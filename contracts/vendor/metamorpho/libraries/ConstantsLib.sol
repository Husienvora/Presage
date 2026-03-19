// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

/// @title ConstantsLib
/// @author Morpho Labs
library ConstantsLib {
    uint256 internal constant MAX_TIMELOCK = 2 weeks;
    uint256 internal constant MIN_TIMELOCK = 1 days;
    uint256 internal constant MAX_QUEUE_LENGTH = 30;
    uint256 internal constant MAX_FEE = 0.5e18;
}
