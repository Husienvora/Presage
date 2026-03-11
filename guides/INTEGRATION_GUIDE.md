# Presage Protocol — Integration Guide

Presage enables users to borrow stablecoins (USDT) against prediction market outcome tokens (CTF) via Morpho Blue. This guide covers EOA integration, Multi-sig Safe batching, and Oracle management.

## 1. Core Addresses (BNB Mainnet)

| Contract | Address |
| :--- | :--- |
| **Presage (Router)** | `0x4d2C98FF3349A71FD4756A3E5dBb987779Fbd48f` |
| **SafeBatchHelper** | `0x08Bf83988A1fb79F1278372eAB26cFAC40180713` |
| **PriceHub** | `0xA0b5248b0Cf37B211C34FED77044984F1757835c` |
| **WrapperFactory** | `0x8Aa2713b0657C87A73aca697C3f5cb29e31b1244` |
| **Morpho Blue** | `0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a` |

---

## 2. SDK Integration

The `@presage/sdk` provides a high-level client for protocol interaction.

### Initialization
```typescript
import { PresageClient } from "@presage/sdk";
import { ethers } from "ethers";

const client = new PresageClient({
  presageAddress: "0x4d2C98FF3349A71FD4756A3E5dBb987779Fbd48f",
  factoryAddress: "0x8Aa2713b0657C87A73aca697C3f5cb29e31b1244",
  batchHelperAddress: "0x08Bf83988A1fb79F1278372eAB26cFAC40180713",
  morphoAddress: "0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a",
  provider: new ethers.JsonRpcProvider("..."),
  signer: mySigner
});
```

### EOA Borrowing Flow
1. **Approve CTF**: `await client.approveCTF(ctfAddress)`
2. **Authorize Morpho**: `await client.authorizePresageOnMorpho()` (One-time setup)
3. **Deposit & Borrow**:
```typescript
await client.depositCollateral(marketId, collateralAmount);
await client.borrow(marketId, borrowAmount);
```

### EOA Repayment (with Buffer)
Repaying on mainnet requires a buffer to handle interest accrued between the calculation and the block execution.
```typescript
const fullDebt = await client.getFullDebtWithBuffer(marketId, userAddress);
await client.approveLoanToken(USDT, fullDebt);
await client.repay(marketId, fullDebt); // Presage refunds unused 'dust' automatically
```

---

## 3. Multi-sig Safe Integration (Atomic Batches)

Multi-sigs can perform complex operations in a single click using the `SafeBatchHelper` and the Safe `multiSend` contract.

### Example: One-click Borrow
```typescript
const payload = await client.encodeFullBorrow(
  marketId,
  ctfAddress,
  collateralAmount,
  borrowAmount
);

// Execute via Safe
await mySafe.executeBatch(MULTI_SEND_ADDRESS, payload);
```

---

## 4. Oracle Architecture (TLS & Pull Oracles)

Presage uses a "Pull Oracle" model. The `PriceHub` spawns a `PullPriceAdapter` for each market.

### Update Workflow
1. **Data Acquisition**: Fetch prediction market data (e.g., from predict.fun API) using a TLS-notarized client (like **TLSNotary** or **PADO**).
2. **Proof Generation**: The TLS proof cryptographically binds the API response (e.g., `probability: 0.65`) to the server's identity.
3. **Submission**:
   - The verified probability is submitted to the `PullPriceAdapter`.
   - The adapter updates the Morpho-compatible price feed.
   - Morpho Blue automatically uses the new price for health factor checks.

### Seeding
Before a market is active, the creator must "seed" the initial price:
```typescript
// Seed price at $0.50
await client.priceHub.seedPrice(ctfTokenId, ethers.parseEther("0.5"));
```

---

## 5. Risk Management
*   **LLTV**: Most CTF markets are configured with a 77% LLTV.
*   **Price Decay**: Oracles include a decay mechanism that trends the price toward $0 or $1 as the resolution date approaches, ensuring positions are closed or liquidated before the market expires.
*   **Health Factor**: Monitor `client.getHealthFactor(marketId, user)` regularly.
