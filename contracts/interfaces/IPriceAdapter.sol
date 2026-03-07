// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IPriceAdapter
/// @notice Pluggable price source for CTF outcome tokens. Different adapters can implement
///         different price discovery mechanisms (zkTLS, Chainlink, UMA, fixed-price, AMM TWAP, etc.)
interface IPriceAdapter {
    /// @notice Fetch the current price of a CTF outcome token.
    /// @param positionId The ERC1155 token ID of the CTF position.
    /// @return price 18-decimal scaled probability price (0 = worthless, 1e18 = certain payout).
    /// @return updatedAt Timestamp of the last price update.
    function getPrice(uint256 positionId) external view returns (uint256 price, uint256 updatedAt);

    /// @notice Push a new price observation (for pull-oracle adapters like zkTLS).
    /// @param positionId The ERC1155 token ID.
    /// @param data Adapter-specific proof or price payload.
    function submitPrice(uint256 positionId, bytes calldata data) external;
}
