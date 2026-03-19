/**
 * Playground Setup Script
 *
 * Deploys Presage infrastructure to a local Hardhat fork and funds test accounts.
 * Markets are created interactively from the playground UI using real predict.fun data.
 *
 * Usage:
 *   FORK_BNB=true npx hardhat node                          # Terminal 1
 *   npx hardhat run scripts/playground-setup.ts --network localhost  # Terminal 2
 *   cd playground && npm run dev                             # Terminal 3
 */

import { ethers } from "hardhat";
import { parseEther, formatEther } from "ethers";
import * as fs from "fs";
import * as path from "path";

const MORPHO = "0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a";
const IRM = "0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const WHALE = "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3";

async function main() {
  const signers = await ethers.getSigners();
  const [owner, alice, bob, curator, allocator, treasury, liquidator] = signers;

  console.log("═══════════════════════════════════════════════");
  console.log("  Presage Playground Setup");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Owner:       ${await owner.getAddress()}`);
  console.log(`  Alice(LP):   ${await alice.getAddress()}`);
  console.log(`  Bob(Borr):   ${await bob.getAddress()}`);
  console.log(`  Charlie(Liq):${await liquidator.getAddress()}`);

  // ── 1. Deploy Core Contracts ──────────────────────────────────────────
  console.log("\n[1/7] Deploying WrapperFactory...");
  const factory = await (await ethers.getContractFactory("WrapperFactory")).deploy();
  console.log(`  WrapperFactory: ${await factory.getAddress()}`);

  console.log("[2/7] Deploying PriceHub...");
  const priceHub = await (await ethers.getContractFactory("PriceHub")).deploy(3600);
  console.log(`  PriceHub: ${await priceHub.getAddress()}`);

  console.log("[3/7] Deploying FixedPriceAdapter...");
  const adapter = await (await ethers.getContractFactory("FixedPriceAdapter")).deploy();
  await priceHub.setDefaultAdapter(await adapter.getAddress());
  console.log(`  FixedPriceAdapter: ${await adapter.getAddress()}`);

  console.log("[4/7] Deploying Presage...");
  const presage = await (await ethers.getContractFactory("Presage")).deploy(
    MORPHO, await factory.getAddress(), await priceHub.getAddress(), IRM
  );
  console.log(`  Presage: ${await presage.getAddress()}`);

  console.log("[5/7] Deploying SafeBatchHelper...");
  const batchHelper = await (await ethers.getContractFactory("SafeBatchHelper")).deploy(
    await presage.getAddress(), MORPHO
  );
  console.log(`  SafeBatchHelper: ${await batchHelper.getAddress()}`);

  console.log("[6/7] Deploying MockCTF...");
  const mockCTF = await (await ethers.getContractFactory("MockCTF")).deploy();
  console.log(`  MockCTF: ${await mockCTF.getAddress()}`);

  console.log("[7/7] Deploying MetaMorphoFactory...");
  const vaultFactory = await (await ethers.getContractFactory("MetaMorphoFactory")).deploy(MORPHO);
  console.log(`  MetaMorphoFactory: ${await vaultFactory.getAddress()}`);

  // ── 2. Set Treasury ───────────────────────────────────────────────────
  await presage.setTreasury(await treasury.getAddress());
  console.log(`  Treasury set: ${await treasury.getAddress()}`);

  // ── 3. Fund Test Accounts ─────────────────────────────────────────────
  console.log("\nFunding test accounts...");
  await ethers.provider.send("hardhat_impersonateAccount", [WHALE]);
  const whaleSigner = await ethers.getSigner(WHALE);
  const usdt = await ethers.getContractAt("IERC20", USDT);
  await owner.sendTransaction({ to: WHALE, value: parseEther("1") });

  const fundAmount = parseEther("50000");
  for (const signer of [owner, alice, bob, liquidator]) {
    await usdt.connect(whaleSigner).transfer(await signer.getAddress(), fundAmount);
    console.log(`  Funded ${await signer.getAddress()} with ${formatEther(fundAmount)} USDT`);
  }

  // ── 4. Write Addresses ────────────────────────────────────────────────
  const addresses = {
    presage: await presage.getAddress(),
    wrapperFactory: await factory.getAddress(),
    priceHub: await priceHub.getAddress(),
    fixedPriceAdapter: await adapter.getAddress(),
    safeBatchHelper: await batchHelper.getAddress(),
    mockCTF: await mockCTF.getAddress(),
    vaultFactory: await vaultFactory.getAddress(),
    morpho: MORPHO,
    irm: IRM,
    usdt: USDT,
  };

  const outPath = path.join(__dirname, "..", "playground", "public", "deployed.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log(`\nAddresses written to: ${outPath}`);

  console.log("\n═══════════════════════════════════════════════");
  console.log("  Infrastructure ready!");
  console.log("  Open the playground to create markets from");
  console.log("  real predict.fun data.");
  console.log("═══════════════════════════════════════════════");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
