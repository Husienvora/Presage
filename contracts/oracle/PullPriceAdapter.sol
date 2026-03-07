// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPriceAdapter} from "../interfaces/IPriceAdapter.sol";

/// @title IProofVerifier
/// @notice Verifies off-chain price attestations (zkTLS, signed API responses, etc.).
interface IProofVerifier {
    /// @param proof Raw proof bytes.
    /// @return timestamp When the price was observed.
    /// @return positionId The CTF token ID the price refers to.
    /// @return price 18-decimal probability.
    function verify(bytes calldata proof) external view returns (uint256 timestamp, uint256 positionId, uint256 price);
}

/// @title PullPriceAdapter
/// @notice Pull-oracle adapter that accepts externally-proven price observations.
///         Supports multiple verifier backends (zkTLS via Reclaim, signed feeds, etc.).
///         Anyone can submit a valid proof; the adapter validates and records the price
///         in the PriceHub.
contract PullPriceAdapter is IPriceAdapter, Ownable {
    address public priceHub;

    mapping(address => bool) public verifiers;
    mapping(uint256 positionId => PriceCache) internal _cache;

    struct PriceCache {
        uint256 price;
        uint256 updatedAt;
    }

    event VerifierToggled(address indexed verifier, bool enabled);

    constructor(address priceHub_) Ownable(msg.sender) {
        priceHub = priceHub_;
    }

    // ──────── Admin ────────

    function setVerifier(address v, bool enabled) external onlyOwner {
        verifiers[v] = enabled;
        emit VerifierToggled(v, enabled);
    }

    function setPriceHub(address hub) external onlyOwner {
        priceHub = hub;
    }

    // ──────── IPriceAdapter ────────

    function getPrice(uint256 positionId) external view override returns (uint256, uint256) {
        PriceCache memory c = _cache[positionId];
        return (c.price, c.updatedAt);
    }

    /// @notice Submit a proof to update a position's price.
    /// @param positionId The CTF position (used for routing, actual ID is validated from proof).
    /// @param data ABI-encoded (address verifier, bytes proof).
    function submitPrice(uint256 positionId, bytes calldata data) external override {
        (address verifier, bytes memory proof) = abi.decode(data, (address, bytes));

        require(verifiers[verifier], "unknown verifier");

        (uint256 ts, uint256 proofPositionId, uint256 prob) = IProofVerifier(verifier).verify(proof);

        require(proofPositionId == positionId, "position mismatch");
        require(prob <= 1e18, "invalid probability");
        require(ts > _cache[positionId].updatedAt, "not newer");

        _cache[positionId] = PriceCache(prob, ts);

        // Forward to PriceHub
        IPriceHubRecorder(priceHub).recordPrice(positionId, prob, ts);
    }
}

/// @dev Minimal interface so the adapter can push prices to PriceHub.
interface IPriceHubRecorder {
    function recordPrice(uint256 positionId, uint256 probability, uint256 timestamp) external;
}
