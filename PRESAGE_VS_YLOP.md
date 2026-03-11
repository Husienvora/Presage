# Presage vs YLOP: Code Comparison & Originality Analysis

## Overview

Both Presage and YLOP solve the same problem: enabling users to borrow stablecoins against Gnosis CTF (ERC1155) prediction market tokens via Morpho Blue on BNB Chain. Both were developed for this specific niche. This document compares the two codebases contract-by-contract to assess similarity and originality.

---

## Could YLOP Accuse Presage of Copying?

**Short answer: No, not credibly.**

The protocols share a common architectural pattern driven by the problem domain, but the implementations are meaningfully different in design decisions, code structure, naming, feature set, and oracle approach. No function or contract is copy-pasted. The shared patterns are the natural/only way to build this type of system given the constraints (Morpho Blue requires ERC20 collateral, CTF is ERC1155, time-decay is the known solution for prediction market collateral risk).

Below is the detailed breakdown.

---

## Shared Architectural Decisions (Domain-Driven, Not Copying)

These shared elements are the _only reasonable way_ to build prediction market lending on Morpho Blue:

| Shared Pattern | Why It's Inevitable |
|---|---|
| ERC1155 -> ERC20 wrapper | Morpho Blue only accepts ERC20 collateral. CTF tokens are ERC1155. There is no other option. |
| Morpho Blue as lending layer | The only singleton lending protocol on BNB Chain that supports custom oracles and isolated markets. |
| Per-market oracle stub delegating to a registry | Morpho requires one `IOracle` address per market. A stub that delegates to a central registry is the standard pattern (Morpho docs recommend it). |
| Time-based LLTV/price decay | Both the YLOP risk research and all academic literature identify temporal decay as the mandatory control for prediction market collateral. Any protocol in this space must implement it. |
| Linear decay formula | `decay = (end - now) / duration` is the simplest possible implementation. Both use it because it's the obvious first choice. |
| Same Morpho Blue + IRM addresses | There is one Morpho Blue deployment on BNB Chain. Both must use the same address. |
| Sequential `nextMarketId` counter | Standard pattern for any protocol that creates multiple markets. |
| `SafeERC20`, `ERC1155Holder` | Standard OpenZeppelin patterns required when handling ERC20 transfers and receiving ERC1155 tokens. |

### The Merge Liquidation Pattern

Both protocols implement a "merge liquidation" where a liquidator provides opposite-outcome CTF tokens, merges them with seized collateral to recover the underlying stablecoin, and profits from the spread.

This is the most distinctive shared concept. However:
- It's a **direct consequence of how Gnosis CTF works** (mergePositions is a native CTF function)
- It's the economically obvious liquidation path (merge is guaranteed to produce $1 per pair, regardless of market price)
- The concept is discussed in the institutional risk research as a key liquidation route
- Both teams could independently arrive at it by reading the Gnosis CTF documentation

---

## Contract-by-Contract Differences

### 1. Main Orchestrator: `Ylop.sol` vs `Presage.sol`

| Aspect | YLOP | Presage |
|---|---|---|
| **License** | GPL-2.0-or-later | MIT |
| **Solidity version** | ^0.8.13 | ^0.8.28 |
| **Naming convention** | Trailing underscores on params (`amount_`, `marketId_`), SCREAMING_CASE immutables (`MORPHO`, `IRM`) | No trailing underscores, camelCase immutables (`morpho`, `irm`) |
| **Market creation** | `createMarket()` - deploys new CTFWrapper directly | `openMarket()` - uses WrapperFactory clones, reuses existing wrappers |
| **Collateral functions** | `supplyCollateral()` / `withdrawCollateral()` | `depositCollateral()` / `releaseCollateral()` |
| **Liquidation functions** | `liquidateUsingLoanToken()` / `liquidateUsingOppositeShares()` | `settleWithLoanToken()` / `settleWithMerge()` |
| **Repay logic** | Checks `amount_ == borrowed` (exact match only) | Checks `amount >= owed` (repays full if overpaying) |
| **Leverage system** | Full solver-based leverage/deleverage (`requestLeverage`, `fillLeverage`, `requestDeleverage`, `fillDeleverage`) | **Not present** |
| **View functions** | `healthFactor()`, `ltv()`, `positionOf()`, `isHealthy()` | `healthFactor()`, `getMarket()`, `triggerAccrual()` |
| **Interest accrual** | `accrueInterest()` | `triggerAccrual()` |
| **Market struct** | `YlopMarket { marketParams, ctfParams, resolutionAt, lltvDecay }` (decay stored per market) | `LendingMarket { morphoParams, ctfPosition, resolutionAt }` (decay stored in PriceHub) |
| **CTF param struct** | `CTFParams { ctf, parentCollectionId, conditionId, oppositePositionId, positionId }` | `CTFPosition { ctf, parentCollectionId, conditionId, positionId, oppositePositionId }` |

**Key difference: YLOP stores the LLTV decay config in the market struct and the OracleRegistry reads it back from Ylop. Presage stores decay config in PriceHub directly during oracle spawning.** This is a fundamentally different data architecture.

### 2. CTF Wrapper: `CTFWrapper.sol` vs `WrappedCTF.sol`

| Aspect | YLOP | Presage |
|---|---|---|
| **Deployment** | Direct `new CTFWrapper()` per market, one-per-market | EIP-1167 minimal proxy clones via WrapperFactory, CREATE2 deterministic addresses |
| **Access control** | `Ownable` - only Ylop contract can wrap/unwrap | **Permissionless** - anyone can wrap/unwrap |
| **Flash unwrap** | Built into `unwrap()` - if `data_.length > 0`, invokes callback, callback fires _before_ burn | Separate `flashUnwrap()` function - burns first, transfers CTF out, then invokes callback |
| **Callback interface** | `ICTFWrapperUnwrapCallback.onCTFWrapperUnwrap(amount, data)` | `IFlashUnwrapCallback.onFlashUnwrap(initiator, amount, data)` |
| **Callback timing** | Callback fires before burn (sends CTF first, then burns ERC20) | Burns ERC20 first, sends CTF out, then calls back |
| **Initialize** | Constructor-initialized (immutable fields) | `initialize()` function (needed for clone pattern) |
| **Name/Symbol** | "Ylop Wrapped CTF" / "ylopwCTF" | "Presage wCTF" / "pwCTF" |
| **Factory** | None (deployed directly by Ylop) | `WrapperFactory` with `create()`, `predictAddress()`, `getWrapper()` |
| **Reusability** | New wrapper per market even for same position | Wrappers are shared across markets for the same positionId |

**This is a major design divergence.** YLOP's approach is simpler but creates a new wrapper every time. Presage's clone factory is more gas-efficient and allows wrapper reuse.

### 3. Oracle System: `OracleRegistry.sol` + `Oracle.sol` vs `PriceHub.sol` + `MorphoOracleStub`

| Aspect | YLOP | Presage |
|---|---|---|
| **Architecture** | `OracleRegistry` (factory + price store + decay) + `Oracle` (stub) | `PriceHub` (registry + price store + decay + adapter routing) + `MorphoOracleStub` |
| **Price source** | zkTLS proofs via Reclaim Protocol verifiers | Pluggable `IPriceAdapter` system (FixedPriceAdapter, PullPriceAdapter) |
| **Default pricing** | No default - requires zkTLS proof submissions | FixedPriceAdapter returns $1 for all tokens (conservative safe default) |
| **Price verification** | URL validation against registered endpoints, tokenId matching, Reclaim cryptographic proof | Adapter-dependent; PullPriceAdapter uses generic IProofVerifier |
| **Decay factor scale** | **1e36** | **1e18** (applied during Morpho price scaling) |
| **Decay config storage** | Reads from `Ylop.markets(marketId)` at query time | Stored directly in PriceHub's `MarketConfig` at spawn time |
| **Stub naming** | `Oracle` | `MorphoOracleStub` |
| **Stub constructor** | Takes `marketId_`, sets `registry = msg.sender` | Takes `positionId_` and `hub_` address |
| **Keyed by** | `marketId` (sequential integer) | `positionId` (CTF position hash) |
| **Admin seeding** | Not supported | `seedPrice()` for testing/initial setup |
| **Staleness** | `maxAge` (default 30 minutes) | `maxStaleness` (default 3600s = 1 hour) |

**This is the biggest architectural difference.** YLOP has a tightly-coupled zkTLS verification system tied to Reclaim Protocol. Presage has a modular adapter system that can use fixed prices, pull oracles, or any future price source. Completely different design philosophy.

### 4. Merge Liquidation Callback

**YLOP (`onCTFWrapperUnwrap`):**
```solidity
function onCTFWrapperUnwrap(uint256 seizeAmount_, bytes calldata data_) external {
    (YlopMarket memory market, address borrower, address liquidator, uint256 marketId) =
        abi.decode(data_, (YlopMarket, address, address, uint256));
    require(msg.sender == market.marketParams.collateralToken, "Invalid caller");
    // ... merge, quote repay, liquidate, transfer profit
}
```

**Presage (`onFlashUnwrap`):**
```solidity
function onFlashUnwrap(address, uint256 amount, bytes calldata data) external override {
    (uint256 marketId, address borrower, address liquidator) =
        abi.decode(data, (uint256, address, address));
    LendingMarket memory m = _markets[marketId];
    require(msg.sender == m.morphoParams.collateralToken, "bad caller");
    // ... merge, quote repay, liquidate, transfer profit
}
```

The **logic flow** is the same (merge -> quote -> liquidate -> transfer profit) because that's the only way to do a merge liquidation. But:
- Different function signatures (YLOP takes `(uint256, bytes)`, Presage takes `(address, uint256, bytes)`)
- Different data encoding (YLOP encodes the full `YlopMarket` struct + addresses, Presage encodes just `marketId` and re-fetches)
- Different variable names, error messages, struct access patterns

### 5. `_quoteRepay` / `_quoteRepayAmount`

**YLOP:**
```solidity
function _quoteRepayAmount(YlopMarket memory market_, uint256 seizeAmount_) private view returns (uint256 repayAmount) {
    Market memory morphoMarket = MORPHO.market(market_.marketParams.id());
    uint256 seizedAssetsQuoted = seizeAmount_.mulDivUp(IOracle(market_.marketParams.oracle).price(), ORACLE_PRICE_SCALE);
    uint256 liquidationIncentiveFactor = UtilsLib.min(
        MAX_LIQUIDATION_INCENTIVE_FACTOR,
        WAD.wDivDown(WAD - LIQUIDATION_CURSOR.wMulDown(WAD - market_.marketParams.lltv))
    );
    uint256 repayShares = seizedAssetsQuoted.wDivUp(liquidationIncentiveFactor).toSharesUp(...);
    repayAmount = repayShares.toAssetsUp(...);
}
```

**Presage:**
```solidity
function _quoteRepay(LendingMarket memory m, uint256 seizeAmount) internal view returns (uint256) {
    (,,uint128 totalBorrowAssets, uint128 totalBorrowShares,,) = morpho.market(m.morphoParams.id());
    uint256 oraclePrice = IOracle(m.morphoParams.oracle).price();
    uint256 seizedQuoted = seizeAmount.mulDivUp(oraclePrice, ORACLE_PRICE_SCALE);
    uint256 lif = UtilsLib.min(MAX_LIQUIDATION_INCENTIVE_FACTOR, WAD.wDivDown(WAD - LIQUIDATION_CURSOR.wMulDown(WAD - m.morphoParams.lltv)));
    uint256 repayShares = seizedQuoted.wDivUp(lif).toSharesUp(totalBorrowAssets, totalBorrowShares);
    return repayShares.toAssetsUp(totalBorrowAssets, totalBorrowShares);
}
```

**These use the same formula** because it's Morpho Blue's liquidation math from their documentation/source code. Both are re-implementing `Morpho.liquidate()`'s internal calculation to predict the repay amount. This formula is public in `morpho-blue/src/Morpho.sol` and any protocol integrating with Morpho's liquidation must use it.

---

## Features Unique to Each Protocol

### YLOP Only
- **Solver-based leverage/deleverage** - `requestLeverage()`, `fillLeverage()`, `requestDeleverage()`, `fillDeleverage()` - A full order-matching system where solvers provide CTF tokens for leveraged positions
- **zkTLS oracle verification** - Reclaim Protocol integration for cryptographically-proven price feeds from Polymarket
- **URL endpoint validation** - Verifies zkTLS proofs come from the correct API endpoint
- **`ltv()` view function** - Returns current LTV ratio
- **`isHealthy()` view function** - Boolean health check
- **`positionOf()` view** - Returns full position breakdown

### Presage Only
- **WrapperFactory with EIP-1167 clones** - Gas-efficient deterministic wrapper deployment, shared across markets
- **Permissionless wrapping** - Anyone can wrap/unwrap CTF tokens (not just the protocol)
- **Pluggable price adapter system** - FixedPriceAdapter, PullPriceAdapter, extensible to any future source
- **FixedPriceAdapter ($1 pricing)** - Conservative oracle model that eliminates manipulation risk entirely
- **SafeBatchHelper** - Encodes Gnosis Safe multiSend transactions for atomic borrow/repay workflows
- **`seedPrice()` for testing** - Owner can set prices directly for development
- **`getMarket()` view** - Returns full market configuration
- **Explicit `flashUnwrap()` function** - Separate from normal unwrap, cleaner API

---

## Code Style & Structural Differences

| Aspect | YLOP | Presage |
|---|---|---|
| **Build system** | Foundry (forge) | Hardhat |
| **Import style** | Named imports from @morpho-org packages | Vendored Morpho types in contracts/vendor/morpho/ |
| **Param naming** | Trailing underscore: `amount_`, `marketId_` | No suffix: `amount`, `marketId` |
| **Immutable casing** | SCREAMING_CASE: `MORPHO`, `ORACLE_REGISTRY` | camelCase: `morpho`, `priceHub` |
| **Visibility** | Explicit `private`/`public`/`external` | Mix of `internal`/`external` |
| **Error style** | String reverts: `"Ylop: request expired"` | Short strings: `"bad caller"`, `"stale price"` |
| **Market access** | `public` mapping with auto-getter | `internal` mapping with explicit `getMarket()` |
| **Interfaces** | Full `IYlop.sol` interface with NatSpec | No protocol interface; callback interface only |
| **Event richness** | Events for leverage/deleverage operations | Events for core operations only |
| **Comments** | Minimal inline, extensive NatSpec in interface | Section headers (unicode box-drawing), brief NatSpec |

---

## Summary

| Question | Answer |
|---|---|
| **Is there copy-pasted code?** | No. Not a single function, struct, or block is copy-pasted. |
| **Is the architecture similar?** | Yes -- both wrap CTF into ERC20 for Morpho Blue with time-decay oracles and merge liquidation. But this architecture is dictated by the problem constraints. |
| **Are the implementations different?** | Yes, significantly. Different wrapper deployment (clones vs direct), different oracle systems (adapters vs zkTLS), different feature sets (leverage/deleverage vs Safe batching), different access models (restricted vs permissionless wrapping). |
| **Is the `_quoteRepay` formula the same?** | Yes, because both re-implement Morpho Blue's public liquidation math. This is like two Uniswap integrations both implementing `getAmountsOut`. |
| **Could someone independently arrive at this design?** | Yes. Given the constraints (CTF is ERC1155, Morpho needs ERC20, prediction markets need time-decay), the wrapper + oracle-stub + decay + merge-liquidation pattern is the natural solution. |
| **Could YLOP credibly claim copying?** | No. The differences in implementation, naming, architecture, features, and design philosophy are substantial. The shared patterns are domain-driven, not evidence of derivation. |

The analogy: both are "Uber for prediction market lending on Morpho Blue" -- they solve the same problem with the same underlying infrastructure but make different engineering choices at every level.
