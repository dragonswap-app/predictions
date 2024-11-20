// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AdministrativeBase} from "./AdministrativeBase.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {SeiNativeOracleAdapter} from "@dragonswap/sei-native-oracle-adapter/src/SeiNativeOracleAdapter.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPrediction} from "../interfaces/IPrediction.sol";

abstract contract PredictionBase is IPrediction, AdministrativeBase, PausableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    IERC20 public token; // Token being address(0) implies that bets are paid in native.

    bool public genesisLockOnce;
    bool public genesisStartOnce;

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
    function initializeBase(
        address _owner,
        address _adminAddress,
        address _operatorAddress,
        uint256 _intervalSeconds,
        uint256 _bufferSeconds,
        uint256 _minBetAmount,
        uint256 _treasuryFee
    ) internal onlyInitializing {
        if (_treasuryFee > MAX_TREASURY_FEE) revert TreasuryFeeTooHigh();
        __ReentrancyGuard_init();

        initializeAdministration(_owner, _adminAddress, _operatorAddress);

        intervalSeconds = _intervalSeconds;
        bufferSeconds = _bufferSeconds;
        minBetAmount = _minBetAmount;
        treasuryFee = _treasuryFee;
    }

    function setBettingToken(address _token) internal onlyInitializing {
        if (_token == address(0)) revert InvalidAddress();
        token = IERC20(_token);
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
            _pay(address(msg.sender), reward);
        }
    }

    /**
     * @notice Start the next round n, lock price for round n-1, end round n-2
     * @dev Callable by operator
     */
    function executeRound() external whenNotPaused onlyOperator {
        if (!genesisStartOnce || !genesisLockOnce) revert GenesisNotManaged();

        uint256 price = _getPrice();

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

        uint256 price = _getPrice();

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
        _pay(adminAddress, currentTreasuryAmount);

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
    function recoverToken(IERC20 _token, uint256 _amount) external virtual onlyOwner {
        if (_token == token) revert InvalidAddress();
        _token.safeTransfer(address(msg.sender), _amount);

        emit TokenRecovery(address(_token), _amount);
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

    function _bet(uint256 epoch, uint256 amount, bool bull) internal {
        if (epoch != currentEpoch) revert BetUnavailable();
        if (!_bettable(epoch)) revert NotBettable();
        if (amount < minBetAmount) revert BetAmountTooLow();
        if (ledger[epoch][msg.sender].amount != 0) revert AlreadyMadeABet();

        // Update round data
        Round storage round = rounds[epoch];
        BetInfo storage betInfo = ledger[epoch][msg.sender];
        round.totalAmount = round.totalAmount + amount;
        if (bull) {
            betInfo.position = Position.Bull;
            round.bullAmount += amount;
        } else {
            betInfo.position = Position.Bear;
            round.bearAmount += amount;
        }

        betInfo.amount = amount;
        userRounds[msg.sender].push(epoch);

        emit Bet(msg.sender, epoch, amount, bull);
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

    function _pay(address to, uint256 value) internal virtual {}

    function _getPrice() internal virtual returns (uint256) {
        return SeiNativeOracleAdapter.getExchangeRate(tokenDenom);
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

    function _onlyEOA() private view {
        if (tx.origin != msg.sender) revert OnlyEOA();
    }
}
