// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PredictionBase} from "./PredictionBase.sol";
import {SeiNativeOracleAdapter} from "@dragonswap/sei-native-oracle-adapter/src/SeiNativeOracleAdapter.sol";

/**
 * @title PredictionV2.sol
 */
abstract contract PredictionBaseNative is PredictionBase {
    /**
     * @notice Bet bull position
     * @param epoch: epoch
     * @param bull: true -> bull / false -> bear
     */
    function bet(uint256 epoch, bool bull) external payable whenNotPaused nonReentrant onlyEOA {
        _bet(epoch, msg.value, bull);
    }

    function _pay(address to, uint256 value) internal override {
        (bool success,) = to.call{value: value}("");
        if (!success) revert SeiTransferFailed();
    }

    function _getPrice() internal override virtual returns (uint256) {

    }
}
