// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPrediction} from "./interfaces/IPrediction.sol";
import {SeiNativeOracleAdapter} from "@dragonswap/sei-native-oracle-adapter/src/SeiNativeOracleAdapter.sol";

/**
 * @title PredictionV2.sol
 */
contract PredictionV2 is IPrediction, OwnableUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    bool public genesisLockOnce;
    bool public genesisStartOnce;

    address public adminAddress; // address of the admin
    address public operatorAddress; // address of the operator

    uint256 public bufferSeconds; // number of seconds for valid execution of a prediction round
    uint256 public intervalSeconds; // interval in seconds between two prediction rounds

    uint256 public minBetAmount; // minimum betting amount (denominated in wei)
    uint256 public treasuryFee; // treasury rate (e.g. 200 = 2%, 150 = 1.50%)
    uint256 public treasuryAmount; // treasury amount that was not claimed

    uint256 public currentEpoch; // current epoch for prediction round

    string public tokenDenom;

    mapping(uint256 => Round) public rounds;
    mapping(address => uint256[]) public userRounds;
    mapping(uint256 => mapping(address => BetInfo)) public ledger;

    uint256 public constant MAX_TREASURY_FEE = 1_000; // 10%

    modifier onlyAdmin() {
        _onlyAdmin();
        _;
    }

    modifier onlyAdminOrOperator() {
        _onlyAdminOrOperator();
        _;
    }

    modifier onlyOperator() {
        _onlyOperator();
        _;
    }

    modifier onlyEOA() {
        _onlyEOA();
        _;
    }

    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param _adminAddress: admin address
     * @param _operatorAddress: operator address
     * @param _intervalSeconds: number of time within an interval
     * @param _bufferSeconds: buffer of time for resolution of price
     * @param _minBetAmount: minimum bet amounts (in wei)
     * @param _treasuryFee: treasury fee (1000 = 10%)
     */
    function initialize(
        address _owner,
        address _adminAddress,
        address _operatorAddress,
        uint256 _intervalSeconds,
        uint256 _bufferSeconds,
        uint256 _minBetAmount,
        uint256 _treasuryFee,
        string calldata _tokenDenom
    ) external initializer {
        if (_treasuryFee > MAX_TREASURY_FEE) revert TreasuryFeeTooHigh();
        __Ownable_init(_owner);
        __Pausable_init();
        __ReentrancyGuard_init();

        if (_adminAddress == address(0)) revert InvalidAddress();
        adminAddress = _adminAddress;
        if (_operatorAddress == address(0)) revert InvalidAddress();
        operatorAddress = _operatorAddress;
        intervalSeconds = _intervalSeconds;
        bufferSeconds = _bufferSeconds;
        minBetAmount = _minBetAmount;
        treasuryFee = _treasuryFee;

        if (SeiNativeOracleAdapter.getExchangeRate(_tokenDenom) == 0) revert UnsupportedToken();
        tokenDenom = _tokenDenom;
    }

    /**
     * @notice Bet bear position
     * @param epoch: epoch
     */
    function betBear(uint256 epoch) external payable whenNotPaused nonReentrant onlyEOA {
        if (epoch != currentEpoch) revert BetUnavailable();
        if (!_bettable(epoch)) revert NotBettable();
        if (msg.value < minBetAmount) revert BetAmountTooLow();
        if (ledger[epoch][msg.sender].amount != 0) revert AlreadyMadeABet();

        // Update round data
        uint256 amount = msg.value;
        Round storage round = rounds[epoch];
        round.totalAmount = round.totalAmount + amount;
        round.bearAmount = round.bearAmount + amount;

        // Update user data
        BetInfo storage betInfo = ledger[epoch][msg.sender];
        betInfo.position = Position.Bear;
        betInfo.amount = amount;
        userRounds[msg.sender].push(epoch);

        emit BetBear(msg.sender, epoch, amount);
    }

    /**
     * @notice Bet bull position
     * @param epoch: epoch
     */
    function betBull(uint256 epoch) external payable whenNotPaused nonReentrant onlyEOA {
        if (epoch != currentEpoch) revert BetUnavailable();
        if (!_bettable(epoch)) revert NotBettable();
        if (msg.value < minBetAmount) revert BetAmountTooLow();
        if (ledger[epoch][msg.sender].amount != 0) revert AlreadyMadeABet();

        // Update round data
        uint256 amount = msg.value;
        Round storage round = rounds[epoch];
        round.totalAmount = round.totalAmount + amount;
        round.bullAmount = round.bullAmount + amount;

        // Update user data
        BetInfo storage betInfo = ledger[epoch][msg.sender];
        betInfo.position = Position.Bull;
        betInfo.amount = amount;
        userRounds[msg.sender].push(epoch);

        emit BetBull(msg.sender, epoch, amount);
    }

    /**
     * @notice Claim reward for an array of epochs
     * @param epochs: array of epochs
     */
    function claim(uint256[] calldata epochs) external nonReentrant onlyEOA {
        uint256 reward; // Initializes reward

        for (uint256 i = 0; i < epochs.length; ++i) {
            uint256 epoch = epochs[i];
            if (rounds[epoch].startTimestamp == 0 || block.timestamp <= rounds[epoch].closeTimestamp) {
                revert RoundNotOverYet();
            }

            uint256 addedReward;

            // Round valid, claim rewards
            if (rounds[epoch].oracleCalled) {
                if (!claimable(epoch, msg.sender)) revert NotClaimable();
                Round memory round = rounds[epoch];
                addedReward = (ledger[epoch][msg.sender].amount * round.rewardAmount) / round.rewardBaseCalAmount;
            }
            // Round invalid, refund bet amount
            else {
                if (!refundable(epoch, msg.sender)) revert NotRefundable();
                addedReward = ledger[epoch][msg.sender].amount;
            }

            ledger[epoch][msg.sender].claimed = true;
            reward += addedReward;

            emit Claim(msg.sender, epoch, addedReward);
        }

        if (reward > 0) {
            _safeTransferSEI(address(msg.sender), reward);
        }
    }

    /**
     * @notice Start the next round n, lock price for round n-1, end round n-2
     * @dev Callable by operator
     */
    function executeRound() external whenNotPaused onlyOperator {
        if (!genesisStartOnce || !genesisLockOnce) revert GenesisNotManaged();

        uint256 price = SeiNativeOracleAdapter.getExchangeRate(tokenDenom);

        // CurrentEpoch refers to previous round (n-1)
        _safeLockRound(currentEpoch, price);
        _safeEndRound(currentEpoch - 1, price);
        _calculateRewards(currentEpoch - 1);

        // Increment currentEpoch to current round (n)
        currentEpoch = currentEpoch + 1;
        _safeStartRound(currentEpoch);
    }

    /**
     * @notice Lock genesis round
     * @dev Callable by operator
     */
    function genesisLockRound() external whenNotPaused onlyOperator {
        if (!genesisStartOnce) revert GenesisNotStarted();
        if (genesisLockOnce) revert GenesisAlreadyLocked();

        uint256 price = SeiNativeOracleAdapter.getExchangeRate(tokenDenom);

        _safeLockRound(currentEpoch, price);

        currentEpoch = currentEpoch + 1;
        _startRound(currentEpoch);
        genesisLockOnce = true;
    }

    /**
     * @notice Start genesis round
     * @dev Callable by admin or operator
     */
    function genesisStartRound() external whenNotPaused onlyOperator {
        if (genesisStartOnce) revert GenesisAlreadyStarted();

        currentEpoch = currentEpoch + 1;
        _startRound(currentEpoch);
        genesisStartOnce = true;
    }

    /**
     * @notice called by the admin to pause, triggers stopped state
     * @dev Callable by admin or operator
     */
    function pause() external whenNotPaused onlyAdminOrOperator {
        _pause();

        emit Pause(currentEpoch);
    }

    /**
     * @notice Claim all rewards in treasury
     * @dev Callable by admin
     */
    function claimTreasury() external nonReentrant onlyAdmin {
        uint256 currentTreasuryAmount = treasuryAmount;
        treasuryAmount = 0;
        _safeTransferSEI(adminAddress, currentTreasuryAmount);

        emit TreasuryClaim(currentTreasuryAmount);
    }

    /**
     * @notice called by the admin to unpause, returns to normal state
     * Reset genesis state. Once paused, the rounds would need to be kickstarted by genesis
     */
    function unpause() external whenPaused onlyAdminOrOperator {
        genesisStartOnce = false;
        genesisLockOnce = false;
        _unpause();

        emit Unpause(currentEpoch);
    }

    /**
     * @notice Set buffer and interval (in seconds)
     * @dev Callable by admin
     */
    function setBufferAndIntervalSeconds(uint256 _bufferSeconds, uint256 _intervalSeconds)
        external
        whenPaused
        onlyAdmin
    {
        if (_bufferSeconds >= _intervalSeconds) revert InvalidTimespanRelation();
        bufferSeconds = _bufferSeconds;
        intervalSeconds = _intervalSeconds;

        emit NewBufferAndIntervalSeconds(_bufferSeconds, _intervalSeconds);
    }

    /**
     * @notice Set minBetAmount
     * @dev Callable by admin
     */
    function setMinBetAmount(uint256 _minBetAmount) external whenPaused onlyAdmin {
        if (_minBetAmount == 0) revert InvalidMinBetAmount();
        minBetAmount = _minBetAmount;

        emit NewMinBetAmount(currentEpoch, minBetAmount);
    }

    /**
     * @notice Set operator address
     * @dev Callable by admin
     */
    function setOperator(address _operatorAddress) external onlyAdmin {
        if (_operatorAddress == address(0)) revert InvalidAddress();
        operatorAddress = _operatorAddress;

        emit NewOperatorAddress(_operatorAddress);
    }

    /**
     * @notice Set treasury fee
     * @dev Callable by admin
     */
    function setTreasuryFee(uint256 _treasuryFee) external whenPaused onlyAdmin {
        if (_treasuryFee > MAX_TREASURY_FEE) revert TreasuryFeeTooHigh();
        treasuryFee = _treasuryFee;

        emit NewTreasuryFee(currentEpoch, treasuryFee);
    }

    /**
     * @notice It allows the owner to recover tokens sent to the contract by mistake
     * @param _token: token address
     * @param _amount: token amount
     * @dev Callable by owner
     */
    function recoverToken(address _token, uint256 _amount) external onlyOwner {
        IERC20(_token).safeTransfer(address(msg.sender), _amount);

        emit TokenRecovery(_token, _amount);
    }

    /**
     * @notice Set admin address
     * @dev Callable by owner
     */
    function setAdmin(address _adminAddress) external onlyOwner {
        if (_adminAddress == address(0)) revert InvalidAddress();
        adminAddress = _adminAddress;

        emit NewAdminAddress(_adminAddress);
    }

    /**
     * @notice Returns round epochs and bet information for a user that has participated
     * @param user: user address
     * @param cursor: cursor
     * @param size: size
     */
    function getUserRounds(address user, uint256 cursor, uint256 size)
        external
        view
        returns (uint256[] memory, BetInfo[] memory, uint256)
    {
        uint256 length = size;

        if (length > userRounds[user].length - cursor) {
            length = userRounds[user].length - cursor;
        }

        uint256[] memory values = new uint256[](length);
        BetInfo[] memory betInfo = new BetInfo[](length);

        for (uint256 i = 0; i < length; ++i) {
            values[i] = userRounds[user][cursor + i];
            betInfo[i] = ledger[values[i]][user];
        }

        return (values, betInfo, cursor + length);
    }

    /**
     * @notice Returns round epochs length
     * @param user: user address
     */
    function getUserRoundsLength(address user) external view returns (uint256) {
        return userRounds[user].length;
    }

    /**
     * @notice Get the claimable stats of specific epoch and user account
     * @param epoch: epoch
     * @param user: user address
     */
    function claimable(uint256 epoch, address user) public view returns (bool) {
        BetInfo memory betInfo = ledger[epoch][user];
        Round memory round = rounds[epoch];
        if (round.lockPrice == round.closePrice) {
            return false;
        }
        return round.oracleCalled && betInfo.amount != 0 && !betInfo.claimed
            && (
                (round.closePrice > round.lockPrice && betInfo.position == Position.Bull)
                    || (round.closePrice < round.lockPrice && betInfo.position == Position.Bear)
            );
    }

    /**
     * @notice Get the refundable stats of specific epoch and user account
     * @param epoch: epoch
     * @param user: user address
     */
    function refundable(uint256 epoch, address user) public view returns (bool) {
        BetInfo memory betInfo = ledger[epoch][user];
        Round memory round = rounds[epoch];
        return !round.oracleCalled && !betInfo.claimed && block.timestamp > round.closeTimestamp + bufferSeconds
            && betInfo.amount != 0;
    }

    /**
     * @notice Get round stats
     * @param epoch: epoch
     */
    function roundStats(uint256 epoch)
        public
        view
        returns (uint256 poolSize, uint256 bullMultiplier, uint256 bearMultiplier)
    {
        Round memory round = rounds[epoch];
        poolSize = round.totalAmount;
        if (round.bullAmount > 0) {
            bullMultiplier = (poolSize * 100) / round.bullAmount;
        }
        if (round.bearAmount > 0) {
            bearMultiplier = (poolSize * 100) / round.bearAmount;
        }
        return (poolSize, bullMultiplier, bearMultiplier);
    }

    /**
     * @notice Calculate rewards for round
     * @param epoch: epoch
     */
    function _calculateRewards(uint256 epoch) private {
        if (rounds[epoch].rewardBaseCalAmount != 0 || rounds[epoch].rewardAmount != 0) {
            revert RewardsAlreadyCalculated();
        }
        Round storage round = rounds[epoch];
        uint256 rewardBaseCalAmount;
        uint256 treasuryAmt;
        uint256 rewardAmount;

        // Bull wins
        if (round.closePrice > round.lockPrice) {
            rewardBaseCalAmount = round.bullAmount;
            treasuryAmt = (round.totalAmount * treasuryFee) / 10_000;
            rewardAmount = round.totalAmount - treasuryAmt;
        }
        // Bear wins
        else if (round.closePrice < round.lockPrice) {
            rewardBaseCalAmount = round.bearAmount;
            treasuryAmt = (round.totalAmount * treasuryFee) / 10_000;
            rewardAmount = round.totalAmount - treasuryAmt;
        }
        // House wins
        else {
            rewardBaseCalAmount = 0;
            rewardAmount = 0;
            treasuryAmt = round.totalAmount;
        }
        round.rewardBaseCalAmount = rewardBaseCalAmount;
        round.rewardAmount = rewardAmount;

        // Add to treasury
        treasuryAmount += treasuryAmt;

        emit RewardsCalculated(epoch, rewardBaseCalAmount, rewardAmount, treasuryAmt);
    }

    /**
     * @notice End round
     * @param epoch: epoch
     * @param price: price of the round
     */
    function _safeEndRound(uint256 epoch, uint256 price) private {
        if (rounds[epoch].lockTimestamp == 0) revert RoundNotLocked();
        if (block.timestamp < rounds[epoch].closeTimestamp) revert CannotCloseYet();
        if (block.timestamp > rounds[epoch].closeTimestamp + bufferSeconds) revert ClosingPeriodEnded();
        Round storage round = rounds[epoch];
        round.closePrice = price;
        round.oracleCalled = true;

        emit EndRound(epoch, round.closePrice);
    }

    /**
     * @notice Lock round
     * @param epoch: epoch
     * @param price: price of the round
     */
    function _safeLockRound(uint256 epoch, uint256 price) private {
        if (rounds[epoch].startTimestamp == 0) revert RoundNotStartedYet();
        if (block.timestamp < rounds[epoch].lockTimestamp) revert CannotLockYet();
        if (block.timestamp > rounds[epoch].lockTimestamp + bufferSeconds) revert ClosingPeriodEnded();
        Round storage round = rounds[epoch];
        round.closeTimestamp = block.timestamp + intervalSeconds;
        round.lockPrice = price;

        emit LockRound(epoch, round.lockPrice);
    }

    /**
     * @notice Start round
     * Previous round n-2 must end
     * @param epoch: epoch
     */
    function _safeStartRound(uint256 epoch) private {
        if (!genesisStartOnce) revert GenesisNotStarted();
        if (rounds[epoch - 2].closeTimestamp == 0) revert RoundNMinus2MustBeClosed();
        if (block.timestamp < rounds[epoch - 2].closeTimestamp) revert RoundNMinus2ClosingTimeNotPassed();
        _startRound(epoch);
    }

    /**
     * @notice Transfer SEI in a safe way
     * @param to: address to transfer SEI to
     * @param value: SEI amount to transfer (in wei)
     */
    function _safeTransferSEI(address to, uint256 value) private {
        (bool success,) = to.call{value: value}("");
        if (!success) revert SeiTransferFailed();
    }

    /**
     * @notice Start round
     * Previous round n-2 must end
     * @param epoch: epoch
     */
    function _startRound(uint256 epoch) private {
        Round storage round = rounds[epoch];
        round.startTimestamp = block.timestamp;
        round.lockTimestamp = block.timestamp + intervalSeconds;
        round.closeTimestamp = block.timestamp + (2 * intervalSeconds);
        round.epoch = epoch;
        round.totalAmount = 0;

        emit StartRound(epoch);
    }

    /**
     * @notice Determine if a round is valid for receiving bets
     * Round must have started and locked
     * Current timestamp must be within startTimestamp and closeTimestamp
     */
    function _bettable(uint256 epoch) private view returns (bool) {
        return rounds[epoch].startTimestamp != 0 && rounds[epoch].lockTimestamp != 0
            && block.timestamp > rounds[epoch].startTimestamp && block.timestamp < rounds[epoch].lockTimestamp;
    }

    function _onlyAdmin() private view {
        if (msg.sender != adminAddress) revert OnlyAdmin();
    }

    function _onlyAdminOrOperator() private view {
        if (msg.sender != operatorAddress && msg.sender != adminAddress) revert OnlyAdminOrOperator();
    }

    function _onlyOperator() private view {
        if (msg.sender != operatorAddress) revert OnlyOperator();
    }

    function _onlyEOA() private view {
        if (tx.origin != msg.sender) revert OnlyEOA();
    }
}