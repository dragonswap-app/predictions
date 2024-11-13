// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PredictionBase} from "./PredictionBase.sol";

abstract contract PredictionBaseERC20 is PredictionBase {
    using SafeERC20 for IERC20;
    /**
     * @notice Bet bull position
     * @param epoch: epoch
     * @param bull: true -> bull / false -> bear
     */
    function bet(uint256 epoch, uint256 amount, bool bull) external whenNotPaused nonReentrant onlyEOA {
        _bet(epoch, amount, bull);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    function _pay(address to, uint256 value) internal override {
        token.safeTransfer(to, value);
    }

    function _getPrice() internal override virtual returns (uint256) {

    }
}
