# Predictions

- Decentralized predictions

  A decentralized prediction system using the Pyth Oracle for on-chain price feeds. This system allows users to predict future price movements based on real-time data provided by the Pyth network.

- Centralized predictions

  A centralized prediction system using in-house oracle ensures the integrity and reliability of our predictions, delivering a transparent and fair experience for all participants. This system allows users to predict outcome of all kinds of events, from sports scores to market trends.


## Setup

### Dependencies
- `$ nvm use`
- `$ npm install`

### Environment
- Get a private key from Metamask
- Create a `.env` file with the following information:
  - KEY_MAINNET=private key from Metamask
  - KEY_TESTNET=private key from Metamask


## Description

This repository contains a PredictionsFactory contract and four versions of the Predictions contracts:

`PredictionFactory` is contract that is used for deploying new instances of Predictions based on their version.

`Predictions` contracts are divided into two categories:

Decentralized predictions:
- **PredictionV2**: Allows users to bet using native currency on the price of any token we want to support.
- **PredictionV3**: Enhances the system by allowing users to bet with chosen ERC20 tokens on price of a chosen ERC20 token or any other token that we want to support.

Centralized predictions:
- **PredictionV4**: Allows users to bet using native currency on the outcome of events we want to support.
- **PredictionV5**: Enhances the system by allowing users to bet with chosen ERC20 tokens on the outcome of events we want to support.

---

## Table of Contents
1. [PredictionV2](#prediction-v2)

2. [PredictionV3](#predictionv3)

3. [PredictionV4](#predictionv4)

4. [PredictionV5](#predictionv5)

---

## PredictionV2

### Documentation

- **Oracle Price Feed (Pyth)**: [Pyth Network Price Feeds Documentation](https://docs.pyth.network/price-feeds)


## Deployment

- Verify that `config.ts` has the correct information
- Run one of the following commands:
```
npm run deployPredictionV2:mainnet
npm run deployPredictionV2:testnet
```

### <a name="operation-v2"></a>Operation

When a round is started, the round's `lockBlock` and `closeBlock` would be set.

`lockBlock` = current block + `intervalBlocks`

`closeBlock` = current block + (`intervalBlocks` * 2)

## Kick-start Rounds

The rounds are always kick-started with:

```
startGenesisRound()
(wait for x blocks)
lockGenesisRound()
(wait for x blocks)
executeRound()
```

## Continue Running Rounds

```
executeRound()
(wait for x blocks)
executeRound()
(wait for x blocks)
```

## Resuming Rounds

After errors like missing `executeRound()` etc.

```
pause()
(Users can't bet, but still is able to withdraw)
unpause()
startGenesisRound()
(wait for x blocks)
lockGenesisRound()
(wait for x blocks)
executeRound()
```


## PredictionV3

### Documentation

- **Oracle Price Feed (Pyth)**: [Pyth Network Price Feeds Documentation](https://docs.pyth.network/price-feeds)

## Deployment

- Verify that `config.ts` has the correct information
- Run one of the following commands:
```
npm run deployPredictionV3:mainnet
npm run deployPredictionV3:testnet
```

### Operation

When a round is started, the round's `lockBlock` and `closeBlock` would be set.

`lockBlock` = current block + `intervalBlocks`

`closeBlock` = current block + (`intervalBlocks` * 2)

## Kick-start Rounds

The rounds are always kick-started with:

```
startGenesisRound()
(wait for x blocks)
lockGenesisRound()
(wait for x blocks)
executeRound()
```

## Continue Running Rounds

```
executeRound()
(wait for x blocks)
executeRound()
(wait for x blocks)
```

## Resuming Rounds

After errors like missing `executeRound()` etc.

```
pause()
(Users can't bet, but still is able to withdraw)
unpause()
startGenesisRound()
(wait for x blocks)
lockGenesisRound()
(wait for x blocks)
executeRound()
```

## PredictionV4

### Documentation

PredictionV4 uses In-House Oracle to determine the outcome of events.

## Deployment

- Verify that `config.ts` has the correct information
- Run one of the following commands:
```
npm run deployPredictionV4:mainnet
npm run deployPredictionV4:testnet
```

### Operation

PredictionV4 is meant to have one round for one event, but it's possible to have more than one round for one event if in some case there's need for that.

When a round is started, the round's `startTimestamp` would be set.

## Kick-start Round

When a round is started, the round's `startTimestamp` would be set to `_startTimestamp` passed as an argument.

The round is always kick-started with:

```
startNewRound(uint256 _startTimestamp)
```

## Close Round

When a round is closed, the round's `closeTimestamp` is set to current `block.timestamp`

```
closeRound(uint256 _roundToEnd, Outcome _outcome)
```

## PredictionV5

### Documentation

PredictionV5 uses In-House Oracle to determine the outcome of events.

## Deployment

- Verify that `config.ts` has the correct information
- Run one of the following commands:
```
npm run deployPredictionV5:mainnet
npm run deployPredictionV5:testnet
```

### Operation

PredictionV5 is meant to have one round for one event, but it's possible to have more than one round for one event if in some case there's need for that.

When a round is started, the round's `startTimestamp` would be set.

## Kick-start Round

When a round is started, the round's `startTimestamp` would be set to `_startTimestamp` passed as an argument.

The round is always kick-started with:

```
startNewRound(uint256 _startTimestamp)
```

## Close Round

When a round is closed, the round's `closeTimestamp` is set to current `block.timestamp`

```
closeRound(uint256 _roundToEnd, Outcome _outcome)
```