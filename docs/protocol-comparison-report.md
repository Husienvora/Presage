# Strategic Protocol Analysis: Presage vs. YLOP — Code-Verified Comparison
**Subject:** Technical evaluation of YLOP's claimed innovations, strategic independence timing, and leverage gap analysis
**Date:** March 17, 2026
**Methodology:** Full source-code review of Presage and YLOP smart contract repositories. Note: only on-chain contract code was available for review. YLOP's off-chain infrastructure (bots, solvers, internal tooling) was not available and its status is unknown.

---

## Executive Summary

Both Presage and YLOP are thin routers built on top of **Morpho Blue** (`0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a` on BNB). They share the same lending engine, the same IRM, and the same liquidation math. Of YLOP's 5 claimed "innovations," **only one — solver-assisted leverage — is actually implemented in their contracts**. The other four are either shared technology, not implemented on-chain, or pure marketing. However, the leverage mechanism is the single most important feature for user acquisition and capital efficiency, and Presage currently does not have it.

**Bottom line:** Presage has feature parity on 4 of 5 claims and advantages in fees, oracle flexibility, and architecture. Two gaps must be closed before April 7th: **(1) liquidation infrastructure** — Presage does not yet have a liquidation bot, price keeper, or operational automation, and it is unknown whether YLOP has built these separately; **(2) leverage looping** — the #1 driver of TVL growth. Breaking with YLOP now is strategically sound because there is nothing in their on-chain contracts that cannot be replicated before April 7th.

---

## YLOP's 5 Claimed Innovations — Verified Against Code

### 1. Temporal Liquidation Threshold Decay (TLD)

**Claimed:** "The standout innovation... does not exist in Aave, Morpho, Compound."

**Reality: Both protocols have identical implementations. Not a moat.**

Because Morpho Blue's LLTV is immutable once a market is created, neither protocol decays the LLTV itself — both decay the **oracle price**, which has the same economic effect (borrowing power compresses linearly toward zero as resolution approaches).

| | YLOP (`OracleRegistry.sol:41-51`) | Presage (`PriceHub.sol:127-134`) |
|---|---|---|
| **Decay target** | Oracle price | Oracle price |
| **Math** | `(end - now) * 1e36 / duration` | `(end - now) * 1e18 / duration` |
| **Window** | `resolutionAt - cooldown - duration` → `resolutionAt - cooldown` | Identical |
| **Applied in** | `price()` return value | `morphoPrice()` return value |
| **Effect when expired** | Returns 0 (all positions liquidatable) | Returns 0 (all positions liquidatable) |

The only difference is scale factor (1e36 vs 1e18), which is an internal convention — the economic behavior is identical. **Presage had this from the start.**

**Verdict: Matched. No action needed.**

---

### 2. zkTLS as a Pull Oracle for Prediction Market Pricing

**Claimed:** "No one before YLOP had used zkTLS proofs to verify prediction market share prices."

**Reality: Both use the exact same third-party technology (Reclaim Protocol). Presage has broader oracle support.**

| | YLOP | Presage |
|---|---|---|
| **zkTLS Verifier** | `ReclaimVerifier.sol` (89 lines) | `ReclaimVerifier.sol` (211 lines, more robust) |
| **Reclaim Contract** | `0x5917FaB4808A119560dfADc14F437ae1455AEd40` | Same provider |
| **Additional Oracles** | None | `SignedProofVerifier.sol` (ECDSA relayer), `FixedPriceAdapter.sol` ($1 fallback) |
| **Architecture** | Monolithic (OracleRegistry does everything) | Pluggable (`IPriceAdapter` interface — swap backends without redeployment) |
| **Endpoint Validation** | URL prefix matching | URL prefix matching + positionId mapping |

Presage's `IPriceAdapter` plugin architecture is strictly more flexible. New oracle backends (Chainlink, Pyth, API3) can be added without touching the core contract. YLOP's oracle logic is hardcoded into their OracleRegistry.

**Presage advantage:** `SignedProofVerifier` provides a fast, cheap oracle path for markets where zkTLS overhead isn't justified. This is useful for launch speed.

**Verdict: Matched and exceeded. No action needed.**

---

### 3. Three-Layer Market Eligibility & Risk Scoring Model (Layer A/B/C)

**Claimed:** "The framework of Layer A/B hard gates plus seven-weighted-factor quantitative scoring (Layer C) for whitelisting prediction market collateral."

**Reality: No on-chain implementation exists in YLOP's contracts. Market creation is owner-only with no automated scoring.**

YLOP's market creation (`Ylop.sol:createMarket`) is simply:
```solidity
function createMarket(...) external onlyOwner
```

No on-chain Layer A, B, or C gates. No quantitative scoring logic. No automated validation of prediction market quality. The owner calls `createMarket()` and picks the parameters manually. Whether YLOP has off-chain tooling or internal processes that implement this scoring framework is unknown — but nothing is enforced at the contract level.

Presage has the identical on-chain mechanism: `openMarket()` with `onlyOwner`. Both protocols gate market creation through admin discretion at the contract layer. Any "Layer A/B/C" framework is a **governance process** that either protocol can build independently — there is no on-chain logic to replicate.

**Verdict: Not an on-chain feature. Both rely on owner discretion at the contract layer. Presage can independently develop any off-chain scoring methodology it needs.**

---

### 4. Solver-Assisted Atomic Leverage

**Claimed:** "A user requests leverage and a third-party solver atomically delivers the shares."

**Reality: THIS IS YLOP'S ONE GENUINE ON-CHAIN DIFFERENTIATOR. Presage does not have it yet.**

YLOP implements four functions in `Ylop.sol`:

| Function | Purpose |
|---|---|
| `requestLeverage(marketId, margin, totalCollateral, maxBorrow, deadline)` | Borrower posts intent: "I have X margin, want Y total collateral exposure" |
| `fillLeverage(borrower, marketId)` | Solver provides the extra collateral, wraps all, supplies to Morpho, borrows on behalf of borrower, receives loan tokens |
| `requestDeleverage(marketId, repayAmount, maxWithdraw, deadline)` | Borrower posts intent: "I want to unwind" |
| `fillDeleverage(borrower, marketId)` | Solver provides loan tokens, repays Morpho, receives collateral |

**How it works (leverage):**
1. Borrower has 100 YES tokens as margin, wants 3x exposure (300 total)
2. Borrower calls `requestLeverage(marketId, 100, 300, 150_USDT, deadline)`
3. Solver sees profitable opportunity, calls `fillLeverage(borrower, marketId)`
4. Atomically: solver provides 200 YES tokens + borrower's 100 → all wrapped → supplied to Morpho → borrows 150 USDT → USDT goes to solver
5. Result: borrower has 300 collateral, 150 debt. Solver spent 200 YES tokens, received 150 USDT.

**Why this matters:** Leverage looping is the #1 driver of TVL and user acquisition in DeFi lending. A user who can 3x their prediction market position will never use a plain borrow flow. Looping is extremely important and should take priority over other feature work.

**Gap assessment:**
- YLOP's on-chain solver mechanism is ~250 lines of Solidity (4 functions + storage)
- The mechanism is straightforward: request/fill pattern with deadline protection
- **Estimated implementation effort for Presage: 2-3 days for an experienced Solidity developer**
- The on-chain contracts only handle the request/fill flow — the actual solver (an off-chain bot that monitors requests and fills them) is separate infrastructure. Whether YLOP has a working solver bot is unknown, but the on-chain hooks are in place.

**Verdict: Real gap. Must be closed before or shortly after launch. See recommendations below.**

---

### 5. Portfolio-Aware LTV (HHI-Based Diversification Bonus)

**Claimed:** "Applying HHI to reward collateral diversification across uncorrelated prediction market categories with an LTV bonus."

**Reality: No on-chain implementation exists in YLOP's contracts. No HHI calculation exists anywhere in the reviewed codebase.**

YLOP's health factor calculation (`Ylop.sol:359-381`) is strictly per-market:
```solidity
function healthFactor(uint256 marketId_, address borrower_) external view returns (uint256) {
    // ... single market, single collateral, single price ...
    return (_collateralInBorrowToken * _marketParams.lltv) / _borrowed;
}
```

No cross-market aggregation. No portfolio view. No diversification bonus. Each market is fully isolated, exactly like Presage.

Furthermore, this **cannot** be implemented on Morpho Blue without building a custom lending pool. Morpho Blue is designed for isolated markets (1 loan token vs. 1 collateral token). Cross-collateralization would require a fundamentally different architecture and would reintroduce the contagion risk that isolated pools are designed to prevent.

**Verdict: Not implemented on-chain, and cannot be implemented on Morpho Blue without abandoning its core isolated-market design. If YLOP has this, it would require a fundamentally different architecture than what their contracts currently use.**

---

## Presage On-Chain Advantages (Verified in Contracts)

| Feature | Presage | YLOP (per reviewed contracts) |
|---|---|---|
| **Protocol Fees** | Origination fee (0-5%) + Liquidation fee (0-20%) with configurable treasury | No fee mechanism in contracts |
| **Pluggable Oracle Architecture** | `IPriceAdapter` interface — swap oracle backends without redeployment | Monolithic OracleRegistry, tightly coupled |
| **Multiple Oracle Types** | zkTLS (Reclaim) + ECDSA Relayer + Fixed Price fallback | zkTLS (Reclaim) only in contracts |
| **Deterministic Wrapper Addresses** | CREATE2 via WrapperFactory — address predictable before deployment | Standard deployment, no address prediction |
| **EIP-1167 Minimal Proxies** | ~67k gas per wrapper clone | Full contract deployment per wrapper |
| **Fee Treasury** | Configurable per-market, fees disabled when treasury unset | None in contracts |
| **Safe Batch Encoding** | `SafeBatchHelper` for atomic UX flows | No batching helper in contracts |

---

## Side-by-Side Architecture Comparison

| Component | Presage | YLOP |
|---|---|---|
| **Lending Engine** | Morpho Blue (same instance) | Morpho Blue (same instance) |
| **Main Router** | `Presage.sol` (395 lines) | `Ylop.sol` (441 lines) |
| **CTF Wrapper** | `WrappedCTF.sol` via `WrapperFactory.sol` (EIP-1167 clones) | `CTFWrapper.sol` (direct deploy) |
| **Oracle Registry** | `PriceHub.sol` + `MorphoOracleStub` | `OracleRegistry.sol` + `Oracle.sol` |
| **Price Decay** | In `PriceHub.morphoPrice()` | In `OracleRegistry.price()` |
| **zkTLS Verifier** | `ReclaimVerifier.sol` (211 lines, more thorough) | `ReclaimVerifier.sol` (89 lines) |
| **Liquidation Path 1** | `settleWithLoanToken()` | `liquidateUsingLoanToken()` |
| **Liquidation Path 2** | `settleWithMerge()` + `onFlashUnwrap()` | `liquidateUsingOppositeShares()` + `onCTFWrapperUnwrap()` |
| **Leverage** | **Not implemented** | `requestLeverage/fillLeverage` + `requestDeleverage/fillDeleverage` |
| **Fees** | Origination + Liquidation + Treasury | None |
| **Market Creation** | `onlyOwner` | `onlyOwner` |

---

## Strategic Analysis: Break Timing & Launch Risk

### Should Presage break with YLOP now or wait?

**Recommendation: Break now.** Here's why, grounded in code facts:

1. **There is nothing in YLOP's on-chain contracts Presage cannot build.** Their total contract surface is ~700 lines of Solidity (Ylop.sol 441 + OracleRegistry 111 + Oracle 20 + CTFWrapper 38 + ReclaimVerifier 89). Presage is already at feature parity on everything except leverage. What off-chain tooling YLOP may have is unknown, but off-chain infrastructure (bots, keepers) is standard engineering work, not a proprietary moat.

2. **The leverage gap is closable.** YLOP's solver mechanism is ~250 lines. It's a request/fill pattern — no novel cryptography, no complex math. Building this into Presage is straightforward.

3. **Waiting creates dependency risk.** If YLOP identifies Presage as a competitor and cuts access, the scramble to replace whatever integration exists will cost more time than proactively building independence now.

4. **Presage already has advantages YLOP lacks** — fee capture, pluggable oracles, multiple verifier types, gas-efficient wrapper deployment. These compound over time.

### Will breaking delay the April 7th launch?

**Assessment: No, if leverage is scoped correctly.**

- Presage can launch on April 7th **without leverage** — basic lend/borrow/liquidate is fully functional
- Leverage can be added as a v1.1 feature within 1-2 weeks post-launch
- Alternatively, if leverage is critical for launch, the solver mechanism can be added to Presage in 2-3 days of focused development
- The solver bot (off-chain component that fills leverage requests) is the longer pole — but a simple bot watching events and auto-filling is ~1 day of work

### Why looping should be the #1 priority

Leverage looping is the primary growth driver for any prediction market lending protocol:

- **Without looping:** User deposits $1000 of YES tokens, borrows $600 USDT. Capital efficiency: 1x exposure with some liquidity extraction.
- **With looping (3x):** User deposits $1000, borrows $600, buys $600 more YES tokens, deposits those, borrows $360 more... effective exposure: ~$2500 on $1000 margin.
- **TVL multiplier:** Every dollar of real collateral generates 2-3x in protocol TVL
- **Revenue multiplier:** More borrowing = more interest = more origination fees

**This should take priority above parimutuel/mustard features.** Presage can overtake YLOP by shipping leverage first or better.

---

## Critical Gap: Liquidation Infrastructure

**Presage does not yet have a liquidation bot, price keeper, or any operational automation.** No bot code exists in the Presage codebase. Whether YLOP has built this infrastructure separately is unknown — their smart contract repo contains no bot code either, but they may maintain off-chain tooling in private repositories.

Regardless of what YLOP has, this is the single biggest operational risk for Presage's April 7th launch. A lending protocol without liquidation infrastructure will accumulate bad debt on day one.

### Why "Morpho MEV searchers will handle it" is wrong

The `liquidity-incentive-plan.md` assumes existing Morpho liquidation bots will automatically protect Presage markets. This assumption has three problems:

1. **Standard Morpho bots can't profit from prediction market collateral.** They seize ERC20 tokens and sell on DEXes (Uniswap, PancakeSwap). WrappedCTF tokens have zero DEX liquidity — a bot that seizes them has no way to sell, making the liquidation unprofitable. No rational bot will add these markets.

2. **The "flash-loan → liquidate → sell on predict.fun" loop doesn't work atomically.** predict.fun uses an off-chain orderbook with API-based trading, not an on-chain AMM. There is no way to sell seized collateral back into predict.fun in the same transaction. The arbitrage loop described in the docs cannot be executed as described.

3. **Oracle freshness requires active maintenance.** Presage uses pull oracles — prices must be submitted with proofs before they go stale (default: 1 hour). If nobody updates the oracle, `morphoPrice()` reverts, and **no liquidation can execute**. Bad debt accumulates silently.

### The router bypass problem

Liquidators calling `settleWithLoanToken()` pay Presage's `liquidationFeeBps`. But they can call `Morpho.liquidate()` directly, bypassing the router entirely. Same discount, zero fees. Economically rational liquidators will always bypass the router for Path A liquidations. Only Path B (merge with opposite tokens) is protected, because it requires Presage's `onFlashUnwrap` callback.

**Revenue impact:** The liquidation fee revenue model only works reliably on merge-path liquidations. Path A fees are unenforceable.

### What must be built

| Component | Purpose | Priority |
|---|---|---|
| **Safety Bot** | Monitors all positions, executes liquidations when HF < 1.0 | Launch blocker |
| **Price Keeper** | Submits fresh oracle proofs before staleness window expires | Launch blocker |
| **Bot Wallet Funding** | USDT + opposite CTF tokens for the bot to execute with | Launch blocker |
| **Health Dashboard** | Real-time view of all positions and health factors for monitoring | Launch day |
| **Alerting** | Notifications when positions approach liquidation threshold | Week 1 |

Whether YLOP has operational liquidation infrastructure is unknown — it was not present in the contracts repository reviewed. There is no guarantee YLOP has these, so Presage must build its own, and Yamata should separate from YLOP.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| **No liquidation bot at launch** | **Critical** | **Build and fund a Safety Bot before April 7th** |
| **Oracle goes stale, freezing all liquidations** | **Critical** | **Build a Price Keeper that submits proofs on a schedule** |
| YLOP launches leverage before Presage | High | Build solver mechanism into Presage ASAP |
| Liquidators bypass router, avoiding fees | Medium | Prioritize merge-path liquidation incentives; accept Path A leakage |
| YLOP has first-mover brand recognition | Medium | Yamata ecosystem (spot exchange, wallet) is the real distribution advantage |
| YLOP cuts off access to shared infrastructure | Medium | Presage is fully independent — own contracts, own oracles, own deployment |
| YLOP implements portfolio LTV | Low | Cannot be done on Morpho Blue's isolated-market architecture without a fundamentally different design |
| YLOP adds a fee mechanism | Low | Would require contract redeployment — Presage already has this built in |

---

## Recommended Action Plan

### Launch Blockers (Before April 7th)
1. **Build and deploy a Safety Bot** — Off-chain service that monitors all borrower positions, keeps oracle prices fresh, and executes liquidations when health factor drops below 1.0. Without this, the protocol cannot safely hold user funds.
2. **Build a Price Keeper** — Can be part of the Safety Bot. Submits signed or zkTLS proofs on a schedule to prevent oracle staleness. If prices go stale, all Morpho operations (including liquidations) revert.
3. **Fund the bot wallet** — The bot needs USDT to execute Path A liquidations. Optionally hold opposite-outcome CTF tokens for more profitable Path B (merge) liquidations.
4. **Build leverage into Presage** — Add `requestLeverage`, `fillLeverage`, `requestDeleverage`, `fillDeleverage` to `Presage.sol`. Apply origination fees to leveraged borrows.
5. **Build a simple solver bot** — Off-chain service that monitors leverage requests, checks profitability, and fills. Start with a Yamata-operated solver, open to third parties later.
6. **Formalize independence from YLOP** — Presage has zero technical dependencies on their contracts. There is no integration to unwind.

### Post-Launch (April 7th+)
7. **Looping UI** — One-click "3x Leverage" button that creates leverage request + waits for solver fill. This is the killer UX.
8. **Cross-asset collateral** — The Yamata wallet vision (borrow against spot ETH to bet on prediction markets) is the real long-term moat. No standalone lending protocol can replicate this without building an entire exchange.
9. **Open solver network** — Let anyone run a solver bot. Competition drives better fills for users.
10. **Liquidation bot incentive program** — Publish a bot SDK/template so third-party liquidators can profitably run bots on Presage markets, reducing reliance on the team-operated Safety Bot.

---

## Conclusion

Of YLOP's five claimed innovations, the on-chain evidence shows: TLD is shared technology with identical math. zkTLS is a third-party tool both protocols use. Risk scoring and portfolio LTV have no on-chain implementation. The only verified on-chain differentiator — solver-assisted leverage — is a moderate engineering task, not a fundamental architectural advantage. What off-chain tooling YLOP may have (bots, solvers, risk scoring tools, keepers) is unknown.

There is no guarantee YLOP has the off-chain operational infrastructure (liquidation bots, price keepers, solver bots) needed to safely run a lending market. Presage must build its own, and Yamata should separate from YLOP — a lending protocol without liquidation automation is a protocol waiting for bad debt.

Presage is architecturally superior in fee capture, oracle flexibility, and gas efficiency at the contract level. The path forward is clear: **(1)** build and fund a Safety Bot + Price Keeper (launch blocker), **(2)** close the leverage gap, **(3)** formalize independence, and **(4)** launch on April 7th. The Yamata ecosystem (spot exchange + wallet + lending) is a moat that no standalone lending protocol can replicate.
