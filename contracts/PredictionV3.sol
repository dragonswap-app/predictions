// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PredictionBaseERC20} from "./base/PredictionBaseERC20.sol";
import {SeiNativeOracleAdapter} from "@dragonswap/sei-native-oracle-adapter/src/SeiNativeOracleAdapter.sol";

contract PredictionV3 is PredictionBaseERC20 {
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
        address _token,
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

        setBettingToken(_token);

        if (SeiNativeOracleAdapter.getExchangeRate(_tokenDenom) == 0) revert UnsupportedToken();
        tokenDenom = _tokenDenom;
    }
}
