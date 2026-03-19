# Presage Protocol — Detailed Executive FAQ

This document provides a comprehensive breakdown of the Presage Protocol's architecture, risk management, and market mechanics. It is designed to answer fundamental questions about how the protocol operates for borrowers, lenders, and administrators.

---

## 1. The Core Value Proposition

### Q: What is the primary problem Presage solves?

Prediction market tokens (like those from Polymarket or Omen) are typically **illiquid**. If you buy a "YES" token for $0.70, your capital is "locked" until the event resolves. You cannot use that $0.70 elsewhere in DeFi because the tokens are ERC1155 (multi-token standard) which most protocols don't support. Presage unlocks this value by allowing you to use those tokens as collateral to borrow stablecoins.

### Q: Why would a user borrow instead of just selling their bet?

1.  **Maintaining Exposure:** Selling a token early often means exit at a discount. Borrowing allows you to access cash now while still owning the "upside" if your prediction is correct.
2.  **Tax Efficiency:** In many jurisdictions, selling is a taxable event. Borrowing against an asset is typically not.
3.  **Capital Efficiency:** Users can "leverage" their predictions by borrowing stablecoins to buy even more prediction tokens.

---

## 2. Interest Rate & APR Mechanics (The IRM)

### Q: How is the APR dictated? Do we decide the rates manually?

No. The APR is dictated by the **Adaptive Curve Interest Rate Model (IRM)**. It is a purely mathematical, on-chain mechanism that adjusts rates based on **Market Utilization**.

- **Utilization** = (Total Borrowed) / (Total Supplied).
- The model targets a "Goldilocks" utilization of **90%**.

### Q: How does the "Adaptive" part work?

If utilization stays above 90%, it means there is high demand to borrow and lenders might struggle to withdraw. The curve "shifts up" over time, increasing interest rates to attract more lenders and discourage borrowers. If utilization is low, the curve "shifts down" to make borrowing cheaper.

### Q: What is the difference between Borrower APR and Supplier APR?

- **Borrower APR:** This is the cost paid by the borrower, calculated directly from the IRM curve.
- **Supplier APR:** Suppliers earn the interest paid by borrowers, distributed proportionally across all supplied assets.
  - _Formula:_ `Supplier APR = Borrower APR × Utilization × (1 - Morpho Fee)`.
  - _Example:_ If borrowers pay 10% interest and 50% of the pool is borrowed, suppliers earn 5%.

### Q: How does the protocol generate revenue?

Presage collects **per-market fees** at two points:

1.  **Origination Fee (on Borrow):** When a user borrows, a configurable percentage (in basis points, max 5%) is deducted from the borrowed amount and sent to the protocol treasury. For example, at 50 bps (0.5%), borrowing 1000 USDT means 5 USDT goes to the treasury and 995 USDT goes to the borrower.
2.  **Liquidation Fee:** When a position is liquidated, a configurable percentage (max 20%) of the liquidator's profit is routed to the treasury. This applies to both `settleWithMerge` (fee on USDT profit) and `settleWithLoanToken` (fee on seized collateral, kept as wrapped ERC20).

**Per-market pricing:** Each market has its own fee rates, set from global defaults at creation time. The owner can override fees for individual markets via `setMarketFees()` — allowing higher fees on riskier/shorter-dated markets and lower fees on high-volume markets. Global defaults are changed via `setDefaultOriginationFee()` and `setDefaultLiquidationFee()`, affecting only future markets.

Both fees default to 0. The treasury address must be set before fees can be collected.

### Q: Can the protocol team "rug" users by spiking interest rates?

No. The IRM address for a market is set at creation and is **immutable**. Neither the Presage team nor Morpho can manually spike the interest rate of an active market.

---

## 3. The Wrapping Layer (ERC1155 → ERC20)

### Q: Why do we need a "Wrapper"?

Morpho Blue and most DeFi apps require **ERC20** tokens (one contract per token). Prediction markets use **ERC1155** (one contract for many tokens). The wrapper bridges this gap.

### Q: How does the wrapping process stay secure?

For every prediction token, Presage deploys a unique **WrappedCTF (wCTF)** contract.

- **1:1 Invariant:** The wrapper's only job is to hold 1 ERC1155 token for every 1 ERC20 token it mints. It can never mint more than it holds.
- **Permissionless:** Anyone can wrap or unwrap at any time. The wrapper has no "Admin" or "Owner"—it is a neutral utility.
- **Gas Efficiency:** We use **EIP-1167 Minimal Proxy Clones**, which makes deploying a new wrapper for a new prediction ~95% cheaper than a standard deployment.

---

## 4. Price Discovery & Oracle Logic

### Q: How do we determine the "Price" of a prediction bet?

In Presage, **Price = Probability**. If a "YES" token is trading at $0.65, its price in the protocol is 0.65.

1.  **PriceHub:** This is our central registry. it takes raw data (like signatures or web proofs) and converts them into a Morpho-compatible price.
2.  **Adapters:** We use different modules to get data:
    - **Signed Proofs:** Trusted providers sign a message: "Outcome X is currently 0.72."

### Q: What is "LLTV Decay" and why is it critical?

Prediction markets have a "Resolution Date." As that date nears, the risk of the token suddenly dropping to $0 increases.

- To protect lenders, we use **LLTV (Liquidation Loan-to-Value) Decay**.
- As the deadline approaches, the protocol automatically lowers the amount you can borrow against the collateral.
- This forces a "natural wind-down" of the market before the event happens, ensuring lenders aren't left holding worthless tokens.

---

## 5. Risk & Liquidation Mechanics

### Q: When is a borrower liquidated?

A borrower is liquidated if their debt grows too large relative to their collateral value. This happens if:

1.  The **Probability** of their bet winning drops (collateral value falls).
2.  **Interest Accrual** increases their debt.
3.  **LLTV Decay** lowers their borrowing limit.

### Q: Who actually performs liquidations?

Liquidation functions are **permissionless** — anyone can call them. However, prediction market collateral (WrappedCTF) has no DEX liquidity, so standard Morpho Blue MEV searchers cannot profitably liquidate Presage positions by default.

Presage operates a dedicated **Safety Bot** as the primary liquidation mechanism. This bot:
- Monitors all borrower positions continuously
- Keeps oracle prices fresh by submitting proofs on a schedule (required — if oracle goes stale, all operations freeze)
- Executes liquidations when health factor drops below 1.0
- Uses its own funded wallet (USDT or opposite-outcome CTF tokens)

Two liquidation paths are available:
1. **settleWithLoanToken:** Liquidator pays USDT, receives seized WrappedCTF at a discount (Morpho's Liquidation Incentive Factor: ~7-15% bonus).
2. **settleWithMerge:** Liquidator provides opposite-outcome CTF tokens, atomically merges YES+NO into USDT, repays debt, keeps the profit. More capital-efficient.

### Q: How does the merge liquidation path work in detail?

The merge path uses the Gnosis CTF fundamental rule: **1 YES token + 1 NO token = merge = exactly $1.00 USDT**, always, regardless of market price. This is enforced by the CTF smart contract.

**Example:** Borrower deposits 1000 YES tokens, borrows 400 USDT (at 50% LLTV, oracle price $0.80). YES drops to $0.30, NO rises to $0.70.

| Step | What Happens |
|---|---|
| 1 | Liquidator provides 1000 NO tokens to Presage (cost: 1000 x $0.70 = $700) |
| 2 | Presage flash-unwraps 1000 YES tokens from borrower's collateral |
| 3 | Presage merges 1000 YES + 1000 NO = 1000 USDT (guaranteed by CTF contract) |
| 4 | $255.10 repays borrower's debt (seizedTokens x price / LIF = 1000 x $0.30 / 1.176) |
| 5 | Liquidator receives $744.90 USDT. Cost was $700. **Profit: $44.90 in clean USDT, atomic.** |

Compared to Path A (settleWithLoanToken) where the liquidator pays $255.10 USDT and receives 1000 WrappedCTF they can't easily sell, the merge path settles entirely in USDT in a single transaction with no leftover illiquid tokens.

### Q: Why is the Safety Bot always needed?

In a normal lending protocol (Aave, Compound), liquidation only happens if collateral price crashes — an exceptional event. In Presage, **LLTV decay guarantees that every borrower who holds to expiry without repaying will be liquidated.** This is by design to protect lenders before event resolution.

Three things trigger liquidation:
1. **Price drops** — can happen anytime, without warning
2. **Interest accrual** — debt grows every block, slowly eroding health factor
3. **LLTV decay** — as resolution approaches, borrowing power decays linearly to 0

If the Safety Bot goes down near a market's resolution date, LLTV has decayed significantly, multiple positions may be underwater, and when resolution hits, losing collateral goes to $0 with outstanding debt — that debt is socialized to lenders as bad debt.

### Q: Is there a risk of "Systemic Failure"?

Because Presage uses **Isolated Markets** on Morpho Blue:

- **No Contagion:** If one prediction market (e.g., "Will it rain tomorrow?") suffers a massive price manipulation or bad debt, it has **zero impact** on any other market (e.g., "Will BTC hit $100k?").
- **Bad Debt Socialization:** If a borrower goes underwater and the collateral isn't enough to cover the debt, the loss is shared proportionally among the lenders in **that specific market only**.

---

## 6. Protocol Governance & Control

### Q: What does the "Owner" of Presage control?

The Presage admin/multisig has limited but important powers:

1.  **Market Creation:** Choosing which prediction tokens to support and setting the initial parameters (LLTV, IRM, Resolution date).
2.  **Price Feeds:** Selecting which "Adapters" (Signed Relayer, future zkTLS, etc.) are trusted to provide prices for specific tokens.
3.  **Staleness Settings:** Deciding how "old" a price can be before the protocol stops allowing new borrows (to prevent trading on old news).
4.  **Fee Configuration:** Setting the treasury address, global default fees, and per-market fee overrides. Fee caps are hardcoded (5% origination, 20% liquidation) and cannot be exceeded.

### Q: What is Immutable (Cannot be changed)?

1.  **Active Market Parameters:** Once a market is open on Morpho, its IRM and LLTV are fixed.
2.  **Wrapper Logic:** The code that handles the 1:1 swap between ERC1155 and ERC20 cannot be modified.
3.  **User Funds:** The protocol cannot "freeze" or "seize" user funds. Withdrawals and Repayments are handled by the immutable Morpho Blue core logic.
4.  **Fee Caps:** The maximum origination fee (5%) and liquidation fee (20%) are constants and cannot be changed.

---

## 7. The Presage Vault (MetaMorpho)

### Q: What is the Presage Vault?

A MetaMorpho ERC-4626 vault that aggregates LP deposits and automatically allocates them across all active Presage lending markets. LPs deposit USDT once, receive `pUSDT` share tokens, and earn blended yield — no need to pick individual markets or manage positions.

### Q: Why is a vault needed?

Without it, LPs must individually enter 50-100+ isolated markets with different APRs and expiration dates, and manually rotate liquidity as markets resolve. This is impractical for anyone except bot operators. The vault provides a "set and forget" experience comparable to Aave or Compound.

### Q: Does the vault bypass Presage?

Only on the supply side. The vault calls `MORPHO.supply()` directly — but `Presage.supply()` was always a thin passthrough to Morpho anyway. **Presage remains essential** for everything that makes these markets possible: market creation, ERC1155 wrapping, oracle management, LLTV decay, liquidation paths, leverage, and fee collection on borrows.

### Q: How does Presage earn revenue from the vault?

Two ways:
1. **Performance fee** (new) — up to 50% of interest generated by the vault, set by the vault owner (Presage multisig). This is revenue Presage doesn't capture at all without the vault.
2. **Origination fee** (existing) — borrowers still go through `Presage.borrow()` regardless of where the USDT came from, so origination fees are collected as before.

### Q: Does every LP need a vault?

No. The vault is one option for passive LPs. Advanced users can still supply directly to individual Morpho markets through Presage for higher per-market APR with concentration risk. Borrowers never interact with the vault at all.

### Q: What are the vault risks?

- **Bad debt is shared across all vault depositors** — if any market in the vault suffers bad debt, it reduces the vault's total assets. Market isolation is preserved at Morpho but partially lost at the vault level.
- **Curator risk** — mitigated by mandatory 24h+ timelock on cap increases and guardian veto.
- **Allocator risk** — mitigated by per-market supply caps the allocator cannot exceed.

---

## 8. Summary Table for Stakeholders

| Feature           | Borrowers                                          | Lenders                                             |
| :---------------- | :------------------------------------------------- | :-------------------------------------------------- |
| **Yield/Cost**    | Pay dynamic market rates + origination fee.        | Earn interest from borrowers.                       |
| **Max Loan**      | Up to the LLTV (e.g., 80% of value).               | Protected by collateral and LLTV.                   |
| **Exit Strategy** | Repay loan + interest to get CTF back.             | Withdraw stablecoins anytime (if liquidity exists). |
| **Safety Net**    | Liquidated early to prevent total loss.            | Losses isolated to single markets.                  |
| **Time Factor**   | Borrowing limit shrinks as event nears.            | Protected by LLTV Decay as risk increases.          |
| **Fees**          | Origination fee deducted at borrow (per-market).   | No fees on supply/withdraw.                         |
