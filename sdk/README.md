# Presage Protocol SDK

TypeScript SDK for interacting with the Presage Protocol on BNB Chain.

## Features

- **Simple API**: Easy-to-use methods for Supply, Borrow, Withdraw, and Repay.
- **Position Tracking**: Fetch comprehensive data (assets, shares, health factor) directly from Morpho Blue for any user or Safe.
- **Safe Wallet Support**:
  - Generate `multiSend` payloads for atomic transactions.
  - Optimized for multi-sig workflows (e.g., 2/2 or 2/3 Safes).
  - Compatible with any signer (one of the Safe owners).
- **Market Discovery**: Fetch market parameters and health factors.
- **Type Safety**: Full TypeScript definitions for all contract interactions.

## Installation

```sh
npm install @presage/sdk
```

## Quick Start

### Initialize the Client

```typescript
import { PresageClient } from "@presage/sdk";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("BNB_RPC_URL");
const signer = new ethers.Wallet("PRIVATE_KEY", provider);

const client = new PresageClient({
  presageAddress: "0x...",
  factoryAddress: "0x...",
  batchHelperAddress: "0x...",
  morphoAddress: "0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a",
  provider,
  signer
});
```

### Position Tracking

You can query the current state of any user or Safe position:

```typescript
const stats = await client.getUserPosition(marketId, "0xSAFE_ADDRESS");

console.log(stats.supplyAssets);   // Amount supplied in USDT
console.log(stats.borrowAssets);   // Amount borrowed in USDT
console.log(stats.healthFactor);   // Current health factor
```

### Safe Batch Transaction

```typescript
// Generate a payload to Deposit + Borrow in one Safe transaction
const payload = await client.encodeFullBorrow(
  marketId,
  CTF_CONTRACT,
  collateralAmount,
  borrowAmount
);
```

## Examples

Check the `examples/` directory for:
- `safe-integration.ts`: Basic Safe batching.
- `multi-sig-safe.ts`: Complete dual-signatory workflow and position tracking.
