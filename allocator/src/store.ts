import Redis from "ioredis";
import { config } from "./config";

const PREFIX = config.redisPrefix;
const STATE_KEY = `${PREFIX}:state`;
const REALLOC_KEY = `${PREFIX}:reallocations`;

let redis: Redis | null = null;

interface AllocationRecord {
  timestamp: number;
  txHash: string;
  markets: { id: string; before: string; after: string }[];
}

const mem = {
  state: {} as Record<string, string>,
  reallocations: [] as AllocationRecord[],
};

export async function connect(): Promise<void> {
  let instance: Redis | null = null;
  try {
    instance = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      retryStrategy: () => null,
    });
    instance.on("error", () => {});
    await instance.connect();
    const info = await instance.info("server");
    const version = info.match(/redis_version:(\S+)/)?.[1] ?? "unknown";
    redis = instance;
    console.log(`[store] Connected to Redis ${version} at ${config.redisUrl}`);
  } catch (err: any) {
    console.log(`[store] Redis unavailable (${err.message}) — using in-memory fallback`);
    if (instance) instance.disconnect(false);
    redis = null;
  }
}

export async function disconnect(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

export async function setState(key: string, value: string): Promise<void> {
  if (!redis) { mem.state[key] = value; return; }
  await redis.hset(STATE_KEY, key, value);
}

export async function getState(key: string): Promise<string | null> {
  if (!redis) return mem.state[key] ?? null;
  return redis.hget(STATE_KEY, key);
}

export async function recordReallocation(
  txHash: string,
  markets: { id: string; before: string; after: string }[],
): Promise<void> {
  const record: AllocationRecord = {
    timestamp: Date.now(),
    txHash,
    markets,
  };
  if (!redis) {
    mem.reallocations.unshift(record);
    if (mem.reallocations.length > 100) mem.reallocations.length = 100;
    return;
  }
  await redis.lpush(REALLOC_KEY, JSON.stringify(record));
  await redis.ltrim(REALLOC_KEY, 0, 99);
}

export async function getStats(): Promise<{
  totalReallocations: number;
  persistent: boolean;
}> {
  if (!redis) {
    return { totalReallocations: mem.reallocations.length, persistent: false };
  }
  const total = await redis.llen(REALLOC_KEY);
  return { totalReallocations: total, persistent: true };
}
