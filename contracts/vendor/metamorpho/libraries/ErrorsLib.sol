// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {Id} from "../morpho-blue/interfaces/IMorpho.sol";

/// @title ErrorsLib (MetaMorpho)
/// @author Morpho Labs
library ErrorsLib {
    error ZeroAddress();
    error NotCuratorRole();
    error NotAllocatorRole();
    error NotGuardianRole();
    error NotCuratorNorGuardianRole();
    error UnauthorizedMarket(Id id);
    error InconsistentAsset(Id id);
    error SupplyCapExceeded(Id id);
    error MaxFeeExceeded();
    error AlreadySet();
    error AlreadyPending();
    error PendingCap(Id id);
    error PendingRemoval();
    error NonZeroCap();
    error DuplicateMarket(Id id);
    error InvalidMarketRemovalNonZeroCap(Id id);
    error InvalidMarketRemovalNonZeroSupply(Id id);
    error InvalidMarketRemovalTimelockNotElapsed(Id id);
    error NoPendingValue();
    error NotEnoughLiquidity();
    error MarketNotCreated();
    error MarketNotEnabled(Id id);
    error AboveMaxTimelock();
    error BelowMinTimelock();
    error TimelockNotElapsed();
    error MaxQueueLengthExceeded();
    error ZeroFeeRecipient();
    error InconsistentReallocation();
    error AllCapsReached();
}
