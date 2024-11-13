// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SeiNativeOracleAdapter} from "@dragonswap/sei-native-oracle-adapter/src/SeiNativeOracleAdapter.sol";

contract SyntheticPredictionsFactory is Ownable {
    enum Impl {
        NONE,
        V4,
        V5
    }

    // Type of contracts deployed by factory
    mapping(address => Impl) public deploymentToImplType;
    // Array of all sale deployments
    address[] public deployments;
    // PredictionV4 contract implementation
    address public implPredictionV4;
    // PredictionV5 contract implementation
    address public implPredictionV5;

    // Events
    event Deployed(
        address indexed instance,
        Impl indexed impType,
        address token,
        address oracleAddress,
        address adminAddress,
        address operatorAddress,
        uint256 intervalSeconds,
        uint256 bufferSeconds,
        uint256 minBetAmount,
        uint256 oracleUpdateAllowance,
        bytes32 priceFeedId,
        uint256 treasuryFee
    );
    event ImplementationSet(address implementation, Impl impType);

    // Errors
    error CloneCreationFailed();
    error ImplementationNotSet();
    error ImplementationAlreadySet();
    error InvalidIndexRange();

    constructor(address _owner) Ownable(_owner) {}

    /**
     * @dev Function to set new PredictionV4 implementation
     */
    function setImplementationPredictionV4(address implementation) external onlyOwner {
        // Require that implementation is different from current one
        if (implPredictionV4 == implementation) {
            revert ImplementationAlreadySet();
        }
        // Set new implementation
        implPredictionV4 = implementation;
        // Emit relevant event
        emit ImplementationSet(implementation, Impl.V4);
    }

    /**
     * @dev Function to set new PredictionV5 implementation
     */
    function setImplementationPredictionV5(address implementation) external onlyOwner {
        // Require that implementation is different from current one
        if (implPredictionV5 == implementation) {
            revert ImplementationAlreadySet();
        }
        // Set new implementation
        implPredictionV5 = implementation;
        // Emit relevant event
        emit ImplementationSet(implementation, Impl.V5);
    }

    /**
     * @dev Deployment wrapper for boosted staker implementation
     */
    function deployPredictionV4(
        address adminAddress,
        address operatorAddress,
        uint256 minBetAmount,
        uint256 treasuryFee
    ) external onlyOwner {
        bytes memory data = abi.encodeWithSignature(
            "initialize(address,address,address,uint256,uint256)",
            owner(),
            adminAddress,
            operatorAddress,
            minBetAmount,
            treasuryFee
        );
        address instance = _deploy(data, Impl.V4);
        emit Deployed(
            instance,
            Impl.V4,
            address(0),
            address(0),
            adminAddress,
            operatorAddress,
            0,
            0,
            minBetAmount,
            0,
            0,
            treasuryFee
        );
    }

    function deployPredictionV5(
        address token,
        address adminAddress,
        address operatorAddress,
        uint256 minBetAmount,
        uint256 treasuryFee
    ) external onlyOwner {
        bytes memory data = abi.encodeWithSignature(
            "initialize(address,address,address,address,uint256,uint256)",
            owner(),
            token,
            adminAddress,
            operatorAddress,
            minBetAmount,
            treasuryFee
        );
        address instance = _deploy(data, Impl.V5);
        emit Deployed(
            instance,
            Impl.V5,
            token,
            address(0),
            adminAddress,
            operatorAddress,
            0,
            0,
            minBetAmount,
            0,
            0,
            treasuryFee
        );
    }
    /**
     * @dev Function to make a new deployment and initialize clone instance
     */
    function _deploy(bytes memory data, Impl implType) private returns (address instance) {
        address impl = implType == Impl.V4
            ? implPredictionV4
            : implType == Impl.V5 ? implPredictionV5 : address(0);

        // Require that implementation is set
        if (impl == address(0)) {
            revert ImplementationNotSet();
        }

        /// @solidity memory-safe-assembly
        assembly {
            // Cleans the upper 96 bits of the `implementation` word, then packs the first 3 bytes
            // of the `implementation` address with the bytecode before the address.
            mstore(0x00, or(shr(0xe8, shl(0x60, impl)), 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000))
            // Packs the remaining 17 bytes of `implementation` with the bytecode after the address.
            mstore(0x20, or(shl(0x78, impl), 0x5af43d82803e903d91602b57fd5bf3))
            instance := create(0, 0x09, 0x37)
        }
        // Require that clone is created
        if (instance == address(0)) {
            revert CloneCreationFailed();
        }

        // Mark sale as created through official factory
        deploymentToImplType[instance] = implType;
        // Add sale to allSales
        deployments.push(instance);

        // Initialize
        (bool success, ) = instance.call{value: 0}(data);
        if (!success) revert();
    }

    /**
     * @dev Function to retrieve total number of deployments made by this factory
     */
    function noOfDeployments() public view returns (uint256) {
        return deployments.length;
    }

    /**
     * @dev Function to retrieve the address of the latest deployment made by this factory
     * @return Latest deployment address
     */
    function getLatestDeployment() external view returns (address) {
        uint256 _noOfDeployments = noOfDeployments();
        if (_noOfDeployments > 0) return deployments[_noOfDeployments - 1];
        // Return zero address if no deployments were made
        return address(0);
    }

    /**
     * @dev Function to retrieve all deployments between indexes
     * @param startIndex First index
     * @param endIndex Last index
     * @return _deployments All deployments between provided indexes, inclusive
     */
    function getAllDeployments(
        uint256 startIndex,
        uint256 endIndex
    ) external view returns (address[] memory _deployments) {
        // Require valid index input
        if (endIndex < startIndex || endIndex >= deployments.length) {
            revert InvalidIndexRange();
        }
        // Initialize new array
        _deployments = new address[](endIndex - startIndex + 1);
        uint256 index = 0;
        // Fill the array with sale addresses
        for (uint256 i = startIndex; i <= endIndex; i++) {
            _deployments[index] = deployments[i];
            index++;
        }
    }

    /**
     * @dev See if a clone was deployed through this factory
     */
    function isDeployedThroughFactory(address deployment) external view returns (bool) {
        return uint8(deploymentToImplType[deployment]) > 0;
    }
}
