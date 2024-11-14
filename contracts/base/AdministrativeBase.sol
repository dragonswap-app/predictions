// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

abstract contract AdministrativeBase is OwnableUpgradeable {
    address public adminAddress; // address of the admin
    address public operatorAddress; // address of the operator

    event NewAdminAddress(address admin);
    event NewOperatorAddress(address operator);

    error OnlyAdmin();
    error OnlyAdminOrOperator();
    error OnlyOperator();
    error InvalidAddress();

    modifier onlyAdmin() {
        _onlyAdmin();
        _;
    }

    modifier onlyAdminOrOperator() {
        _onlyAdminOrOperator();
        _;
    }

    modifier onlyOperator() {
        _onlyOperator();
        _;
    }

    /**
     * @notice Initialize the contract
     * @param _adminAddress: admin address
     * @param _operatorAddress: operator address
     */
    function initializeAdministration(address _owner, address _adminAddress, address _operatorAddress)
        internal
        onlyInitializing
    {
        __Ownable_init(_owner);

        if (_adminAddress == address(0)) revert InvalidAddress();
        adminAddress = _adminAddress;
        if (_operatorAddress == address(0)) revert InvalidAddress();
        operatorAddress = _operatorAddress;
    }

    /**
     * @notice Set operator address
     * @dev Callable by admin
     */
    function setOperator(address _operatorAddress) external onlyAdmin {
        if (_operatorAddress == address(0)) revert InvalidAddress();
        operatorAddress = _operatorAddress;

        emit NewOperatorAddress(_operatorAddress);
    }

    /**
     * @notice Set admin address
     * @dev Callable by owner
     */
    function setAdmin(address _adminAddress) external onlyOwner {
        if (_adminAddress == address(0)) revert InvalidAddress();
        adminAddress = _adminAddress;

        emit NewAdminAddress(_adminAddress);
    }

    function _onlyAdmin() private view {
        if (msg.sender != adminAddress) revert OnlyAdmin();
    }

    function _onlyAdminOrOperator() private view {
        if (msg.sender != operatorAddress && msg.sender != adminAddress) revert OnlyAdminOrOperator();
    }

    function _onlyOperator() private view {
        if (msg.sender != operatorAddress) revert OnlyOperator();
    }
}
