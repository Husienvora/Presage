// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {WrappedCTF} from "./WrappedCTF.sol";
import {ICTF} from "./interfaces/ICTF.sol";

/// @title WrapperFactory
/// @notice Permissionless factory that deploys WrappedCTF clones via EIP-1167 minimal proxies.
///         CREATE2 for deterministic addresses.
contract WrapperFactory {
    address public immutable implementation;

    mapping(uint256 => address) public wrappers;

    event WrapperCreated(address indexed ctf, uint256 indexed positionId, address wrapper);

    constructor() {
        implementation = address(new WrappedCTF());
    }

    function create(ICTF ctf, uint256 positionId, uint8 decimals_) external returns (address wrapper) {
        require(wrappers[positionId] == address(0), "exists");
        bytes32 salt = _salt(address(ctf), positionId);
        wrapper = Clones.cloneDeterministic(implementation, salt);
        WrappedCTF(wrapper).initialize(ctf, positionId, decimals_);
        wrappers[positionId] = wrapper;
        emit WrapperCreated(address(ctf), positionId, wrapper);
    }

    function predictAddress(ICTF ctf, uint256 positionId) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, _salt(address(ctf), positionId));
    }

    function getWrapper(uint256 positionId) external view returns (address) {
        return wrappers[positionId];
    }

    function _salt(address ctf, uint256 positionId) internal pure returns (bytes32) {
        return keccak256(abi.encode(ctf, positionId));
    }
}
