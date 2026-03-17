import "dotenv/config";

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  rpcUrl: requireEnv("RPC_URL"),
  privateKey: requireEnv("PRIVATE_KEY"),
  presageAddress: requireEnv("PRESAGE_ADDRESS"),
  morphoAddress: process.env.MORPHO_ADDRESS || "0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a",
  marketIds: (process.env.MARKET_IDS || "1").split(",").map((s) => BigInt(s.trim())),
  minProfitUsdt: BigInt(Math.floor(parseFloat(process.env.MIN_PROFIT_USDT || "1.0") * 1e18)),
  pollIntervalMs: (parseInt(process.env.POLL_INTERVAL_SECONDS || "5", 10)) * 1000,
  maxGasPriceGwei: BigInt(process.env.MAX_GAS_PRICE_GWEI || "10"),

  // predict.fun JIT acquisition
  predictApiUrl: process.env.PREDICT_API_URL || "https://api.predict.fun",
  predictApiKey: process.env.PREDICT_API_KEY || "",
  acquireMode: (process.env.ACQUIRE_MODE || "inventory") as "inventory" | "jit",
  jitSlippageBps: BigInt(process.env.JIT_SLIPPAGE_BPS || "100"),
  jitFillTimeoutMs: (parseInt(process.env.JIT_FILL_TIMEOUT_SECONDS || "30", 10)) * 1000,
};
