// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PredictionBaseNative} from "./base/PredictionBaseNative.sol";
import {PredictionBasePyth} from "./base/PredictionBasePyth.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

contract PredictionV2Pyth is PredictionBaseNative, PredictionBasePyth {
    using SafeERC20 for IERC20;

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
        address _oracleAddress,
        address _adminAddress,
        address _operatorAddress,
        uint256 _intervalSeconds,
        uint256 _bufferSeconds,
        uint256 _minBetAmount,
        uint256 _oracleUpdateAllowance,
        bytes32 _priceFeedId,
        uint256 _treasuryFee
    ) external initializer {
        initializeBase(
            _owner, _adminAddress, _operatorAddress, _intervalSeconds, _bufferSeconds, _minBetAmount, _treasuryFee
        );
        initializePyth(_oracleAddress, _oracleUpdateAllowance, _priceFeedId);
    }

    function _getPrice() internal view override returns (uint256) {
        return uint256(int256(pythOracle.getPriceNoOlderThan(priceFeedId, oracleUpdateAllowance).price));
    }
}
