import { ethers, Contract } from "ethers";
import { config } from "./config";

export interface MarketState {
  morphoMarketId: string;
  marketParams: {
    loanToken: string;
    collateralToken: string;
    oracle: string;
    irm: string;
    lltv: bigint;
  };
  totalSupplyAssets: bigint;
  totalBorrowAssets: bigint;
  vaultSupplyAssets: bigint;
  vaultSupplyShares: bigint;
  cap: bigint;
  enabled: boolean;
  hoursToDecayOnset: number;
}

export interface AllocationTarget {
  morphoMarketId: string;
  marketParams: MarketState["marketParams"];
  currentSupply: bigint;
  targetSupply: bigint;
}

const PRECISION = 10n ** 18n;
const MIN_SCORE = PRECISION / 10n; // 0.1 WAD — minimum so idle markets get some allocation

/**
 * Compute target allocations for each enabled market.
 *
 * Strategy:
 * - Markets with cap=0 or near decay onset (< DECAY_PULLBACK_HOURS) → target = 0 (force withdrawal)
 * - Remaining markets: proportional to utilization (BigInt math), capped at market cap
 * - Keep IDLE_BUFFER_PERCENT of vault as idle liquidity
 *
 * All arithmetic uses BigInt with WAD (1e18) scaling to avoid precision loss
 * on large TVL values that exceed Number.MAX_SAFE_INTEGER.
 */
export function computeTargets(
  markets: MarketState[],
  totalVaultAssets: bigint,
): AllocationTarget[] {
  const idleBuffer = (totalVaultAssets * BigInt(config.idleBufferPercent)) / 100n;
  const deployable = totalVaultAssets > idleBuffer ? totalVaultAssets - idleBuffer : 0n;

  // Score each market using BigInt (WAD-scaled)
  const scored: { market: MarketState; scoreScaled: bigint }[] = [];
  let totalScoreScaled = 0n;

  for (const m of markets) {
    if (!m.enabled) continue;

    // Cap=0 or approaching decay: target = 0 (force withdrawal)
    if (m.cap === 0n || m.hoursToDecayOnset < config.decayPullbackHours) {
      scored.push({ market: m, scoreScaled: 0n });
      continue;
    }

    // Utilization-based score using BigInt (WAD scale)
    const utilScaled = m.totalSupplyAssets > 0n
      ? (m.totalBorrowAssets * PRECISION) / m.totalSupplyAssets
      : 0n;

    // Floor at MIN_SCORE so idle markets still get some allocation
    const scoreScaled = utilScaled > MIN_SCORE ? utilScaled : MIN_SCORE;
    totalScoreScaled += scoreScaled;
    scored.push({ market: m, scoreScaled });
  }

  // Compute targets
  const targets: AllocationTarget[] = [];

  for (const { market, scoreScaled } of scored) {
    let target: bigint;
    if (scoreScaled === 0n || totalScoreScaled === 0n) {
      target = 0n;
    } else {
      target = (deployable * scoreScaled) / totalScoreScaled;
      // Cap enforcement
      if (target > market.cap) target = market.cap;
    }

    targets.push({
      morphoMarketId: market.morphoMarketId,
      marketParams: market.marketParams,
      currentSupply: market.vaultSupplyAssets,
      targetSupply: target,
    });
  }

  return targets;
}

/**
 * Build the reallocate() calldata from allocation targets.
 * Withdrawals come first, then supplies. Last supply uses type(uint256).max to sweep.
 */
export function buildReallocatePayload(
  targets: AllocationTarget[],
): { marketParams: any; assets: bigint }[] {
  const withdrawals: { marketParams: any; assets: bigint }[] = [];
  const supplies: { marketParams: any; assets: bigint }[] = [];

  for (const t of targets) {
    if (t.targetSupply < t.currentSupply) {
      // Withdraw: set assets to target (withdraw the difference)
      withdrawals.push({
        marketParams: t.marketParams,
        assets: t.targetSupply,
      });
    } else if (t.targetSupply > t.currentSupply) {
      supplies.push({
        marketParams: t.marketParams,
        assets: t.targetSupply,
      });
    }
    // If equal, skip
  }

  // Last supply gets MaxUint256 to sweep remainder
  if (supplies.length > 0) {
    supplies[supplies.length - 1].assets = ethers.MaxUint256;
  }

  return [...withdrawals, ...supplies];
}

/**
 * Minimum delta (in USDT) before we bother submitting a reallocation tx.
 * Prevents gas waste on tiny adjustments.
 */
export function shouldReallocate(targets: AllocationTarget[]): boolean {
  const THRESHOLD = ethers.parseEther("10"); // 10 USDT minimum change
  let totalDelta = 0n;

  for (const t of targets) {
    const delta = t.targetSupply > t.currentSupply
      ? t.targetSupply - t.currentSupply
      : t.currentSupply - t.targetSupply;
    totalDelta += delta;
  }

  return totalDelta >= THRESHOLD;
}
