import { ethers } from "hardhat";
import { formatEther, formatUnits } from "ethers";
import fs from "fs";

/**
 * Estimate deployment cost on BNB mainnet.
 *
 * Run on a fork so gas measurements are accurate against real chain state:
 *
 *   $env:FORK_BNB="true"
 *   $env:BNB_RPC_URL="<your_rpc>"
 *   $env:MORPHO_BLUE="0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a"
 *   $env:IRM="0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979"
 *   npx hardhat run estimate-deploy.ts --network hardhat
 */
async function main() {
  const [deployer] = await ethers.getSigners();

  // Fetch live gas price from the fork
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice!;
  console.log(`\nGas price: ${formatUnits(gasPrice, "gwei")} gwei\n`);

  const rows: { name: string; gas: bigint; cost: bigint }[] = [];

  function record(name: string, gas: bigint) {
    const cost = gas * gasPrice;
    rows.push({ name, gas, cost });
    console.log(
      `  ${name.padEnd(28)} ${gas.toString().padStart(10)} gas  │  ${formatEther(cost)} BNB`
    );
  }

  console.log("─".repeat(70));
  console.log("  Contract                     Gas Used    │  Cost (BNB)");
  console.log("─".repeat(70));

  // 1. WrapperFactory
  const WrapperFactory = await ethers.getContractFactory("WrapperFactory");
  const factoryTx = await WrapperFactory.deploy();
  const factoryReceipt = (await factoryTx.deploymentTransaction()!.wait())!;
  record("WrapperFactory", factoryReceipt.gasUsed);

  // 2. PriceHub
  const PriceHub = await ethers.getContractFactory("PriceHub");
  const priceHubTx = await PriceHub.deploy(3600);
  const priceHubReceipt = (await priceHubTx.deploymentTransaction()!.wait())!;
  record("PriceHub", priceHubReceipt.gasUsed);

  // 3. FixedPriceAdapter
  const FixedPriceAdapter = await ethers.getContractFactory("FixedPriceAdapter");
  const adapterTx = await FixedPriceAdapter.deploy();
  const adapterReceipt = (await adapterTx.deploymentTransaction()!.wait())!;
  record("FixedPriceAdapter", adapterReceipt.gasUsed);

  // 4. setDefaultAdapter (tx, not deployment)
  const setTx = await priceHubTx.setDefaultAdapter(await adapterTx.getAddress());
  const setReceipt = (await setTx.wait())!;
  record("setDefaultAdapter (tx)", setReceipt.gasUsed);

  // 5. Presage
  const morphoAddr = process.env.MORPHO_BLUE;
  const irmAddr = process.env.IRM;

  if (!morphoAddr || !irmAddr) {
    console.log("\n⚠  Set MORPHO_BLUE and IRM env vars for full estimate.");
    console.log("   Showing partial estimate (wrapping layer only).\n");
  } else {
    const Presage = await ethers.getContractFactory("Presage");
    const presageTx = await Presage.deploy(
      morphoAddr,
      await factoryTx.getAddress(),
      await priceHubTx.getAddress(),
      irmAddr
    );
    const presageReceipt = (await presageTx.deploymentTransaction()!.wait())!;
    record("Presage", presageReceipt.gasUsed);

    // 6. SafeBatchHelper
    const SafeBatchHelper = await ethers.getContractFactory("SafeBatchHelper");
    const helperTx = await SafeBatchHelper.deploy(
      await presageTx.getAddress(),
      morphoAddr
    );
    const helperReceipt = (await helperTx.deploymentTransaction()!.wait())!;
    record("SafeBatchHelper", helperReceipt.gasUsed);
  }

  // Summary
  const totalGas = rows.reduce((s, r) => s + r.gas, 0n);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0n);

  console.log("─".repeat(70));
  console.log(
    `  ${"TOTAL".padEnd(28)} ${totalGas.toString().padStart(10)} gas  │  ${formatEther(totalCost)} BNB`
  );
  console.log("─".repeat(70));

  // USD estimate
  const bnbPrices = [300, 400, 500, 600, 700];
  console.log("\n  USD Estimates at various BNB prices:");
  for (const p of bnbPrices) {
    const usd = Number(formatEther(totalCost)) * p;
    console.log(`    BNB = $${p}  →  $${usd.toFixed(2)}`);
  }
  console.log();

  // Save report
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const blockNumber = await ethers.provider.getBlockNumber();

  const lines: string[] = [
    `PRESAGE PROTOCOL — DEPLOYMENT COST ESTIMATE`,
    ``,
    `Date      : ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`,
    `Time      : ${now.toLocaleTimeString("en-US", { hour12: true })}`,
    `Network   : BNB Smart Chain (fork at block ${blockNumber})`,
    `Gas Price : ${formatUnits(gasPrice, "gwei")} gwei`,
    `Solidity  : 0.8.28 (optimizer 200 runs, cancun)`,
    ``,
    `────────────────────────────────────────────────────────────────`,
    `  Contract                       Gas Used       Cost (BNB)`,
    `────────────────────────────────────────────────────────────────`,
  ];

  for (const r of rows) {
    lines.push(
      `  ${r.name.padEnd(30)} ${r.gas.toString().padStart(10)}    ${formatEther(r.cost).padStart(14)} BNB`
    );
  }

  lines.push(`────────────────────────────────────────────────────────────────`);
  lines.push(
    `  ${"TOTAL".padEnd(30)} ${totalGas.toString().padStart(10)}    ${formatEther(totalCost).padStart(14)} BNB`
  );
  lines.push(`────────────────────────────────────────────────────────────────`);
  lines.push(``);
  lines.push(`  USD Cost Estimates`);
  lines.push(`  ──────────────────`);

  for (const p of bnbPrices) {
    const usd = Number(formatEther(totalCost)) * p;
    lines.push(`  BNB = $${String(p).padEnd(5)}  →  $${usd.toFixed(2)}`);
  }

  lines.push(``);
  lines.push(`  Per-Contract Breakdown (% of total gas)`);
  lines.push(`  ────────────────────────────────────────`);

  for (const r of rows) {
    const pct = ((Number(r.gas) / Number(totalGas)) * 100).toFixed(1);
    lines.push(`  ${r.name.padEnd(30)} ${pct.padStart(5)}%`);
  }

  lines.push(``);
  lines.push(`  Notes`);
  lines.push(`  ─────`);
  lines.push(`  - Costs measured via Hardhat fork against live BNB chain state.`);
  lines.push(`  - Gas price reflects the fork's reported gasPrice at time of run.`);
  lines.push(`  - Actual cost may vary slightly due to gas price fluctuations.`);
  lines.push(`  - Does not include post-deploy txs (openMarket, seedPrice, etc).`);
  lines.push(``);

  const report = lines.join("\n");
  const filename = `deploy-estimate-${ts}.txt`;
  fs.writeFileSync(filename, report);
  console.log(`Report saved to ${filename}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
