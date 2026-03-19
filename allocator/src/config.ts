import "dotenv/config";

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function boundedInt(envKey: string, min: number, max: number, fallback: number): number {
  const raw = process.env[envKey];
  if (!raw) return fallback;
  const val = parseInt(raw, 10);
  if (isNaN(val)) throw new Error(`${envKey} must be a number, got: "${raw}"`);
  if (val < min || val > max) throw new Error(`${envKey} must be between ${min} and ${max}, got: ${val}`);
  return val;
}

export const config = {
  rpcUrl: requireEnv("RPC_URL"),
  privateKey: requireEnv("PRIVATE_KEY"),
  vaultAddress: requireEnv("VAULT_ADDRESS"),
  presageAddress: requireEnv("PRESAGE_ADDRESS"),
  morphoAddress: process.env.MORPHO_ADDRESS || "0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a",
  priceHubAddress: requireEnv("PRICE_HUB_ADDRESS"),
  pollIntervalMs: boundedInt("POLL_INTERVAL_SECONDS", 10, 3600, 300) * 1000,
  idleBufferPercent: boundedInt("IDLE_BUFFER_PERCENT", 0, 50, 5),
  decayPullbackHours: boundedInt("DECAY_PULLBACK_HOURS", 1, 720, 48),

  // Redis persistence
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  redisPrefix: process.env.REDIS_PREFIX || "presage-allocator",
};
