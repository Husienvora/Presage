/**
 * Integration test — BNB Testnet + Presage wrapping
 *
 * Flow:
 *   1.  EOA authenticates → JWT
 *   2.  Set all exchange approvals
 *   3.  Discover a live market, place a BUY LIMIT order, poll until FILLED
 *   4.  Deploy WrapperFactory + WrappedCTF clone for acquired token
 *   5.  Wrap CTF tokens → verify ERC20 balance
 *   6.  Transfer wrapped ERC20 to recipient → verify balances
 *   7.  Unwrap on recipient side → verify CTF tokens returned
 *
 * Required env vars
 * ─────────────────
 *   WALLET_PRIVATE_KEY      hex private key of the EOA (with tBNB for gas)
 *
 * Optional env vars
 * ─────────────────
 *   PREDICT_API_BASE_URL    defaults to https://api-testnet.predict.fun/v1
 *   RECIPIENT_PRIVATE_KEY   private key for recipient wallet (generates random if omitted)
 *   API_KEY                 x-api-key header
 *
 * Run
 * ───
 *   WALLET_PRIVATE_KEY=0x… npx hardhat test test/Presage.integration.test.ts --network bnbTestnet
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { formatEther, parseEther, Wallet, HDNodeWallet, Contract, Signer, JsonRpcProvider } from "ethers";
import dotenv from "dotenv";
dotenv.config();

// ── Env ────────────────────────────────────────────────────────────────────────

const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY ?? "";
const RECIPIENT_PRIVATE_KEY = process.env.RECIPIENT_PRIVATE_KEY ?? "";
const API_BASE_URL = process.env.PREDICT_API_BASE_URL ?? "https://api-testnet.predict.fun/v1";
const API_KEY = process.env.API_KEY ?? "";

// ── Constants ──────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5_000;
const FILL_TIMEOUT_MS = 180_000;
const BUY_VALUE_WEI = parseEther("1"); // 1 USDT

// ── Minimal ABI fragments ──────────────────────────────────────────────────────

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
  "function decimals() view returns (uint8)",
];

// ── predict.fun SDK types (minimal) ────────────────────────────────────────────

interface Book {
  asks: [number, number][];
  bids: [number, number][];
}

interface MarketInfo {
  marketId: number;
  tokenId: string;
  isNegRisk: boolean;
  isYieldBearing: boolean;
  feeRateBps: number;
  book: Book;
}

// ── API helpers ────────────────────────────────────────────────────────────────

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
  const res = await fetchJson<{ data: { message: string } }>(`${API_BASE_URL}/auth/message`, {
    headers: buildHeaders(),
  });
  return res.data.message;
}

async function postAuth(signerAddress: string, message: string, signature: string): Promise<string> {
  const res = await fetchJson<{ data: { token: string } }>(`${API_BASE_URL}/auth`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ signer: signerAddress, message, signature }),
  });
  return res.data.token;
}

async function getActiveMarkets(jwt: string): Promise<any[]> {
  const res = await fetchJson<{ data: any[] }>(`${API_BASE_URL}/markets?status=OPEN&first=20`, {
    headers: buildHeaders(jwt),
  });
  return res.data ?? [];
}

async function getOrderbook(marketId: number | string, jwt: string): Promise<Book> {
  const res = await fetchJson<{ data: Book }>(`${API_BASE_URL}/markets/${marketId}/orderbook`, {
    headers: buildHeaders(jwt),
  });
  return res.data;
}

async function submitOrder(body: object, jwt: string): Promise<{ orderId: string; orderHash: string }> {
  const res = await fetchJson<{ data: { orderId: string; orderHash: string } }>(`${API_BASE_URL}/orders`, {
    method: "POST",
    headers: buildHeaders(jwt),
    body: JSON.stringify(body, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
  });
  return res.data;
}

async function getOrderStatus(orderHash: string, jwt: string): Promise<string> {
  const res = await fetchJson<{ data: { status: string } }>(`${API_BASE_URL}/orders/${orderHash}`, {
    headers: buildHeaders(jwt),
  });
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
          isNegRisk: m.isNegRisk ?? false,
          isYieldBearing: m.isYieldBearing ?? false,
          feeRateBps: m.feeRateBps ?? 0,
          book,
        };
      }
    } catch {
      /* skip inaccessible markets */
    }
  }
  throw new Error("No OPEN testnet market with ask-side liquidity found.");
}

async function waitForFill(orderHash: string, jwt: string): Promise<"FILLED" | "FAILED"> {
  const deadline = Date.now() + FILL_TIMEOUT_MS;
  console.log(`    Polling order ${orderHash} …`);
  while (Date.now() < deadline) {
    const status = await getOrderStatus(orderHash, jwt);
    console.log(`    … status: ${status}`);
    if (status === "FILLED") return "FILLED";
    if (["CANCELLED", "EXPIRED", "INVALIDATED"].includes(status)) return "FAILED";
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return "FAILED";
}

// ── Skip guard ─────────────────────────────────────────────────────────────────

const describeFn = WALLET_PRIVATE_KEY ? describe : describe.skip;

// ── Shared state ───────────────────────────────────────────────────────────────

let signer: Wallet | HDNodeWallet;
let recipient: Wallet | HDNodeWallet;
let jwt: string;

// predict.fun state
let ctfAddress: string;      // address of the CTF contract on testnet
let acquiredTokenId: string;
let acquiredAmount: bigint;
let isYieldBearing: boolean;

// Presage state
let wrapperFactoryAddr: string;
let wrapperAddr: string;

// ── Suite ──────────────────────────────────────────────────────────────────────

describeFn("Presage Integration (BNB Testnet + predict.fun)", function () {
  this.timeout(600_000); // 10 min — testnet can be slow

  // ── Setup ──────────────────────────────────────────────────────────────────

  before(async function () {
    // Use hardhat's provider since we're running --network bnbTestnet
    const provider = ethers.provider as any;
    signer = new Wallet(WALLET_PRIVATE_KEY, provider);

    if (RECIPIENT_PRIVATE_KEY) {
      recipient = new Wallet(RECIPIENT_PRIVATE_KEY, provider);
    } else {
      recipient = Wallet.createRandom().connect(provider);
    }

    console.log("\n── Test environment ──────────────────────────────────────────");
    console.log(`  API:         ${API_BASE_URL}`);
    console.log(`  Signer:      ${signer.address}`);
    console.log(`  Recipient:   ${recipient.address}`);
    console.log("──────────────────────────────────────────────────────────────\n");
  });

  // ── Step 1: Authentication ─────────────────────────────────────────────────

  it("Step 1 — Authenticate with predict.fun", async function () {
    const message = await getAuthMessage();
    const signature = await signer.signMessage(message);
    jwt = await postAuth(signer.address, message, signature);

    expect(jwt).to.be.a("string");
    expect(jwt.length).to.be.greaterThan(20);
    console.log("  [1] JWT acquired ✓");
  });

  // ── Step 2: Set exchange approvals ─────────────────────────────────────────

  it("Step 2 — Set predict.fun exchange approvals", async function () {
    // Import predict.fun SDK dynamically (user must have it installed)
    let OrderBuilder: any, ChainId: any;
    try {
      // @ts-ignore – optional peer dependency, caught below if absent
      const sdk = await import("@aspect-build/predict-sdk"); // adjust to actual package name
      OrderBuilder = sdk.OrderBuilder;
      ChainId = sdk.ChainId;
    } catch {
      // Fallback: skip approval via SDK, assume already approved
      console.log("  [2] predict.fun SDK not found — skipping programmatic approvals");
      console.log("  [2] (Ensure approvals are set manually or via previous test run)");
      this.skip();
      return;
    }

    const builder = await OrderBuilder.make(ChainId.BnbTestnet, signer);
    const result = await builder.setApprovals();
    expect(result.success).to.be.true;
    console.log(`  [2] Approvals set (${result.transactions.length} txs) ✓`);
  });

  // ── Step 3: Buy CTF tokens ─────────────────────────────────────────────────

  it("Step 3 — Buy CTF tokens from predict.fun", async function () {
    this.timeout(300_000);

    const market = await findMarketWithLiquidity(jwt);
    isYieldBearing = market.isYieldBearing;
    acquiredTokenId = market.tokenId;

    console.log(`  [3] Market ${market.marketId} — negRisk:${market.isNegRisk} yieldBearing:${market.isYieldBearing}`);
    console.log(`  [3] Token ID: ${market.tokenId}`);

    // Build order via predict.fun SDK or manual construction
    let OrderBuilder: any, ChainId: any, Side: any;
    try {
      // @ts-ignore – optional peer dependency, caught below if absent
      const sdk = await import("@aspect-build/predict-sdk");
      OrderBuilder = sdk.OrderBuilder;
      ChainId = sdk.ChainId;
      Side = sdk.Side;
    } catch {
      console.log("  [3] predict.fun SDK not available — skipping order placement");
      console.log("  [3] Please run with SDK installed or use pre-funded wallet");
      this.skip();
      return;
    }

    const builder = await OrderBuilder.make(ChainId.BnbTestnet, signer);
    const bestAskPrice = market.book.asks[0][0];
    const pricePerShareWei = parseEther(bestAskPrice.toString());
    const quantityWei = (BUY_VALUE_WEI * parseEther("1")) / pricePerShareWei;

    const { pricePerShare, makerAmount, takerAmount } = builder.getLimitOrderAmounts({
      side: Side.BUY,
      pricePerShareWei,
      quantityWei,
    });

    console.log(`  [3] bestAsk: ${bestAskPrice} | maker: ${formatEther(makerAmount)} | taker: ${formatEther(takerAmount)}`);

    const order = builder.buildOrder("LIMIT", {
      side: Side.BUY,
      maker: signer.address,
      signer: signer.address,
      tokenId: market.tokenId,
      makerAmount,
      takerAmount,
      feeRateBps: market.feeRateBps,
    });

    const typedData = builder.buildTypedData(order, { isNegRisk: market.isNegRisk, isYieldBearing: market.isYieldBearing });
    const signedOrder = await builder.signTypedDataOrder(typedData);
    const hash = builder.buildTypedDataHash(typedData);

    const { orderHash } = await submitOrder(
      { data: { order: { ...signedOrder, hash }, pricePerShare, strategy: "LIMIT" } },
      jwt
    );

    console.log(`  [3] Order submitted: ${orderHash}`);

    const fillStatus = await waitForFill(orderHash, jwt);
    expect(fillStatus).to.equal("FILLED");

    // Detect CTF contract address from the builder
    const ctfIdentifier = isYieldBearing ? "YIELD_BEARING_CONDITIONAL_TOKENS" : "CONDITIONAL_TOKENS";
    const ctfContract = builder.contracts![ctfIdentifier].contract;
    ctfAddress = await ctfContract.getAddress();

    acquiredAmount = await ctfContract.balanceOf(signer.address, BigInt(market.tokenId));
    console.log(`  [3] CTF balance: ${formatEther(acquiredAmount)} tokens at ${ctfAddress} ✓`);
    expect(acquiredAmount).to.be.greaterThan(0n);
  });

  // ── Step 4: Deploy WrapperFactory ──────────────────────────────────────────

  it("Step 4 — Deploy WrapperFactory + create WrappedCTF clone", async function () {
    // If step 3 was skipped, try to read CTF balance from a known contract
    if (!acquiredAmount || acquiredAmount === 0n) {
      console.log("  [4] No CTF tokens acquired — skipping wrapper deployment");
      this.skip();
      return;
    }

    // Deploy WrapperFactory
    const WrapperFactory = await ethers.getContractFactory("WrapperFactory", signer);
    const factory = await WrapperFactory.deploy();
    await factory.waitForDeployment();
    wrapperFactoryAddr = await factory.getAddress();
    console.log(`  [4] WrapperFactory deployed: ${wrapperFactoryAddr}`);

    // Predict wrapper address before deployment
    const predictedAddr = await factory.predictAddress(ctfAddress, BigInt(acquiredTokenId));
    console.log(`  [4] Predicted wrapper address: ${predictedAddr}`);

    // Create wrapper (18 decimals to match predict.fun CTF tokens)
    const tx = await factory.create(ctfAddress, BigInt(acquiredTokenId), 18);
    await tx.wait();

    wrapperAddr = await factory.getWrapper(BigInt(acquiredTokenId));
    console.log(`  [4] WrappedCTF deployed: ${wrapperAddr}`);

    expect(wrapperAddr).to.equal(predictedAddr);
    expect(wrapperAddr).to.not.equal(ethers.ZeroAddress);
    console.log("  [4] CREATE2 address prediction correct ✓");
  });

  // ── Step 5: Wrap CTF tokens ────────────────────────────────────────────────

  it("Step 5 — Wrap CTF → ERC20 (approve + wrap)", async function () {
    if (!wrapperAddr) {
      this.skip();
      return;
    }

    const ctf = new Contract(ctfAddress, ERC1155_ABI, signer) as any;

    // Approve wrapper to pull CTF tokens
    const approveTx = await ctf.setApprovalForAll(wrapperAddr, true);
    await approveTx.wait();
    console.log("  [5] CTF approval set for wrapper");

    // Wrap
    const wrapper = await ethers.getContractAt("WrappedCTF", wrapperAddr, signer) as any;
    const wrapTx = await wrapper.wrap(acquiredAmount);
    await wrapTx.wait();

    // Verify ERC20 balance
    const wctfBalance = await wrapper.balanceOf(signer.address);
    const ctfBalance = await ctf.balanceOf(signer.address, BigInt(acquiredTokenId));
    const wrapperCtfBalance = await ctf.balanceOf(wrapperAddr, BigInt(acquiredTokenId));

    console.log(`  [5] wCTF (ERC20) balance: ${formatEther(wctfBalance)}`);
    console.log(`  [5] CTF (ERC1155) signer balance: ${formatEther(ctfBalance)}`);
    console.log(`  [5] CTF (ERC1155) wrapper balance: ${formatEther(wrapperCtfBalance)}`);

    expect(wctfBalance).to.equal(acquiredAmount);
    expect(ctfBalance).to.equal(0n);
    expect(wrapperCtfBalance).to.equal(acquiredAmount);
    console.log("  [5] Wrap successful — invariant holds ✓");
  });

  // ── Step 6: Transfer wrapped ERC20 ─────────────────────────────────────────

  it("Step 6 — Transfer wrapped ERC20 to recipient", async function () {
    if (!wrapperAddr) {
      this.skip();
      return;
    }

    const wrapper = await ethers.getContractAt("WrappedCTF", wrapperAddr, signer) as any;

    const tx = await wrapper.transfer(recipient.address, acquiredAmount);
    await tx.wait();

    const senderBalance = await wrapper.balanceOf(signer.address);
    const recipientBalance = await wrapper.balanceOf(recipient.address);

    console.log(`  [6] Sender wCTF balance: ${formatEther(senderBalance)}`);
    console.log(`  [6] Recipient wCTF balance: ${formatEther(recipientBalance)}`);

    expect(senderBalance).to.equal(0n);
    expect(recipientBalance).to.equal(acquiredAmount);
    console.log("  [6] ERC20 transfer verified ✓");
  });

  // ── Step 7: Unwrap on recipient side ───────────────────────────────────────

  it("Step 7 — Recipient unwraps ERC20 → CTF", async function () {
    if (!wrapperAddr) {
      this.skip();
      return;
    }

    // Fund recipient with gas if needed
    const recipientBalance = await ethers.provider.getBalance(recipient.address);
    if (recipientBalance < parseEther("0.01")) {
      console.log("  [7] Funding recipient with tBNB for gas…");
      const fundTx = await signer.sendTransaction({
        to: recipient.address,
        value: parseEther("0.02"),
      });
      await fundTx.wait();
    }

    const wrapper = (await ethers.getContractAt("WrappedCTF", wrapperAddr)).connect(recipient) as any;
    const ctf = new Contract(ctfAddress, ERC1155_ABI, recipient) as any;

    // Unwrap
    const unwrapTx = await wrapper.unwrap(acquiredAmount);
    await unwrapTx.wait();

    // Verify
    const wctfBalance = await wrapper.balanceOf(recipient.address);
    const ctfBalance = await ctf.balanceOf(recipient.address, BigInt(acquiredTokenId));
    const wrapperCtfBalance = await ctf.balanceOf(wrapperAddr, BigInt(acquiredTokenId));
    const totalSupply = await wrapper.totalSupply();

    console.log(`  [7] Recipient wCTF: ${formatEther(wctfBalance)}`);
    console.log(`  [7] Recipient CTF:  ${formatEther(ctfBalance)}`);
    console.log(`  [7] Wrapper CTF:    ${formatEther(wrapperCtfBalance)}`);
    console.log(`  [7] Total supply:   ${formatEther(totalSupply)}`);

    expect(wctfBalance).to.equal(0n);
    expect(ctfBalance).to.equal(acquiredAmount);
    expect(wrapperCtfBalance).to.equal(0n);
    expect(totalSupply).to.equal(0n);
    console.log("  [7] Unwrap successful — all invariants hold ✓");
  });
});
