// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AdministrativeBase} from "./AdministrativeBase.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

contract PredictionBasePyth is AdministrativeBase, PausableUpgradeable {
    IPyth public pythOracle;
    bytes32 public priceFeedId;

    uint256 public oracleUpdateAllowance; // seconds

    event NewOracleAndPriceFeedId(address oracle, bytes32 priceFeedId);
    event NewOracleUpdateAllowance(uint256 oracleUpdateAllowance);

    error InvalidBytes32Value();

    function initializePyth(address _oracleAddress, uint256 _oracleUpdateAllowance, bytes32 _priceFeedId)
        internal
        onlyInitializing
    {
        if (_oracleAddress == address(0)) revert InvalidAddress();
        pythOracle = IPyth(_oracleAddress);

        oracleUpdateAllowance = _oracleUpdateAllowance;
        if (_priceFeedId == bytes32(0)) revert InvalidBytes32Value();
        priceFeedId = _priceFeedId;
    }

    /**
     * @notice Set Oracle address and Pyth price feed id
     * @dev Callable by admin
     */
    function setOracleAndPriceFeedId(address _oracle, bytes32 _priceFeedId) external whenPaused onlyAdmin {
        if (_oracle == address(0)) revert InvalidAddress();
        if (_priceFeedId == bytes32(0)) revert InvalidBytes32Value();

        pythOracle = IPyth(_oracle);
        priceFeedId = _priceFeedId;

        emit NewOracleAndPriceFeedId(_oracle, priceFeedId);
    }

    /**
     * @notice Set oracle update allowance
     * @dev Callable by admin
     */
    function setOracleUpdateAllowance(uint256 _oracleUpdateAllowance) external whenPaused onlyAdmin {
        oracleUpdateAllowance = _oracleUpdateAllowance;

        emit NewOracleUpdateAllowance(_oracleUpdateAllowance);
    }
}
