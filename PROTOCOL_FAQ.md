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
  - _Formula:_ `Supplier APR = Borrower APR × Utilization × (1 - Protocol Fee)`.
  - _Example:_ If borrowers pay 10% interest and 50% of the pool is borrowed, suppliers earn 5%.

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

### Q: Is there a risk of "Systemic Failure"?

Because Presage uses **Isolated Markets** on Morpho Blue:

- **No Contagion:** If one prediction market (e.g., "Will it rain tomorrow?") suffers a massive price manipulation or bad debt, it has **zero impact** on any other market (e.g., "Will BTC hit $100k?").
- **Bad Debt Socialization:** If a borrower goes underwater and the collateral isn't enough to cover the debt, the loss is shared proportionally among the lenders in **that specific market only**.

---

## 6. Protocol Governance & Control

### Q: What does the "Owner" of Presage control?

The Presage admin/multisig has limited but important powers:

1.  **Market Creation:** Choosing which prediction tokens to support and setting the initial parameters (LLTV, IRM, Resolution date).
2.  **Price Feeds:** Selecting which "Adapters" (Signed Proofs, Reclaim, etc.) are trusted to provide prices for specific tokens.
3.  **Staleness Settings:** Deciding how "old" a price can be before the protocol stops allowing new borrows (to prevent trading on old news).

### Q: What is Immutable (Cannot be changed)?

1.  **Active Market Parameters:** Once a market is open on Morpho, its IRM and LLTV are fixed.
2.  **Wrapper Logic:** The code that handles the 1:1 swap between ERC1155 and ERC20 cannot be modified.
3.  **User Funds:** The protocol cannot "freeze" or "seize" user funds. Withdrawals and Repayments are handled by the immutable Morpho Blue core logic.

---

## 7. Summary Table for Stakeholders

| Feature           | Borrowers                               | Lenders                                             |
| :---------------- | :-------------------------------------- | :-------------------------------------------------- |
| **Yield/Cost**    | Pay dynamic market rates.               | Earn interest from borrowers.                       |
| **Max Loan**      | Up to the LLTV (e.g., 80% of value).    | Protected by collateral and LLTV.                   |
| **Exit Strategy** | Repay loan + interest to get CTF back.  | Withdraw stablecoins anytime (if liquidity exists). |
| **Safety Net**    | Liquidated early to prevent total loss. | Losses isolated to single markets.                  |
| **Time Factor**   | Borrowing limit shrinks as event nears. | Protected by LLTV Decay as risk increases.          |
