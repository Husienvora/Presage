# Prediction Market Configuration Guide

This guide details the process of launching a new lending market on Presage, using a hypothetical **predict.fun** market ("Will ETH exceed $5,000 by Dec 31?") as our example.

---

## 1. Market Identification (The "What")

Presage operates on top of the **Gnosis Conditional Tokens Framework (CTF)**. To create a market, you first need the identifiers from the underlying prediction market (e.g., Polymarket or predict.fun).

### Prerequisites
*   **Condition ID:** The unique hash of the question/event.
*   **Position ID:** The specific outcome token (e.g., the "YES" token) that will serve as collateral.
*   **Parent Collection ID:** Usually `0x0...0` for base-level markets.

**Example (predict.fun ETH market):**
*   **Condition ID:** `0xabc123...`
*   **YES Position ID:** `0x456...` (This is what borrowers will deposit)
*   **NO Position ID:** `0x789...` (Used for "Merge" liquidations)

---

## 2. Oracle Strategy (The "Price")

The Oracle is the most critical part of a prediction market. Presage uses a **registry-stub** architecture via the `PriceHub`.

### The PriceHub Flow
1.  **PriceHub** manages the mapping of `PositionID -> IPriceAdapter`.
2.  **Adapters** verify raw data (zkTLS proofs, signed API responses, or AMM prices).
3.  **MorphoOracleStub** is a lightweight contract that Morpho Blue calls. It asks the `PriceHub`: "What is the price of this Position ID?"

### Configuring for predict.fun
Since `predict.fun` is off-chain/Web2-based, we use the `PullPriceAdapter`:
*   **Adapter Type:** `PullPriceAdapter` (Standard for off-chain attestations).
*   **Verification:** The adapter verifies a cryptographic proof (e.g., a signature from a `predict.fun` authorized relayer) that the current probability of "YES" is 0.65 ($0.65).

### Price Decay Logic
Prediction markets have a known expiration. To prevent "bad debt" when a market resolves to 0, Presage implements **LLTV Decay**:
*   **`resolutionAt`:** The timestamp when the event occurs (e.g., Dec 31).
*   **`decayDuration`:** The window (e.g., 24 hours) before resolution where the collateral's value (LLTV) begins to drop to zero.
*   **`decayCooldown`:** A buffer period immediately before resolution to ensure all positions are settled or liquidated safely.

---

## 3. Protocol Parameters (The "Risk")

When opening the market, you must define the lending constraints:

*   **Loan Token:** Typically `USDT` (0x55d... on BNB).
*   **LLTV (Liquidation Loan-to-Value):** 
    *   *Conservative:* 70% (0.7e18).
    *   *Aggressive:* 90% (0.9e18).
*   **IRM (Interest Rate Model):** Use the `AdaptiveCurveIRM` (`0x7112...`) to allow interest rates to fluctuate based on demand.

---

## 4. Execution: Opening the Market

Use the `Presage.openMarket` function. This single call automates the deployment of the necessary infrastructure.

### Technical Steps (Internal)
1.  **Wrapper Factory:** Deploys a `WrappedCTF` contract for the YES token (making it an ERC-20 compatible with Morpho).
2.  **Oracle Spawning:** `PriceHub` spawns a new `MorphoOracleStub` specifically for this `positionId`.
3.  **Morpho Initialization:** Formally registers the market on the Morpho Blue Singleton.

### SDK Example
```typescript
const marketId = await client.presage.openMarket(
  {
    ctf: "0xCTF_ADDRESS",
    parentCollectionId: ethers.ZeroHash,
    conditionId: "0xabc123...",
    positionId: "0x456...",       // YES Token
    oppositePositionId: "0x789..." // NO Token
  },
  "0xUSDT_ADDRESS",
  ethers.parseEther("0.8"), // 80% LLTV
  1735689600,              // resolutionAt: Dec 31, 2025
  86400,                   // decayDuration: 24 hours
  3600                     // decayCooldown: 1 hour
);
```

---

## 5. Post-Deployment: Price Updates

Once the market is open, the price must be maintained. 

1.  **Fetch Data:** An off-chain bot monitors `predict.fun` for the current probability.
2.  **Generate Proof:** The bot packages the price and a signature into a `proof` byte array.
3.  **Submit:**
    ```typescript
    await client.updateOraclePrice(marketId, proof);
    ```
4.  **Verification:** The `PullPriceAdapter` validates the signature, and `PriceHub` records the price ($0.65). Morpho Blue now sees the collateral is worth 0.65 USDT per token.

---

## 6. Summary Checklist

| Component | Responsibility | Source |
| :--- | :--- | :--- |
| **CTF Data** | Predict.fun / Gnosis | External |
| **Adapter** | PriceHub Admin | Already Deployed (`PullPriceAdapter`) |
| **Market Creation** | Presage Owner | `openMarket()` |
| **Price Feed** | Relayer Bot | SDK `updateOraclePrice()` |
| **Liquidation** | Searchers / Bots | `settleWithMerge()` |

---
*Note: Always verify the `oppositePositionId` (NO token) is correct, as it is used by liquidators to perform risk-free "Merge" liquidations when the borrower is underwater.*
