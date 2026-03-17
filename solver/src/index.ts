import { ethers, Contract, Wallet, JsonRpcProvider, formatEther, formatUnits, parseUnits } from "ethers";
import { config } from "./config";
import { PRESAGE_ABI, ERC20_ABI, CTF_ABI, MORPHO_ABI, ORACLE_ABI } from "./abis";
import { buyCTF, sellCTF } from "./predict";
import * as store from "./store";

// ──────── Types ────────

interface LeverageOpp {
  type: "leverage";
  borrower: string;
  marketId: bigint;
  marginAmount: bigint;
  supplyCollateralAmount: bigint;
  borrowAmountMax: bigint;
  deadline: bigint;
}

interface DeleverageOpp {
  type: "deleverage";
  borrower: string;
  marketId: bigint;
  repayAmount: bigint;
  withdrawCollateralAmountMax: bigint;
  deadline: bigint;
}

type Opportunity = LeverageOpp | DeleverageOpp;

// ──────── Globals ────────

let provider: JsonRpcProvider;
let wallet: Wallet;
let presage: Contract;

// Cache market info to avoid repeated calls
const marketCache = new Map<
  string,
  {
    loanToken: string;
    collateralToken: string;
    oracle: string;
    ctf: string;
    positionId: bigint;
    originationFeeBps: bigint;
    lltv: bigint;
  }
>();

// Track cancelled/filled requests to avoid wasting gas on doomed transactions.
// Backed by Redis — survives restarts.
// Key format: "leverage:borrower:marketId" or "deleverage:borrower:marketId"

function requestKey(type: "leverage" | "deleverage", borrower: string, marketId: bigint): string {
  return `${type}:${borrower.toLowerCase()}:${marketId}`;
}

// ──────── Helpers ────────

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function getMarketInfo(marketId: bigint) {
  const key = marketId.toString();
  if (marketCache.has(key)) return marketCache.get(key)!;

  const m = await presage.getMarket(marketId);
  const info = {
    loanToken: m.morphoParams.loanToken as string,
    collateralToken: m.morphoParams.collateralToken as string,
    oracle: m.morphoParams.oracle as string,
    ctf: m.ctfPosition.ctf as string,
    positionId: BigInt(m.ctfPosition.positionId),
    originationFeeBps: BigInt(m.originationFeeBps),
    lltv: BigInt(m.morphoParams.lltv),
  };
  marketCache.set(key, info);
  return info;
}

async function getOraclePrice(oracleAddr: string): Promise<bigint> {
  const oracle = new Contract(oracleAddr, ORACLE_ABI, provider);
  return BigInt(await oracle.price());
}

// ──────── Profitability Checks ────────

/**
 * For a leverage fill, the solver:
 *   - Provides (supplyCollateralAmount - marginAmount) CTF tokens
 *   - Receives (borrowAmountMax - originationFee) USDT
 *
 * The solver profits if the USDT received > cost of the CTF provided.
 * Cost of CTF = leveragedAmount * oraclePrice (in USDT terms).
 *
 * Profit = borrowAmountMax * (1 - feeBps/10000) - leveragedAmount * ctfPrice
 */
async function evaluateLeverage(opp: LeverageOpp): Promise<{ profitable: boolean; profit: bigint }> {
  const market = await getMarketInfo(opp.marketId);
  const oraclePrice = await getOraclePrice(market.oracle);

  // Oracle price is scaled to 1e36 for Morpho. Actual price = oraclePrice / 1e36.
  // CTF price in loan token terms: ctfAmount * oraclePrice / 1e36
  const ORACLE_SCALE = 10n ** 36n;

  const leveragedAmount = opp.supplyCollateralAmount - opp.marginAmount;
  const ctfCostUsdt = (leveragedAmount * oraclePrice) / ORACLE_SCALE;

  const BPS = 10000n;
  const fee = (opp.borrowAmountMax * market.originationFeeBps) / BPS;
  const usdtReceived = opp.borrowAmountMax - fee;

  const profit = usdtReceived - ctfCostUsdt;
  return { profitable: profit > config.minProfitUsdt, profit };
}

/**
 * For a deleverage fill, the solver:
 *   - Provides repayAmount USDT
 *   - Receives withdrawCollateralAmountMax CTF tokens
 *
 * Profit = ctfValue - repayAmount
 * ctfValue = withdrawCollateralAmountMax * oraclePrice
 */
async function evaluateDeleverage(opp: DeleverageOpp): Promise<{ profitable: boolean; profit: bigint }> {
  const market = await getMarketInfo(opp.marketId);
  const oraclePrice = await getOraclePrice(market.oracle);
  const ORACLE_SCALE = 10n ** 36n;

  const ctfValueUsdt = (opp.withdrawCollateralAmountMax * oraclePrice) / ORACLE_SCALE;
  const profit = ctfValueUsdt - opp.repayAmount;

  return { profitable: profit > config.minProfitUsdt, profit };
}

// ──────── Balance & Approval Checks ────────

async function ensureCtfApproval(ctfAddr: string) {
  const ctf = new Contract(ctfAddr, CTF_ABI, wallet);
  const approved = await ctf.isApprovedForAll(wallet.address, config.presageAddress);
  if (!approved) {
    log(`  Setting CTF approval for Presage...`);
    const tx = await ctf.setApprovalForAll(config.presageAddress, true);
    await tx.wait();
    log(`  CTF approval set.`);
  }
}

async function ensureUsdtApproval(usdtAddr: string, amount: bigint) {
  const usdt = new Contract(usdtAddr, ERC20_ABI, wallet);
  const allowance = BigInt(await usdt.allowance(wallet.address, config.presageAddress));
  if (allowance < amount) {
    log(`  Approving USDT for Presage...`);
    const tx = await usdt.approve(config.presageAddress, ethers.MaxUint256);
    await tx.wait();
    log(`  USDT approval set.`);
  }
}

async function ensureMorphoAuthorization() {
  const morpho = new Contract(config.morphoAddress, MORPHO_ABI, wallet);
  const authorized = await morpho.isAuthorized(wallet.address, config.presageAddress);
  if (!authorized) {
    log(`Setting Morpho authorization for Presage...`);
    const tx = await morpho.setAuthorization(config.presageAddress, true);
    await tx.wait();
    log(`Morpho authorization set.`);
  }
}

// ──────── Fill Logic ────────

async function fillLeverageRequest(opp: LeverageOpp, profit: bigint = 0n) {
  const key = requestKey("leverage", opp.borrower, opp.marketId);
  if (await store.isDeadRequest(key)) {
    log(`  SKIP: Request already cancelled/filled (cached)`);
    return;
  }

  // Re-read on-chain state to catch cancellations between event and fill
  try {
    const req = await presage.leverageRequests(opp.borrower, opp.marketId);
    if (req.filled || BigInt(req.deadline) === 0n || BigInt(req.deadline) < BigInt(Math.floor(Date.now() / 1000))) {
      log(`  SKIP: Request no longer active on-chain (filled=${req.filled}, deadline=${req.deadline})`);
      await store.addDeadRequest(key);
      return;
    }
  } catch {
    // If the read itself fails, proceed and let the tx revert naturally
  }

  const market = await getMarketInfo(opp.marketId);
  const leveragedAmount = opp.supplyCollateralAmount - opp.marginAmount;

  // Check CTF balance
  const ctf = new Contract(market.ctf, CTF_ABI, provider);
  let balance = BigInt(await ctf.balanceOf(wallet.address, market.positionId));

  if (balance < leveragedAmount) {
    if (config.acquireMode === "jit") {
      // Just-in-time: buy the missing CTF from predict.fun
      const deficit = leveragedAmount - balance;
      log(`  JIT: Need ${formatEther(deficit)} more CTF. Buying from predict.fun...`);

      const { success, costUsdt } = await buyCTF(wallet, market.positionId, deficit);
      if (!success) {
        log(`  SKIP: Failed to acquire CTF from predict.fun`);
        return;
      }

      // Re-check balance after purchase
      balance = BigInt(await ctf.balanceOf(wallet.address, market.positionId));
      if (balance < leveragedAmount) {
        log(`  SKIP: CTF balance still insufficient after JIT buy. Have ${formatEther(balance)}, need ${formatEther(leveragedAmount)}`);
        return;
      }

      log(`  JIT: Acquired CTF for ~${formatEther(costUsdt)} USDT`);
    } else {
      log(`  SKIP: Insufficient CTF. Need ${formatEther(leveragedAmount)}, have ${formatEther(balance)}. Set ACQUIRE_MODE=jit to auto-buy.`);
      return;
    }
  }

  // Check gas price
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || 0n;
  if (gasPrice > config.maxGasPriceGwei * 10n ** 9n) {
    log(`  SKIP: Gas too high (${formatUnits(gasPrice, "gwei")} gwei)`);
    return;
  }

  await ensureCtfApproval(market.ctf);

  log(`  Filling leverage: borrower=${opp.borrower} market=${opp.marketId}`);
  log(`    CTF to provide: ${formatEther(leveragedAmount)}`);
  log(`    USDT to receive: ${formatEther(opp.borrowAmountMax)}`);

  try {
    const tx = await presage.fillLeverage(opp.borrower, opp.marketId);
    const receipt = await tx.wait();
    log(`  FILLED leverage in tx ${receipt.hash}`);
    await store.recordFill("leverage", opp.borrower, opp.marketId, receipt.hash, formatEther(profit));
  } catch (err: any) {
    log(`  FAILED to fill leverage: ${err.reason || err.message}`);
  }
}

async function fillDeleverageRequest(opp: DeleverageOpp, profit: bigint = 0n) {
  const key = requestKey("deleverage", opp.borrower, opp.marketId);
  if (await store.isDeadRequest(key)) {
    log(`  SKIP: Request already cancelled/filled (cached)`);
    return;
  }

  // Re-read on-chain state to catch cancellations between event and fill
  try {
    const req = await presage.deleverageRequests(opp.borrower, opp.marketId);
    if (req.filled || BigInt(req.deadline) === 0n || BigInt(req.deadline) < BigInt(Math.floor(Date.now() / 1000))) {
      log(`  SKIP: Request no longer active on-chain (filled=${req.filled}, deadline=${req.deadline})`);
      await store.addDeadRequest(key);
      return;
    }
  } catch {
    // If the read itself fails, proceed and let the tx revert naturally
  }

  const market = await getMarketInfo(opp.marketId);

  // Check USDT balance
  const usdt = new Contract(market.loanToken, ERC20_ABI, provider);
  const balance = BigInt(await usdt.balanceOf(wallet.address));
  if (balance < opp.repayAmount) {
    log(`  SKIP: Insufficient USDT. Need ${formatEther(opp.repayAmount)}, have ${formatEther(balance)}`);
    return;
  }

  // Check gas price
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || 0n;
  if (gasPrice > config.maxGasPriceGwei * 10n ** 9n) {
    log(`  SKIP: Gas too high (${formatUnits(gasPrice, "gwei")} gwei)`);
    return;
  }

  await ensureUsdtApproval(market.loanToken, opp.repayAmount);

  log(`  Filling deleverage: borrower=${opp.borrower} market=${opp.marketId}`);
  log(`    USDT to provide: ${formatEther(opp.repayAmount)}`);
  log(`    CTF to receive: ${formatEther(opp.withdrawCollateralAmountMax)}`);

  try {
    const tx = await presage.fillDeleverage(opp.borrower, opp.marketId);
    const receipt = await tx.wait();
    log(`  FILLED deleverage in tx ${receipt.hash}`);
    await store.recordFill("deleverage", opp.borrower, opp.marketId, receipt.hash, formatEther(profit));

    // In JIT mode, immediately sell the received CTF back to predict.fun
    if (config.acquireMode === "jit") {
      log(`  JIT: Selling received ${formatEther(opp.withdrawCollateralAmountMax)} CTF on predict.fun...`);
      const { success, proceedsUsdt } = await sellCTF(wallet, market.positionId, opp.withdrawCollateralAmountMax);
      if (success) {
        log(`  JIT: Sold CTF for ~${formatEther(proceedsUsdt)} USDT`);
      } else {
        log(`  JIT: Failed to sell CTF. Holding in inventory.`);
      }
    }
  } catch (err: any) {
    log(`  FAILED to fill deleverage: ${err.reason || err.message}`);
  }
}

// ──────── Event Listener Mode ────────

function startEventListener() {
  log("Starting event listener for leverage/deleverage requests...");

  presage.on("LeverageRequested", async (borrower: string, marketId: bigint, marginAmount: bigint, supplyCollateralAmount: bigint, borrowAmountMax: bigint, deadline: bigint) => {
    if (!config.marketIds.includes(marketId)) return;
    await store.addBorrower(borrower);

    // New request clears any previous dead state (borrower can overwrite)
    await store.removeDeadRequest(requestKey("leverage", borrower, marketId));

    log(`LeverageRequested: borrower=${borrower} market=${marketId} margin=${formatEther(marginAmount)} total=${formatEther(supplyCollateralAmount)} borrow=${formatEther(borrowAmountMax)}`);

    const opp: LeverageOpp = { type: "leverage", borrower, marketId, marginAmount, supplyCollateralAmount, borrowAmountMax, deadline };

    const { profitable, profit } = await evaluateLeverage(opp);
    if (profitable) {
      log(`  PROFITABLE: est. profit = ${formatEther(profit)} USDT`);
      await fillLeverageRequest(opp, profit);
    } else {
      log(`  NOT PROFITABLE: est. profit = ${formatEther(profit)} USDT (min: ${formatEther(config.minProfitUsdt)})`);
    }
  });

  presage.on("DeleverageRequested", async (borrower: string, marketId: bigint, repayAmount: bigint, withdrawCollateralAmountMax: bigint, deadline: bigint) => {
    if (!config.marketIds.includes(marketId)) return;
    await store.addBorrower(borrower);

    // New request clears any previous dead state
    await store.removeDeadRequest(requestKey("deleverage", borrower, marketId));

    log(`DeleverageRequested: borrower=${borrower} market=${marketId} repay=${formatEther(repayAmount)} withdraw=${formatEther(withdrawCollateralAmountMax)}`);

    const opp: DeleverageOpp = { type: "deleverage", borrower, marketId, repayAmount, withdrawCollateralAmountMax, deadline };

    const { profitable, profit } = await evaluateDeleverage(opp);
    if (profitable) {
      log(`  PROFITABLE: est. profit = ${formatEther(profit)} USDT`);
      await fillDeleverageRequest(opp, profit);
    } else {
      log(`  NOT PROFITABLE: est. profit = ${formatEther(profit)} USDT (min: ${formatEther(config.minProfitUsdt)})`);
    }
  });

  presage.on("LeverageCancelled", async (borrower: string, marketId: bigint) => {
    await store.addDeadRequest(requestKey("leverage", borrower, marketId));
    log(`LeverageCancelled: borrower=${borrower} market=${marketId}`);
  });

  presage.on("DeleverageCancelled", async (borrower: string, marketId: bigint) => {
    await store.addDeadRequest(requestKey("deleverage", borrower, marketId));
    log(`DeleverageCancelled: borrower=${borrower} market=${marketId}`);
  });

  presage.on("LeverageFilled", async (borrower: string, marketId: bigint) => {
    await store.addDeadRequest(requestKey("leverage", borrower, marketId));
  });

  presage.on("DeleverageFilled", async (borrower: string, marketId: bigint) => {
    await store.addDeadRequest(requestKey("deleverage", borrower, marketId));
  });
}

// ──────── Polling Mode (fallback for RPCs without WebSocket) ────────

async function pollForRequests() {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const borrowers = await store.getKnownBorrowers();

  for (const marketId of config.marketIds) {
    for (const borrower of borrowers) {
      // Check leverage request
      try {
        const levReq = await presage.leverageRequests(borrower, marketId);
        if (levReq.deadline > now && !levReq.filled && levReq.supplyCollateralAmount > 0n) {
          const opp: LeverageOpp = {
            type: "leverage",
            borrower,
            marketId,
            marginAmount: BigInt(levReq.marginAmount),
            supplyCollateralAmount: BigInt(levReq.supplyCollateralAmount),
            borrowAmountMax: BigInt(levReq.borrowAmountMax),
            deadline: BigInt(levReq.deadline),
          };

          const { profitable, profit } = await evaluateLeverage(opp);
          if (profitable) {
            log(`Poll found profitable leverage: borrower=${borrower} market=${marketId} profit=${formatEther(profit)}`);
            await fillLeverageRequest(opp, profit);
          }
        }
      } catch {
        // Skip — request may not exist
      }

      // Check deleverage request
      try {
        const delReq = await presage.deleverageRequests(borrower, marketId);
        if (delReq.deadline > now && !delReq.filled && delReq.repayAmount > 0n) {
          const opp: DeleverageOpp = {
            type: "deleverage",
            borrower,
            marketId,
            repayAmount: BigInt(delReq.repayAmount),
            withdrawCollateralAmountMax: BigInt(delReq.withdrawCollateralAmountMax),
            deadline: BigInt(delReq.deadline),
          };

          const { profitable, profit } = await evaluateDeleverage(opp);
          if (profitable) {
            log(`Poll found profitable deleverage: borrower=${borrower} market=${marketId} profit=${formatEther(profit)}`);
            await fillDeleverageRequest(opp, profit);
          }
        }
      } catch {
        // Skip
      }
    }
  }
}

async function scanHistoricalEvents() {
  log("Scanning historical events to discover borrowers...");

  try {
    const currentBlock = await provider.getBlockNumber();
    const lastScanned = await store.getLastScannedBlock();

    // Resume from last scanned block, or fall back to last 1000 blocks
    const fromBlock = lastScanned > 0
      ? lastScanned + 1
      : Math.max(0, currentBlock - 1000);

    if (fromBlock > currentBlock) {
      log(`Already scanned up to block ${lastScanned}, current=${currentBlock}. Nothing new.`);
      return;
    }

    log(`Scanning blocks ${fromBlock}..${currentBlock} (${currentBlock - fromBlock} blocks)`);

    const leverageFilter = presage.filters.LeverageRequested();
    const deleverageFilter = presage.filters.DeleverageRequested();

    const [levEvents, delEvents] = await Promise.all([
      presage.queryFilter(leverageFilter, fromBlock),
      presage.queryFilter(deleverageFilter, fromBlock),
    ]);

    const newBorrowers: string[] = [];
    for (const ev of levEvents) {
      newBorrowers.push((ev as any).args[0]);
    }
    for (const ev of delEvents) {
      newBorrowers.push((ev as any).args[0]);
    }

    if (newBorrowers.length > 0) {
      await store.addBorrowers(newBorrowers);
    }
    await store.setLastScannedBlock(currentBlock);

    const totalBorrowers = (await store.getKnownBorrowers()).size;
    log(`Discovered ${newBorrowers.length} borrower entries from events. Total known: ${totalBorrowers}`);
  } catch (err: any) {
    log(`Historical scan failed (non-fatal): ${err.message}`);
    log("Will rely on event listener and future polls to discover borrowers.");
  }
}

// ──────── Main ────────

async function main() {
  log("=== Presage Solver Bot ===");
  log(`Presage: ${config.presageAddress}`);
  log(`Markets: [${config.marketIds.join(", ")}]`);
  log(`Min profit: ${formatEther(config.minProfitUsdt)} USDT`);
  log(`Acquire mode: ${config.acquireMode}${config.acquireMode === "jit" ? ` (slippage: ${config.jitSlippageBps} bps, timeout: ${config.jitFillTimeoutMs / 1000}s)` : ""}`);

  // Connect to Redis (falls back to in-memory if unavailable)
  await store.connect();
  const stats = await store.getStats();
  log(`Store [${stats.persistent ? "redis" : "memory"}]: ${stats.borrowers} borrowers, ${stats.deadRequests} dead requests, ${stats.totalFills} fills, last block ${stats.lastScannedBlock}`);

  // Disable RPC caching to avoid stale nonces on automining chains (Hardhat)
  provider = new JsonRpcProvider(config.rpcUrl, undefined, { cacheTimeout: -1 });
  wallet = new Wallet(config.privateKey, provider);
  presage = new Contract(config.presageAddress, PRESAGE_ABI, wallet);

  log(`Solver address: ${wallet.address}`);

  // Check USDT balance
  const firstMarket = await getMarketInfo(config.marketIds[0]);
  const usdt = new Contract(firstMarket.loanToken, ERC20_ABI, provider);
  const usdtBal = BigInt(await usdt.balanceOf(wallet.address));
  log(`USDT balance: ${formatEther(usdtBal)}`);

  // Ensure Morpho authorization
  await ensureMorphoAuthorization();

  // Start event listener (real-time)
  startEventListener();

  // Scan historical events (resumes from last scanned block)
  await scanHistoricalEvents();

  // Graceful shutdown — disconnect Redis
  const shutdown = async (signal: string) => {
    log(`${signal} received — shutting down...`);
    await store.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Poll loop
  log(`Starting poll loop (interval: ${config.pollIntervalMs / 1000}s)...`);
  while (true) {
    try {
      await pollForRequests();
    } catch (err: any) {
      log(`Poll error: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
