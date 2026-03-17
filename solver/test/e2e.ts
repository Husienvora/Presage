/**
 * End-to-End Solver Test
 *
 * Tests the actual solver bot process against a local Hardhat node.
 * Starts a real Hardhat node (BNB fork), deploys contracts, launches the
 * solver as a child process, submits leverage/deleverage requests as a
 * borrower, and verifies the solver fills them.
 *
 * Usage:
 *   cd solver && npx ts-node test/e2e.ts
 *
 * Prerequisites:
 *   - Parent project compiled (npx hardhat compile)
 *   - BNB_RPC_URL set in parent .env (for forking)
 */

import { spawn, ChildProcess } from "child_process";
import { ethers, JsonRpcProvider, JsonRpcSigner, Contract, parseEther, parseUnits, formatEther } from "ethers";
import path from "path";

// ──────── Config ────────

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const HARDHAT_PORT = 8546;
const RPC_URL = `http://127.0.0.1:${HARDHAT_PORT}`;

const MORPHO = "0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a";
const IRM = "0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const WHALE = "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3";

// ──────── ABIs (minimal) ────────

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
  "function approve(address, uint256) returns (bool)",
];
const CTF_ABI = [
  "function balanceOf(address, uint256) view returns (uint256)",
  "function setApprovalForAll(address, bool)",
  "function mint(address, uint256, uint256)",
];
const MORPHO_ABI = [
  "function setAuthorization(address, bool)",
  "function position(bytes32, address) view returns (uint256, uint128, uint128)",
];
const PRESAGE_ABI = [
  "function openMarket(tuple(address ctf, bytes32 parentCollectionId, bytes32 conditionId, uint256 positionId, uint256 oppositePositionId), address, uint256, uint256, uint256, uint256) returns (uint256)",
  "function supply(uint256, uint256)",
  "function setTreasury(address)",
  "function setMarketFees(uint256, uint256, uint256)",
  "function requestLeverage(uint256, uint256, uint256, uint256, uint256)",
  "function requestDeleverage(uint256, uint256, uint256, uint256)",
  "function leverageRequests(address, uint256) view returns (uint256, uint256, uint256, uint256, bool)",
  "function deleverageRequests(address, uint256) view returns (uint256, uint256, uint256, bool)",
  "function getMarket(uint256) view returns (tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv), tuple(address ctf, bytes32 parentCollectionId, bytes32 conditionId, uint256 positionId, uint256 oppositePositionId), uint256, uint256, uint256)",
  "function healthFactor(uint256, address) view returns (uint256)",
];
const PRICE_HUB_ABI = [
  "function setDefaultAdapter(address)",
  "function seedPrice(uint256, uint256)",
];

// ──────── Helpers ────────

function log(msg: string) {
  console.log(`[e2e] ${msg}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForRpc(url: string, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const p = new JsonRpcProvider(url);
      await p.getBlockNumber();
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`RPC ${url} did not become available within ${timeoutMs}ms`);
}

// ──────── Main ────────

async function main() {
  let hardhatNode: ChildProcess | null = null;
  let solverProc: ChildProcess | null = null;

  try {
    // ════════════════════════════════════════════════════════════════
    // Step 1: Start Hardhat node with BNB fork
    // ════════════════════════════════════════════════════════════════
    log("Starting Hardhat node (BNB fork)...");

    hardhatNode = spawn("npx", ["hardhat", "node", "--port", String(HARDHAT_PORT)], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, FORK_BNB: "true" },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let nodeOutput = "";
    hardhatNode.stdout?.on("data", (d) => { nodeOutput += d.toString(); });
    hardhatNode.stderr?.on("data", (d) => { nodeOutput += d.toString(); });

    await waitForRpc(RPC_URL);
    log("Hardhat node ready.");

    // ════════════════════════════════════════════════════════════════
    // Step 2: Deploy contracts using JsonRpcSigner (handles nonces correctly on fork)
    // ════════════════════════════════════════════════════════════════
    log("Deploying contracts...");

    const provider = new JsonRpcProvider(RPC_URL);

    // Use Hardhat's built-in accounts via JSON-RPC (avoids nonce issues from forked state)
    const accounts = await provider.send("eth_accounts", []);
    const deployer = new JsonRpcSigner(provider, accounts[0]);
    const borrowerSigner = new JsonRpcSigner(provider, accounts[1]);
    const treasurySigner = new JsonRpcSigner(provider, accounts[3]);

    // Use a FRESH random wallet for the solver — avoids nonce issues from
    // Hardhat default accounts that have existing BNB mainnet transactions.
    const solverWallet = ethers.Wallet.createRandom().connect(provider);
    const SOLVER_PRIVATE_KEY = solverWallet.privateKey;

    // Fund the solver wallet with ETH for gas
    await (await deployer.sendTransaction({ to: solverWallet.address, value: parseEther("10") })).wait();
    log(`  Fresh solver wallet: ${solverWallet.address}`);

    // Impersonate the solver address for setup calls — avoids ethers Wallet
    // nonce caching issues on Hardhat automining chains
    await provider.send("hardhat_impersonateAccount", [solverWallet.address]);
    const solverSigner = new JsonRpcSigner(provider, solverWallet.address);

    async function deployContract(name: string, args: any[] = []) {
      const artifactPath = path.join(PROJECT_ROOT, "artifacts", "contracts", `${name}.sol`, `${name}.json`);
      const artifact = require(artifactPath);
      const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
      const contract = await factory.deploy(...args);
      await contract.waitForDeployment();
      return contract;
    }

    async function deployFromArtifact(artifactPath: string, args: any[] = []) {
      const fullPath = path.join(PROJECT_ROOT, "artifacts", artifactPath);
      const artifact = require(fullPath);
      const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
      const contract = await factory.deploy(...args);
      await contract.waitForDeployment();
      return contract;
    }

    const wrapperFactory = await deployContract("WrapperFactory");
    log(`  WrapperFactory: ${await wrapperFactory.getAddress()}`);

    const priceHub = await deployContract("PriceHub", [3600]);
    log(`  PriceHub: ${await priceHub.getAddress()}`);

    const presage = await deployContract("Presage", [
      MORPHO,
      await wrapperFactory.getAddress(),
      await priceHub.getAddress(),
      IRM,
    ]);
    const presageAddr = await presage.getAddress();
    log(`  Presage: ${presageAddr}`);

    const mockCTF = await deployFromArtifact("contracts/test/MockCTF.sol/MockCTF.json");
    log(`  MockCTF: ${await mockCTF.getAddress()}`);

    const fixedAdapter = await deployFromArtifact("contracts/oracle/FixedPriceAdapter.sol/FixedPriceAdapter.json");
    log(`  FixedPriceAdapter: ${await fixedAdapter.getAddress()}`);

    // Configure price hub
    const priceHubContract = new Contract(await priceHub.getAddress(), PRICE_HUB_ABI, deployer);
    await (await priceHubContract.setDefaultAdapter(await fixedAdapter.getAddress())).wait();

    // Create market
    const POSITION_ID = 60n;
    const ctfPos = {
      ctf: await mockCTF.getAddress(),
      parentCollectionId: ethers.ZeroHash,
      conditionId: ethers.ZeroHash,
      positionId: POSITION_ID,
      oppositePositionId: 61n,
    };
    const resolutionAt = Math.floor(Date.now() / 1000) + 86400 * 365;

    const presageDeployer = new Contract(presageAddr, PRESAGE_ABI, deployer);
    await (await presageDeployer.openMarket(ctfPos, USDT, parseEther("0.625"), resolutionAt, 86400 * 7, 86400)).wait();
    await (await presageDeployer.setTreasury(accounts[3])).wait();
    await (await presageDeployer.setMarketFees(1, 200, 1000)).wait();
    await (await priceHubContract.seedPrice(POSITION_ID, parseEther("0.65"))).wait();

    log("  Market created with $0.65 price, 62.5% LLTV, 2% origination fee");

    // Fund accounts with USDT from whale
    await provider.send("hardhat_impersonateAccount", [WHALE]);
    await (await deployer.sendTransaction({ to: WHALE, value: parseEther("1") })).wait();

    const whaleSigner = new JsonRpcSigner(provider, WHALE);
    const usdtWhale = new Contract(USDT, ERC20_ABI, whaleSigner);
    await (await usdtWhale.transfer(accounts[1], parseUnits("5000", 18))).wait();
    await (await usdtWhale.transfer(solverWallet.address, parseUnits("5000", 18))).wait();

    // Solver supplies USDT liquidity
    const presageSolver = new Contract(presageAddr, PRESAGE_ABI, solverSigner);
    const usdtSolver = new Contract(USDT, ERC20_ABI, solverSigner);
    await (await usdtSolver.approve(presageAddr, parseUnits("3000", 18))).wait();
    await (await presageSolver.supply(1, parseUnits("3000", 18))).wait();

    // Morpho authorizations
    const morphoBorrower = new Contract(MORPHO, MORPHO_ABI, borrowerSigner);
    const morphoSolver = new Contract(MORPHO, MORPHO_ABI, solverSigner);
    await (await morphoBorrower.setAuthorization(presageAddr, true)).wait();
    await (await morphoSolver.setAuthorization(presageAddr, true)).wait();

    // Mint CTF tokens
    const mockCTFDeployer = new Contract(await mockCTF.getAddress(), CTF_ABI, deployer);
    await (await mockCTFDeployer.mint(accounts[1], POSITION_ID, parseEther("500"))).wait();
    await (await mockCTFDeployer.mint(solverWallet.address, POSITION_ID, parseEther("2000"))).wait();

    // CTF approvals
    const ctfBorrower = new Contract(await mockCTF.getAddress(), CTF_ABI, borrowerSigner);
    const ctfSolver = new Contract(await mockCTF.getAddress(), CTF_ABI, solverSigner);
    await (await ctfBorrower.setApprovalForAll(presageAddr, true)).wait();
    await (await ctfSolver.setApprovalForAll(presageAddr, true)).wait();

    log("Contracts deployed and configured.");

    // ════════════════════════════════════════════════════════════════
    // Step 3: Start solver bot
    // ════════════════════════════════════════════════════════════════
    log("Starting solver bot...");

    const solverEnv = {
      ...process.env,
      RPC_URL: RPC_URL,
      PRIVATE_KEY: SOLVER_PRIVATE_KEY,
      PRESAGE_ADDRESS: presageAddr,
      MORPHO_ADDRESS: MORPHO,
      MARKET_IDS: "1",
      MIN_PROFIT_USDT: "0.5",
      POLL_INTERVAL_SECONDS: "2",
      MAX_GAS_PRICE_GWEI: "100",
      ACQUIRE_MODE: "inventory",
    };

    solverProc = spawn("npx", ["ts-node", "src/index.ts"], {
      cwd: path.resolve(__dirname, ".."),
      env: solverEnv,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let solverOutput = "";
    solverProc.stdout?.on("data", (d) => {
      const line = d.toString();
      solverOutput += line;
      process.stdout.write(`  [solver] ${line}`);
    });
    solverProc.stderr?.on("data", (d) => {
      solverOutput += d.toString();
    });

    log("Waiting for solver to initialize...");
    const solverReady = await Promise.race([
      new Promise<boolean>((resolve) => {
        const check = setInterval(() => {
          if (solverOutput.includes("Starting poll loop")) {
            clearInterval(check);
            resolve(true);
          }
        }, 500);
      }),
      sleep(60000).then(() => false),
    ]);

    if (!solverReady) {
      log("FAIL: Solver did not start within 60s");
      log("Solver output:\n" + solverOutput);
      process.exit(1);
    }
    log("Solver bot running.");

    // ════════════════════════════════════════════════════════════════
    // Step 4: Borrower submits leverage request
    // ════════════════════════════════════════════════════════════════
    log("Borrower submitting leverage request...");

    const presageBorrower = new Contract(presageAddr, PRESAGE_ABI, borrowerSigner);
    const block = await provider.getBlock("latest");
    const deadline = block!.timestamp + 300;

    // margin=200, total=300, borrow=120 (profitable and feasible at $0.65, 62.5% LLTV)
    await (await presageBorrower.requestLeverage(
      1, parseEther("200"), parseEther("300"), parseUnits("120", 18), deadline
    )).wait();
    log("Leverage request submitted. Waiting for solver to fill...");

    // ════════════════════════════════════════════════════════════════
    // Step 5: Wait for solver to fill
    // ════════════════════════════════════════════════════════════════
    const fillDeadline = Date.now() + 30000;
    let filled = false;

    while (Date.now() < fillDeadline) {
      const req = await presageBorrower.leverageRequests(accounts[1], 1);
      if (req[4] === true) {
        filled = true;
        break;
      }
      await sleep(1000);
    }

    if (filled) {
      log("SUCCESS: Solver filled the leverage request!");
      const hf = await presageBorrower.healthFactor(1, accounts[1]);
      log(`  Health factor: ${formatEther(hf)}`);
    } else {
      log("FAIL: Solver did not fill leverage within 30s");
      log("Solver output:\n" + solverOutput);
      process.exit(1);
    }

    // ════════════════════════════════════════════════════════════════
    // Step 6: Test deleverage
    // ════════════════════════════════════════════════════════════════
    log("Borrower submitting deleverage request...");

    const block2 = await provider.getBlock("latest");
    const deadline2 = block2!.timestamp + 300;

    // repay=30, withdraw=50 (profitable for solver: 50*0.65=32.5 > 30)
    await (await presageBorrower.requestDeleverage(
      1, parseUnits("30", 18), parseEther("50"), deadline2
    )).wait();
    log("Deleverage request submitted. Waiting for solver to fill...");

    const fillDeadline2 = Date.now() + 30000;
    let filled2 = false;

    while (Date.now() < fillDeadline2) {
      const req = await presageBorrower.deleverageRequests(accounts[1], 1);
      if (req[3] === true) {
        filled2 = true;
        break;
      }
      await sleep(1000);
    }

    if (filled2) {
      log("SUCCESS: Solver filled the deleverage request!");
      const hf = await presageBorrower.healthFactor(1, accounts[1]);
      log(`  Health factor after deleverage: ${formatEther(hf)}`);
    } else {
      log("FAIL: Solver did not fill deleverage within 30s");
      log("Solver output:\n" + solverOutput);
      process.exit(1);
    }

    // ════════════════════════════════════════════════════════════════
    // Done
    // ════════════════════════════════════════════════════════════════
    log("");
    log("═══════════════════════════════════════════════");
    log("  ALL E2E TESTS PASSED");
    log("═══════════════════════════════════════════════");
    log("");
    process.exit(0);

  } catch (err: any) {
    log(`ERROR: ${err.message}`);
    console.error(err);
    process.exit(1);
  } finally {
    if (solverProc) solverProc.kill();
    if (hardhatNode) hardhatNode.kill();
  }
}

main();
