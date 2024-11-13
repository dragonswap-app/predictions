// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPrediction {
    enum Position {
        Bull,
        Bear
    }

    struct Round {
        uint256 epoch;
        uint256 startTimestamp;
        uint256 lockTimestamp;
        uint256 closeTimestamp;
        uint256 lockPrice;
        uint256 closePrice;
        uint256 totalAmount;
        uint256 bullAmount;
        uint256 bearAmount;
        uint256 rewardBaseCalAmount;
        uint256 rewardAmount;
        bool oracleCalled;
    }

    struct BetInfo {
        Position position;
        uint256 amount;
        bool claimed; // default false
    }

    event BetBear(address indexed sender, uint256 indexed epoch, uint256 amount); //de
    event BetBull(address indexed sender, uint256 indexed epoch, uint256 amount); //de
    event Bet(address indexed sender, uint256 indexed epoch, uint256 amount, bool bull);
    event Claim(address indexed sender, uint256 indexed epoch, uint256 amount);
    event EndRound(uint256 indexed epoch, uint256 price);
    event LockRound(uint256 indexed epoch, uint256 price);

    event NewAdminAddress(address admin);
    event NewBufferAndIntervalSeconds(uint256 bufferSeconds, uint256 intervalSeconds);
    event NewMinBetAmount(uint256 indexed epoch, uint256 minBetAmount);
    event NewTreasuryFee(uint256 indexed epoch, uint256 treasuryFee);
    event NewOperatorAddress(address operator);

    event Pause(uint256 indexed epoch);
    event RewardsCalculated(
        uint256 indexed epoch, uint256 rewardBaseCalAmount, uint256 rewardAmount, uint256 treasuryAmount
    );

    event StartRound(uint256 indexed epoch);
    event TokenRecovery(address indexed token, uint256 amount);
    event TreasuryClaim(uint256 amount);
    event Unpause(uint256 indexed epoch);

    event NewOracleAndPriceFeedId(address oracle, bytes32 priceFeedId);
    event NewOracleUpdateAllowance(uint256 oracleUpdateAllowance);

    error OnlyAdmin();
    error OnlyAdminOrOperator();
    error OnlyOperator();
    error OnlyEOA();
    error UnsupportedToken();
    error TreasuryFeeTooHigh();
    error NotClaimable();
    error NotBettable();
    error RoundNotLocked();
    error RoundNotOverYet();
    error RoundNotStartedYet();
    error RoundNMinus2MustBeClosed();
    error RoundNMinus2ClosingTimeNotPassed();
    error RewardsAlreadyCalculated();
    error ClosingPeriodEnded();
    error SeiTransferFailed();
    error CannotLockYet();
    error CannotCloseYet();
    error InvalidAddress();
    error InvalidMinBetAmount();
    error GenesisAlreadyLocked();
    error GenesisAlreadyStarted();
    error InvalidTimespanRelation();
    error GenesisNotManaged();
    error GenesisNotStarted();
    error NotRefundable();
    error AlreadyMadeABet();
    error BetAmountTooLow();
    error BetUnavailable();
    error InvalidBytes32Value();
}
