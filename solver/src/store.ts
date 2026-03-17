import Redis from "ioredis";
import { config } from "./config";

// ──────── Keys ────────

const PREFIX = config.redisPrefix;
const BORROWERS_KEY = `${PREFIX}:borrowers`;
const DEAD_KEY = `${PREFIX}:dead`;
const LAST_BLOCK_KEY = `${PREFIX}:lastScannedBlock`;
const FILLS_KEY = `${PREFIX}:fills`;

// ──────── Connection ────────

let redis: Redis | null = null;

// In-memory fallback when Redis is unavailable
const mem = {
  borrowers: new Set<string>(),
  dead: new Set<string>(),
  lastBlock: 0,
  fills: [] as FillRecord[],
};

export async function connect(): Promise<void> {
  let instance: Redis | null = null;
  try {
    instance = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      retryStrategy: () => null,          // don't auto-reconnect on failure
    });
    instance.on("error", () => {});        // suppress unhandled error events
    await instance.connect();
    const info = await instance.info("server");
    const version = info.match(/redis_version:(\S+)/)?.[1] ?? "unknown";
    redis = instance;
    console.log(`[store] Connected to Redis ${version} at ${config.redisUrl}`);
  } catch (err: any) {
    console.log(`[store] Redis unavailable (${err.message}) — using in-memory fallback`);
    if (instance) instance.disconnect(false);   // kill the socket immediately
    redis = null;
  }
}

export async function disconnect(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

// ──────── Borrowers (Set) ────────

export async function getKnownBorrowers(): Promise<Set<string>> {
  if (!redis) return new Set(mem.borrowers);
  const members = await redis.smembers(BORROWERS_KEY);
  return new Set(members);
}

export async function addBorrower(address: string): Promise<void> {
  const lower = address.toLowerCase();
  if (!redis) { mem.borrowers.add(lower); return; }
  await redis.sadd(BORROWERS_KEY, lower);
}

export async function addBorrowers(addresses: string[]): Promise<void> {
  if (addresses.length === 0) return;
  const lowered = addresses.map((a) => a.toLowerCase());
  if (!redis) { lowered.forEach((a) => mem.borrowers.add(a)); return; }
  await redis.sadd(BORROWERS_KEY, ...lowered);
}

// ──────── Dead Requests (Set) ────────

export async function getDeadRequests(): Promise<Set<string>> {
  if (!redis) return new Set(mem.dead);
  const members = await redis.smembers(DEAD_KEY);
  return new Set(members);
}

export async function addDeadRequest(key: string): Promise<void> {
  if (!redis) { mem.dead.add(key); return; }
  await redis.sadd(DEAD_KEY, key);
}

export async function removeDeadRequest(key: string): Promise<void> {
  if (!redis) { mem.dead.delete(key); return; }
  await redis.srem(DEAD_KEY, key);
}

export async function isDeadRequest(key: string): Promise<boolean> {
  if (!redis) return mem.dead.has(key);
  return (await redis.sismember(DEAD_KEY, key)) === 1;
}

// ──────── Last Scanned Block ────────

export async function getLastScannedBlock(): Promise<number> {
  if (!redis) return mem.lastBlock;
  const val = await redis.get(LAST_BLOCK_KEY);
  return val ? parseInt(val, 10) : 0;
}

export async function setLastScannedBlock(block: number): Promise<void> {
  if (!redis) { mem.lastBlock = block; return; }
  await redis.set(LAST_BLOCK_KEY, block.toString());
}

// ──────── Fill History (List, capped at 1000) ────────

export interface FillRecord {
  type: "leverage" | "deleverage";
  borrower: string;
  marketId: string;
  txHash: string;
  profitEstimate: string;
  timestamp: number;
}

export async function recordFill(
  type: "leverage" | "deleverage",
  borrower: string,
  marketId: bigint,
  txHash: string,
  profitEstimate: string,
): Promise<void> {
  const record: FillRecord = {
    type,
    borrower: borrower.toLowerCase(),
    marketId: marketId.toString(),
    txHash,
    profitEstimate,
    timestamp: Date.now(),
  };
  if (!redis) {
    mem.fills.unshift(record);
    if (mem.fills.length > 1000) mem.fills.length = 1000;
    return;
  }
  await redis.lpush(FILLS_KEY, JSON.stringify(record));
  await redis.ltrim(FILLS_KEY, 0, 999);
}

export async function getFills(count: number = 50): Promise<FillRecord[]> {
  if (!redis) return mem.fills.slice(0, count);
  const raw = await redis.lrange(FILLS_KEY, 0, count - 1);
  return raw.map((r) => JSON.parse(r) as FillRecord);
}

// ──────── Stats ────────

export async function getStats(): Promise<{
  borrowers: number;
  deadRequests: number;
  lastScannedBlock: number;
  totalFills: number;
  persistent: boolean;
}> {
  if (!redis) {
    return {
      borrowers: mem.borrowers.size,
      deadRequests: mem.dead.size,
      lastScannedBlock: mem.lastBlock,
      totalFills: mem.fills.length,
      persistent: false,
    };
  }
  const [borrowers, deadRequests, lastBlock, totalFills] = await Promise.all([
    redis.scard(BORROWERS_KEY),
    redis.scard(DEAD_KEY),
    redis.get(LAST_BLOCK_KEY),
    redis.llen(FILLS_KEY),
  ]);
  return {
    borrowers,
    deadRequests,
    lastScannedBlock: lastBlock ? parseInt(lastBlock, 10) : 0,
    totalFills,
    persistent: true,
  };
}
