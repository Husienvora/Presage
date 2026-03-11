// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IProofVerifier {
    function verify(bytes calldata proof) external view returns (uint256 timestamp, uint256 positionId, uint256 price);
}

/// @title SignedProofVerifier
/// @notice Verifies price attestations signed by an authorized relayer.
contract SignedProofVerifier is IProofVerifier, Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    address public relayer;

    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);

    constructor(address relayer_) Ownable(msg.sender) {
        require(relayer_ != address(0), "zero relayer");
        relayer = relayer_;
    }

    function setRelayer(address relayer_) external onlyOwner {
        require(relayer_ != address(0), "zero relayer");
        emit RelayerUpdated(relayer, relayer_);
        relayer = relayer_;
    }

    /// @notice Verifies a signed price proof.
    /// @param proof ABI-encoded (uint256 timestamp, uint256 positionId, uint256 price, bytes signature).
    function verify(bytes calldata proof) external view override returns (uint256 timestamp, uint256 positionId, uint256 price) {
        bytes memory signature;
        (timestamp, positionId, price, signature) = abi.decode(proof, (uint256, uint256, uint256, bytes));

        bytes32 messageHash = keccak256(abi.encodePacked(timestamp, positionId, price));
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();

        address signer = ethSignedMessageHash.recover(signature);
        require(signer == relayer, "invalid signature");

        return (timestamp, positionId, price);
    }
}
