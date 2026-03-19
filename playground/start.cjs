#!/usr/bin/env node
/**
 * Presage Playground — Cross-Platform Launcher
 *
 * Usage (from project root):
 *   node playground/start.cjs
 *   npm run playground
 */
const { spawn, execSync } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const PLAYGROUND = __dirname;
const isWin = process.platform === "win32";

// ── Load .env ──────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

if (!process.env.BNB_RPC_URL) {
  console.error("ERROR: BNB_RPC_URL not set. Add it to .env");
  console.error("  Example: BNB_RPC_URL=https://bnb-mainnet.g.alchemy.com/v2/YOUR_KEY");
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────
const children = [];

function killChild(child) {
  try {
    if (!child || child.exitCode !== null) return; // already exited
    if (isWin) {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch { /* already dead */ }
}

function cleanup() {
  console.log("\nShutting down...");
  for (const child of children) {
    killChild(child);
  }
  // Give processes a moment to die, then force exit
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function checkRpc() {
  return new Promise((resolve) => {
    const data = JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 });
    const req = http.request(
      { hostname: "127.0.0.1", port: 8545, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": data.length } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve(body.includes("result")));
      }
    );
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    req.write(data);
    req.end();
  });
}

/** Spawn a child and return a promise that resolves when it exits */
function runAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: opts.stdio || "inherit",
      cwd: opts.cwd || ROOT,
      env: { ...process.env, ...(opts.env || {}) },
      shell: true,
    });
    // Track it but remove when done so cleanup doesn't try to kill a dead process
    children.push(proc);
    proc.on("error", reject);
    proc.on("close", (code) => {
      const idx = children.indexOf(proc);
      if (idx !== -1) children.splice(idx, 1);
      resolve(code);
    });
  });
}

function killPort(port) {
  try {
    if (isWin) {
      const out = execSync(
        `netstat -ano | findstr :${port} | findstr LISTENING`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
      );
      const pids = [...new Set(
        out.trim().split("\n")
          .map((l) => l.trim().split(/\s+/).pop())
          .filter((p) => p && p !== "0")
      )];
      for (const pid of pids) {
        try { execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" }); } catch { /* ok */ }
      }
      if (pids.length) console.log(`  Killed process on port ${port}`);
    } else {
      const out = execSync(`lsof -ti :${port}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
      if (out.trim()) {
        execSync(`kill ${out.trim().split("\n").join(" ")}`, { stdio: "ignore" });
        console.log(`  Killed process on port ${port}`);
      }
    }
  } catch { /* nothing on port */ }
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  console.log("===============================================================");
  console.log("  Presage Playground Launcher");
  console.log("===============================================================\n");

  // 1. Install playground deps if needed
  if (!fs.existsSync(path.join(PLAYGROUND, "node_modules"))) {
    console.log("[1/5] Installing playground dependencies...");
    await runAsync("npm", ["install"], { cwd: PLAYGROUND });
  } else {
    console.log("[1/5] Playground deps already installed.");
  }

  // 2. Kill existing processes on ports
  console.log("[2/5] Checking ports 8545 and 5173...");
  killPort(8545);
  killPort(5173);

  // 3. Start Hardhat fork node (long-running, stays in children[])
  console.log("[3/5] Starting Hardhat fork node on :8545...");
  const hhProc = spawn(
    "npx", ["hardhat", "node", "--hostname", "127.0.0.1", "--port", "8545"],
    { stdio: "ignore", cwd: ROOT, env: { ...process.env, FORK_BNB: "true" }, shell: true }
  );
  children.push(hhProc);
  hhProc.on("error", (err) => {
    console.error("Failed to start Hardhat node:", err.message);
    cleanup();
  });

  // Wait for node to be ready
  process.stdout.write("  Waiting for node");
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    if (await checkRpc()) {
      ready = true;
      console.log(" ready!");
      break;
    }
    process.stdout.write(".");
  }
  if (!ready) {
    console.log(" TIMEOUT. Check BNB_RPC_URL in .env");
    cleanup();
    return;
  }

  // 4. Deploy contracts (async spawn, not spawnSync — avoids Windows libuv crash)
  console.log("[4/5] Deploying contracts & funding accounts...");
  const deployedJsonPath = path.join(PLAYGROUND, "public", "deployed.json");

  // Remove old deployed.json so we can detect fresh success
  try { fs.unlinkSync(deployedJsonPath); } catch { /* ok */ }

  await runAsync("npx", ["hardhat", "run", "scripts/playground-setup.ts", "--network", "localhost"]);

  // Verify deployment succeeded by checking output file
  if (!fs.existsSync(deployedJsonPath)) {
    console.error("Deploy failed — deployed.json not created.");
    cleanup();
    return;
  }
  console.log("  Contracts deployed successfully.");

  // 5. Start Vite dev server (long-running)
  console.log("[5/5] Starting playground UI on :5173...");
  const viteProc = spawn(
    "npx", ["vite", "--host", "127.0.0.1", "--port", "5173"],
    { stdio: "inherit", cwd: PLAYGROUND, env: process.env, shell: true }
  );
  children.push(viteProc);
  viteProc.on("error", (err) => {
    console.error("Failed to start Vite:", err.message);
    cleanup();
  });

  await sleep(2000);
  console.log("");
  console.log("===============================================================");
  console.log("  Presage Playground is running!");
  console.log("");
  console.log("  UI:   http://localhost:5173");
  console.log("  RPC:  http://localhost:8545");
  console.log("");
  console.log("  Press Ctrl+C to stop everything.");
  console.log("===============================================================");

  // Keep alive — wait for either long-running process to exit
  await new Promise((resolve) => {
    hhProc.on("exit", resolve);
    viteProc.on("exit", resolve);
  });

  cleanup();
}

main().catch((err) => {
  console.error(err);
  cleanup();
});
