// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PredictionBaseNative} from "./base/PredictionBaseNative.sol";
import {SeiNativeOracleAdapter} from "@dragonswap/sei-native-oracle-adapter/src/SeiNativeOracleAdapter.sol";

/**
 * @title PredictionV2.sol
 */
contract PredictionV2 is PredictionBaseNative {
    using SafeERC20 for IERC20;

    string public tokenDenom;

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
        initializeBase(
            _owner, _adminAddress, _operatorAddress, _intervalSeconds, _bufferSeconds, _minBetAmount, _treasuryFee
        );

        if (SeiNativeOracleAdapter.getExchangeRate(_tokenDenom) == 0) revert UnsupportedToken();
        tokenDenom = _tokenDenom;
    }

    function _getPrice() internal view override returns (uint256) {
        return SeiNativeOracleAdapter.getExchangeRate(tokenDenom);
    }
}
