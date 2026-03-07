// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.28;

import {MarketParams, Market, Position, Id} from "./Types.sol";

/// @dev Vendored from morpho-org/morpho-blue — minimal interface for Presage integration.
interface IMorpho {
    function createMarket(MarketParams memory marketParams) external;

    function supply(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        bytes memory data
    ) external returns (uint256 assetsSupplied, uint256 sharesSupplied);

    function withdraw(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        address receiver
    ) external returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn);

    function borrow(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        address receiver
    ) external returns (uint256 assetsBorrowed, uint256 sharesBorrowed);

    function repay(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        bytes memory data
    ) external returns (uint256 assetsRepaid, uint256 sharesRepaid);

    function supplyCollateral(
        MarketParams memory marketParams,
        uint256 assets,
        address onBehalf,
        bytes memory data
    ) external;

    function withdrawCollateral(
        MarketParams memory marketParams,
        uint256 assets,
        address onBehalf,
        address receiver
    ) external;

    function liquidate(
        MarketParams memory marketParams,
        address borrower,
        uint256 seizedAssets,
        uint256 repaidShares,
        bytes memory data
    ) external returns (uint256 assetsSeized, uint256 assetsRepaid);

    function accrueInterest(MarketParams memory marketParams) external;

    function setAuthorization(address authorized, bool newIsAuthorized) external;

    function market(Id id) external view returns (
        uint128 totalSupplyAssets,
        uint128 totalSupplyShares,
        uint128 totalBorrowAssets,
        uint128 totalBorrowShares,
        uint128 lastUpdate,
        uint128 fee
    );

    function position(Id id, address account) external view returns (
        uint256 supplyShares,
        uint128 borrowShares,
        uint128 collateral
    );

    function isAuthorized(address authorizer, address authorized) external view returns (bool);

    function idToMarketParams(Id id) external view returns (
        address loanToken,
        address collateralToken,
        address oracle,
        address irm,
        uint256 lltv
    );
}
