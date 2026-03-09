/**
 * Mainnet Integration Test — BNB Mainnet + predict.fun + Dual-Sig Safe
 *
 * End-to-end test of the full Presage protocol on BNB mainnet:
 *
 *   Phase 1: Setup
 *     1.  Deploy all Presage contracts (Factory, PriceHub, Presage, SafeBatchHelper)
 *     2.  Authenticate with predict.fun mainnet API
 *     3.  Set predict.fun exchange approvals
 *     4.  Buy CTF tokens from a live market
 *
 *   Phase 2: EOA Lending & Borrowing
 *     5.  Open a Presage lending market for the acquired CTF token
 *     6.  Seed oracle price
 *     7.  Supply USDT as a lender
 *     8.  Deposit CTF collateral as borrower
 *     9.  Borrow USDT against collateral
 *    10.  Verify health factor and position stats
 *    11.  Repay partial debt
 *    12.  Release partial collateral
 *    13.  Verify final position
 *
 *   Phase 3: Dual-Sig Safe Wallet
 *    14.  Deploy MockSafe (simulates 2/2 multisig)
 *    15.  Fund Safe with CTF tokens
 *    16.  Execute atomic batch: Approve + Authorize + Deposit + Borrow
 *    17.  Execute atomic batch: Approve + Repay + Release
 *    18.  Verify Safe position is clean
 *
 *   Phase 4: Wrapping Integrity
 *    19.  Wrap remaining CTF → ERC20
 *    20.  Transfer wrapped ERC20
 *    21.  Unwrap on recipient side
 *    22.  Verify all invariants hold
 *
 * Required env vars
 * ─────────────────
 *   WALLET_PRIVATE_KEY       Primary deployer / lender / borrower (with BNB for gas + USDT)
 *   WALLET_PRIVATE_KEY_2     Second Safe owner (with BNB for gas)
 *
 * Pre-configured env vars (in .env)
 * ──────────────────────────────────
 *   BNB_RPC_URL              Alchemy archive RPC
 *   PREDICT_API_KEY           predict.fun API key
 *
 * Run
 * ───
 *   npx hardhat test test/Presage.mainnet.test.ts --network bnb
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import {
  formatEther,
  formatUnits,
  parseEther,
  parseUnits,
  Wallet,
  HDNodeWallet,
  Contract,
  MaxUint256,
} from "ethers";
import dotenv from "dotenv";
dotenv.config();

// ── Env ─────────────────────────────────────────────────────────────────────────

const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY ?? "";
const WALLET_PRIVATE_KEY_2 = process.env.WALLET_PRIVATE_KEY_2 ?? "";
const API_KEY = process.env.PREDICT_API_KEY ?? "";
const API_BASE_URL = "https://api.predict.fun/v1";

// ── BNB Mainnet Constants ───────────────────────────────────────────────────────

const MORPHO = "0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a";
const IRM = "0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const MULTI_SEND = "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761";

// predict.fun mainnet CTF contracts
const CTF_STANDARD = "0x22DA1810B194ca018378464a58f6Ac2B10C9d244";
const CTF_YIELD_BEARING = "0x9400F8Ad57e9e0F352345935d6D3175975eb1d9F";

// ── Timing ──────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5_000;
const FILL_TIMEOUT_MS = 180_000;
const BUY_VALUE_WEI = parseEther("2"); // 2 USDT — small test trade

// ── ABI Fragments ───────────────────────────────────────────────────────────────

const ERC1155_ABI = [
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
];

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const MORPHO_ABI = [
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function setAuthorization(address authorized, bool authorizedStatus)",
  "function isAuthorized(address authorizer, address authorized) view returns (bool)",
];

// ── predict.fun API Helpers ─────────────────────────────────────────────────────

interface Book {
  asks: [number, number][];
  bids: [number, number][];
}

interface MarketInfo {
  marketId: number;
  tokenId: string;
  conditionId: string;
  isNegRisk: boolean;
  isYieldBearing: boolean;
  feeRateBps: number;
  book: Book;
  title: string;
}

function buildHeaders(jwt?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) h["x-api-key"] = API_KEY;
  if (jwt) h["Authorization"] = `Bearer ${jwt}`;
  return h;
}

async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}\n${text}`);
  }
  return res.json() as Promise<T>;
}

async function getAuthMessage(): Promise<string> {
  const res = await fetchJson<{ data: { message: string } }>(
    `${API_BASE_URL}/auth/message`,
    { headers: buildHeaders() }
  );
  return res.data.message;
}

async function postAuth(signerAddress: string, message: string, signature: string): Promise<string> {
  const res = await fetchJson<{ data: { token: string } }>(
    `${API_BASE_URL}/auth`,
    {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ signer: signerAddress, message, signature }),
    }
  );
  return res.data.token;
}

async function getActiveMarkets(jwt: string): Promise<any[]> {
  const res = await fetchJson<{ data: any[] }>(
    `${API_BASE_URL}/markets?status=OPEN&first=20`,
    { headers: buildHeaders(jwt) }
  );
  return res.data ?? [];
}

async function getOrderbook(marketId: number | string, jwt: string): Promise<Book> {
  const res = await fetchJson<{ data: Book }>(
    `${API_BASE_URL}/markets/${marketId}/orderbook`,
    { headers: buildHeaders(jwt) }
  );
  return res.data;
}

async function submitOrder(body: object, jwt: string): Promise<{ orderId: string; orderHash: string }> {
  const res = await fetchJson<{ data: { orderId: string; orderHash: string } }>(
    `${API_BASE_URL}/orders`,
    {
      method: "POST",
      headers: buildHeaders(jwt),
      body: JSON.stringify(body, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value
      ),
    }
  );
  return res.data;
}

async function getOrderStatus(orderHash: string, jwt: string): Promise<string> {
  const res = await fetchJson<{ data: { status: string } }>(
    `${API_BASE_URL}/orders/${orderHash}`,
    { headers: buildHeaders(jwt) }
  );
  return res.data.status;
}

async function findMarketWithLiquidity(jwt: string): Promise<MarketInfo> {
  const markets = await getActiveMarkets(jwt);
  for (const m of markets) {
    try {
      const book = await getOrderbook(m.id, jwt);
      if (book.asks && book.asks.length > 0) {
        return {
          marketId: m.id,
          tokenId: m.outcomes[0].onChainId,
          conditionId: m.conditionId ?? "",
          isNegRisk: m.isNegRisk ?? false,
          isYieldBearing: m.isYieldBearing ?? false,
          feeRateBps: m.feeRateBps ?? 0,
          book,
          title: m.title ?? `Market #${m.id}`,
        };
      }
    } catch {
      /* skip inaccessible markets */
    }
  }
  throw new Error("No OPEN mainnet market with ask-side liquidity found.");
}

async function waitForFill(orderHash: string, jwt: string): Promise<"FILLED" | "FAILED"> {
  const deadline = Date.now() + FILL_TIMEOUT_MS;
  console.log(`      Polling order ${orderHash} ...`);
  while (Date.now() < deadline) {
    const status = await getOrderStatus(orderHash, jwt);
    console.log(`      ... status: ${status}`);
    if (status === "FILLED") return "FILLED";
    if (["CANCELLED", "EXPIRED", "INVALIDATED"].includes(status)) return "FAILED";
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return "FAILED";
}

// ── Morpho ID helper ────────────────────────────────────────────────────────────

function computeMorphoId(mp: {
  loanToken: string;
  collateralToken: string;
  oracle: string;
  irm: string;
  lltv: bigint;
}): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address", "address", "uint256"],
    [mp.loanToken, mp.collateralToken, mp.oracle, mp.irm, mp.lltv]
  );
  return ethers.keccak256(encoded);
}

// ── Skip guard ──────────────────────────────────────────────────────────────────

const describeFn = WALLET_PRIVATE_KEY ? describe : describe.skip;

// ── Shared state ────────────────────────────────────────────────────────────────

let signer: Wallet;
let signer2: Wallet | HDNodeWallet;

let jwt: string;

// predict.fun state
let ctfAddress: string;
let acquiredTokenId: string;
let acquiredAmount: bigint;
let isYieldBearing: boolean;
let conditionId: string;

// Presage contracts
let presage: any;
let factory: any;
let priceHub: any;
let batchHelper: any;

// Market state
let presageMarketId: bigint;
let morphoMarketId: string;

// ── Suite ───────────────────────────────────────────────────────────────────────

describeFn("Presage Mainnet Integration (BNB + predict.fun + Dual-Sig Safe)", function () {
  this.timeout(900_000); // 15 min — mainnet can be slow + order fills

  // ══════════════════════════════════════════════════════════════════════════════
  //  PHASE 1: SETUP
  // ══════════════════════════════════════════════════════════════════════════════

  before(async function () {
    const provider = ethers.provider as any;
    signer = new Wallet(WALLET_PRIVATE_KEY, provider);

    if (WALLET_PRIVATE_KEY_2) {
      signer2 = new Wallet(WALLET_PRIVATE_KEY_2, provider);
    } else {
      signer2 = Wallet.createRandom().connect(provider);
    }

    const balance = await provider.getBalance(signer.address);
    const usdt = new Contract(USDT, ERC20_ABI, signer);
    const usdtBalance = await usdt.balanceOf(signer.address);

    console.log("\n══ PRESAGE MAINNET INTEGRATION TEST ══════════════════════════════");
    console.log(`  Network     : BNB Smart Chain (Mainnet)`);
    console.log(`  API         : ${API_BASE_URL}`);
    console.log(`  Signer 1    : ${signer.address}`);
    console.log(`  Signer 2    : ${signer2.address}`);
    console.log(`  BNB Balance : ${formatEther(balance)} BNB`);
    console.log(`  USDT Balance: ${formatEther(usdtBalance)} USDT`);
    console.log("══════════════════════════════════════════════════════════════════\n");

    if (balance < parseEther("0.01")) {
      throw new Error("Signer 1 needs at least 0.01 BNB for gas");
    }
    if (usdtBalance < parseEther("5")) {
      throw new Error("Signer 1 needs at least 5 USDT for test operations");
    }
  });

  // ── Step 1: Deploy Contracts ────────────────────────────────────────────────

  it("Step 1 — Deploy Presage protocol contracts", async function () {
    this.timeout(120_000);

    // 1. WrapperFactory
    const WrapperFactory = await ethers.getContractFactory("WrapperFactory", signer);
    factory = await WrapperFactory.deploy();
    await factory.waitForDeployment();
    const factoryAddr = await factory.getAddress();
    console.log(`    WrapperFactory : ${factoryAddr}`);

    // 2. PriceHub
    const PriceHub = await ethers.getContractFactory("PriceHub", signer);
    priceHub = await PriceHub.deploy(3600);
    await priceHub.waitForDeployment();
    const priceHubAddr = await priceHub.getAddress();
    console.log(`    PriceHub       : ${priceHubAddr}`);

    // 3. FixedPriceAdapter
    const FixedPriceAdapter = await ethers.getContractFactory("FixedPriceAdapter", signer);
    const adapter = await FixedPriceAdapter.deploy();
    await adapter.waitForDeployment();
    const setTx = await priceHub.setDefaultAdapter(await adapter.getAddress());
    await setTx.wait();
    console.log(`    FixedPriceAdapter: ${await adapter.getAddress()} (set as default)`);

    // 4. Presage
    const Presage = await ethers.getContractFactory("Presage", signer);
    presage = await Presage.deploy(MORPHO, factoryAddr, priceHubAddr, IRM);
    await presage.waitForDeployment();
    const presageAddr = await presage.getAddress();
    console.log(`    Presage        : ${presageAddr}`);

    // 5. SafeBatchHelper
    const SafeBatchHelper = await ethers.getContractFactory("SafeBatchHelper", signer);
    batchHelper = await SafeBatchHelper.deploy(presageAddr, MORPHO);
    await batchHelper.waitForDeployment();
    console.log(`    SafeBatchHelper: ${await batchHelper.getAddress()}`);

    // Verify ownership
    expect(await presage.owner()).to.equal(signer.address);
    expect(await priceHub.owner()).to.equal(signer.address);
    console.log("    All contracts deployed and ownership verified");
  });

  // ── Step 2: Authenticate with predict.fun ───────────────────────────────────

  it("Step 2 — Authenticate with predict.fun mainnet", async function () {
    const message = await getAuthMessage();
    const signature = await signer.signMessage(message);
    jwt = await postAuth(signer.address, message, signature);

    expect(jwt).to.be.a("string");
    expect(jwt.length).to.be.greaterThan(20);
    console.log("    JWT acquired");
  });

  // ── Step 3: Set exchange approvals ──────────────────────────────────────────

  it("Step 3 — Set predict.fun exchange approvals", async function () {
    this.timeout(120_000);

    let OrderBuilder: any, ChainId: any;
    try {
      const sdk = await import("@predictdotfun/sdk");
      OrderBuilder = sdk.OrderBuilder;
      ChainId = sdk.ChainId;
    } catch {
      console.log("    predict.fun SDK not found — skipping programmatic approvals");
      console.log("    (Ensure approvals are set manually or via previous run)");
      this.skip();
      return;
    }

    try {
      const builder = await OrderBuilder.make(ChainId.BnbMainnet, signer);
      const result = await builder.setApprovals();
      expect(result.success).to.be.true;
      console.log(`    Approvals set (${result.transactions.length} txs)`);
    } catch (e: any) {
      console.log("    Programmatic approvals failed — continuing (may already be set)");
      console.log(`    Reason: ${e.message?.slice(0, 100)}`);
    }
  });

  // ── Step 4: Buy CTF tokens ──────────────────────────────────────────────────

  it("Step 4 — Buy CTF tokens from predict.fun mainnet", async function () {
    this.timeout(300_000);

    const market = await findMarketWithLiquidity(jwt);
    isYieldBearing = market.isYieldBearing;
    acquiredTokenId = market.tokenId;
    conditionId = market.conditionId;

    console.log(`    Market: "${market.title}" (ID: ${market.marketId})`);
    console.log(`    negRisk: ${market.isNegRisk} | yieldBearing: ${market.isYieldBearing}`);
    console.log(`    Token ID: ${market.tokenId}`);

    let OrderBuilder: any, ChainId: any, Side: any;
    try {
      const sdk = await import("@predictdotfun/sdk");
      OrderBuilder = sdk.OrderBuilder;
      ChainId = sdk.ChainId;
      Side = sdk.Side;
    } catch {
      console.log("    predict.fun SDK not available — cannot place order");
      this.skip();
      return;
    }

    const builder = await OrderBuilder.make(ChainId.BnbMainnet, signer);
    const bestAskPrice = market.book.asks[0][0];
    const pricePerShareWei = parseEther(bestAskPrice.toString());
    const quantityWei = (BUY_VALUE_WEI * parseEther("1")) / pricePerShareWei;

    const { pricePerShare, makerAmount, takerAmount } = builder.getLimitOrderAmounts({
      side: Side.BUY,
      pricePerShareWei,
      quantityWei,
    });

    console.log(`    bestAsk: ${bestAskPrice} | maker: ${formatEther(makerAmount)} | taker: ${formatEther(takerAmount)}`);

    const order = builder.buildOrder("LIMIT", {
      side: Side.BUY,
      maker: signer.address,
      signer: signer.address,
      tokenId: market.tokenId,
      makerAmount,
      takerAmount,
      feeRateBps: market.feeRateBps,
    });

    const typedData = builder.buildTypedData(order, {
      isNegRisk: market.isNegRisk,
      isYieldBearing: market.isYieldBearing,
    });
    const signedOrder = await builder.signTypedDataOrder(typedData);
    const hash = builder.buildTypedDataHash(typedData);

    const { orderHash } = await submitOrder(
      { data: { order: { ...signedOrder, hash }, pricePerShare, strategy: "LIMIT" } },
      jwt
    );

    console.log(`    Order submitted: ${orderHash}`);

    const fillStatus = await waitForFill(orderHash, jwt);
    expect(fillStatus).to.equal("FILLED");

    // Detect CTF contract address
    ctfAddress = isYieldBearing ? CTF_YIELD_BEARING : CTF_STANDARD;

    const ctf = new Contract(ctfAddress, ERC1155_ABI, signer);
    acquiredAmount = await ctf.balanceOf(signer.address, BigInt(market.tokenId));

    console.log(`    CTF address  : ${ctfAddress}`);
    console.log(`    CTF acquired : ${formatEther(acquiredAmount)} tokens`);
    expect(acquiredAmount).to.be.greaterThan(0n);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  PHASE 2: EOA LENDING & BORROWING
  // ══════════════════════════════════════════════════════════════════════════════

  // ── Step 5: Open lending market ─────────────────────────────────────────────

  it("Step 5 — Open a Presage lending market", async function () {
    if (!acquiredAmount || acquiredAmount === 0n) {
      this.skip();
      return;
    }

    const ctfPos = {
      ctf: ctfAddress,
      parentCollectionId: ethers.ZeroHash,
      conditionId: conditionId || ethers.ZeroHash,
      positionId: BigInt(acquiredTokenId),
      oppositePositionId: 0n, // Not used for basic borrow/repay test
    };

    // Resolve 30 days from now, decay over 7 days, 1-hour cooldown
    const resolutionAt = Math.floor(Date.now() / 1000) + 86400 * 30;
    const decayDuration = 86400 * 7;
    const decayCooldown = 3600;
    const lltv = parseEther("0.77"); // 77% LLTV (Morpho-approved tier)

    const tx = await presage.openMarket(ctfPos, USDT, lltv, resolutionAt, decayDuration, decayCooldown);
    const receipt = await tx.wait();

    presageMarketId = 1n;
    const marketData = await presage.getMarket(presageMarketId);
    morphoMarketId = computeMorphoId(marketData.morphoParams);

    console.log(`    Presage Market ID : ${presageMarketId}`);
    console.log(`    Morpho Market ID  : ${morphoMarketId}`);
    console.log(`    Wrapper (wCTF)    : ${marketData.morphoParams.collateralToken}`);
    console.log(`    Oracle            : ${marketData.morphoParams.oracle}`);
    console.log(`    LLTV              : ${formatEther(marketData.morphoParams.lltv)} (${Number(formatEther(marketData.morphoParams.lltv)) * 100}%)`);
    console.log(`    Resolution        : ${new Date(Number(marketData.resolutionAt) * 1000).toISOString()}`);
    console.log(`    Gas used          : ${receipt.gasUsed.toString()}`);

    expect(marketData.morphoParams.loanToken).to.equal(USDT);
    expect(marketData.morphoParams.collateralToken).to.not.equal(ethers.ZeroAddress);
  });

  // ── Step 6: Seed oracle price ───────────────────────────────────────────────

  it("Step 6 — Seed oracle price", async function () {
    if (!presageMarketId) {
      this.skip();
      return;
    }

    // Seed at $1.00 (FixedPriceAdapter default, but seedPrice is needed for the stub)
    const probability = parseEther("1");
    const tx = await priceHub.seedPrice(BigInt(acquiredTokenId), probability);
    await tx.wait();

    const priceData = await priceHub.prices(BigInt(acquiredTokenId));
    const decay = await priceHub.decayFactor(BigInt(acquiredTokenId));

    console.log(`    Price seeded   : ${formatEther(priceData.price)} ($${formatEther(priceData.price)})`);
    console.log(`    Decay factor   : ${formatEther(decay)} (${Number(formatEther(decay)) * 100}%)`);

    expect(priceData.price).to.equal(probability);
    expect(decay).to.equal(parseEther("1")); // Should be 100% (far from resolution)
  });

  // ── Step 7: Supply USDT ─────────────────────────────────────────────────────

  it("Step 7 — Supply USDT as lender", async function () {
    if (!presageMarketId) {
      this.skip();
      return;
    }

    const supplyAmount = parseEther("3"); // 3 USDT
    const usdt = new Contract(USDT, ERC20_ABI, signer);
    const presageAddr = await presage.getAddress();

    // Approve
    const approveTx = await usdt.approve(presageAddr, supplyAmount);
    await approveTx.wait();

    // Supply
    const balBefore = await usdt.balanceOf(signer.address);
    const tx = await presage.supply(presageMarketId, supplyAmount);
    await tx.wait();
    const balAfter = await usdt.balanceOf(signer.address);

    // Verify via Morpho
    const morpho = new Contract(MORPHO, MORPHO_ABI, signer);
    const position = await morpho.position(morphoMarketId, signer.address);
    const market = await morpho.market(morphoMarketId);

    console.log(`    Supplied        : ${formatEther(supplyAmount)} USDT`);
    console.log(`    USDT deducted   : ${formatEther(balBefore - balAfter)} USDT`);
    console.log(`    Supply shares   : ${position.supplyShares.toString()}`);
    console.log(`    Market total    : ${formatEther(market.totalSupplyAssets)} USDT`);

    expect(position.supplyShares).to.be.gt(0n);
    expect(balBefore - balAfter).to.equal(supplyAmount);
  });

  // ── Step 8: Deposit collateral ──────────────────────────────────────────────

  it("Step 8 — Deposit CTF collateral", async function () {
    if (!presageMarketId || !acquiredAmount) {
      this.skip();
      return;
    }

    const depositAmount = acquiredAmount; // All of it
    const ctf = new Contract(ctfAddress, ERC1155_ABI, signer);
    const presageAddr = await presage.getAddress();

    // Approve CTF for Presage
    const approveTx = await ctf.setApprovalForAll(presageAddr, true);
    await approveTx.wait();

    // Deposit
    const tx = await presage.depositCollateral(presageMarketId, depositAmount);
    await tx.wait();

    // Verify collateral is in Morpho
    const morpho = new Contract(MORPHO, MORPHO_ABI, signer);
    const position = await morpho.position(morphoMarketId, signer.address);

    console.log(`    Deposited      : ${formatEther(depositAmount)} CTF tokens`);
    console.log(`    Morpho collateral: ${formatEther(BigInt(position.collateral))} wCTF`);

    expect(BigInt(position.collateral)).to.equal(depositAmount);

    // CTF should no longer be in signer's wallet
    const ctfBal = await ctf.balanceOf(signer.address, BigInt(acquiredTokenId));
    expect(ctfBal).to.equal(0n);
  });

  // ── Step 9: Borrow USDT ─────────────────────────────────────────────────────

  it("Step 9 — Borrow USDT against collateral", async function () {
    if (!presageMarketId) {
      this.skip();
      return;
    }

    // Authorize Presage on Morpho (required for borrow-on-behalf)
    const morpho = new Contract(MORPHO, MORPHO_ABI, signer);
    const authTx = await morpho.setAuthorization(await presage.getAddress(), true);
    await authTx.wait();
    console.log("    Morpho authorization set");

    // Borrow a conservative amount (well within LLTV)
    // collateral value = acquiredAmount * $1 * 77% LLTV
    // Safe borrow = ~50% of max to leave room
    const maxBorrow = (acquiredAmount * 77n) / 100n;
    const borrowAmount = maxBorrow / 2n; // Borrow 50% of max

    const usdt = new Contract(USDT, ERC20_ABI, signer);
    const balBefore = await usdt.balanceOf(signer.address);

    const tx = await presage.borrow(presageMarketId, borrowAmount);
    await tx.wait();

    const balAfter = await usdt.balanceOf(signer.address);

    console.log(`    Max borrowable : ${formatEther(maxBorrow)} USDT`);
    console.log(`    Borrowed       : ${formatEther(borrowAmount)} USDT`);
    console.log(`    USDT received  : ${formatEther(balAfter - balBefore)} USDT`);

    expect(balAfter - balBefore).to.equal(borrowAmount);
  });

  // ── Step 10: Verify health factor ───────────────────────────────────────────

  it("Step 10 — Verify health factor and position stats", async function () {
    if (!presageMarketId) {
      this.skip();
      return;
    }

    const hf = await presage.healthFactor(presageMarketId, signer.address);
    const morpho = new Contract(MORPHO, MORPHO_ABI, signer);
    const position = await morpho.position(morphoMarketId, signer.address);
    const market = await morpho.market(morphoMarketId);

    const supplyAssets = BigInt(market.totalSupplyShares) > 0n
      ? (BigInt(position.supplyShares) * BigInt(market.totalSupplyAssets)) / BigInt(market.totalSupplyShares)
      : 0n;
    const borrowAssets = BigInt(market.totalBorrowShares) > 0n
      ? (BigInt(position.borrowShares) * BigInt(market.totalBorrowAssets)) / BigInt(market.totalBorrowShares)
      : 0n;

    const utilization = BigInt(market.totalSupplyAssets) > 0n
      ? (Number(market.totalBorrowAssets) * 100) / Number(market.totalSupplyAssets)
      : 0;

    console.log("    ── Position Stats ──────────────────────────");
    console.log(`    Health Factor  : ${formatEther(hf)}`);
    console.log(`    Collateral     : ${formatEther(BigInt(position.collateral))} wCTF`);
    console.log(`    Supply Assets  : ${formatEther(supplyAssets)} USDT`);
    console.log(`    Borrow Assets  : ${formatEther(borrowAssets)} USDT`);
    console.log(`    Borrow Shares  : ${position.borrowShares.toString()}`);
    console.log("    ── Market Stats ───────────────────────────");
    console.log(`    Total Supply   : ${formatEther(market.totalSupplyAssets)} USDT`);
    console.log(`    Total Borrow   : ${formatEther(market.totalBorrowAssets)} USDT`);
    console.log(`    Utilization    : ${utilization.toFixed(2)}%`);
    console.log("    ───────────────────────────────────────────");

    // Health factor should be ~2.0 (borrowed 50% of max)
    const hfNum = Number(formatEther(hf));
    expect(hfNum).to.be.greaterThan(1.0);
    console.log(`    Health factor ${hfNum.toFixed(4)} > 1.0 — position is healthy`);
  });

  // ── Step 11: Partial repay ──────────────────────────────────────────────────

  it("Step 11 — Repay partial debt", async function () {
    if (!presageMarketId) {
      this.skip();
      return;
    }

    const morpho = new Contract(MORPHO, MORPHO_ABI, signer);
    const posBefore = await morpho.position(morphoMarketId, signer.address);
    const mktBefore = await morpho.market(morphoMarketId);

    const debtBefore = BigInt(mktBefore.totalBorrowShares) > 0n
      ? (BigInt(posBefore.borrowShares) * BigInt(mktBefore.totalBorrowAssets)) / BigInt(mktBefore.totalBorrowShares)
      : 0n;

    // Repay half the debt
    const repayAmount = debtBefore / 2n;
    const usdt = new Contract(USDT, ERC20_ABI, signer);
    const approveTx = await usdt.approve(await presage.getAddress(), repayAmount);
    await approveTx.wait();

    const tx = await presage.repay(presageMarketId, repayAmount);
    await tx.wait();

    const posAfter = await morpho.position(morphoMarketId, signer.address);

    console.log(`    Debt before    : ${formatEther(debtBefore)} USDT`);
    console.log(`    Repaid         : ${formatEther(repayAmount)} USDT`);
    console.log(`    Shares before  : ${posBefore.borrowShares.toString()}`);
    console.log(`    Shares after   : ${posAfter.borrowShares.toString()}`);

    expect(BigInt(posAfter.borrowShares)).to.be.lt(BigInt(posBefore.borrowShares));

    const hfAfter = await presage.healthFactor(presageMarketId, signer.address);
    console.log(`    Health factor  : ${formatEther(hfAfter)} (improved)`);
  });

  // ── Step 12: Release partial collateral ─────────────────────────────────────

  it("Step 12 — Release partial collateral", async function () {
    if (!presageMarketId) {
      this.skip();
      return;
    }

    // Release 10% of collateral (must keep HF > 1)
    const morpho = new Contract(MORPHO, MORPHO_ABI, signer);
    const pos = await morpho.position(morphoMarketId, signer.address);
    const releaseAmount = BigInt(pos.collateral) / 10n;

    const ctf = new Contract(ctfAddress, ERC1155_ABI, signer);
    const ctfBalBefore = await ctf.balanceOf(signer.address, BigInt(acquiredTokenId));

    const tx = await presage.releaseCollateral(presageMarketId, releaseAmount);
    await tx.wait();

    const ctfBalAfter = await ctf.balanceOf(signer.address, BigInt(acquiredTokenId));
    const posAfter = await morpho.position(morphoMarketId, signer.address);
    const hf = await presage.healthFactor(presageMarketId, signer.address);

    console.log(`    Released       : ${formatEther(releaseAmount)} CTF`);
    console.log(`    CTF returned   : ${formatEther(ctfBalAfter - ctfBalBefore)}`);
    console.log(`    Remaining coll : ${formatEther(BigInt(posAfter.collateral))} wCTF`);
    console.log(`    Health factor  : ${formatEther(hf)}`);

    expect(ctfBalAfter - ctfBalBefore).to.equal(releaseAmount);
    expect(Number(formatEther(hf))).to.be.greaterThan(1.0);
  });

  // ── Step 13: Final position verification ────────────────────────────────────

  it("Step 13 — Verify final EOA position", async function () {
    if (!presageMarketId) {
      this.skip();
      return;
    }

    const morpho = new Contract(MORPHO, MORPHO_ABI, signer);
    const pos = await morpho.position(morphoMarketId, signer.address);
    const market = await morpho.market(morphoMarketId);
    const hf = await presage.healthFactor(presageMarketId, signer.address);

    const supplyAssets = BigInt(market.totalSupplyShares) > 0n
      ? (BigInt(pos.supplyShares) * BigInt(market.totalSupplyAssets)) / BigInt(market.totalSupplyShares)
      : 0n;
    const borrowAssets = BigInt(market.totalBorrowShares) > 0n
      ? (BigInt(pos.borrowShares) * BigInt(market.totalBorrowAssets)) / BigInt(market.totalBorrowShares)
      : 0n;

    console.log("    ── Final Position ─────────────────────────");
    console.log(`    Supply   : ${formatEther(supplyAssets)} USDT (earning interest)`);
    console.log(`    Borrow   : ${formatEther(borrowAssets)} USDT (outstanding debt)`);
    console.log(`    Collateral: ${formatEther(BigInt(pos.collateral))} wCTF`);
    console.log(`    Health   : ${formatEther(hf)}`);
    console.log("    ──────────────────────────────────────────");

    // Position should have: some supply, reduced borrow, reduced collateral
    expect(pos.supplyShares).to.be.gt(0n);
    expect(pos.borrowShares).to.be.gt(0n);
    expect(BigInt(pos.collateral)).to.be.gt(0n);
    expect(Number(formatEther(hf))).to.be.greaterThan(1.0);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  PHASE 3: DUAL-SIG SAFE WALLET
  // ══════════════════════════════════════════════════════════════════════════════

  let mockSafe: any;
  let safeAddr: string;

  it("Step 14 — Deploy dual-sig MockSafe and fund with CTF", async function () {
    if (!presageMarketId) {
      this.skip();
      return;
    }

    // Deploy MockSafe
    const MockSafe = await ethers.getContractFactory("MockSafe", signer);
    mockSafe = await MockSafe.deploy();
    await mockSafe.waitForDeployment();
    safeAddr = await mockSafe.getAddress();
    console.log(`    MockSafe deployed : ${safeAddr}`);

    // Transfer released CTF tokens to the Safe
    const ctf = new Contract(ctfAddress, ERC1155_ABI, signer);
    const signerCtfBal = await ctf.balanceOf(signer.address, BigInt(acquiredTokenId));

    if (signerCtfBal === 0n) {
      console.log("    No CTF tokens available for Safe — skipping Safe tests");
      this.skip();
      return;
    }

    const transferTx = await ctf.safeTransferFrom(
      signer.address,
      safeAddr,
      BigInt(acquiredTokenId),
      signerCtfBal,
      "0x"
    );
    await transferTx.wait();

    const safeCTFBal = await ctf.balanceOf(safeAddr, BigInt(acquiredTokenId));
    console.log(`    Safe CTF balance : ${formatEther(safeCTFBal)} tokens`);
    expect(safeCTFBal).to.equal(signerCtfBal);
  });

  it("Step 15 — Safe atomic batch: Approve + Authorize + Deposit + Borrow", async function () {
    if (!mockSafe || !presageMarketId) {
      this.skip();
      return;
    }

    const ctf = new Contract(ctfAddress, ERC1155_ABI, signer);
    const collateralAmount = await ctf.balanceOf(safeAddr, BigInt(acquiredTokenId));

    if (collateralAmount === 0n) {
      console.log("    Safe has no CTF tokens — skipping");
      this.skip();
      return;
    }

    // Borrow conservatively: 30% of max
    const borrowAmount = (collateralAmount * 77n * 30n) / (100n * 100n);

    console.log(`    Collateral     : ${formatEther(collateralAmount)} CTF`);
    console.log(`    Borrow target  : ${formatEther(borrowAmount)} USDT`);

    // Generate multiSend payload
    const payload = await batchHelper.encodeBorrow(
      presageMarketId,
      ctfAddress,
      collateralAmount,
      borrowAmount
    );

    // Execute the batch from the Safe
    const usdt = new Contract(USDT, ERC20_ABI, signer);
    const safeBefore = await usdt.balanceOf(safeAddr);

    const execTx = await mockSafe.executeBatch(MULTI_SEND, payload);
    await execTx.wait();

    const safeAfter = await usdt.balanceOf(safeAddr);

    console.log(`    USDT received  : ${formatEther(safeAfter - safeBefore)} USDT`);
    expect(safeAfter - safeBefore).to.equal(borrowAmount);

    // Verify Morpho position for Safe
    const morpho = new Contract(MORPHO, MORPHO_ABI, signer);
    const pos = await morpho.position(morphoMarketId, safeAddr);

    console.log(`    Safe collateral: ${formatEther(BigInt(pos.collateral))} wCTF`);
    console.log(`    Safe borrow    : ${pos.borrowShares.toString()} shares`);

    expect(BigInt(pos.collateral)).to.equal(collateralAmount);
    expect(BigInt(pos.borrowShares)).to.be.gt(0n);

    // Verify authorization
    const isAuth = await morpho.isAuthorized(safeAddr, await presage.getAddress());
    expect(isAuth).to.be.true;
    console.log("    Morpho authorization verified for Safe");

    // Health factor
    const hf = await presage.healthFactor(presageMarketId, safeAddr);
    console.log(`    Safe HF        : ${formatEther(hf)}`);
    expect(Number(formatEther(hf))).to.be.greaterThan(1.0);
  });

  it("Step 16 — Safe atomic batch: Approve + Repay + Release", async function () {
    if (!mockSafe || !presageMarketId) {
      this.skip();
      return;
    }

    const morpho = new Contract(MORPHO, MORPHO_ABI, signer);
    const posBefore = await morpho.position(morphoMarketId, safeAddr);
    const mkt = await morpho.market(morphoMarketId);

    // Calculate full debt to repay
    const fullDebt = BigInt(mkt.totalBorrowShares) > 0n
      ? (BigInt(posBefore.borrowShares) * BigInt(mkt.totalBorrowAssets) + BigInt(mkt.totalBorrowShares) - 1n) / BigInt(mkt.totalBorrowShares)
      : 0n;

    if (fullDebt === 0n) {
      console.log("    No debt to repay — skipping");
      this.skip();
      return;
    }

    // The Safe needs USDT to repay — it received some from borrowing.
    // If not enough, fund it from signer
    const usdt = new Contract(USDT, ERC20_ABI, signer);
    const safeUsdtBal = await usdt.balanceOf(safeAddr);

    if (safeUsdtBal < fullDebt) {
      const deficit = fullDebt - safeUsdtBal + parseEther("0.01"); // small buffer
      const topUpTx = await usdt.transfer(safeAddr, deficit);
      await topUpTx.wait();
      console.log(`    Topped up Safe with ${formatEther(deficit)} USDT for repay`);
    }

    const collateralToRelease = BigInt(posBefore.collateral);

    // Generate multiSend payload for repay + release
    const payload = await batchHelper.encodeRepayAndRelease(
      presageMarketId,
      USDT,
      fullDebt,
      collateralToRelease
    );

    // Execute
    const execTx = await mockSafe.executeBatch(MULTI_SEND, payload);
    await execTx.wait();

    // Verify clean position
    const posAfter = await morpho.position(morphoMarketId, safeAddr);

    console.log(`    Repaid         : ${formatEther(fullDebt)} USDT`);
    console.log(`    Released       : ${formatEther(collateralToRelease)} CTF`);
    console.log(`    Remaining debt : ${posAfter.borrowShares.toString()} shares`);
    console.log(`    Remaining coll : ${formatEther(BigInt(posAfter.collateral))} wCTF`);

    expect(BigInt(posAfter.borrowShares)).to.equal(0n);
    expect(BigInt(posAfter.collateral)).to.equal(0n);

    // CTF should be back in the Safe
    const ctf = new Contract(ctfAddress, ERC1155_ABI, signer);
    const safeCTFBal = await ctf.balanceOf(safeAddr, BigInt(acquiredTokenId));
    console.log(`    Safe CTF bal   : ${formatEther(safeCTFBal)}`);
    expect(safeCTFBal).to.equal(collateralToRelease);
  });

  it("Step 17 — Verify Safe position is fully clean", async function () {
    if (!mockSafe || !presageMarketId) {
      this.skip();
      return;
    }

    const morpho = new Contract(MORPHO, MORPHO_ABI, signer);
    const pos = await morpho.position(morphoMarketId, safeAddr);

    console.log("    ── Safe Final State ───────────────────────");
    console.log(`    Supply shares  : ${pos.supplyShares.toString()}`);
    console.log(`    Borrow shares  : ${pos.borrowShares.toString()}`);
    console.log(`    Collateral     : ${formatEther(BigInt(pos.collateral))} wCTF`);
    console.log("    ──────────────────────────────────────────");

    expect(BigInt(pos.borrowShares)).to.equal(0n);
    expect(BigInt(pos.collateral)).to.equal(0n);
    console.log("    Safe position is fully unwound");
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  PHASE 4: WRAPPING INTEGRITY
  // ══════════════════════════════════════════════════════════════════════════════

  it("Step 18 — Wrap CTF tokens to ERC20", async function () {
    if (!presageMarketId) {
      this.skip();
      return;
    }

    // Transfer CTF from Safe back to signer for wrapping test
    const ctf = new Contract(ctfAddress, ERC1155_ABI, signer);

    // Use any CTF tokens the Safe has
    const safeCTFBal = await ctf.balanceOf(safeAddr, BigInt(acquiredTokenId));
    if (safeCTFBal > 0n && mockSafe) {
      // Can't directly call safeTransferFrom from the mock — skip if no signer CTF
    }

    // Check signer's CTF balance (from step 12 release)
    // Actually use the wrapper from the market
    const marketData = await presage.getMarket(presageMarketId);
    const wrapperAddr = marketData.morphoParams.collateralToken;
    const wrapper = await ethers.getContractAt("WrappedCTF", wrapperAddr, signer);

    // Signer may have 0 CTF at this point — get some by releasing remaining collateral
    const morpho = new Contract(MORPHO, MORPHO_ABI, signer);
    const pos = await morpho.position(morphoMarketId, signer.address);

    if (BigInt(pos.collateral) > 0n && BigInt(pos.borrowShares) > 0n) {
      // Must fully repay first to release all collateral
      const mkt = await morpho.market(morphoMarketId);
      const fullDebt = (BigInt(pos.borrowShares) * BigInt(mkt.totalBorrowAssets) + BigInt(mkt.totalBorrowShares) - 1n) / BigInt(mkt.totalBorrowShares);

      const usdt = new Contract(USDT, ERC20_ABI, signer);
      const appTx = await usdt.approve(await presage.getAddress(), fullDebt);
      await appTx.wait();
      const repTx = await presage.repay(presageMarketId, fullDebt);
      await repTx.wait();
      console.log(`    Repaid remaining debt: ${formatEther(fullDebt)} USDT`);
    }

    // Now release all collateral
    const posNow = await morpho.position(morphoMarketId, signer.address);
    const remaining = BigInt(posNow.collateral);
    if (remaining > 0n) {
      const relTx = await presage.releaseCollateral(presageMarketId, remaining);
      await relTx.wait();
      console.log(`    Released remaining: ${formatEther(remaining)} CTF`);
    }

    // Now wrap the CTF
    const ctfBal = await ctf.balanceOf(signer.address, BigInt(acquiredTokenId));
    if (ctfBal === 0n) {
      console.log("    No CTF available for wrapping test — skipping");
      this.skip();
      return;
    }

    const isApproved = await ctf.isApprovedForAll(signer.address, wrapperAddr);
    if (!isApproved) {
      const appTx = await ctf.setApprovalForAll(wrapperAddr, true);
      await appTx.wait();
    }

    const wrapTx = await wrapper.wrap(ctfBal);
    await wrapTx.wait();

    const wctfBal = await wrapper.balanceOf(signer.address);
    const wrapperCTFBal = await ctf.balanceOf(wrapperAddr, BigInt(acquiredTokenId));

    console.log(`    Wrapped        : ${formatEther(ctfBal)} CTF → wCTF`);
    console.log(`    wCTF balance   : ${formatEther(wctfBal)}`);
    console.log(`    Wrapper holds  : ${formatEther(wrapperCTFBal)} CTF (invariant)`);

    expect(wctfBal).to.equal(ctfBal);
    expect(wrapperCTFBal).to.equal(ctfBal);
  });

  it("Step 19 — Transfer wrapped ERC20 to signer 2", async function () {
    if (!presageMarketId) {
      this.skip();
      return;
    }

    const marketData = await presage.getMarket(presageMarketId);
    const wrapper = await ethers.getContractAt("WrappedCTF", marketData.morphoParams.collateralToken, signer);

    const balance = await wrapper.balanceOf(signer.address);
    if (balance === 0n) {
      console.log("    No wCTF to transfer — skipping");
      this.skip();
      return;
    }

    const tx = await wrapper.transfer(signer2.address, balance);
    await tx.wait();

    const senderBal = await wrapper.balanceOf(signer.address);
    const recipientBal = await wrapper.balanceOf(signer2.address);

    console.log(`    Transferred    : ${formatEther(balance)} wCTF → Signer 2`);
    console.log(`    Sender wCTF    : ${formatEther(senderBal)}`);
    console.log(`    Recipient wCTF : ${formatEther(recipientBal)}`);

    expect(senderBal).to.equal(0n);
    expect(recipientBal).to.equal(balance);
  });

  it("Step 20 — Signer 2 unwraps ERC20 → CTF", async function () {
    if (!presageMarketId) {
      this.skip();
      return;
    }

    const marketData = await presage.getMarket(presageMarketId);
    const wrapperAddr = marketData.morphoParams.collateralToken;

    // Fund signer2 with gas if needed
    const s2Balance = await ethers.provider.getBalance(signer2.address);
    if (s2Balance < parseEther("0.005")) {
      const fundTx = await signer.sendTransaction({
        to: signer2.address,
        value: parseEther("0.01"),
      });
      await fundTx.wait();
      console.log("    Funded signer 2 with 0.01 BNB for gas");
    }

    const wrapper = (await ethers.getContractAt("WrappedCTF", wrapperAddr)).connect(signer2) as any;
    const ctf = new Contract(ctfAddress, ERC1155_ABI, signer2);

    const wctfBal = await wrapper.balanceOf(signer2.address);
    if (wctfBal === 0n) {
      console.log("    No wCTF to unwrap — skipping");
      this.skip();
      return;
    }

    const unwrapTx = await wrapper.unwrap(wctfBal);
    await unwrapTx.wait();

    // Verify
    const wctfAfter = await wrapper.balanceOf(signer2.address);
    const ctfBal = await ctf.balanceOf(signer2.address, BigInt(acquiredTokenId));
    const wrapperCTFBal = await ctf.balanceOf(wrapperAddr, BigInt(acquiredTokenId));
    const totalSupply = await wrapper.totalSupply();

    console.log(`    Unwrapped      : ${formatEther(wctfBal)} wCTF → CTF`);
    console.log(`    Signer 2 wCTF  : ${formatEther(wctfAfter)}`);
    console.log(`    Signer 2 CTF   : ${formatEther(ctfBal)}`);
    console.log(`    Wrapper CTF    : ${formatEther(wrapperCTFBal)}`);
    console.log(`    Total supply   : ${formatEther(totalSupply)}`);

    expect(wctfAfter).to.equal(0n);
    expect(ctfBal).to.equal(wctfBal);
    expect(wrapperCTFBal).to.equal(0n);
    expect(totalSupply).to.equal(0n);
    console.log("    All wrapping invariants hold");
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  CLEANUP / SUMMARY
  // ══════════════════════════════════════════════════════════════════════════════

  after(async function () {
    console.log("\n══ TEST SUMMARY ══════════════════════════════════════════════════");

    if (presage) {
      console.log(`  Presage        : ${await presage.getAddress()}`);
      console.log(`  WrapperFactory : ${await factory.getAddress()}`);
      console.log(`  PriceHub       : ${await priceHub.getAddress()}`);
      console.log(`  BatchHelper    : ${await batchHelper.getAddress()}`);
    }

    if (presageMarketId) {
      console.log(`  Market ID      : ${presageMarketId}`);
      console.log(`  Morpho ID      : ${morphoMarketId}`);
    }

    if (ctfAddress) {
      console.log(`  CTF Contract   : ${ctfAddress}`);
      console.log(`  Token ID       : ${acquiredTokenId}`);
      console.log(`  Yield Bearing  : ${isYieldBearing}`);
    }

    const usdt = new Contract(USDT, ERC20_ABI, signer);
    const finalUSDT = await usdt.balanceOf(signer.address);
    const finalBNB = await ethers.provider.getBalance(signer.address);

    console.log(`  Final USDT     : ${formatEther(finalUSDT)}`);
    console.log(`  Final BNB      : ${formatEther(finalBNB)}`);
    console.log("══════════════════════════════════════════════════════════════════\n");
  });
});
