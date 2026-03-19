import { ethers, Contract, Wallet, JsonRpcProvider } from "ethers";
import { config } from "./config";
import { VAULT_ABI, MORPHO_ABI, PRESAGE_ABI, PRICE_HUB_ABI } from "./abis";
import { MarketState, computeTargets, buildReallocatePayload, shouldReallocate } from "./strategy";
import * as store from "./store";

let provider: JsonRpcProvider;
let wallet: Wallet;
let vault: Contract;
let morpho: Contract;
let priceHub: Contract;

async function readMarketStates(): Promise<MarketState[]> {
  const vaultAddr = await vault.getAddress();
  const wqLen = Number(await vault.withdrawQueueLength());
  const states: MarketState[] = [];

  for (let i = 0; i < wqLen; i++) {
    const mid = await vault.withdrawQueue(i);
    const cfg = await vault.config(mid);

    if (!cfg.enabled) continue;

    // Read Morpho market state
    const mkt = await morpho.market(mid);
    const pos = await morpho.position(mid, vaultAddr);
    const params = await morpho.idToMarketParams(mid);

    // Compute vault supply in assets
    const vaultSupplyAssets = BigInt(mkt.totalSupplyShares) > 0n
      ? (BigInt(pos.supplyShares) * BigInt(mkt.totalSupplyAssets)) / BigInt(mkt.totalSupplyShares)
      : 0n;

    // Read resolution config from PriceHub via oracle → positionId
    let hoursToDecayOnset = Infinity;
    try {
      // The oracle is a MorphoOracleStub that has a positionId
      const oracleContract = new Contract(params.oracle, [
        "function positionId() external view returns (uint256)",
      ], provider);
      const positionId = await oracleContract.positionId();
      const phConfig = await priceHub.configs(positionId);
      const resolutionAt = Number(phConfig.resolutionAt);
      const decayDuration = Number(phConfig.decayDuration);
      if (resolutionAt > 0 && decayDuration > 0) {
        const decayOnset = resolutionAt - decayDuration;
        const now = Math.floor(Date.now() / 1000);
        hoursToDecayOnset = (decayOnset - now) / 3600;
      }
    } catch {
      // If oracle doesn't have positionId, treat as non-decaying
    }

    states.push({
      morphoMarketId: mid,
      marketParams: {
        loanToken: params.loanToken,
        collateralToken: params.collateralToken,
        oracle: params.oracle,
        irm: params.irm,
        lltv: BigInt(params.lltv),
      },
      totalSupplyAssets: BigInt(mkt.totalSupplyAssets),
      totalBorrowAssets: BigInt(mkt.totalBorrowAssets),
      vaultSupplyAssets,
      vaultSupplyShares: BigInt(pos.supplyShares),
      cap: BigInt(cfg.cap),
      enabled: cfg.enabled,
      hoursToDecayOnset,
    });
  }

  return states;
}

async function runAllocationCycle(): Promise<void> {
  console.log(`[allocator] Running allocation cycle...`);

  const markets = await readMarketStates();
  const totalAssets = await vault.totalAssets();

  console.log(`[allocator] Vault total assets: ${ethers.formatEther(totalAssets)} USDT`);
  console.log(`[allocator] Enabled markets: ${markets.length}`);

  for (const m of markets) {
    const util = m.totalSupplyAssets > 0n
      ? ((m.totalBorrowAssets * 100n) / m.totalSupplyAssets)
      : 0n;
    console.log(`  Market ${m.morphoMarketId.slice(0, 10)}... supply=${ethers.formatEther(m.vaultSupplyAssets)} util=${util}% decay=${m.hoursToDecayOnset.toFixed(0)}h`);
  }

  const targets = computeTargets(markets, totalAssets);

  if (!shouldReallocate(targets)) {
    console.log(`[allocator] No significant reallocation needed`);
    return;
  }

  const payload = buildReallocatePayload(targets);
  if (payload.length === 0) {
    console.log(`[allocator] No changes in payload`);
    return;
  }

  console.log(`[allocator] Submitting reallocate with ${payload.length} market operations...`);

  try {
    const tx = await vault.reallocate(payload);
    const receipt = await tx.wait();
    console.log(`[allocator] Reallocation tx: ${receipt.hash}`);

    // Record to store
    const records = targets.map((t) => ({
      id: t.morphoMarketId,
      before: t.currentSupply.toString(),
      after: t.targetSupply.toString(),
    }));
    await store.recordReallocation(receipt.hash, records);
  } catch (err: any) {
    console.error(`[allocator] Reallocation failed: ${err.message}`);
  }
}

async function main(): Promise<void> {
  console.log(`[allocator] Starting Presage vault allocator bot`);

  provider = new JsonRpcProvider(config.rpcUrl);
  wallet = new Wallet(config.privateKey, provider);
  vault = new Contract(config.vaultAddress, VAULT_ABI, wallet);
  morpho = new Contract(config.morphoAddress, MORPHO_ABI, provider);
  priceHub = new Contract(config.priceHubAddress, PRICE_HUB_ABI, provider);

  console.log(`[allocator] Wallet: ${wallet.address}`);
  console.log(`[allocator] Vault: ${config.vaultAddress}`);
  console.log(`[allocator] Poll interval: ${config.pollIntervalMs / 1000}s`);

  await store.connect();

  // Run initial cycle
  await runAllocationCycle();

  // Poll loop
  const interval = setInterval(async () => {
    try {
      await runAllocationCycle();
    } catch (err: any) {
      console.error(`[allocator] Cycle error: ${err.message}`);
    }
  }, config.pollIntervalMs);

  // Graceful shutdown
  const shutdown = async () => {
    console.log(`[allocator] Shutting down...`);
    clearInterval(interval);
    await store.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(`[allocator] Fatal error: ${err.message}`);
  process.exit(1);
});
