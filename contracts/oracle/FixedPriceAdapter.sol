// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPriceAdapter} from "../interfaces/IPriceAdapter.sol";

/// @title FixedPriceAdapter
/// @notice Returns a fixed probability of 1.0 for every CTF position.
///         Combined with a conservative LLTV (65-77%), this is the safest oracle model:
///         no external dependencies, no manipulation surface, and CTF tokens are naturally
///         capped at $1 payout on resolution.
contract FixedPriceAdapter is IPriceAdapter {
    uint256 public constant FIXED_PRICE = 1e18; // 100% probability = $1

    function getPrice(uint256 /* positionId */) external view override returns (uint256, uint256) {
        return (FIXED_PRICE, block.timestamp);
    }

    /// @notice No-op — fixed price never changes.
    function submitPrice(uint256, bytes calldata) external override {}
}
