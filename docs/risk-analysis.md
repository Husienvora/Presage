# Presage Protocol Risk Analysis

Comparison of Presage's risk parameters against industry risk control policies and institutional risk research for prediction market collateral in DeFi lending.

---

## What Presage Does Right

### 1. Temporal LT Decay
Presage implements linear price decay via `PriceHub._decayFactor()`, which risk research cites as **the single most important control** for prediction market collateral. The oracle price decays linearly from 100% to 0% over `decayDuration`, stopping at `decayCooldown` before resolution. This aligns with the industry-standard "Mandatory Temporal LT Decay" requirement.

### 2. Isolated Markets (Morpho Blue)
Each market is a fully isolated lending pair. The institutional research explicitly calls out Morpho Blue's design as ideal for this use case. No cross-contamination between markets.

### 3. FixedPriceAdapter at $1
The conservative approach of pricing all CTF tokens at their maximum payout ($1) means LLTV alone controls the effective haircut. With LLTV 77%, the effective LTV against *true market value* is even lower for tokens trading below $1. This eliminates oracle manipulation for price discovery entirely.

### 4. Merge Liquidation Path
`settleWithMerge()` is genuinely novel and addresses the risk framework concern about liquidation route diversity. It allows atomic YES+NO merge to redeem USDC, providing a liquidation path that doesn't depend on order book depth.

### 5. Staleness Check
`maxStaleness` (default 3600s) enforces oracle liveness. Industry best practice requires 5-minute max stale time for liquidation — Presage is more lenient but configurable.

---

## Critical Gaps & Recommended Improvements

### 1. LLTV of 77% Is Too Aggressive

**Risk policy recommends:** Max LTV of 50% absolute cap, with Tier A markets getting 40-50% and Tier B/C much lower.

**Research paper says:** "Haircuts approaching 50-100% for individual prediction market positions" based on the institutional consensus that every regulated exchange requires full pre-collateralization for binary contracts.

**Presage currently:** 77% LLTV in tests, no hardcoded cap.

**Risk:** With FixedPriceAdapter at $1 and 77% LLTV, a borrower posting 100 tokens at "price" $1 can borrow $77. If the real market price is $0.50, the effective LTV is 154% — already underwater. Even at market price $0.80, effective LTV is 96%.

**Recommendation:**
- Add a `MAX_LLTV` constant capping at ~50% (0.5e18) for prediction market collateral
- Or if using fixed $1 pricing, 50% LLTV means borrowers can borrow $50 against 100 tokens worth up to $100 — a 50% haircut from max payout, which is the recommended cap
- For production with real price feeds (`PullPriceAdapter`), consider tiered LLTVs: 40-50% for liquid markets, 25-35% for thin ones

### 2. No Supply/Borrow Caps per Market

**Risk policy recommends:**
- Per-market collateral value ≤ 10% of total protocol collateral
- Per-category cluster ≤ 25%
- Absolute dollar caps per market

**Research paper:** Extensive discussion of concentration risk; the French Whale's $45M single position moved entire market odds.

**Presage currently:** No per-market caps. Relies entirely on Morpho Blue's native mechanics.

**Recommendation:** Add protocol-level supply caps to `Presage.openMarket()`:
```solidity
uint256 public maxSupplyPerMarket;  // e.g., 500k USDT
uint256 public maxBorrowPerMarket;  // e.g., 200k USDT
```
Enforce in `supply()` and `borrow()`. Without caps, a single large position can dominate protocol risk.

### 3. No "No-New-Borrows" Window

**Risk policy recommends:** No new borrowing when ≤72 hours to exit time.

**Presage currently:** Decay makes borrowing increasingly unattractive as resolution approaches (oracle price decays to 0), but doesn't strictly prevent it. A borrower could still open a new position in the late-decay window if they deposit enough collateral.

**Recommendation:** Add a `borrowingDisabledAt` timestamp per market:
```solidity
function borrow(...) {
    require(block.timestamp < m.resolutionAt - NO_NEW_BORROW_WINDOW, "borrowing closed");
}
```
Set `NO_NEW_BORROW_WINDOW = 72 hours` (or configurable per market). The economic deterrent via decay is not sufficient — explicitly blocking is safer.

### 4. Decay Parameters Are Insufficient

**Risk policy recommends:**
- Decay window: 3-7 days depending on tier
- Exit buffer (cooldown): 24 hours minimum
- Decay starts well before resolution

**Presage test values:** `decayDuration = 86400` (1 day), `decayCooldown = 3600` (1 hour)

**Risk:** A 1-day decay window is extremely aggressive. A borrower could be healthy at decay start and face liquidation within hours, while the market may lack liquidation depth that close to resolution.

**Recommendation:**
- Minimum `decayDuration`: 3 days (259200s) for any market, 5-7 days preferred
- Minimum `decayCooldown`: 24 hours (86400s), not 1 hour
- Consider adding `require(decayDuration >= MIN_DECAY_DURATION)` in `spawnOracle()`

### 5. No Circuit Breakers

**Risk policy recommends:**
- CB1: 20% price gap in 5min -> freeze new borrowing
- CB2: Liquidity cliff -> LTV to 0 for new borrows
- CB3: Oracle liveness failure -> conservative fallback pricing

**Research paper:** $403M in DeFi oracle manipulation losses in 2022. MakerDAO's Black Thursday caused $5.67M bad debt when liquidators couldn't operate.

**Presage currently:** Only staleness check. No circuit breakers for price gaps, no emergency pause.

**Recommendation:** Add an owner/emergency-council callable `pauseMarket(uint256 marketId)` function that:
- Blocks new borrows and new collateral deposits
- Allows repayments and liquidations to continue
- Can be triggered by off-chain monitoring bots via a multisig

### 6. Single Oracle Source

**Risk policy requires:** >=2 independent price sources.

**Research paper:** "No oracle infrastructure exists for prediction market valuation in DeFi lending contexts."

**Presage currently:** Single adapter per position. `FixedPriceAdapter` is safe (hardcoded $1), but `PullPriceAdapter` introduces single-source risk.

**Recommendation:** For production with real price feeds, implement:
- Median of 2+ price sources
- Sanity bounds (e.g., price change ≤ 30% per update)
- TWAP smoothing rather than spot prices
- The FixedPriceAdapter approach is actually the safest model and sidesteps this entirely, but limits capital efficiency

### 7. Liquidation Bonus Assessment

**Risk policy recommends:** Tier A: 3-6%, Tier B: 6-10%, Tier C: 10-15%.

**Presage currently:** Uses Morpho Blue's hardcoded liquidation incentive formula:
```
LIF = min(1.15, 1 / (1 - 0.3 * (1 - LLTV)))
```
- At LLTV=77%: LIF = 1/(1 - 0.3*0.23) = 1.074 = **7.4% bonus**
- At LLTV=50%: LIF = 1/(1 - 0.3*0.5) = 1.176 = **~15% bonus** (capped at 15%)

**Assessment:** The Morpho formula is actually reasonable — lower LLTV -> higher incentive, which aligns with the recommended tiering. At 50% LLTV the ~15% bonus is at the top of the Tier C range, which makes sense for novel collateral. This is adequate.

### 8. Missing: Dispute/Resolution Handling

**Risk policy recommends:** Immediate delist on resolution dispute.

**Research paper:** UMA disputes extend resolution by 3-12 days. Augur disputes can last 60+ days.

**Presage currently:** No mechanism to handle disputed resolution. If a Gnosis CTF condition enters dispute, collateral is trapped and the protocol has no emergency response.

**Recommendation:** Add:
```solidity
function emergencyFreezeMarket(uint256 marketId) external onlyOwner {
    // Set decay to 0 immediately, blocking new borrows
    // Allow liquidations at last known price
}
```

### 9. Missing: Per-Position Risk Assessment

**Risk policy scoring model:** 7-category weighted scoring system evaluating liquidity, oracle robustness, volatility, time-to-event, manipulation risk, correlation, and smart contract risk.

**Presage currently:** All markets treated identically — same LLTV, no tiering.

**Recommendation:** This is primarily an off-chain governance concern. Implement at minimum:
- A tiering system in market onboarding scripts
- Different LLTV values per market type (macro events: 50%, sports: 35%, crypto: 30%)
- Document the criteria for market operators

---

### 10. No Liquidation Bot or Price Keeper

**This is an operational gap, not a code gap — but it is equally critical.**

Presage's contracts define when positions are liquidatable, but no off-chain infrastructure exists to execute liquidations or keep oracle prices fresh.

**Liquidation bot:**
- Standard Morpho Blue MEV searchers will not automatically protect Presage markets. WrappedCTF tokens have no DEX liquidity — a bot that seizes them cannot sell them for an immediate profit on Uniswap or PancakeSwap.
- The "flash-loan → liquidate → sell on predict.fun" loop described in `liquidity-incentive-plan.md` does not work atomically. predict.fun uses an off-chain orderbook, not an on-chain AMM. Seized collateral cannot be sold in the same transaction.
- Presage must operate its own Safety Bot that monitors positions and executes `settleWithLoanToken()` or `settleWithMerge()` with its own capital.

**Price keeper:**
- Presage uses pull oracles — prices must be actively submitted with proofs. If the oracle goes stale (beyond `maxStaleness`, default 1 hour), `PriceHub.morphoPrice()` reverts. This freezes ALL Morpho operations: no borrows, no liquidations, no health checks. Bad debt accumulates silently because nobody can liquidate.
- A price keeper must continuously submit fresh proofs on a schedule.

**Recommendation:** Build and deploy both services before launch. They can be a single off-chain process. The bot wallet needs USDT funding for Path A liquidations and gas for both services. See `docs/pre-launch-build-list.md` for detailed specifications.

---

## Summary Priority Matrix

| Gap | Severity | Effort | Priority |
|-----|----------|--------|----------|
| No liquidation bot or price keeper | **Critical** | Medium | **P0** |
| LLTV too high (77%) | **Critical** | Low | **P0** |
| No supply/borrow caps | **High** | Medium | **P1** |
| No-new-borrows window missing | **High** | Low | **P1** |
| Decay too short (1 day) | **High** | Low (config change) | **P1** |
| No emergency pause/circuit breaker | **High** | Medium | **P1** |
| No dispute resolution handling | **Medium** | Medium | **P2** |
| Single oracle source | **Medium** | High | **P2** |
| No market tiering | **Low** | Off-chain | **P3** |

---

## Bottom Line

Presage's architecture is **sound** — Morpho Blue isolation, temporal decay, merge liquidation, and the FixedPriceAdapter approach are all well-aligned with institutional thinking. The main risk is in **parameterization**: the 77% LLTV and 1-day decay window would not survive the stress scenarios outlined in either document. A token at $0.60 market price with 77% LLTV against $1 fixed oracle price means the position is immediately insolvent with no recourse. The fix is straightforward: lower LLTV to <=50%, extend decay to 3-7 days, add caps, and add an emergency pause mechanism.

---

*Analysis based on: Industry risk control policies for prediction market collateral and Institutional Risk Framework for Prediction Market Collateral in DeFi Lending.*
