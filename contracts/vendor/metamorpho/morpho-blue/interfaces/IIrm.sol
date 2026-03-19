// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

import {MarketParams, Market} from "./IMorpho.sol";

/// @title IIrm
/// @author Morpho Labs
/// @custom:contact security@morpho.org
interface IIrm {
    function borrowRate(MarketParams memory marketParams, Market memory market) external returns (uint256);
    function borrowRateView(MarketParams memory marketParams, Market memory market) external view returns (uint256);
}
