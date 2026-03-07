import { ethers } from "ethers";
import { PresageClient } from "../src";

/**
 * Example: Multi-Sig Safe Workflow
 * 
 * Workflow:
 * 1. Initialize Presage SDK with a Signer (one of the Safe owners).
 * 2. Generate a batch payload for Presage operations.
 * 3. Propose and sign the transaction via Safe (Owner 1).
 * 4. Sign the transaction (Owner 2).
 * 5. Execute.
 * 6. Query position data to verify.
 */

async function main() {
  // --- CONFIGURATION ---
  const RPC_URL = "https://bnb-mainnet.g.alchemy.com/v2/your-api-key";
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // Owners of the 2/2 Safe
  const owner1 = new ethers.Wallet("PRIVATE_KEY_1", provider);
  const owner2 = new ethers.Wallet("PRIVATE_KEY_2", provider);

  const safeAddress = "0xSAFE_ADDRESS_CREATED_OUTSIDE";
  
  const client = new PresageClient({
    presageAddress: "0x...", 
    factoryAddress: "0x...",
    batchHelperAddress: "0x...",
    morphoAddress: "0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a", // BNB Mainnet
    provider,
    signer: owner1 // Initializing with Owner 1
  });

  const marketId = 1;
  const USDT = "0x55d398326f99059fF775485246999027B3197955";

  // 1. GENERATE PAYLOAD
  console.log("Encoding Supply transaction for Safe...");
  const amount = ethers.parseUnits("500", 18);
  const multiSendPayload = await client.encodeFullSupply(marketId, USDT, amount);

  // 2. SAFE INTERACTION (Conceptual using Safe Protocol Kit pattern)
  // In a real app, you'd use @safe-global/protocol-kit
  console.log(`
    Transaction Proposing (Conceptual):
    - To: MultiSend (0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761)
    - Value: 0
    - Data: ${multiSendPayload}
    
    1. Owner 1 (SDK Signer) signs the transaction hash.
    2. Owner 2 signs the transaction hash.
    3. Anyone executes the transaction once both signatures are gathered.
  `);

  // 3. FETCH POSITION DATA
  // This can be done by anyone at any time to check the Safe's status
  console.log(`Fetching positions for Safe: ${safeAddress}...`);
  
  const position = await client.getUserPosition(marketId, safeAddress);

  console.log("--- Safe Position Data ---");
  console.log(`Supply Assets:    ${ethers.formatUnits(position.supplyAssets, 18)} USDT`);
  console.log(`Borrow Assets:    ${ethers.formatUnits(position.borrowAssets, 18)} USDT`);
  console.log(`Collateral:       ${ethers.formatEther(position.collateralAssets)} wCTF`);
  console.log(`Health Factor:    ${ethers.formatEther(position.healthFactor)}`);
  
  if (position.healthFactor < ethers.parseEther("1.1")) {
    console.warn("⚠️ WARNING: Safe is near liquidation threshold!");
  }
}

main().catch(console.error);
