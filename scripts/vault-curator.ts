/**
 * Vault Curator CLI — Manual operations for MetaMorpho vault management
 *
 * Usage:
 *   npx ts-node scripts/vault-curator.ts submit-cap --market-id 1 --cap 50000
 *   npx ts-node scripts/vault-curator.ts accept-cap --market-id 1
 *   npx ts-node scripts/vault-curator.ts decrease-cap --market-id 1 --cap 0
 *   npx ts-node scripts/vault-curator.ts status
 *
 * Required env vars:
 *   RPC_URL, PRIVATE_KEY, VAULT_ADDRESS, PRESAGE_ADDRESS, MORPHO_ADDRESS (optional)
 */

import { ethers, Contract, Wallet, JsonRpcProvider, parseEther, formatEther } from "ethers";
import "dotenv/config";

// ──────── ABIs ────────

const VAULT_ABI = [
  "function withdrawQueue(uint256) external view returns (bytes32)",
  "function withdrawQueueLength() external view returns (uint256)",
  "function supplyQueue(uint256) external view returns (bytes32)",
  "function supplyQueueLength() external view returns (uint256)",
  "function config(bytes32 id) external view returns (uint184 cap, bool enabled, uint64 removableAt)",
  "function pendingCap(bytes32 id) external view returns (uint192 value, uint64 validAt)",
  "function totalAssets() external view returns (uint256)",
  "function lastTotalAssets() external view returns (uint256)",
  "function fee() external view returns (uint96)",
  "function feeRecipient() external view returns (address)",
  "function curator() external view returns (address)",
  "function owner() external view returns (address)",
  "function timelock() external view returns (uint256)",
  "function asset() external view returns (address)",
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function totalSupply() external view returns (uint256)",
  "function submitCap(tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 newSupplyCap) external",
  "function acceptCap(tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams) external",
  "function updateWithdrawQueue(uint256[] indexes) external",
];

const MORPHO_ABI = [
  "function market(bytes32 id) external view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function position(bytes32 id, address user) external view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function idToMarketParams(bytes32 id) external view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
];

const PRESAGE_ABI = [
  "function getMarket(uint256 marketId) external view returns (tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) morphoParams, tuple(address ctf, bytes32 parentCollectionId, bytes32 conditionId, uint256 positionId, uint256 oppositePositionId) ctfPosition, uint256 resolutionAt, uint256 originationFeeBps, uint256 liquidationFeeBps)",
];

// ──────── Config ────────

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

const MORPHO_DEFAULT = "0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a";

// ──────── Helpers ────────

function morphoMarketId(mp: any): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "address", "address", "uint256"],
      [mp.loanToken, mp.collateralToken, mp.oracle, mp.irm, mp.lltv]
    )
  );
}

// ──────── Commands ────────

async function cmdStatus(): Promise<void> {
  const provider = new JsonRpcProvider(requireEnv("RPC_URL"));
  const vault = new Contract(requireEnv("VAULT_ADDRESS"), VAULT_ABI, provider);
  const morpho = new Contract(process.env.MORPHO_ADDRESS || MORPHO_DEFAULT, MORPHO_ABI, provider);

  console.log("═══════════════════════════════════════════════");
  console.log(`  Vault: ${await vault.name()} (${await vault.symbol()})`);
  console.log(`  Address: ${await vault.getAddress()}`);
  console.log(`  Asset: ${await vault.asset()}`);
  console.log(`  Owner: ${await vault.owner()}`);
  console.log(`  Curator: ${await vault.curator()}`);
  console.log(`  Timelock: ${await vault.timelock()} seconds`);
  console.log(`  Fee: ${formatEther(await vault.fee())} (${Number(formatEther(await vault.fee())) * 100}%)`);
  console.log(`  Fee Recipient: ${await vault.feeRecipient()}`);
  console.log(`  Total Assets: ${formatEther(await vault.totalAssets())} USDT`);
  console.log(`  Total Supply (shares): ${formatEther(await vault.totalSupply())}`);
  console.log("═══════════════════════════════════════════════");

  const wqLen = Number(await vault.withdrawQueueLength());
  const sqLen = Number(await vault.supplyQueueLength());

  console.log(`\n  Supply Queue (${sqLen} markets):`);
  for (let i = 0; i < sqLen; i++) {
    console.log(`    [${i}] ${await vault.supplyQueue(i)}`);
  }

  console.log(`\n  Withdraw Queue (${wqLen} markets):`);
  const vaultAddr = await vault.getAddress();
  for (let i = 0; i < wqLen; i++) {
    const mid = await vault.withdrawQueue(i);
    const cfg = await vault.config(mid);
    const mkt = await morpho.market(mid);
    const pos = await morpho.position(mid, vaultAddr);

    const vaultSupply = BigInt(mkt.totalSupplyShares) > 0n
      ? (BigInt(pos.supplyShares) * BigInt(mkt.totalSupplyAssets)) / BigInt(mkt.totalSupplyShares)
      : 0n;
    const utilization = BigInt(mkt.totalSupplyAssets) > 0n
      ? (BigInt(mkt.totalBorrowAssets) * 100n) / BigInt(mkt.totalSupplyAssets)
      : 0n;

    console.log(`    [${i}] ${mid}`);
    console.log(`        Cap: ${formatEther(BigInt(cfg.cap))} | Enabled: ${cfg.enabled}`);
    console.log(`        Vault Supply: ${formatEther(vaultSupply)} | Util: ${utilization}%`);
    console.log(`        Total Supply: ${formatEther(BigInt(mkt.totalSupplyAssets))} | Total Borrow: ${formatEther(BigInt(mkt.totalBorrowAssets))}`);

    // Check pending cap
    const pending = await vault.pendingCap(mid);
    if (BigInt(pending.validAt) > 0n) {
      const validAt = new Date(Number(pending.validAt) * 1000);
      console.log(`        PENDING CAP: ${formatEther(BigInt(pending.value))} (valid at ${validAt.toISOString()})`);
    }
  }
}

async function cmdSubmitCap(presageMarketId: bigint, capUsdt: number): Promise<void> {
  const provider = new JsonRpcProvider(requireEnv("RPC_URL"));
  const wallet = new Wallet(requireEnv("PRIVATE_KEY"), provider);
  const vault = new Contract(requireEnv("VAULT_ADDRESS"), VAULT_ABI, wallet);
  const presage = new Contract(requireEnv("PRESAGE_ADDRESS"), PRESAGE_ABI, provider);

  const market = await presage.getMarket(presageMarketId);
  const mp = {
    loanToken: market.morphoParams.loanToken,
    collateralToken: market.morphoParams.collateralToken,
    oracle: market.morphoParams.oracle,
    irm: market.morphoParams.irm,
    lltv: market.morphoParams.lltv,
  };

  const cap = parseEther(capUsdt.toString());
  console.log(`Submitting cap for Presage market ${presageMarketId}:`);
  console.log(`  Morpho market: ${morphoMarketId(mp)}`);
  console.log(`  Cap: ${capUsdt} USDT (${cap})`);

  const tx = await vault.submitCap(mp, cap);
  const receipt = await tx.wait();
  console.log(`  TX: ${receipt.hash}`);
  console.log(`  Cap submitted. Accept after timelock elapses.`);
}

async function cmdAcceptCap(presageMarketId: bigint): Promise<void> {
  const provider = new JsonRpcProvider(requireEnv("RPC_URL"));
  const wallet = new Wallet(requireEnv("PRIVATE_KEY"), provider);
  const vault = new Contract(requireEnv("VAULT_ADDRESS"), VAULT_ABI, wallet);
  const presage = new Contract(requireEnv("PRESAGE_ADDRESS"), PRESAGE_ABI, provider);

  const market = await presage.getMarket(presageMarketId);
  const mp = {
    loanToken: market.morphoParams.loanToken,
    collateralToken: market.morphoParams.collateralToken,
    oracle: market.morphoParams.oracle,
    irm: market.morphoParams.irm,
    lltv: market.morphoParams.lltv,
  };

  console.log(`Accepting cap for Presage market ${presageMarketId}:`);
  console.log(`  Morpho market: ${morphoMarketId(mp)}`);

  const tx = await vault.acceptCap(mp);
  const receipt = await tx.wait();
  console.log(`  TX: ${receipt.hash}`);
  console.log(`  Cap accepted and active.`);
}

async function cmdDecreaseCap(presageMarketId: bigint, capUsdt: number): Promise<void> {
  const provider = new JsonRpcProvider(requireEnv("RPC_URL"));
  const wallet = new Wallet(requireEnv("PRIVATE_KEY"), provider);
  const vault = new Contract(requireEnv("VAULT_ADDRESS"), VAULT_ABI, wallet);
  const presage = new Contract(requireEnv("PRESAGE_ADDRESS"), PRESAGE_ABI, provider);

  const market = await presage.getMarket(presageMarketId);
  const mp = {
    loanToken: market.morphoParams.loanToken,
    collateralToken: market.morphoParams.collateralToken,
    oracle: market.morphoParams.oracle,
    irm: market.morphoParams.irm,
    lltv: market.morphoParams.lltv,
  };

  const cap = parseEther(capUsdt.toString());
  console.log(`Decreasing cap for Presage market ${presageMarketId}:`);
  console.log(`  Morpho market: ${morphoMarketId(mp)}`);
  console.log(`  New cap: ${capUsdt} USDT`);

  // submitCap with lower value executes instantly (no timelock)
  const tx = await vault.submitCap(mp, cap);
  const receipt = await tx.wait();
  console.log(`  TX: ${receipt.hash}`);
  console.log(`  Cap decreased instantly (no timelock for decreases).`);
}

async function cmdRemoveMarket(presageMarketId: bigint): Promise<void> {
  const provider = new JsonRpcProvider(requireEnv("RPC_URL"));
  const wallet = new Wallet(requireEnv("PRIVATE_KEY"), provider);
  const vault = new Contract(requireEnv("VAULT_ADDRESS"), VAULT_ABI, wallet);
  const presage = new Contract(requireEnv("PRESAGE_ADDRESS"), PRESAGE_ABI, provider);
  const morpho = new Contract(process.env.MORPHO_ADDRESS || MORPHO_DEFAULT, MORPHO_ABI, provider);

  const market = await presage.getMarket(presageMarketId);
  const mid = morphoMarketId(market.morphoParams);

  // Check preconditions
  const cfg = await vault.config(mid);
  if (BigInt(cfg.cap) !== 0n) {
    console.error(`  Market cap is ${formatEther(BigInt(cfg.cap))} — must be 0 before removal.`);
    console.error(`  Run: decrease-cap --market-id ${presageMarketId} --cap 0`);
    process.exit(1);
  }

  const vaultAddr = await vault.getAddress();
  const pos = await morpho.position(mid, vaultAddr);
  const mkt = await morpho.market(mid);
  const vaultSupply = BigInt(mkt.totalSupplyShares) > 0n
    ? (BigInt(pos.supplyShares) * BigInt(mkt.totalSupplyAssets)) / BigInt(mkt.totalSupplyShares)
    : 0n;
  if (vaultSupply > 0n) {
    console.error(`  Vault still has ${formatEther(vaultSupply)} USDT in this market — reallocate first.`);
    process.exit(1);
  }

  // Build new withdraw queue without this market
  const wqLen = Number(await vault.withdrawQueueLength());
  const keepIndexes: number[] = [];
  for (let i = 0; i < wqLen; i++) {
    const queueId = await vault.withdrawQueue(i);
    if (queueId !== mid) keepIndexes.push(i);
  }

  if (keepIndexes.length === wqLen) {
    console.error(`  Market ${mid} not found in withdraw queue.`);
    process.exit(1);
  }

  console.log(`Removing Presage market ${presageMarketId} from vault:`);
  console.log(`  Morpho market: ${mid}`);
  console.log(`  Withdraw queue: ${wqLen} → ${keepIndexes.length} markets`);

  const tx = await vault.updateWithdrawQueue(keepIndexes);
  const receipt = await tx.wait();
  console.log(`  TX: ${receipt.hash}`);
  console.log(`  Market removed from withdraw queue.`);
}

// ──────── CLI Parser ────────

function parseArgs(): { command: string; args: Record<string, string> } {
  const rawArgs = process.argv.slice(2);
  const command = rawArgs[0] || "status";
  const args: Record<string, string> = {};

  for (let i = 1; i < rawArgs.length; i++) {
    if (rawArgs[i].startsWith("--")) {
      const key = rawArgs[i].slice(2);
      const val = rawArgs[i + 1] || "";
      args[key] = val;
      i++;
    }
  }

  return { command, args };
}

async function main(): Promise<void> {
  const { command, args } = parseArgs();

  switch (command) {
    case "status":
      await cmdStatus();
      break;

    case "submit-cap": {
      const marketId = BigInt(args["market-id"] || "0");
      const cap = parseFloat(args["cap"] || "0");
      if (marketId === 0n || cap <= 0) {
        console.error("Usage: submit-cap --market-id <id> --cap <usdt_amount>");
        process.exit(1);
      }
      await cmdSubmitCap(marketId, cap);
      break;
    }

    case "accept-cap": {
      const marketId = BigInt(args["market-id"] || "0");
      if (marketId === 0n) {
        console.error("Usage: accept-cap --market-id <id>");
        process.exit(1);
      }
      await cmdAcceptCap(marketId);
      break;
    }

    case "decrease-cap": {
      const marketId = BigInt(args["market-id"] || "0");
      const cap = parseFloat(args["cap"] ?? "-1");
      if (marketId === 0n || cap < 0) {
        console.error("Usage: decrease-cap --market-id <id> --cap <usdt_amount>");
        process.exit(1);
      }
      await cmdDecreaseCap(marketId, cap);
      break;
    }

    case "remove-market": {
      const marketId = BigInt(args["market-id"] || "0");
      if (marketId === 0n) {
        console.error("Usage: remove-market --market-id <id>");
        console.error("  Market must have cap=0 and supply=0 first.");
        process.exit(1);
      }
      await cmdRemoveMarket(marketId);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error("Commands: status, submit-cap, accept-cap, decrease-cap, remove-market");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
