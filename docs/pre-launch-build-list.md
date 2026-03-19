# Presage Pre-Launch Build List
**Target Launch:** April 7, 2026
**Last Updated:** March 17, 2026

---

## Launch Blockers

These must be completed before the protocol can safely accept user funds.

### 1. Safety Bot (Liquidation Keeper)

**Status:** Not started — no code exists
**Effort:** 3-5 days
**Why it's a blocker:** A lending protocol without liquidation automation accumulates bad debt the moment a position goes underwater. There are no existing Morpho liquidation bots that can profitably liquidate prediction market collateral (WrappedCTF has no DEX liquidity, and predict.fun's orderbook is off-chain/non-atomic).

**What it does:**
- Monitors all active markets and borrower positions on every block (or on `PriceUpdated` events)
- Calls `healthFactor(marketId, borrower)` for all borrowers with outstanding debt
- When HF < 1.0, executes liquidation via `settleWithLoanToken()` or `settleWithMerge()`
- Logs all liquidation activity for auditability

**Technical requirements:**
- Off-chain service (Node.js/TypeScript to match existing SDK)
- Ethers v6 (matching project conventions)
- Funded wallet with USDT for Path A liquidations
- Optionally funded with opposite-outcome CTF tokens for Path B (merge) liquidations
- Event listeners: `LoanTaken`, `CollateralDeposited`, `CollateralReleased`, `LoanRepaid`, `PriceUpdated`
- View function polling: `healthFactor(marketId, borrower)` for tracked positions

**Liquidation path decision logic:**
- Path A (`settleWithLoanToken`): Bot has USDT, receives WrappedCTF. Simpler but bot takes on CTF price risk until it can sell.
- Path B (`settleWithMerge`): Bot has opposite-outcome tokens, merges YES+NO → USDT. More profitable, zero price risk, but requires holding opposite tokens.
- Path B is preferred when bot has inventory; Path A is the fallback.

**Profit model:**
- Morpho's Liquidation Incentive Factor (LIF): ~7-15% bonus depending on LLTV
- At LLTV=77%: LIF = 1.074 (7.4% bonus on seized collateral)
- Minus gas costs (~0.001 BNB per tx on BNB Chain)
- Minus liquidation fee (if using router — configurable, currently up to 20%)

---

### 2. Price Keeper (Oracle Freshness)

**Status:** Not started — no code exists
**Effort:** 2-3 days (can be combined with Safety Bot)
**Why it's a blocker:** Presage uses pull oracles. If nobody submits a fresh price proof within `maxStaleness` (default: 1 hour), `PriceHub.morphoPrice()` reverts. This freezes ALL Morpho operations — no borrows, no liquidations, no health checks. Bad debt accumulates silently because nobody can liquidate.

**What it does:**
- Tracks the `updatedAt` timestamp for every active market's price
- When approaching staleness threshold (e.g., at 50 minutes of a 60-minute window), submits a fresh proof
- Two oracle paths available:
  - `SignedProofVerifier`: Authorized relayer signs `(timestamp, positionId, price)` — cheapest, fastest
  - `ReclaimVerifier`: Generates zkTLS proof from prediction market API — trustless, higher overhead

**Recommended approach for launch:**
- Use `SignedProofVerifier` for the keeper (low gas, instant)
- The keeper service IS the authorized relayer — it fetches price from predict.fun API, signs it, submits on-chain
- zkTLS proofs remain available for third-party price submissions (trustless path)

**Infrastructure:**
- Cron job or event-driven loop (check every 5-10 minutes)
- Needs: predict.fun API access, relayer private key, funded wallet for gas
- Can run on same infrastructure as Safety Bot

---

### 3. Bot Wallet Funding

**Status:** Needs allocation decision
**Effort:** 1 day (operational, not engineering)
**Why it's a blocker:** The Safety Bot needs assets to execute liquidations with.

**Minimum funding per market:**
- Path A: Enough USDT to cover the largest single-borrower debt position (suggest 2x the expected max borrow per market)
- Path B: Opposite-outcome CTF tokens matching expected collateral positions
- Gas: ~1 BNB should cover months of operations on BNB Chain

**Capital efficiency note:** The bot recovers its capital on every successful liquidation (receives collateral worth more than the USDT spent, thanks to LIF). The wallet is a revolving fund, not a sunk cost.

---

### 4. MetaMorpho Vault Deployment

**Status:** Not started
**Effort:** 1-2 days
**Why it's a blocker:** Without the vault, every LP must individually manage 50-100+ isolated markets with different APRs and expiration dates. This is the primary LP acquisition bottleneck — the vault provides the "set and forget" experience that passive LPs expect.

**What to deploy:**
- Deploy a `MetaMorpho` vault via `MetaMorphoFactory` with `asset = USDT`, `morpho = Morpho Blue address`
- Set roles: owner (Presage multisig), curator (ops address), guardian (safety multisig)
- Set performance fee (e.g., 10% of generated interest) and fee recipient (treasury)
- Set initial timelock (24 hours minimum)
- Enable an idle market (unborrrowable, for withdrawal liquidity buffer)
- For each active Presage market, curator submits a supply cap; after timelock, allocator can supply

**Deploy order update:**
```
WrapperFactory -> PriceHub -> FixedPriceAdapter -> Presage -> SafeBatchHelper -> MetaMorpho Vault
```

---

### 5. Allocator Bot (Vault Rebalancer)

**Status:** Not started
**Effort:** 2-3 days (can share infrastructure with Safety Bot and Price Keeper)
**Why it's a blocker:** The vault cannot function without an allocator to distribute LP deposits across markets and rotate liquidity as markets expire.

**What it does:**
- On new deposit: USDT flows into markets per `supplyQueue` order automatically (MetaMorpho handles this)
- Periodically: calls `reallocate()` to shift funds from low-utilization or expiring markets to high-demand markets
- On market open: curator submits cap, allocator updates supply queue to include new market
- On market approaching expiry: allocator shifts liquidity out before LLTV decay makes the market unattractive
- Calls `setSupplyQueue()` to prioritize high-yield markets
- Calls `updateWithdrawQueue()` to remove fully exited markets

**Technical requirements:**
- Off-chain service (Node.js/TypeScript)
- Ethers v6, reads vault state + Morpho market utilization
- Funded wallet for gas only (BNB) — moves the vault's own USDT, doesn't need its own
- Can run as a cron job (every 4-6 hours) rather than a continuous daemon — not time-sensitive

**If it stops:** Yield drops, some funds sit idle in expiring markets. No funds are lost. Not safety-critical but directly impacts LP experience and revenue.

---

## High Priority (Before April 7th if possible)

### 6. Solver-Assisted Leverage

**Status:** Not started — Presage has no leverage mechanism
**Effort:** 2-3 days (Solidity) + 1-2 days (solver bot)
**Why it matters:** Leverage looping is the #1 driver of TVL and user acquisition. Without it, Presage is a basic lend/borrow protocol. With it, every $1 of collateral generates $2-3 in protocol TVL and borrowing revenue.

**On-chain (Presage.sol additions):**
- `requestLeverage(marketId, marginAmount, totalCollateral, maxBorrow, deadline)` — borrower posts intent
- `fillLeverage(borrower, marketId)` — solver atomically provides extra collateral, wraps, supplies, borrows
- `requestDeleverage(marketId, repayAmount, maxWithdraw, deadline)` — borrower posts unwind intent
- `fillDeleverage(borrower, marketId)` — solver provides loan tokens, repays, receives collateral
- Storage: `mapping(address => mapping(uint256 => LeverageRequest))` with filled/deadline fields
- Apply origination fees on the leveraged borrow amount

**Off-chain (Solver Bot):**
- Monitors `LeverageRequested` events
- Checks profitability: solver provides CTF tokens, receives USDT — is USDT received > CTF market value?
- If profitable, calls `fillLeverage()`
- Start with Yamata-operated solver, open to third parties later
- Solver needs: CTF token inventory + gas

**Reference implementation:** YLOP's `Ylop.sol` lines 241-330 (~250 lines, request/fill pattern with deadline protection)

---

### 7. Health Dashboard

**Status:** Partially exists in UI testing dashboard
**Effort:** 1-2 days
**Why it matters:** Lenders need to see that the protocol is safe. Real-time health visibility builds confidence.

**Requirements:**
- List all active markets with total supply, total borrow, utilization
- List all borrower positions with health factor, collateral value, debt
- Highlight "at risk" positions (HF < 1.5)
- Show oracle freshness (time since last price update)
- Show decay status (how much LLTV decay has occurred)
- Show vault composition (which markets, allocation %, blended APY)

---

## Post-Launch

### 8. Looping UI
- One-click "3x Leverage" in the frontend
- Creates leverage request, waits for solver fill, shows result
- Estimated effort: 2-3 days

### 9. Liquidation Bot SDK/Template
- Publish open-source bot template so third-party liquidators can run bots
- Reduces reliance on team-operated Safety Bot
- Include documentation for both Path A and Path B strategies
- The merge path (Path B) is attractive to market makers who already hold opposite tokens
- Estimated effort: 2-3 days

### 10. Alerting & Monitoring
- Telegram/Discord alerts when positions approach liquidation
- PagerDuty/OpsGenie integration for oracle staleness and bot health
- Grafana dashboard for protocol health metrics
- Bot liveness monitoring (auto-restart on failure)
- Estimated effort: 2-3 days

### 11. Cross-Asset Collateral
- Borrow against spot ETH/BNB in Yamata wallet to fund prediction market positions
- The real long-term moat — no standalone lending protocol can replicate this
- Requires Yamata wallet integration
- Estimated effort: Significant (weeks)

### 12. Open Solver Network
- Let anyone run a solver bot for leverage fills
- Competition drives better fills for users
- Requires solver discovery mechanism (on-chain registry or off-chain relay)
- Estimated effort: 1-2 weeks

---

## Complete Bot Inventory

All bots can run as a single process with three loops, sharing one server.

| Bot | Purpose | Frequency | Needs Funds? | If It Stops |
|---|---|---|---|---|
| **Price Keeper** | Submit oracle proofs to keep prices fresh | Every ~30 min | Gas only (BNB) | Protocol freezes — no operations possible |
| **Safety Bot** | Liquidate underwater positions | Every ~1 min | USDT + opposite CTF + gas | Bad debt accumulates, lenders lose money |
| **Allocator Bot** | Rebalance vault across markets | Every ~4-6 hours | Gas only (BNB) | Yield drops, funds idle. No funds lost. |
| **Solver Bot** | Fill leverage/deleverage requests | Event-driven | CTF inventory + gas | Leverage unavailable, no funds at risk |

---

## Priority Summary

| # | Item | Effort | Priority | Status |
|---|---|---|---|---|
| 1 | Safety Bot | 3-5 days | **Launch blocker** | Not started |
| 2 | Price Keeper | 2-3 days | **Launch blocker** | Not started |
| 3 | Bot Wallet Funding | 1 day | **Launch blocker** | Needs decision |
| 4 | MetaMorpho Vault | 1-2 days | **Launch blocker** | Not started |
| 5 | Allocator Bot | 2-3 days | **Launch blocker** | Not started |
| 6 | Solver-Assisted Leverage | 3-5 days | High | Not started |
| 7 | Health Dashboard | 1-2 days | High | Partial |
| 8 | Looping UI | 2-3 days | Post-launch | Not started |
| 9 | Liquidation Bot SDK | 2-3 days | Post-launch | Not started |
| 10 | Alerting & Monitoring | 2-3 days | Post-launch | Not started |
| 11 | Cross-Asset Collateral | Weeks | Post-launch | Not started |
| 12 | Open Solver Network | 1-2 weeks | Post-launch | Not started |
