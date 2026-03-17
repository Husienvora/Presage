import { Wallet, parseEther } from "ethers";
import { OrderBuilder, ChainId, Side, type Book } from "@predictdotfun/sdk";
import { config } from "./config";

// ──────── Types ────────

interface PredictMarket {
  tokenId: string;
  feeRateBps: number;
  isNegRisk: boolean;
  isYieldBearing: boolean;
}

// ──────── State ────────

let orderBuilder: OrderBuilder | null = null;
let jwt: string | null = null;
let jwtExpiresAt = 0;

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [predict] ${msg}`);
}

// ──────── Auth ────────

async function authenticate(wallet: Wallet): Promise<string> {
  // If JWT is still fresh (with 60s buffer), reuse it
  if (jwt && Date.now() < jwtExpiresAt - 60_000) return jwt;

  const baseUrl = config.predictApiUrl;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.predictApiKey) headers["x-api-key"] = config.predictApiKey;

  // 1. Get message to sign
  const msgRes = await fetch(`${baseUrl}/auth/message`, { headers });
  const msgData = (await msgRes.json()) as { data: { message: string } };
  const message: string = msgData.data.message;

  // 2. Sign with wallet
  const signature = await wallet.signMessage(message);

  // 3. Exchange for JWT
  const authRes = await fetch(`${baseUrl}/auth`, {
    method: "POST",
    headers,
    body: JSON.stringify({ signer: wallet.address, message, signature }),
  });
  const authData = (await authRes.json()) as { data: { token: string } };
  jwt = authData.data.token;

  // JWT typically valid for 24h — set a conservative 12h expiry
  jwtExpiresAt = Date.now() + 12 * 60 * 60 * 1000;

  log("Authenticated with predict.fun API");
  return jwt!;
}

// ──────── API Helpers ────────

async function apiGet(path: string, token: string): Promise<any> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (config.predictApiKey) headers["x-api-key"] = config.predictApiKey;
  const res = await fetch(`${config.predictApiUrl}${path}`, { headers });
  return res.json();
}

async function apiPost(path: string, body: any, token: string): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (config.predictApiKey) headers["x-api-key"] = config.predictApiKey;
  const res = await fetch(`${config.predictApiUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return res.json();
}

// ──────── OrderBuilder ────────

async function getOrderBuilder(wallet: Wallet): Promise<OrderBuilder> {
  if (!orderBuilder) {
    orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, wallet);
    // Set approvals (one-time)
    const result = await orderBuilder.setApprovals();
    if (!result.success) {
      log("WARNING: Failed to set predict.fun exchange approvals");
    } else {
      log("Exchange approvals set");
    }
  }
  return orderBuilder;
}

// ──────── Core: Buy CTF via predict.fun ────────

/**
 * Buy CTF tokens from predict.fun's orderbook.
 *
 * @param wallet - Solver's wallet
 * @param tokenId - On-chain ERC1155 token ID (same as Presage positionId)
 * @param amount - Amount of CTF shares to buy (in wei, 18 decimals)
 * @returns true if the order was successfully placed and filled
 */
export async function buyCTF(
  wallet: Wallet,
  tokenId: bigint,
  amount: bigint,
): Promise<{ success: boolean; costUsdt: bigint }> {
  try {
    const token = await authenticate(wallet);
    const builder = await getOrderBuilder(wallet);

    // 1. Fetch orderbook for this token
    const bookData = await apiGet(`/orderbook/${tokenId.toString()}`, token);
    const rawBook = bookData.data || bookData;
    const book: Book = {
      marketId: rawBook.marketId ?? 0,
      updateTimestampMs: rawBook.updateTimestampMs ?? Date.now(),
      asks: rawBook.asks ?? [],
      bids: rawBook.bids ?? [],
    };

    if (book.asks.length === 0) {
      log(`No asks on orderbook for token ${tokenId}`);
      return { success: false, costUsdt: 0n };
    }

    // 2. Calculate cost: walk the orderbook to fill `amount`
    let remainingShares = Number(amount) / 1e18;
    let totalCost = 0;
    for (const [price, qty] of book.asks) {
      const fillQty = Math.min(remainingShares, qty);
      totalCost += fillQty * price;
      remainingShares -= fillQty;
      if (remainingShares <= 0) break;
    }

    if (remainingShares > 0) {
      log(`Insufficient orderbook depth for token ${tokenId}: need ${Number(amount) / 1e18} shares, only ${(Number(amount) / 1e18) - remainingShares} available`);
      return { success: false, costUsdt: 0n };
    }

    const costUsdt = parseEther(totalCost.toFixed(18));

    // 3. Fetch market metadata (feeRateBps, isNegRisk, isYieldBearing)
    //    We need the predict.fun market ID that contains this tokenId.
    //    The API typically returns this from the token lookup.
    const marketMeta = await apiGet(`/tokens/${tokenId.toString()}`, token);
    const meta: PredictMarket = marketMeta.data || marketMeta;

    // 4. Build and sign a market buy order
    const { pricePerShare, makerAmount, takerAmount } = builder.getMarketOrderAmounts(
      {
        side: Side.BUY,
        quantityWei: amount,
        slippageBps: config.jitSlippageBps,
      },
      book,
    );

    const order = builder.buildOrder("MARKET", {
      side: Side.BUY,
      maker: wallet.address,
      signer: wallet.address,
      tokenId: tokenId.toString(),
      makerAmount,
      takerAmount,
      feeRateBps: BigInt(meta.feeRateBps),
    });

    const typedData = builder.buildTypedData(order, {
      isNegRisk: meta.isNegRisk,
      isYieldBearing: meta.isYieldBearing,
    });
    const signedOrder = await builder.signTypedDataOrder(typedData);
    const hash = builder.buildTypedDataHash(typedData);

    // 5. Submit to predict.fun API
    const submitRes = await apiPost("/orders", {
      data: {
        order: { ...signedOrder, hash },
        pricePerShare,
        strategy: "MARKET",
      },
    }, token);

    const orderHash = submitRes.data?.orderHash || submitRes.orderHash;
    if (!orderHash) {
      log(`Order submission failed: ${JSON.stringify(submitRes)}`);
      return { success: false, costUsdt: 0n };
    }

    log(`Order submitted: ${orderHash}. Waiting for fill...`);

    // 6. Poll for fill
    const deadline = Date.now() + config.jitFillTimeoutMs;
    while (Date.now() < deadline) {
      const statusRes = await apiGet(`/orders/${orderHash}`, token);
      const status = statusRes.data?.status || statusRes.status;

      if (status === "FILLED") {
        log(`Order FILLED. Cost: ~${totalCost.toFixed(4)} USDT`);
        return { success: true, costUsdt };
      }
      if (["CANCELLED", "EXPIRED", "INVALIDATED"].includes(status)) {
        log(`Order ${status}: ${orderHash}`);
        return { success: false, costUsdt: 0n };
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    log(`Order fill timeout after ${config.jitFillTimeoutMs / 1000}s`);
    return { success: false, costUsdt: 0n };
  } catch (err: any) {
    log(`buyCTF error: ${err.message}`);
    return { success: false, costUsdt: 0n };
  }
}

/**
 * Sell CTF tokens on predict.fun's orderbook (for deleverage — solver receives CTF and sells).
 */
export async function sellCTF(
  wallet: Wallet,
  tokenId: bigint,
  amount: bigint,
): Promise<{ success: boolean; proceedsUsdt: bigint }> {
  try {
    const token = await authenticate(wallet);
    const builder = await getOrderBuilder(wallet);

    const bookData = await apiGet(`/orderbook/${tokenId.toString()}`, token);
    const rawBook = bookData.data || bookData;
    const book: Book = {
      marketId: rawBook.marketId ?? 0,
      updateTimestampMs: rawBook.updateTimestampMs ?? Date.now(),
      asks: rawBook.asks ?? [],
      bids: rawBook.bids ?? [],
    };

    if (book.bids.length === 0) {
      log(`No bids on orderbook for token ${tokenId}`);
      return { success: false, proceedsUsdt: 0n };
    }

    // Walk bids to estimate proceeds
    let remainingShares = Number(amount) / 1e18;
    let totalProceeds = 0;
    for (const [price, qty] of book.bids) {
      const fillQty = Math.min(remainingShares, qty);
      totalProceeds += fillQty * price;
      remainingShares -= fillQty;
      if (remainingShares <= 0) break;
    }

    const proceedsUsdt = parseEther(totalProceeds.toFixed(18));

    const marketMeta = await apiGet(`/tokens/${tokenId.toString()}`, token);
    const meta: PredictMarket = marketMeta.data || marketMeta;

    const { pricePerShare, makerAmount, takerAmount } = builder.getMarketOrderAmounts(
      {
        side: Side.SELL,
        quantityWei: amount,
        slippageBps: config.jitSlippageBps,
      },
      book,
    );

    const order = builder.buildOrder("MARKET", {
      side: Side.SELL,
      maker: wallet.address,
      signer: wallet.address,
      tokenId: tokenId.toString(),
      makerAmount,
      takerAmount,
      feeRateBps: BigInt(meta.feeRateBps),
    });

    const typedData = builder.buildTypedData(order, {
      isNegRisk: meta.isNegRisk,
      isYieldBearing: meta.isYieldBearing,
    });
    const signedOrder = await builder.signTypedDataOrder(typedData);
    const hash = builder.buildTypedDataHash(typedData);

    const submitRes = await apiPost("/orders", {
      data: {
        order: { ...signedOrder, hash },
        pricePerShare,
        strategy: "MARKET",
      },
    }, token);

    const orderHash = submitRes.data?.orderHash || submitRes.orderHash;
    if (!orderHash) {
      log(`Sell order submission failed: ${JSON.stringify(submitRes)}`);
      return { success: false, proceedsUsdt: 0n };
    }

    log(`Sell order submitted: ${orderHash}. Waiting for fill...`);

    const deadline = Date.now() + config.jitFillTimeoutMs;
    while (Date.now() < deadline) {
      const statusRes = await apiGet(`/orders/${orderHash}`, token);
      const status = statusRes.data?.status || statusRes.status;

      if (status === "FILLED") {
        log(`Sell order FILLED. Proceeds: ~${totalProceeds.toFixed(4)} USDT`);
        return { success: true, proceedsUsdt };
      }
      if (["CANCELLED", "EXPIRED", "INVALIDATED"].includes(status)) {
        log(`Sell order ${status}: ${orderHash}`);
        return { success: false, proceedsUsdt: 0n };
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    log(`Sell order fill timeout`);
    return { success: false, proceedsUsdt: 0n };
  } catch (err: any) {
    log(`sellCTF error: ${err.message}`);
    return { success: false, proceedsUsdt: 0n };
  }
}
