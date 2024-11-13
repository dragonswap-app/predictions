// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract PredictionV4 is OwnableUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    address public adminAddress; // address of the admin
    address public operatorAddress; // address of the operator

    uint256 public minBetAmount; // minimum betting amount (denominated in wei)
    uint256 public treasuryFee; // treasury rate (e.g. 200 = 2%, 150 = 1.50%)
    uint256 public treasuryAmount; // treasury amount that was not claimed

    uint256 public currentRound; // current round number

    uint256 public constant MAX_TREASURY_FEE = 1000; // 10%

    mapping(uint256 => mapping(address => BetInfo)) public ledger;
    mapping(uint256 => Round) public rounds;
    mapping(address => uint256[]) public userRounds;

    enum Position {
        Bull,
        Bear
    }

    enum Outcome {
        Up,
        Down
    }

    struct Round {
        uint256 roundId;
        uint256 startTimestamp;
        uint256 closeTimestamp;
        uint256 totalAmount;
        uint256 bullAmount;
        uint256 bearAmount;
        uint256 rewardBaseCalAmount;
        uint256 rewardAmount;
        bool roundClosed;
        Outcome outcome;
    }

    struct BetInfo {
        Position position;
        uint256 amount;
        bool claimed; // default false
    }

    event StartRound(uint256 indexed round);
    event EndRound(uint256 indexed round, Outcome outcome);
    event BetBear(address indexed sender, uint256 indexed round, uint256 amount);
    event BetBull(address indexed sender, uint256 indexed round, uint256 amount);
    event Claim(address indexed sender, uint256 indexed round, uint256 amount);

    event NewAdminAddress(address admin);
    event NewMinBetAmount(uint256 indexed round, uint256 minBetAmount);
    event NewTreasuryFee(uint256 indexed round, uint256 treasuryFee);
    event NewOperatorAddress(address operator);

    event RewardsCalculated(
        uint256 indexed round,
        uint256 rewardBaseCalAmount,
        uint256 rewardAmount,
        uint256 treasuryAmount
    );

    event TokenRecovery(address indexed token, uint256 amount);
    event TreasuryClaim(uint256 amount);
    event Pause(uint256 indexed round);
    event Unpause(uint256 indexed round);

    modifier onlyAdmin() {
        require(msg.sender == adminAddress, "Not admin");
        _;
    }

    modifier onlyAdminOrOperator() {
        require(msg.sender == adminAddress || msg.sender == operatorAddress, "Not operator/admin");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operatorAddress, "Not operator");
        _;
    }

    modifier notContract() {
        require(!_isContract(msg.sender), "Contract not allowed");
        require(msg.sender == tx.origin, "Proxy contract not allowed");
        _;
    }

    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Constructor
     * @param _adminAddress: admin address
     * @param _operatorAddress: operator address
     * @param _minBetAmount: minimum bet amounts (in wei)
     * @param _treasuryFee: treasury fee (1000 = 10%)
     */
    function initialize(
        address _owner,
        address _adminAddress,
        address _operatorAddress,
        uint256 _minBetAmount,
        uint256 _treasuryFee
    ) external initializer {
        require(_treasuryFee <= MAX_TREASURY_FEE, "Treasury fee too high");
        __Ownable_init(_owner);
        __Pausable_init();
        __ReentrancyGuard_init();

        adminAddress = _adminAddress;
        operatorAddress = _operatorAddress;
        minBetAmount = _minBetAmount;
        treasuryFee = _treasuryFee;
    }

    function betBear(uint256 roundId) external payable whenNotPaused nonReentrant notContract {
        require(roundId == currentRound, "Bet is too early/late");
        require(_bettable(roundId), "Round not bettable");
        require(msg.value >= minBetAmount, "Bet amount must be greater than minBetAmount");
        require(ledger[roundId][msg.sender].amount == 0, "Can only bet once per round");

        // Update round data
        uint256 amount = msg.value;
        Round storage round = rounds[roundId];
        round.totalAmount = round.totalAmount + amount;
        round.bearAmount = round.bearAmount + amount;

        // Update user data
        BetInfo storage betInfo = ledger[roundId][msg.sender];
        betInfo.position = Position.Bear;
        betInfo.amount = amount;
        userRounds[msg.sender].push(roundId);

        emit BetBear(msg.sender, roundId, amount);
    }

    function betBull(uint256 roundId) external payable whenNotPaused nonReentrant notContract {
        require(roundId == currentRound, "Bet is too early/late");
        require(_bettable(roundId), "Round not bettable");
        require(msg.value >= minBetAmount, "Bet amount must be greater than minBetAmount");
        require(ledger[roundId][msg.sender].amount == 0, "Can only bet once per round");

        // Update round data
        uint256 amount = msg.value;
        Round storage round = rounds[roundId];
        round.totalAmount = round.totalAmount + amount;
        round.bullAmount = round.bullAmount + amount;

        // Update user data
        BetInfo storage betInfo = ledger[roundId][msg.sender];
        betInfo.position = Position.Bull;
        betInfo.amount = amount;
        userRounds[msg.sender].push(roundId);

        emit BetBull(msg.sender, roundId, amount);
    }

    /**
     * @notice Claim reward for a round
     * @param roundId: round id
     */
    function claim(uint256 roundId) external nonReentrant notContract {
        uint256 reward; // Initializes reward

        require(rounds[roundId].startTimestamp != 0, "Round has not started");
        require(rounds[roundId].roundClosed, "Round has not ended");

        uint256 addedReward = 0;

        require(claimable(roundId, msg.sender), "Not eligible for claim");
        Round memory round = rounds[roundId];
        addedReward = (ledger[roundId][msg.sender].amount * round.rewardAmount) / round.rewardBaseCalAmount;

        ledger[roundId][msg.sender].claimed = true;
        reward += addedReward;

        emit Claim(msg.sender, roundId, addedReward);

        if (reward > 0) {
            _safeTransferNative(address(msg.sender), reward);
        }
    }

    /**
     * @notice Starts round
     * @dev Callable by operator
     */
    function startNewRound(uint256 _startTimestamp) public whenNotPaused onlyOperator {
        require(_startTimestamp > block.timestamp, "startTimestamp must be greater than current timestamp");

        currentRound = currentRound + 1;

        uint256 roundId = currentRound;
        Round storage round = rounds[roundId];
        round.startTimestamp = _startTimestamp;
        round.totalAmount = 0;
        round.roundId = roundId;

        emit StartRound(roundId);
    }

    /**
     * @notice Closes round
     * @param _roundToEnd: the round that is being closed
     * @param _outcome: the outcome of the round
     * @dev Callable by operator
     */
    function closeRound(uint256 _roundToEnd, Outcome _outcome) public whenNotPaused onlyOperator {
        require(_roundToEnd == currentRound, "Round does not exist");
        require(!rounds[_roundToEnd].roundClosed, "Round has already been closed");

        _safeEndRound(_roundToEnd, _outcome);

        _calculateRewards(_roundToEnd);
    }

    /**
    /**
     * @notice called by the admin to pause, triggers stopped state
     * @dev Callable by admin or operator
     */
    function pause() external whenNotPaused onlyAdminOrOperator {
        _pause();

        emit Pause(currentRound);
    }

    /**
     * @notice Claim all rewards in treasury
     * @dev Callable by admin
     */
    function claimTreasury() external nonReentrant onlyAdmin {
        uint256 currentTreasuryAmount = treasuryAmount;
        treasuryAmount = 0;
        _safeTransferNative(adminAddress, currentTreasuryAmount);

        emit TreasuryClaim(currentTreasuryAmount);
    }

    /**
     * @notice called by the admin to unpause, returns to normal state
     * Reset genesis state. Once paused, the rounds would need to be kickstarted by genesis
     * @dev Callable by admin or operator
     */
    function unpause() external whenPaused onlyAdminOrOperator {
        _unpause();

        emit Unpause(currentRound);
    }

    /**
     * @notice Set minBetAmount
     * @dev Callable by admin
     */
    function setMinBetAmount(uint256 _minBetAmount) external whenPaused onlyAdmin {
        require(_minBetAmount != 0, "Must be superior to 0");
        minBetAmount = _minBetAmount;

        emit NewMinBetAmount(currentRound, minBetAmount);
    }

    /**
     * @notice Set operator address
     * @dev Callable by admin
     */
    function setOperator(address _operatorAddress) external onlyAdmin {
        require(_operatorAddress != address(0), "Cannot be zero address");
        operatorAddress = _operatorAddress;

        emit NewOperatorAddress(_operatorAddress);
    }

    /**
     * @notice Set treasury fee
     * @dev Callable by admin
     */
    function setTreasuryFee(uint256 _treasuryFee) external whenPaused onlyAdmin {
        require(_treasuryFee <= MAX_TREASURY_FEE, "Treasury fee too high");
        treasuryFee = _treasuryFee;

        emit NewTreasuryFee(currentRound, treasuryFee);
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
        require(_adminAddress != address(0), "Cannot be zero address");
        adminAddress = _adminAddress;

        emit NewAdminAddress(_adminAddress);
    }

    /**
     * @notice Returns rounds and bet information for a user that has participated
     * @param user: user address
     * @param cursor: cursor
     * @param size: size
     */
    function getUserRounds(
        address user,
        uint256 cursor,
        uint256 size
    ) external view returns (uint256[] memory, BetInfo[] memory, uint256) {
        uint256 length = size;

        if (length > userRounds[user].length - cursor) {
            length = userRounds[user].length - cursor;
        }

        uint256[] memory values = new uint256[](length);
        BetInfo[] memory betInfo = new BetInfo[](length);

        for (uint256 i = 0; i < length; i++) {
            values[i] = userRounds[user][cursor + i];
            betInfo[i] = ledger[values[i]][user];
        }

        return (values, betInfo, cursor + length);
    }

    /**
     * @notice Returns rounds length
     * @param user: user address
     */
    function getUserRoundsLength(address user) external view returns (uint256) {
        return userRounds[user].length;
    }

    /**
     * @notice Get the claimable stats of specific round and user account
     * @param roundId: round id
     * @param user: user address
     */
    function claimable(uint256 roundId, address user) public view returns (bool) {
        BetInfo memory betInfo = ledger[roundId][user];
        Round memory round = rounds[roundId];

        return
            round.roundClosed &&
            betInfo.amount != 0 &&
            !betInfo.claimed &&
            ((round.outcome == Outcome.Up && betInfo.position == Position.Bull) ||
                (round.outcome == Outcome.Down && betInfo.position == Position.Bear));
    }

    /**
     * @notice Calculate rewards for round
     * @param roundId: round id
     */
    function _calculateRewards(uint256 roundId) internal {
        require(rounds[roundId].rewardBaseCalAmount == 0 && rounds[roundId].rewardAmount == 0, "Rewards calculated");
        Round storage round = rounds[roundId];
        uint256 rewardBaseCalAmount;
        uint256 treasuryAmt;
        uint256 rewardAmount;

        if (round.outcome == Outcome.Up) {
            // Bull wins
            rewardBaseCalAmount = round.bullAmount;
            treasuryAmt = (round.totalAmount * treasuryFee) / 10000;
            rewardAmount = round.totalAmount - treasuryAmt;
        } else if (round.outcome == Outcome.Down) {
            // Bear wins
            rewardBaseCalAmount = round.bearAmount;
            treasuryAmt = (round.totalAmount * treasuryFee) / 10000;
            rewardAmount = round.totalAmount - treasuryAmt;
        }

        round.rewardBaseCalAmount = rewardBaseCalAmount;
        round.rewardAmount = rewardAmount;

        // Add to treasury
        treasuryAmount += treasuryAmt;

        emit RewardsCalculated(roundId, rewardBaseCalAmount, rewardAmount, treasuryAmt);
    }

    /**
     * @notice End round
     * @param roundId: round id
     * @param _outcome: winning side of the round
     */
    function _safeEndRound(uint256 roundId, Outcome _outcome) internal {
        Round storage round = rounds[roundId];
        round.closeTimestamp = block.timestamp;
        round.outcome = _outcome;
        round.roundClosed = true;

        emit EndRound(roundId, round.outcome);
    }

    /**
     * @notice Check if round is bettable
     * @param roundId: round id
     */
    function _bettable(uint256 roundId) internal view returns (bool) {
        return
            rounds[roundId].startTimestamp != 0 &&
            rounds[roundId].startTimestamp < block.timestamp &&
            !rounds[roundId].roundClosed;
    }

    /**
     * @notice Get round stats
     * @param roundId: round id
     */
    function roundStats(
        uint256 roundId
    ) public view returns (uint256 poolSize, uint256 bullMultiplier, uint256 bearMultiplier) {
        Round memory round = rounds[roundId];
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
     * @notice Transfer Native token in a safe way
     * @param to: address to transfer native token to
     * @param value: Native token amount to transfer (in wei)
     */
    function _safeTransferNative(address to, uint256 value) internal {
        (bool success, ) = to.call{value: value}("");
        require(success, "TransferHelper: NATIVE_TOKEN_TRANSFER_FAILED");
    }

    /**
     * @notice Returns true if `account` is a contract.a
     * @param account: account address
     */
    function _isContract(address account) internal view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(account)
        }
        return size > 0;
    }
}
