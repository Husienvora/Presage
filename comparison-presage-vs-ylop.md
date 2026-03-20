# Presage vs YLOP-Contracts: Similarity Comparison Report

**Date:** 2026-03-19
**Projects Compared:**
- **Presage** — `F:\Yamata\Presage`
- **YLOP-Contracts** — `F:\Yamata\YLOP-contracts`

---

## Executive Summary

These two projects are **functionally near-identical** implementations of the same protocol concept: a DeFi lending protocol on BNB Chain that enables borrowing stablecoins against Gnosis Conditional Token Framework (CTF) prediction market positions via Morpho Blue. They share the same core architecture, the same on-chain dependencies (Morpho Blue, IRM, USDT, Reclaim Protocol), and the same feature set (leverage/deleverage, dual liquidation, LLTV decay, zkTLS oracles). Presage is the more mature and feature-rich version.

**Overall Similarity Score: 89/100**

---

## Scoring Breakdown

| Dimension                        | Score | Notes |
|----------------------------------|:-----:|-------|
| Core Purpose & Concept           | 100   | Identical: borrow USDT against CTF tokens via Morpho Blue on BNB |
| Smart Contract Architecture      | 90    | Same pattern, different naming; Presage adds WrapperFactory |
| Lending Operations               | 95    | supply, withdraw, borrow, repay — functionally identical |
| Collateral Management            | 95    | ERC1155→ERC20 wrapping, same 1:1 model, same flash-unwrap callback |
| Liquidation Mechanisms           | 95    | Both have loan-token + opposite-shares (merge) liquidation |
| Leverage/Deleverage              | 95    | Identical solver-assisted request/fill pattern with deadlines |
| Oracle Architecture              | 75    | Both use PriceHub/OracleRegistry + Reclaim zkTLS; Presage adds 3 more adapters |
| LLTV Time Decay                  | 95    | Same linear decay formula; minor scale difference (1e18 vs 1e36) |
| Safe Wallet Integration          | 80    | Both support Safe; Presage has dedicated SafeBatchHelper contract |
| Fee System                       | 60    | Presage has origination + liquidation fees; YLOP has no fee system |
| Build Tooling                    | 50    | Presage = Hardhat; YLOP = Foundry (+ Hardhat secondary) |
| SDK                              | 0     | Presage has full TS SDK (PresageClient); YLOP has none |
| UI                               | 0     | Presage has React testing dashboard; YLOP has none |
| Solver Bot                       | 0     | Presage has Redis-backed solver bot; YLOP has none |
| Allocator Bot                    | 0     | Presage has MetaMorpho allocation manager; YLOP has none |
| Playground                       | 0     | Presage has interactive fork playground; YLOP has none |
| MetaMorpho Vault Integration     | 0     | Presage has full ERC4626 vault support; YLOP has none |
| Testing Coverage                 | 70    | Presage: 11 test suites (unit/fork/integration/mainnet); YLOP: Foundry fork tests |
| Deployment Scripts               | 85    | Both have deploy scripts targeting BNB; same addresses |
| On-Chain Dependencies            | 100   | Identical: same Morpho Blue, IRM, USDT, Reclaim addresses |

---

## Detailed Comparison

### 1. Core Contract Mapping

| Functionality         | Presage                   | YLOP                      | Match |
|-----------------------|---------------------------|---------------------------|:-----:|
| Main Router           | `Presage.sol` (575 lines) | `Ylop.sol` (441 lines)    | High  |
| ERC20 Wrapper         | `WrappedCTF.sol` (63 lines) | `CTFWrapper.sol` (38 lines) | High  |
| Wrapper Factory       | `WrapperFactory.sol` (42 lines) | *(none — inline in Ylop)* | —     |
| Oracle Registry       | `PriceHub.sol` (159 lines) | `OracleRegistry.sol` (111 lines) | High  |
| Oracle Stub           | `MorphoOracleStub` (spawned by PriceHub) | `Oracle.sol` (19 lines) | High  |
| zkTLS Verifier        | `ReclaimVerifier.sol`     | `ReclaimVerifier.sol`     | High  |
| Signed Proof Verifier | `SignedProofVerifier.sol`  | *(none)*                  | —     |
| Fixed Price Adapter   | `FixedPriceAdapter.sol`   | *(none)*                  | —     |
| Pull Price Adapter    | `PullPriceAdapter.sol`    | *(none)*                  | —     |
| Safe Helper           | `SafeBatchHelper.sol` (145 lines) | *(uses native multicall)* | Partial |

### 2. Function-Level Comparison (Main Contract)

| Operation              | Presage Function           | YLOP Function                 | Identical? |
|------------------------|----------------------------|-------------------------------|:----------:|
| Create market          | `openMarket()`             | `createMarket()`              | ~Yes       |
| Supply liquidity       | `supply()`                 | `supply()`                    | Yes        |
| Withdraw liquidity     | `withdraw()`               | `withdraw()`                  | Yes        |
| Deposit collateral     | `depositCollateral()`      | `supplyCollateral()`          | Yes        |
| Release collateral     | `releaseCollateral()`      | `withdrawCollateral()`        | Yes        |
| Borrow                 | `borrow()`                 | `borrow()`                    | Yes        |
| Repay                  | `repay()`                  | `repay()`                     | Yes        |
| Liquidate (loan token) | `settleWithLoanToken()`    | `liquidateUsingLoanToken()`   | Yes        |
| Liquidate (merge)      | `settleWithMerge()`        | `liquidateUsingOppositeShares()` | Yes     |
| Request leverage       | `requestLeverage()`        | `requestLeverage()`           | Yes        |
| Fill leverage          | `fillLeverage()`           | `fillLeverage()`              | Yes        |
| Request deleverage     | `requestDeleverage()`      | `requestDeleverage()`         | Yes        |
| Fill deleverage        | `fillDeleverage()`         | `fillDeleverage()`            | Yes        |
| Health factor          | `healthFactor()`           | `healthFactor()`              | Yes        |
| Flash unwrap callback  | `onFlashUnwrap()`          | `onCTFWrapperUnwrap()`        | Yes        |

### 3. Data Structure Comparison

**Market Struct:**

| Field            | Presage (`LendingMarket`)      | YLOP (`YlopMarket`)           |
|------------------|-------------------------------|-------------------------------|
| Morpho params    | `morphoParams`                | `morphoMarketParams`          |
| CTF position     | `ctfPosition` (struct)        | `ctfParams` (struct)          |
| Resolution time  | `resolutionAt`                | `resolutionAt`                |
| LLTV decay       | In PriceHub (decayDuration, decayCooldown) | `lltvDecay` (duration, cooldown) |
| Origination fee  | `originationFeeBps`           | *(not present)*               |
| Liquidation fee  | `liquidationFeeBps`           | *(not present)*               |

**Leverage Request Struct:**

| Field         | Presage                | YLOP                   |
|---------------|------------------------|------------------------|
| Margin        | `margin`               | `margin`               |
| Total amount  | `totalCollateral`      | `totalCollateral`      |
| Max borrow    | `maxBorrow`            | `maxBorrow`            |
| Deadline      | `deadline`             | `deadline`             |
| Filled flag   | `filled`               | `filled`               |

### 4. Oracle Architecture Comparison

| Feature                  | Presage (PriceHub)                    | YLOP (OracleRegistry)              |
|--------------------------|---------------------------------------|-------------------------------------|
| Price storage            | Per-positionId                        | Per-marketId                        |
| Adapter model            | Default + per-position override       | Single verifier set                 |
| Adapters available       | Fixed, Pull, Reclaim, SignedProof (4) | Reclaim only (1)                    |
| Decay calculation        | `decayFactor * price / 1e18`          | `price * decayFactor / 1e36`        |
| Staleness default        | 1 hour                                | 30 minutes                          |
| Price scale              | 1e36 for Morpho                       | 1e36 for Morpho                     |
| Oracle stub deployment   | Internal (spawned by PriceHub)        | External `Oracle.sol` per market    |
| Endpoint whitelisting    | Per (endpoint, marketId) → positionId | Per CTF address → endpoint          |

### 5. ERC20 Wrapper Comparison

| Feature            | Presage (WrappedCTF)             | YLOP (CTFWrapper)                |
|--------------------|----------------------------------|----------------------------------|
| Deployment model   | EIP-1167 clones via WrapperFactory | Created directly by Ylop.sol    |
| Address derivation | CREATE2 deterministic            | Standard CREATE (sequential)     |
| Permissioning      | Permissionless wrap/unwrap       | Only owner (Ylop) can wrap/unwrap |
| Flash unwrap       | `flashUnwrap()` with callback    | `unwrap()` with optional callback |
| Token name         | Dynamic (from CTF metadata)      | "Ylop Wrapped CTF" (ylopwCTF)   |
| Decimals           | 18 (fixed)                       | Configurable (matches loan token) |

### 6. On-Chain Dependencies (Identical)

| Dependency      | Address                                      |
|-----------------|----------------------------------------------|
| Morpho Blue     | `0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a` |
| Adaptive IRM    | `0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979` |
| USDT (BNB)      | `0x55d398326f99059fF775485246999027B3197955` |
| Reclaim         | `0x5917FaB4808A119560dfADc14F437ae1455AEd40` |

### 7. Tooling & Ecosystem Comparison

| Component              | Presage | YLOP |
|------------------------|:-------:|:----:|
| Smart Contracts        | Yes     | Yes  |
| TypeScript SDK         | Yes     | No   |
| React UI               | Yes     | No   |
| Interactive Playground | Yes     | No   |
| Solver Bot (leverage)  | Yes     | No   |
| Allocator Bot (vault)  | Yes     | No   |
| MetaMorpho Vault       | Yes     | No   |
| SafeBatchHelper        | Yes     | No   |
| Multiple Oracle Adapters | Yes (4) | No (1) |
| Fee System             | Yes     | No   |
| Unit Tests             | Yes     | Yes  |
| Fork Tests             | Yes     | Yes  |
| Integration Tests      | Yes     | No   |
| Mainnet Tests          | Yes     | No   |
| Build Framework        | Hardhat | Foundry |
| Solidity Version       | 0.8.28  | 0.8.28 |
| OpenZeppelin           | ^5.1.0  | ^5.4.0 |

---

## Key Differences Summary

### Presage Has, YLOP Does Not
1. **WrapperFactory** — CREATE2 deterministic wrapper deployment
2. **Multiple Oracle Adapters** — FixedPrice, PullPrice, SignedProof (in addition to Reclaim)
3. **Fee System** — Origination fees (max 5%) and liquidation fees (max 20%) with treasury
4. **SafeBatchHelper** — Dedicated contract for Safe multiSend encoding
5. **SDK** — Full TypeScript client library (ethers v6)
6. **UI** — React testing dashboard with tabs for all operations
7. **Playground** — Interactive fork-based testing environment with pre-funded accounts
8. **Solver Bot** — Redis-backed intent solver for leverage/deleverage
9. **Allocator Bot** — MetaMorpho vault reallocation strategy manager
10. **MetaMorpho Vault** — ERC4626 vault integration with curator/allocator roles

### YLOP Has, Presage Does Not
1. **Foundry-native build** — `forge build`/`forge test` as primary toolchain
2. **Solidity deploy scripts** — `DeployBNB.s.sol` and `CreateMarket.s.sol` (Foundry scripts)
3. **Configurable wrapper decimals** — CTFWrapper decimals match loan token
4. **Restricted wrapper access** — Only Ylop can wrap/unwrap (vs permissionless in Presage)
5. **Cleaner interface separation** — Full `IYlop.sol` interface (373 lines) with comprehensive event definitions

### Design Philosophy Differences
| Aspect              | Presage                                      | YLOP                                      |
|---------------------|----------------------------------------------|--------------------------------------------|
| Wrapper deployment  | Factory pattern (permissionless, deterministic) | Inline creation (controlled by Ylop only) |
| Oracle flexibility  | Multiple adapter backends                    | Single verifier system (Reclaim only)      |
| Safe integration    | Dedicated helper contract                    | Native multicall (no extra contract)       |
| Codebase scope      | Full-stack (contracts + SDK + UI + bots)     | Contracts only                             |
| Testing philosophy  | Hardhat + multiple environments              | Foundry fork tests                         |

---

## Similarity Heatmap

```
Core Lending Logic        ████████████████████ 95%
Collateral Model          ████████████████████ 95%
Liquidation Mechanisms    ████████████████████ 95%
Leverage/Deleverage       ████████████████████ 95%
LLTV Decay                ████████████████████ 95%
On-Chain Dependencies     ████████████████████ 100%
Oracle (Core Concept)     ████████████████████ 90%
Oracle (Implementation)   ███████████████░░░░░ 75%
Safe Integration          ████████████████░░░░ 80%
Fee System                ████████████░░░░░░░░ 60%
Build Tooling             ██████████░░░░░░░░░░ 50%
Ecosystem (SDK/UI/Bots)   ░░░░░░░░░░░░░░░░░░░░  0%
```

---

---

## Code-Level Comparison

### 1. Main Contract: Presage.sol (575 lines) vs Ylop.sol (441 lines)

#### 1.1 Imports & Inheritance

```solidity
// ─── Presage ───
contract Presage is ERC1155Holder, IFlashUnwrapCallback, Ownable {
    using SafeERC20 for IERC20;
    using SafeERC20 for WrappedCTF;
    using MarketParamsLib for MarketParams;
    using SharesMathLib for uint256;
    using SharesMathLib for uint128;
    using MathLib for uint256;

// ─── YLOP ───
contract Ylop is IYlop, Ownable, ERC1155Holder {
    using SafeERC20 for IERC20;
    using SafeERC20 for ICTFWrapper;
    using MathLib for uint256;
    using SharesMathLib for uint256;
    using SharesMathLib for uint128;
    using MarketParamsLib for MarketParams;
```

**Similarity: 95%** — Identical `using` directives and base contracts. YLOP adds `IYlop` interface. Presage adds `IFlashUnwrapCallback`. Both import and use the exact same Morpho libraries.

#### 1.2 Immutables & State

```solidity
// ─── Presage ───
IMorpho public immutable morpho;          // lowercase
WrapperFactory public immutable factory;  // extra: factory contract
PriceHub public immutable priceHub;       // named PriceHub
address public immutable irm;

uint256 public nextMarketId = 1;
mapping(uint256 => LendingMarket) internal _markets;
mapping(address => mapping(uint256 => LeverageRequest)) public leverageRequests;
mapping(address => mapping(uint256 => DeleverageRequest)) public deleverageRequests;

// Fee state (Presage-only)
address public treasury;
uint256 public defaultOriginationFeeBps;
uint256 public defaultLiquidationFeeBps;

// ─── YLOP ───
IOracleRegistry public immutable ORACLE_REGISTRY;  // SCREAMING_CASE
IMorpho public immutable MORPHO;                   // SCREAMING_CASE
address public immutable IRM;                      // SCREAMING_CASE

uint256 internal nextMarketId;                     // no factory, no fee state
mapping(uint256 marketId => YlopMarket market) public markets;
mapping(address borrower => mapping(uint256 marketId => LeverageRequest)) public leverageRequests;
mapping(address borrower => mapping(uint256 marketId => DeleverageRequest)) public deleverageRequests;
```

**Similarity: 85%** — Same mapping signatures. Presage adds fee state + WrapperFactory. YLOP uses `SCREAMING_CASE` for immutables (Solidity convention). YLOP uses named mapping keys (Solidity 0.8.18+).

#### 1.3 Market Structs

```solidity
// ─── Presage ───
struct CTFPosition {
    ICTF ctf;
    bytes32 parentCollectionId;
    bytes32 conditionId;
    uint256 positionId;
    uint256 oppositePositionId;
}
struct LendingMarket {
    MarketParams morphoParams;
    CTFPosition ctfPosition;
    uint256 resolutionAt;
    uint256 originationFeeBps;     // Presage-only
    uint256 liquidationFeeBps;     // Presage-only
}

// ─── YLOP ───
struct CTFParams {
    IConditionalTokens ctf;
    bytes32 parentCollectionId;
    bytes32 conditionId;
    uint256 oppositePositionId;    // swapped order vs Presage
    uint256 positionId;
}
struct YlopMarket {
    MarketParams marketParams;
    CTFParams ctfParams;
    uint256 resolutionAt;
    LLTVDecay lltvDecay;           // YLOP stores decay here; Presage stores in PriceHub
}
struct LLTVDecay {
    uint256 duration;
    uint256 cooldown;
}
```

**Similarity: 85%** — Same fields for CTF identification. YLOP swaps field order for `positionId`/`oppositePositionId`. YLOP stores decay config in the market struct; Presage stores it in PriceHub. Presage adds fee fields.

#### 1.4 Leverage/Deleverage Structs (Identical)

```solidity
// Both projects use the EXACT same struct:
struct LeverageRequest {
    uint256 marginAmount;
    uint256 supplyCollateralAmount;
    uint256 borrowAmountMax;
    uint256 deadline;
    bool filled;
}
struct DeleverageRequest {
    uint256 repayAmount;
    uint256 withdrawCollateralAmountMax;
    uint256 deadline;
    bool filled;
}
```

**Similarity: 100%** — Field names and types are byte-for-byte identical.

#### 1.5 supply() — Side-by-Side

```solidity
// ─── Presage ───
function supply(uint256 marketId, uint256 amount) external {
    MarketParams memory mp = _markets[marketId].morphoParams;
    IERC20 loan = IERC20(mp.loanToken);
    loan.safeTransferFrom(msg.sender, address(this), amount);
    loan.forceApprove(address(morpho), amount);
    morpho.supply(mp, amount, 0, msg.sender, "");
    loan.forceApprove(address(morpho), 0);          // ← clears approval
    emit Supplied(marketId, msg.sender, amount);
}

// ─── YLOP ───
function supply(uint256 marketId, uint256 amount_) external {
    MarketParams memory marketParams = markets[marketId].marketParams;
    IERC20 loanToken = IERC20(marketParams.loanToken);
    loanToken.safeTransferFrom(msg.sender, address(this), amount_);
    loanToken.forceApprove(address(MORPHO), amount_);
    MORPHO.supply(marketParams, amount_, 0, msg.sender, "");
    loanToken.forceApprove(address(MORPHO), 0);      // ← clears approval
    emit Supplied(marketId, msg.sender, amount_);
}
```

**Similarity: 98%** — Identical logic and call sequence. Only variable naming differs (`mp` vs `marketParams`, `loan` vs `loanToken`, `morpho` vs `MORPHO`).

#### 1.6 depositCollateral() / supplyCollateral() — Side-by-Side

```solidity
// ─── Presage ───
function depositCollateral(uint256 marketId, uint256 amount) external {
    LendingMarket memory m = _markets[marketId];
    WrappedCTF wrapper = WrappedCTF(m.morphoParams.collateralToken);
    m.ctfPosition.ctf.safeTransferFrom(msg.sender, address(this), m.ctfPosition.positionId, amount, "");
    m.ctfPosition.ctf.setApprovalForAll(address(wrapper), true);
    wrapper.wrap(amount);
    m.ctfPosition.ctf.setApprovalForAll(address(wrapper), false);
    wrapper.forceApprove(address(morpho), amount);
    morpho.supplyCollateral(m.morphoParams, amount, msg.sender, "");
    wrapper.forceApprove(address(morpho), 0);
    emit CollateralDeposited(marketId, msg.sender, amount);
}

// ─── YLOP ───
function supplyCollateral(uint256 marketId, uint256 amount_) external {
    YlopMarket memory market = markets[marketId];
    IConditionalTokens ctf = market.ctfParams.ctf;
    MarketParams memory marketParams = market.marketParams;
    ICTFWrapper collateral = ICTFWrapper(marketParams.collateralToken);
    ctf.safeTransferFrom(msg.sender, address(this), market.ctfParams.positionId, amount_, "");
    ctf.setApprovalForAll(address(collateral), true);
    collateral.wrap(amount_);
    ctf.setApprovalForAll(address(collateral), false);
    collateral.forceApprove(address(MORPHO), amount_);
    MORPHO.supplyCollateral(marketParams, amount_, msg.sender, "");
    collateral.forceApprove(address(MORPHO), 0);
    emit CollateralSupplied(marketId, msg.sender, amount_);
}
```

**Similarity: 97%** — Identical 7-step sequence: (1) pull ERC1155, (2) approve wrapper, (3) wrap, (4) revoke approval, (5) approve Morpho, (6) supply collateral, (7) revoke approval. Only naming and variable extraction style differ.

#### 1.7 borrow() — Key Behavioral Difference

```solidity
// ─── Presage ─── (routes through contract for fee extraction)
function borrow(uint256 marketId, uint256 amount) external {
    LendingMarket memory m = _markets[marketId];
    IERC20 loan = IERC20(m.morphoParams.loanToken);
    morpho.borrow(m.morphoParams, amount, 0, msg.sender, address(this));  // ← to: this
    uint256 fee;
    if (m.originationFeeBps > 0 && treasury != address(0)) {
        fee = (amount * m.originationFeeBps) / BPS;
        loan.safeTransfer(treasury, fee);
    }
    loan.safeTransfer(msg.sender, amount - fee);
    emit LoanTaken(marketId, msg.sender, amount);
    if (fee > 0) emit OriginationFeeCollected(marketId, msg.sender, fee);
}

// ─── YLOP ─── (sends directly to borrower, no fees)
function borrow(uint256 marketId, uint256 amount_) external {
    MarketParams memory marketParams = markets[marketId].marketParams;
    MORPHO.borrow(marketParams, amount_, 0, msg.sender, msg.sender);       // ← to: sender
    emit Borrowed(marketId, msg.sender, amount_);
}
```

**Similarity: 70%** — Same Morpho call, but Presage routes through itself to deduct origination fees. YLOP sends directly to `msg.sender` (no fee intermediary). This is the **biggest behavioral divergence** in the lending flow.

#### 1.8 repay() — Rounding Strategy

```solidity
// ─── Presage ─── (uses amount >= owed threshold)
if (amount >= owed) {
    shares = borrowShares_;
    assets = 0;
} else {
    assets = amount;
    shares = 0;
}
loan.safeTransferFrom(msg.sender, address(this), amount);
loan.forceApprove(address(morpho), amount);
morpho.repay(mp, assets, shares, msg.sender, "");
// Refund dust
uint256 dust = loan.balanceOf(address(this));
if (dust > 0) loan.safeTransfer(msg.sender, dust);

// ─── YLOP ─── (uses amount == borrowed exact match)
if (amount_ == borrowed) {
    shares = position.borrowShares;
    loanToken.safeTransferFrom(msg.sender, address(this), borrowed);
    loanToken.forceApprove(address(MORPHO), borrowed);
} else {
    assets = amount_;
    loanToken.safeTransferFrom(msg.sender, address(this), amount_);
    loanToken.forceApprove(address(MORPHO), amount_);
}
MORPHO.repay(marketParams, assets, shares, msg.sender, "");
```

**Similarity: 85%** — Both solve the Morpho share-rounding problem (1 wei dust). Presage uses `>=` threshold and refunds dust; YLOP uses `==` exact match. Both switch to shares-based repayment for full repay. Presage approach is more defensive (handles overpayment).

#### 1.9 settleWithLoanToken() / liquidateUsingLoanToken()

```solidity
// ─── Presage ─── (adds accrueInterest + fee deduction)
function settleWithLoanToken(uint256 marketId, address borrower, uint256 repayAmount) external {
    ...
    morpho.accrueInterest(m.morphoParams);                    // ← Presage accrues first
    ...
    uint256 repayShares = repayAmount.toSharesDown(...);
    uint256 actualRepay = repayShares.toAssetsUp(...);
    loan.safeTransferFrom(msg.sender, address(this), actualRepay);  // ← exact amount
    ...
    (uint256 seized, ) = morpho.liquidate(..., 0, repayShares, "");
    // Refund dust
    uint256 dust = loan.balanceOf(address(this));
    if (dust > 0) loan.safeTransfer(msg.sender, dust);
    // Fee on seized collateral
    uint256 fee;
    if (m.liquidationFeeBps > 0 && treasury != address(0)) {
        fee = (seized * m.liquidationFeeBps) / BPS;
        wrapper.safeTransfer(treasury, fee);
    }
    uint256 net = seized - fee;
    wrapper.unwrap(net);
    m.ctfPosition.ctf.safeTransferFrom(..., net, "");
}

// ─── YLOP ─── (no accrual, no fees)
function liquidateUsingLoanToken(uint256 marketId, address borrower_, uint256 repayAmount_) external {
    ...
    uint256 repayShares = repayAmount_.toSharesDown(...);
    loanToken.safeTransferFrom(msg.sender, address(this), repayAmount_);
    ...
    (uint256 seized, ) = MORPHO.liquidate(..., 0, repayShares, "");
    collateral.unwrap(seized, "");
    ctf.safeTransferFrom(..., seized, "");
}
```

**Similarity: 80%** — Same core flow (calculate shares → pull loan → liquidate → unwrap → transfer CTF). Presage adds: (1) explicit `accrueInterest` for consistent share conversion, (2) dust refund, (3) liquidation fee extraction. YLOP is cleaner but doesn't handle rounding edge cases.

#### 1.10 settleWithMerge() / liquidateUsingOppositeShares() + Flash Callback

```solidity
// ─── Presage ───
function settleWithMerge(uint256 marketId, address borrower, uint256 seizeAmount) external {
    ...
    ctf.safeTransferFrom(msg.sender, address(this), m.ctfPosition.oppositePositionId, seizeAmount, "");
    bytes memory cbData = abi.encode(marketId, borrower, msg.sender);
    wrapper.flashUnwrap(seizeAmount, address(this), address(this), cbData);
}
function onFlashUnwrap(address, uint256 amount, bytes calldata data) external override {
    (uint256 marketId, address borrower, address liquidator) = abi.decode(data, (uint256, address, address));
    ...
    ctf.mergePositions(loan, parentCollectionId, conditionId, partition, amount);
    uint256 repayAmount = _quoteRepay(m, amount);
    loan.forceApprove(address(morpho), repayAmount);
    (uint256 seized, ) = morpho.liquidate(m.morphoParams, borrower, amount, 0, "");
    require(seized == amount, "seize mismatch");
    uint256 profit = amount - repayAmount;
    // Fee on profit
    uint256 fee;
    if (m.liquidationFeeBps > 0 && treasury != address(0) && profit > 0) {
        fee = (profit * m.liquidationFeeBps) / BPS;
        loan.safeTransfer(treasury, fee);
    }
    loan.safeTransfer(liquidator, profit - fee);
}

// ─── YLOP ───
function liquidateUsingOppositeShares(uint256 marketId, address borrower_, uint256 seizeAmount_) external {
    ...
    ctf.safeTransferFrom(msg.sender, address(this), market.ctfParams.oppositePositionId, seizeAmount_, "");
    bytes memory data = abi.encode(market, borrower_, msg.sender, marketId);
    collateral.unwrap(seizeAmount_, data);                // ← triggers callback
}
function onCTFWrapperUnwrap(uint256 seizeAmount_, bytes calldata data_) external {
    (YlopMarket memory market, address borrower, address liquidator, uint256 marketId) = abi.decode(...);
    require(msg.sender == market.marketParams.collateralToken, "Invalid caller");
    ctf.mergePositions(loanToken, parentCollectionId, conditionId, binaryPartition, seizeAmount_);
    uint256 repayAmount = _quoteRepayAmount(market, seizeAmount_);
    loanToken.forceApprove(address(MORPHO), repayAmount);
    (uint256 seized, ) = MORPHO.liquidate(market.marketParams, borrower, seizeAmount_, 0, "");
    require(seized == seizeAmount_, "Ylop: seized amount doesn't match opposite amount");
    uint256 payback = seizeAmount_ - repayAmount;
    loanToken.safeTransfer(liquidator, payback);
}
```

**Similarity: 90%** — Identical flash-unwrap liquidation pattern: pull opposite → trigger callback → merge → calculate repay → liquidate → send profit. Presage adds fee extraction on profit. YLOP encodes the full `YlopMarket` struct in callback data; Presage encodes only `(marketId, borrower, liquidator)` and re-reads from storage.

#### 1.11 _quoteRepay() / _quoteRepayAmount() (Identical Math)

```solidity
// ─── Presage ───
function _quoteRepay(LendingMarket memory m, uint256 seizeAmount) internal view returns (uint256) {
    (,,uint128 totalBorrowAssets, uint128 totalBorrowShares,,) = morpho.market(m.morphoParams.id());
    uint256 oraclePrice = IOracle(m.morphoParams.oracle).price();
    uint256 seizedQuoted = seizeAmount.mulDivUp(oraclePrice, ORACLE_PRICE_SCALE);
    uint256 lif = UtilsLib.min(MAX_LIQUIDATION_INCENTIVE_FACTOR,
        WAD.wDivDown(WAD - LIQUIDATION_CURSOR.wMulDown(WAD - m.morphoParams.lltv)));
    uint256 repayShares = seizedQuoted.wDivUp(lif).toSharesUp(totalBorrowAssets, totalBorrowShares);
    return repayShares.toAssetsUp(totalBorrowAssets, totalBorrowShares);
}

// ─── YLOP ───
function _quoteRepayAmount(YlopMarket memory market_, uint256 seizeAmount_) private view returns (uint256) {
    Market memory morphoMarket = MORPHO.market(market_.marketParams.id());
    uint256 seizedAssetsQuoted = seizeAmount_.mulDivUp(
        IOracle(market_.marketParams.oracle).price(), ORACLE_PRICE_SCALE);
    uint256 liquidationIncentiveFactor = UtilsLib.min(MAX_LIQUIDATION_INCENTIVE_FACTOR,
        WAD.wDivDown(WAD - LIQUIDATION_CURSOR.wMulDown(WAD - market_.marketParams.lltv)));
    uint256 repayShares = seizedAssetsQuoted.wDivUp(liquidationIncentiveFactor)
        .toSharesUp(morphoMarket.totalBorrowAssets, morphoMarket.totalBorrowShares);
    return repayShares.toAssetsUp(morphoMarket.totalBorrowAssets, morphoMarket.totalBorrowShares);
}
```

**Similarity: 99%** — Mathematically identical. Same formula, same Morpho library calls, same constants. Only variable names differ.

#### 1.12 fillLeverage() — Side-by-Side

```solidity
// ─── Presage ─── (adds fee deduction on borrow proceeds)
function fillLeverage(address borrower, uint256 marketId) external {
    LeverageRequest storage req = leverageRequests[borrower][marketId];
    require(block.timestamp <= req.deadline, "request expired");
    require(!req.filled, "already filled");
    req.filled = true;
    ...
    if (req.marginAmount > 0) {
        ctf.safeTransferFrom(borrower, address(this), posId, req.marginAmount, "");
    }
    uint256 leveragedAmount = req.supplyCollateralAmount - req.marginAmount;
    ctf.safeTransferFrom(msg.sender, address(this), posId, leveragedAmount, "");
    ctf.setApprovalForAll(address(wrapper), true);
    wrapper.wrap(req.supplyCollateralAmount);
    ctf.setApprovalForAll(address(wrapper), false);
    wrapper.forceApprove(address(morpho), req.supplyCollateralAmount);
    morpho.supplyCollateral(m.morphoParams, req.supplyCollateralAmount, borrower, "");
    wrapper.forceApprove(address(morpho), 0);
    uint256 borrowAmount = req.borrowAmountMax;
    morpho.borrow(m.morphoParams, borrowAmount, 0, borrower, address(this));  // ← to: this
    // Fee deduction
    IERC20 loan = IERC20(m.morphoParams.loanToken);
    uint256 fee;
    if (m.originationFeeBps > 0 && treasury != address(0)) {
        fee = (borrowAmount * m.originationFeeBps) / BPS;
        loan.safeTransfer(treasury, fee);
    }
    loan.safeTransfer(msg.sender, borrowAmount - fee);
}

// ─── YLOP ─── (no fees, borrow sent directly to solver)
function fillLeverage(address borrower_, uint256 marketId_) external {
    LeverageRequest storage request = leverageRequests[borrower_][marketId_];
    require(block.timestamp <= request.deadline, "Ylop: request expired");
    require(!request.filled, "Ylop: request already filled");
    request.filled = true;
    ...
    if (request.marginAmount > 0) {
        ctf.safeTransferFrom(borrower_, address(this), positionId, request.marginAmount, "");
    }
    uint256 leveragedAmount = request.supplyCollateralAmount - request.marginAmount;
    ctf.safeTransferFrom(msg.sender, address(this), positionId, leveragedAmount, "");
    ctf.setApprovalForAll(address(wrapper), true);
    wrapper.wrap(request.supplyCollateralAmount);
    ctf.setApprovalForAll(address(wrapper), false);
    wrapper.forceApprove(address(MORPHO), request.supplyCollateralAmount);
    MORPHO.supplyCollateral(marketParams, request.supplyCollateralAmount, borrower_, "");
    wrapper.forceApprove(address(MORPHO), 0);
    MORPHO.borrow(marketParams, request.borrowAmountMax, 0, borrower_, msg.sender);  // ← to: solver
}
```

**Similarity: 90%** — Identical 7-step atomic flow. Key difference: Presage routes borrow through itself for fee extraction; YLOP sends directly to solver via Morpho's `receiver` param.

#### 1.13 healthFactor() — Same Formula, Different Data Access

```solidity
// ─── Presage ─── (destructures tuple returns)
function healthFactor(uint256 marketId, address borrower) external view returns (uint256) {
    MarketParams memory mp = _markets[marketId].morphoParams;
    Id mid = mp.id();
    (,,uint128 totalBorrowAssets, uint128 totalBorrowShares,,) = morpho.market(mid);
    (, uint128 borrowShares, uint128 collateral) = morpho.position(mid, borrower);
    if (borrowShares == 0) return type(uint256).max;
    uint256 borrowed = (uint256(borrowShares) * totalBorrowAssets) / totalBorrowShares;
    if (borrowed == 0) return type(uint256).max;
    uint256 collateralValue = (uint256(collateral) * IOracle(mp.oracle).price()) / ORACLE_PRICE_SCALE;
    return (collateralValue * mp.lltv) / borrowed;
}

// ─── YLOP ─── (uses Market/Position structs)
function healthFactor(uint256 marketId_, address borrower_) external view returns (uint256) {
    MarketParams memory _marketParams = markets[marketId_].marketParams;
    Id _morphoId = _marketParams.id();
    Market memory _market = MORPHO.market(_morphoId);
    Position memory _position = MORPHO.position(_morphoId, borrower_);
    uint256 _collateralPrice = IOracle(_marketParams.oracle).price();
    if (_market.totalBorrowShares == 0) return type(uint256).max;
    uint256 _borrowed = (uint256(_position.borrowShares) * _market.totalBorrowAssets) / _market.totalBorrowShares;
    if (_borrowed == 0) return type(uint256).max;
    uint256 _collateralInBorrowToken = (uint256(_position.collateral) * _collateralPrice) / ORACLE_PRICE_SCALE;
    return (_collateralInBorrowToken * _marketParams.lltv) / _borrowed;
}
```

**Similarity: 98%** — Identical formula: `(collateral * oraclePrice * lltv) / (borrowShares * totalBorrowAssets / totalBorrowShares)`. YLOP adds extra guard (`totalBorrowShares == 0`). Presage checks `borrowShares == 0` (equivalent since totalBorrowShares=0 implies borrowShares=0).

#### 1.14 Presage-Only Features (No YLOP Equivalent)

| Feature | Lines | Code |
|---------|------:|------|
| Fee admin (`setTreasury`, `setDefaultOriginationFee`, `setDefaultLiquidationFee`, `setMarketFees`) | 25 | Fee cap enforcement, per-market overrides |
| `cancelLeverageRequest()` / `cancelDeleverageRequest()` | 16 | Request cleanup + event emission |
| `getMarket()` view | 10 | Returns full market struct |
| `triggerAccrual()` | 3 | Public interest accrual trigger |

#### 1.15 YLOP-Only Features (No Presage Equivalent)

| Feature | Lines | Code |
|---------|------:|------|
| `ltv()` view | 25 | Current loan-to-value ratio |
| `positionOf()` view | 12 | Returns (supplied, collateral, borrowed) tuple |
| `isHealthy()` view | 16 | Boolean liquidation eligibility check |
| Full `IYlop` interface | 373 | Comprehensive NatSpec documentation |

---

### 2. ERC20 Wrapper: WrappedCTF.sol (63 lines) vs CTFWrapper.sol (38 lines)

```solidity
// ─── Presage: WrappedCTF ───
contract WrappedCTF is ERC20, ERC1155Holder {
    ICTF public ctf;
    uint256 public positionId;
    uint8 internal _dec;
    bool internal _initialized;

    constructor() ERC20("Presage wCTF", "pwCTF") {}

    function initialize(ICTF ctf_, uint256 positionId_, uint8 decimals_) external {
        require(!_initialized, "already init");
        _initialized = true;
        ctf = ctf_; positionId = positionId_; _dec = decimals_;
    }
    function wrap(uint256 amount) external {
        ctf.safeTransferFrom(msg.sender, address(this), positionId, amount, "");
        _mint(msg.sender, amount);
    }
    function unwrap(uint256 amount) external {
        _burn(msg.sender, amount);
        ctf.safeTransferFrom(address(this), msg.sender, positionId, amount, "");
    }
    function flashUnwrap(uint256 amount, address receiver, address callback, bytes calldata data) external {
        _burn(msg.sender, amount);
        ctf.safeTransferFrom(address(this), receiver, positionId, amount, "");
        if (callback != address(0)) IFlashUnwrapCallback(callback).onFlashUnwrap(msg.sender, amount, data);
    }
}

// ─── YLOP: CTFWrapper ───
contract CTFWrapper is ICTFWrapper, ERC1155Holder, ERC20, Ownable {
    IConditionalTokens public immutable CTF;
    uint256 public immutable POSITION_ID;
    uint8 internal immutable _decimals;

    constructor(IConditionalTokens ctf_, uint256 positionId_, uint8 decimals_)
        ERC20("Ylop Wrapped CTF", "ylopwCTF") Ownable(msg.sender) {
        CTF = ctf_; POSITION_ID = positionId_; _decimals = decimals_;
    }
    function wrap(uint256 amount_) external override onlyOwner {
        CTF.safeTransferFrom(msg.sender, address(this), POSITION_ID, amount_, "");
        _mint(msg.sender, amount_);
    }
    function unwrap(uint256 amount_, bytes calldata data_) external onlyOwner {
        CTF.safeTransferFrom(address(this), msg.sender, POSITION_ID, amount_, "");
        if (data_.length > 0) ICTFWrapperUnwrapCallback(msg.sender).onCTFWrapperUnwrap(amount_, data_);
        _burn(msg.sender, amount_);
    }
}
```

| Aspect | Presage | YLOP |
|--------|---------|------|
| Deployment | EIP-1167 clone + `initialize()` | Direct `new` in constructor |
| State | Mutable (set once via init) | Immutable (set in constructor) |
| Access | Permissionless (anyone can wrap/unwrap) | `onlyOwner` (only Ylop) |
| Flash pattern | Dedicated `flashUnwrap()` function | Callback in `unwrap()` via `data_` param |
| Burn order | **burn → transfer** (unwrap), **burn → transfer → callback** (flash) | **transfer → callback → burn** |
| Extra inheritance | — | `Ownable` |

**Similarity: 75%** — Same concept (1:1 ERC1155↔ERC20), same `wrap`/`unwrap` core logic. Significant design differences in deployment model, access control, and callback architecture.

---

### 3. Oracle: PriceHub.sol (159 lines) vs OracleRegistry.sol (111 lines)

#### 3.1 Architecture

```solidity
// ─── Presage: PriceHub spawns MorphoOracleStub inline ───
contract PriceHub is Ownable {
    struct MarketConfig { positionId, resolutionAt, decayDuration, decayCooldown, loanDecimals, collateralDecimals }
    struct PricePoint { price, updatedAt }

    IPriceAdapter public defaultAdapter;
    mapping(uint256 => IPriceAdapter) public adapters;     // per-position override
    mapping(uint256 => PricePoint) public prices;
    mapping(uint256 => address) public oracles;
    mapping(uint256 => MarketConfig) public configs;

    function spawnOracle(...) → address { new MorphoOracleStub(positionId, this); }
    function morphoPrice(positionId) → applies staleness + decay + decimal scaling
}

contract MorphoOracleStub is IOracle {
    function price() → hub.morphoPrice(positionId);
}

// ─── YLOP: OracleRegistry deploys separate Oracle contract ───
contract OracleRegistry is IOracleRegistry, Ownable {
    struct PriceData { price, updatedAt }

    IYlop public ylop;                                      // back-reference to Ylop
    EnumerableSet.AddressSet private _verifiers;
    mapping(uint256 => IOracle) public oracles;
    mapping(uint256 => PriceData) public prices;
    mapping(address => string) public endpoints;            // per-CTF endpoint

    function deploy(marketId) → IOracle { new Oracle(marketId); }
    function price(marketId) → applies staleness + decay
}

contract Oracle is IOracle {
    function price() → registry.price(marketId);
}
```

**Similarity: 85%** — Identical pattern: registry stores prices, spawns lightweight oracle stubs that delegate `price()` back to registry. Key differences:
- **Keying**: Presage keys by `positionId`; YLOP keys by `marketId`
- **Adapters**: Presage has pluggable adapter pattern (default + override); YLOP has verifier set
- **Decimal handling**: Presage stores and applies decimal scaling in morphoPrice(); YLOP assumes same decimals
- **Decay config**: Presage stores in PriceHub config; YLOP reads from Ylop contract via back-reference

#### 3.2 Decay Factor (Identical Formula)

```solidity
// ─── Presage ───
function _decayFactor(MarketConfig memory cfg) internal view returns (uint256) {
    if (cfg.resolutionAt == 0 || cfg.decayDuration == 0) return 1e18;
    uint256 end = cfg.resolutionAt - cfg.decayCooldown;
    uint256 start = end - cfg.decayDuration;
    if (block.timestamp < start) return 1e18;
    if (block.timestamp >= end) return 0;
    return ((end - block.timestamp) * 1e18) / cfg.decayDuration;
}

// ─── YLOP ───
function decayFactor(uint256 marketId_) public view returns (uint256) {
    (, , uint256 resolutionAt, IYlop.LLTVDecay memory lltvDecay) = ylop.markets(marketId_);
    uint256 start = resolutionAt - lltvDecay.cooldown - lltvDecay.duration;
    uint256 end = resolutionAt - lltvDecay.cooldown;
    if (block.timestamp < start) return 1e36;
    if (block.timestamp >= end) return 0;
    return ((end - block.timestamp) * 1e36) / lltvDecay.duration;
}
```

**Similarity: 95%** — Identical linear decay formula. Only scale differs: Presage uses `1e18` and multiplies in `morphoPrice()`; YLOP uses `1e36` and divides in `price()`. Mathematically equivalent result.

#### 3.3 Price Submission Flow

```solidity
// ─── Presage: adapter-mediated two-step ───
// Step 1: External calls submitPrice → adapter.submitPrice(positionId, proof)
// Step 2: Adapter verifies → calls priceHub.recordPrice(positionId, probability, timestamp)
function recordPrice(uint256 positionId, uint256 probability, uint256 timestamp) external {
    require(msg.sender == address(_adapterFor(positionId)), "unauthorized");
    require(probability <= 1e18, "price > 1");
    require(timestamp >= prices[positionId].updatedAt, "stale");
    prices[positionId] = PricePoint(probability, timestamp);
}

// ─── YLOP: direct verification in registry ───
function updatePrice(uint256 marketId_, Proof calldata proof_) public override {
    require(_verifiers.contains(proof_.verifier), "Invalid Verifier");
    IVerifier _verifier = IVerifier(proof_.verifier);
    (uint256 _timestamp, uint256 _tokenId, uint256 _price, string memory url) = _verifier.verify(proof_.encodedProof);
    require(_timestamp >= prices[marketId_].updatedAt, "Stale proof");
    require(_price <= 1e18, "Price too high");
    // Validate tokenId and URL against market config...
    prices[marketId_] = PriceData({price: _price * 1e18, updatedAt: _timestamp});
}
```

**Similarity: 75%** — Same validation checks (staleness, price bounds). Presage delegates validation to adapters then receives the result; YLOP does inline verification with URL/tokenId validation in the registry itself.

---

### 4. ReclaimVerifier: Presage (210 lines) vs YLOP (88 lines)

| Aspect | Presage | YLOP |
|--------|---------|------|
| Interface | `IProofVerifier.verify() → (timestamp, positionId, price)` | `IVerifier.verify() → (timestamp, tokenId, price, url)` |
| URL handling | Returns positionId (resolved via endpoint→positionId mapping) | Returns raw URL + tokenId (validation done in OracleRegistry) |
| Position mapping | Internal: `mapPosition(endpoint, marketId, positionId)` | External: OracleRegistry validates `tokenId == ctfParams.positionId` |
| Endpoint validation | Internal: `_matchEndpoint()` against indexed whitelist | External: OracleRegistry validates URL prefix against `endpoints[ctf]` |
| Price parsing | `_parseDecimalToWad()` — handles `"0.65"` format | `_extractPrice()` — handles `"\"0.034\""` escaped format |
| Token ID extraction | Via endpoint mapping (no URL parsing) | `_extractURLAndTokenId()` — parses `token_id=<digits>` from URL |
| Admin | `Ownable` — endpoint CRUD + position mapping | Stateless — no admin functions |
| Lines | 210 | 88 |

**Similarity: 70%** — Both verify Reclaim proofs and extract (timestamp, price) from the same proof structure. Presage is self-contained (manages its own endpoint whitelist and position mapping); YLOP is a thin verifier that delegates validation to OracleRegistry.

---

### 5. WrapperFactory (Presage-Only)

```solidity
// Presage: 42 lines — no YLOP equivalent
contract WrapperFactory {
    address public immutable implementation;
    mapping(uint256 => address) public wrappers;

    constructor() { implementation = address(new WrappedCTF()); }

    function create(ICTF ctf, uint256 positionId, uint8 decimals_) external returns (address wrapper) {
        require(wrappers[positionId] == address(0), "exists");
        bytes32 salt = _salt(address(ctf), positionId);
        wrapper = Clones.cloneDeterministic(implementation, salt);
        WrappedCTF(wrapper).initialize(ctf, positionId, decimals_);
        wrappers[positionId] = wrapper;
    }

    function predictAddress(ICTF ctf, uint256 positionId) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, _salt(address(ctf), positionId));
    }
}
```

YLOP creates wrappers inline in `createMarket()` via `new CTFWrapper(...)`. No factory, no CREATE2, no address prediction, no deduplication across markets.

---

### 6. Code Metrics Summary

| Metric | Presage | YLOP | Delta |
|--------|---------|------|-------|
| Main contract lines | 575 | 441 | +134 (fee system, cancel functions) |
| Wrapper lines | 63 | 38 | +25 (flash unwrap, init pattern) |
| Oracle registry lines | 159 | 111 | +48 (adapter pattern, decimal scaling, seed) |
| Oracle stub lines | 12 (inline) | 19 (separate file) | -7 |
| Verifier lines | 210 | 88 | +122 (self-contained validation) |
| Factory lines | 42 | 0 | +42 |
| Interface lines | ~30 (scattered) | 373 (comprehensive IYlop) | -343 |
| **Total core Solidity** | **~1,061** | **~1,070** | ~equal |

---

### 7. Code-Level Similarity Scores

| Code Unit | Score | Rationale |
|-----------|:-----:|-----------|
| `supply()` | 98% | Identical call sequence, only var names differ |
| `withdraw()` | 98% | One-liner difference in naming |
| `depositCollateral()` / `supplyCollateral()` | 97% | Same 7-step wrapping flow |
| `releaseCollateral()` / `withdrawCollateral()` | 97% | Same 3-step unwrapping flow |
| `borrow()` | 70% | Fee routing divergence |
| `repay()` | 85% | Same rounding fix, different threshold logic |
| `settleWithLoanToken()` / `liquidateUsingLoanToken()` | 80% | Same flow, Presage adds accrual + fees + dust |
| `settleWithMerge()` / `liquidateUsingOppositeShares()` | 90% | Identical flash pattern, Presage adds fees |
| `_quoteRepay()` / `_quoteRepayAmount()` | 99% | Mathematically identical |
| `requestLeverage()` | 95% | Presage adds validation checks |
| `fillLeverage()` | 90% | Identical flow, Presage adds fees |
| `requestDeleverage()` | 98% | Essentially identical |
| `fillDeleverage()` | 95% | Same flow, minor dust handling diff |
| `healthFactor()` | 98% | Same formula |
| `decayFactor()` | 95% | Same formula, different scale (1e18 vs 1e36) |
| Wrapper `wrap()` | 95% | Same logic, different access model |
| Wrapper `unwrap()` / `flashUnwrap()` | 75% | Different callback architecture |
| Oracle stub `price()` | 98% | Both delegate to registry |
| ReclaimVerifier `verify()` | 70% | Same proof verification, different output/validation split |
| **Weighted Average** | **~90%** | |

---

## Conclusion

Presage and YLOP are two implementations of the **same protocol design**. The core smart contract logic — lending, collateral wrapping, dual liquidation, solver-assisted leverage, and time-decaying LLTV — is functionally identical across both codebases. The naming differs (`Presage` vs `Ylop`, `WrappedCTF` vs `CTFWrapper`, `PriceHub` vs `OracleRegistry`, `settle` vs `liquidate`) but the behavior, data structures, and on-chain interactions map 1:1.

At the code level, functions like `supply()`, `healthFactor()`, and `_quoteRepay()` are **98-99% identical** — the same Morpho library calls in the same order with only variable names changed. The divergences appear in: (1) Presage's fee system adding ~130 lines of fee routing logic, (2) different wrapper deployment models (factory/clone vs inline/ownable), (3) different oracle adapter architectures (pluggable vs inline), and (4) Presage's more defensive edge-case handling (dust refunds, interest accrual before liquidation).

**Presage is the more developed version**, with a significantly larger ecosystem: SDK, UI, playground, solver bot, allocator bot, MetaMorpho vault integration, multiple oracle adapters, and a fee system. YLOP is a leaner, contracts-only implementation with Foundry as its primary toolchain and a cleaner interface definition.

Both projects target the same chain (BNB), use the same external protocols (Morpho Blue, Reclaim), and share identical deployed dependency addresses.
