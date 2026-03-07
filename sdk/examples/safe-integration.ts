import { ethers } from "ethers";
import { PresageClient } from "../src";

/**
 * Example: Safe Integration
 *
 * This example shows how to use the Presage SDK to generate atomic
 * batch transactions for a Gnosis Safe wallet.
 */

async function main() {
  // 1. Setup Provider/Signer
  const provider = new ethers.JsonRpcProvider(
    "https://bnb-mainnet.g.alchemy.com/v2/your-api-key",
  );

  // Addresses (BNB Mainnet examples)
  const config = {
    presageAddress: "0x...",
    factoryAddress: "0x...",
    batchHelperAddress: "0x...",
    morphoAddress: "0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a", // BNB Mainnet
    provider,
  };

  const client = new PresageClient(config);

  const marketId = 1;
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const CTF_CONTRACT = "0x...";
  const POSITION_ID = "123..."; // The outcome token ID

  // ──────── LENDING FLOW (SUPPLY) ────────

  console.log("Generating Supply Payload...");
  console.log("This will bundle 2 operations into 1 transaction:");
  console.log("  1. USDT.approve(PresageRouter, amount)");
  console.log("  2. PresageRouter.supply(marketId, amount)");

  const supplyAmount = ethers.parseUnits("1000", 18);
  const supplyPayload = await client.encodeFullSupply(
    marketId,
    USDT,
    supplyAmount,
  );

  console.log("Safe MultiSend Payload (Supply):", supplyPayload);
  // Next step: Send `supplyPayload` to your Safe's multiSend contract (0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761)

  // ──────── BORROWING FLOW ────────

  console.log("\nGenerating Borrow Payload...");
  console.log("This will bundle 4 operations into 1 transaction:");
  console.log("  1. CTF.setApprovalForAll(PresageRouter, true)");
  console.log("  2. Morpho.setAuthorization(PresageRouter, true)  <-- Required for Safe borrowing");
  console.log("  3. PresageRouter.depositCollateral(marketId, collateralAmount)");
  console.log("  4. PresageRouter.borrow(marketId, borrowAmount)");

  const collateralAmount = ethers.parseEther("100");
  const borrowAmount = ethers.parseUnits("50", 18);

  const borrowPayload = await client.encodeFullBorrow(
    marketId,
    CTF_CONTRACT,
    collateralAmount,
    borrowAmount
  );

  console.log("Safe MultiSend Payload (Borrow):", borrowPayload);
  // Next step: Execute via Safe MultiSend
}

main().catch(console.error);
