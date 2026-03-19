// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

struct MarketConfig {
    uint184 cap;
    bool enabled;
    uint64 removableAt;
}

struct PendingUint192 {
    uint192 value;
    uint64 validAt;
}

struct PendingAddress {
    address value;
    uint64 validAt;
}

/// @title PendingLib
/// @author Morpho Labs
library PendingLib {
    function update(PendingUint192 storage pending, uint184 newValue, uint256 timelock) internal {
        pending.value = newValue;
        pending.validAt = uint64(block.timestamp + timelock);
    }

    function update(PendingAddress storage pending, address newValue, uint256 timelock) internal {
        pending.value = newValue;
        pending.validAt = uint64(block.timestamp + timelock);
    }
}
