# Strategy: Building the Presage Liquidity Flywheel
**Subject:** Incentivizing Lenders and Borrowers in Low-TVL Prediction Markets

In a market with "weak TVL," we must use targeted incentives to bridge the gap between risk (for lenders) and cost (for borrowers). Below is the dual-incentive framework to bootstrap the Presage ecosystem.

---

## 1. The Lender Incentive (Attracting the "Vaults")
Lenders provide the USDT that makes the protocol function. In a PM context, they are taking "Model Risk" (trusting our oracle/LLTV).

### A. High Yield via "Hyper-Utilization"
In a traditional money market (like Aave or Compound), yield is "diluted" across a massive pool of idle capital. Presage uses **Siloed Markets** to create a "Small Pond" effect where even modest borrowing creates massive "Headline APY."

*   **The Math of Yield:** `Lending APY = Borrow Rate × Utilization Rate`. 
    *   **Big Ocean:** $500M USDT supplied, $50M borrowed (10% utilization). At a 5% borrow rate, lenders earn only **0.5% APY**.
    *   **Small Pond (Presage):** $2M USDT supplied, $1.8M borrowed (90% utilization). At a 15% borrow rate, lenders earn **13.5% APY**.
*   **The "Leverage Multiplier" Premium:** Because prediction market users are buying a "multiplier" (e.g., trying to turn $0.50 into $1.00), their "willingness to pay" interest is significantly higher than traditional traders. A user will gladly pay 1% in interest over a 2-week bet to double their money.
*   **Adaptive Curve IRM:** Presage utilizes Morpho's **Adaptive Curve Interest Rate Model**. If utilization exceeds 90%, the interest rate spikes aggressively. In a "Weak TVL" market, even a few "Power Users" leveraging their positions can push utilization into this "High Yield Zone," creating the high-interest headlines (e.g., **"Earn 18% on USDT"**) that act as a magnet for new lenders.

### B. Risk-Adjusted Safety (The LLTV Guardrail)
Lenders often fear the "All-or-Nothing" nature of prediction markets. Presage mitigates this through a multi-layered safety architecture.

*   **The 23% Equity Buffer:** By setting the LLTV at **77%**, we ensure that borrowers must maintain at least 23% "equity" in their position. For a lender to lose money, the collateral value would have to drop more than 23% *faster* than a liquidator can react.
*   **Time-to-Liquidation (TTL):** Because Presage converts CTF tokens into **Standard ERC20 (WrappedCTF)**, the collateral is compatible with Morpho Blue's liquidation interface. However, prediction market collateral requires purpose-built liquidation infrastructure:
    *   **Why standard MEV searchers won't cover us:** Existing Morpho liquidation bots seize ERC20 tokens and sell them on DEXes (Uniswap, PancakeSwap). WrappedCTF tokens have no DEX liquidity, so standard bots cannot profit and will not add our markets. Additionally, predict.fun uses an off-chain orderbook — seized collateral cannot be sold atomically in the same transaction.
    *   **The Presage Safety Bot (Required for Launch):** Presage must operate a dedicated **Safety Bot** from day one — not as a "backstop," but as the **primary liquidation mechanism** during the bootstrap phase. This bot monitors all positions, keeps oracle prices fresh, and triggers liquidations the moment a Health Factor drops below 1.0. It requires a funded wallet with USDT (for loan-token liquidations) or opposite-outcome CTF tokens (for merge liquidations). See `docs/pre-launch-build-list.md` for specifications.
    *   **The Price Keeper (Required for Launch):** Presage uses pull oracles — if nobody submits a fresh price proof within the staleness window (default: 1 hour), all Morpho operations freeze, including liquidations. A dedicated price keeper must run continuously, submitting proofs on schedule.
    *   **Path to third-party liquidators:** Over time, as WrappedCTF gains familiarity and Presage publishes a liquidation bot SDK, third-party MEV searchers may begin covering Presage markets. But this cannot be assumed at launch.
*   **Binary Risk Management:** In a prediction market, a "NO" outcome eventually goes to zero. Our **PriceHub Oracles** are time-aware; as the event resolution approaches, the Oracle price reflects the real-time probability. If a bet starts "losing," the Health Factor drops, triggering a liquidation that returns the lender's USDT while the collateral still has value (e.g., at $0.40 or $0.30), effectively "stopping the loss" for the lender.
*   **Transparency Dashboard:** We provide a real-time view of all "At-Risk" positions. Lenders can see exactly how much "buffer" exists across the entire pool, building confidence through verifiable on-chain health metrics.

### C. Protocol "Points" or Early Adopter Rewards
*   **The Incentive:** Bootstrap liquidity with a "Liquidity Mining" program (e.g., Presage Points).
*   **Outcome:** Lenders earn a future stake in the protocol for being the "first in," offsetting the perceived risk of new collateral types.

---

## 2. The Borrower Incentive (Attracting the "Traders")
Borrowers are the revenue drivers. They pay the fees that fuel the protocol.

### A. The "Leverage Multiplier" (Profit Maximization)
*   **The Incentive:** The ability to turn a $1,000 "YES" bet into a $3,000 position.
*   **Outcome:** If a user is 90% sure of an outcome, they will gladly pay 10% interest to triple their potential payout. Leverage is the primary "hook" for prediction market users.

### B. Tax & Opportunity Cost Optimization
*   **The Incentive:** Borrowing USDT is not a taxable event (unlike selling the CTF position).
*   **Outcome:** High-net-worth bettors can extract liquidity for real-world expenses or other trades without "breaking" their winning position or triggering capital gains taxes.

### C. Arbitrage Liquidity
*   **The Incentive:** Use borrowed USDT to hedge the same event on a different platform (e.g., Polymarket vs. predict.fun).
*   **Outcome:** Arbitrageurs provide consistent "Base TVL" because they use Presage as a capital-efficiency tool to lock in risk-free profits across exchanges.

---

## 3. The "Weak TVL" Flywheel
In a low-liquidity environment, the goal is to create a tight loop:

1.  **Stage 1:** Small, high-yield USDT vaults attract "Sophisticated Lenders."
2.  **Stage 2:** This liquidity enables "One-Click Leverage" for high-conviction "Power Bettors."
3.  **Stage 3:** High borrower demand keeps Lending APY high ($>$20%).
4.  **Stage 4:** High APY attracts more "Idle USDT" from the broader BNB ecosystem.
5.  **Stage 5:** TVL grows, slippage for borrowers decreases, and the market matures.

## Summary for Stakeholders
We don't need a $1B market to be profitable. By focusing on **High-Conviction Leverage (Borrowers)** and **High-Yield Vaults (Lenders)**, Presage can dominate the "Capital Efficiency" niche of prediction markets, making $40M in idle assets feel like $200M in active economic activity.
