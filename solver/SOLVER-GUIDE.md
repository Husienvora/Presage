# Presage Solver Bot

## What Is the Solver?

The Presage protocol uses an **intent-based** leverage/deleverage system. Borrowers don't execute leveraged trades directly — they post **requests** describing the trade they want. A third-party **solver** evaluates these requests, and if profitable, fills them atomically in a single transaction.

The solver is a permissionless role. Anyone can run the bot. There is no whitelist, no registration, and no special access. The only requirement is capital: the solver needs either CTF tokens (for leverage fills) or USDT (for deleverage fills).

---

## How Leverage Works

### The Borrower's Perspective

A borrower holds prediction market tokens (CTF — Conditional Token Framework, ERC1155) and wants to increase their position without buying more tokens outright. They use their existing CTF as **margin** and want a solver to provide the rest.

**Example:** Alice holds 200 CTF tokens priced at $0.65 each. She wants exposure to 300 CTF total. She calls:

```
requestLeverage(marketId=1, margin=200, totalCollateral=300, maxBorrow=120, deadline=...)
```

This means:
- Alice puts up **200 CTF** as margin
- She wants **300 CTF** total collateral in her Morpho position
- A solver must provide the missing **100 CTF**
- In exchange, Alice borrows up to **120 USDT** against the full 300 CTF position
- That 120 USDT goes to the solver as payment for the CTF they provided

### The Solver's Perspective

The solver sees this request and calculates:

1. **Cost:** 100 CTF at oracle price $0.65 = **$65 USDT** worth of tokens
2. **Revenue:** 120 USDT minus 2% origination fee = **$117.60 USDT** received
3. **Profit:** $117.60 - $65.00 = **$52.60 USDT**

If profitable, the solver calls `fillLeverage(alice, marketId)`.

### What Happens On-Chain (Atomic)

When `fillLeverage` executes, all of the following happen in one transaction or none of it does:

1. Pull **200 CTF** from borrower (margin)
2. Pull **100 CTF** from solver (the leveraged portion)
3. Wrap all 300 CTF into WrappedCTF (ERC20, needed for Morpho)
4. Supply 300 WrappedCTF as collateral in Morpho on behalf of borrower
5. Borrow 120 USDT from Morpho on behalf of borrower
6. Send 2% fee (2.4 USDT) to treasury
7. Send remaining 117.6 USDT to solver

After this, Alice has a leveraged position: 300 CTF collateral backing a 120 USDT debt. Her health factor is governed by `(collateral * oraclePrice * LLTV) / debt`.

---

## How Deleverage Works

### The Borrower's Perspective

Alice now wants to reduce her position. She has 300 CTF collateral and ~120 USDT debt. She calls:

```
requestDeleverage(marketId=1, repayAmount=30, withdrawCollateral=50, deadline=...)
```

This means:
- A solver provides **30 USDT** to repay part of Alice's debt
- In exchange, **50 CTF** are withdrawn from Alice's collateral and sent to the solver

### The Solver's Perspective

1. **Cost:** 30 USDT (the repayment amount)
2. **Revenue:** 50 CTF at oracle price $0.65 = **$32.50 USDT** worth
3. **Profit:** $32.50 - $30.00 = **$2.50 USDT**

The solver now holds 50 CTF tokens that they can sell on predict.fun or hold in inventory for future leverage fills.

### What Happens On-Chain (Atomic)

When `fillDeleverage` executes:

1. Pull **30 USDT** from solver
2. Repay 30 USDT of borrower's Morpho debt
3. Refund any dust (rounding remainders) back to solver
4. Withdraw **50 WrappedCTF** from borrower's Morpho collateral
5. Unwrap into raw CTF tokens
6. Send **50 CTF** to solver

After this, Alice's position is smaller: 250 CTF collateral, ~90 USDT debt.

---

## Profit Math

### Leverage Profit Formula

```
leveragedAmount = totalCollateral - margin
ctfCost         = leveragedAmount * oraclePrice / 1e36
fee             = borrowAmount * originationFeeBps / 10000
usdtReceived    = borrowAmount - fee
profit          = usdtReceived - ctfCost
```

The oracle price is stored at **1e36 scale** (Morpho's convention). All token amounts are **18 decimals**.

**Key insight:** The solver profits when the borrower is willing to borrow more USDT (after fees) than the market value of the CTF the solver provides. This happens when the borrower is bullish and willing to pay a premium for leveraged exposure.

### Deleverage Profit Formula

```
ctfValue = withdrawCollateral * oraclePrice / 1e36
profit   = ctfValue - repayAmount
```

**Key insight:** The solver profits when the CTF tokens they receive are worth more than the USDT they spend to repay debt. This happens when the borrower is willing to accept a discount to exit their position quickly.

### When Is It Unprofitable?

- **Leverage:** If the borrower requests a low borrow amount relative to the CTF the solver must provide, the solver loses money. Example: providing 200 CTF ($130 at $0.65) but only receiving $117.60 after fees = **-$12.40 loss**.

- **Deleverage:** If the repay amount exceeds the CTF value. Example: paying 80 USDT to receive 100 CTF worth only $65 = **-$15 loss**.

- **Price movement:** A request that was profitable at $0.65 can become unprofitable if the oracle price rises to $0.80 (leverage) or drops to $0.40 (deleverage) before the solver fills.

---

## Solver Bot Architecture

```
solver/
  src/
    index.ts      Main bot loop: detect → evaluate → fill
    config.ts     Environment variable parsing
    abis.ts       Contract ABIs (Presage, ERC20, CTF, Morpho, Oracle)
    predict.ts    predict.fun orderbook integration (JIT mode)
  test/
    e2e.ts        End-to-end test (Hardhat fork + real bot process)
  .env.example    Configuration template
  package.json
  tsconfig.json
```

### Detection: How the Bot Finds Requests

The solver uses two parallel strategies:

**1. Event Listener (Real-Time)**

Subscribes to `LeverageRequested` and `DeleverageRequested` events from the Presage contract. When a borrower submits a request, the bot is notified immediately.

```
presage.on("LeverageRequested", async (borrower, marketId, margin, total, borrow, deadline) => {
  // evaluate and fill
});
```

**2. Polling (Fallback)**

Every N seconds (configurable), the bot queries the on-chain state for all known borrowers:

```
const req = await presage.leverageRequests(borrower, marketId);
if (req.deadline > now && !req.filled && req.supplyCollateralAmount > 0n) {
  // evaluate and fill
}
```

Polling catches requests that the event listener might miss (e.g., RPC disconnection, node restart). The bot discovers borrowers from historical events on startup and adds new ones as events arrive.

### Evaluation: Should the Bot Fill?

Before filling, the bot runs a profitability check:

1. Fetch the oracle price from the market's oracle contract
2. Calculate expected profit using the formulas above
3. Compare profit against the configurable `MIN_PROFIT_USDT` threshold
4. Check gas price against `MAX_GAS_PRICE_GWEI`
5. Verify the solver has sufficient token balances

Only if all checks pass does the bot proceed to fill.

### Fill Execution

1. Ensure token approvals are set (CTF `setApprovalForAll`, USDT `approve`, Morpho `setAuthorization`)
2. Call `fillLeverage(borrower, marketId)` or `fillDeleverage(borrower, marketId)`
3. Log the result

### Cancellation Awareness

The bot also listens for `LeverageCancelled` and `DeleverageCancelled` events. If a fill attempt reverts because the request was cancelled or expired, the bot catches the error and moves on — it does not crash.

---

## Inventory Mode vs. JIT Mode

### Inventory Mode (Default)

The solver pre-holds CTF tokens for the markets it monitors. When a leverage request arrives, it checks its balance and fills from existing inventory.

- Simpler, faster, no external dependencies
- Requires upfront capital in the specific CTF positions
- Best for solvers who are market makers or already hold prediction market positions

### JIT (Just-In-Time) Mode

When the solver doesn't have enough CTF, it buys the missing amount from the predict.fun orderbook before filling:

```
ACQUIRE_MODE=jit
```

**Leverage flow with JIT:**
1. Bot detects a profitable leverage request needing 100 CTF
2. Bot only has 20 CTF → deficit of 80
3. Bot places a market buy order on predict.fun for 80 CTF
4. Waits for the order to fill (up to `JIT_FILL_TIMEOUT_SECONDS`)
5. Once acquired, proceeds to fill the Presage request

**Deleverage flow with JIT:**
1. Bot fills the deleverage (provides USDT, receives CTF)
2. Immediately places a market sell order on predict.fun for the received CTF
3. Converts back to USDT, closing the loop

JIT mode is configured with:
- `JIT_SLIPPAGE_BPS` — max slippage tolerance (default: 100 = 1%)
- `JIT_FILL_TIMEOUT_SECONDS` — how long to wait for the orderbook fill (default: 30s)

### predict.fun Integration

The `predict.ts` module handles:
1. **Authentication** — wallet signs a message, exchanges for JWT token
2. **Orderbook reading** — fetches asks/bids for the target CTF token
3. **Order building** — uses `@predictdotfun/sdk` `OrderBuilder` to create signed orders
4. **Order submission** — posts to the predict.fun API
5. **Fill polling** — waits for order status to become `FILLED`

---

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Required | Description |
|---|---|---|
| `RPC_URL` | Yes | BNB Chain RPC endpoint |
| `PRIVATE_KEY` | Yes | Solver wallet private key |
| `PRESAGE_ADDRESS` | Yes | Presage contract address |
| `MORPHO_ADDRESS` | No | Morpho Blue address (defaults to BNB mainnet) |
| `MARKET_IDS` | No | Comma-separated market IDs to monitor (default: `1`) |
| `MIN_PROFIT_USDT` | No | Minimum profit threshold in USDT (default: `1.0`) |
| `POLL_INTERVAL_SECONDS` | No | Polling frequency (default: `5`) |
| `MAX_GAS_PRICE_GWEI` | No | Skip fills above this gas price (default: `10`) |
| `ACQUIRE_MODE` | No | `inventory` or `jit` (default: `inventory`) |
| `PREDICT_API_URL` | No | predict.fun API base URL |
| `PREDICT_API_KEY` | No | API key for higher rate limits |
| `JIT_SLIPPAGE_BPS` | No | Max slippage for JIT orders (default: `100`) |
| `JIT_FILL_TIMEOUT_SECONDS` | No | JIT order fill timeout (default: `30`) |

### Running the Bot

```bash
cd solver
cp .env.example .env
# Edit .env with your values
npm install
npm run dev    # development (ts-node)
npm run build && npm start  # production
```

### Required On-Chain Setup

Before the solver can fill requests, the solver's wallet must have:

1. **Morpho authorization** — `morpho.setAuthorization(presageAddress, true)` (the bot does this automatically on startup)
2. **CTF approval** — `ctf.setApprovalForAll(presageAddress, true)` (the bot does this automatically before the first leverage fill)
3. **USDT approval** — `usdt.approve(presageAddress, MAX_UINT256)` (the bot does this automatically before the first deleverage fill)
4. **Token balances** — USDT for deleverage fills, CTF for leverage fills (or JIT mode to acquire on demand)
5. **BNB for gas**

---

## Test Coverage

The solver is tested at three levels:

### 1. Contract-Level Tests (`test/Presage.leverage.fork.test.ts`)

**32 tests** against a real BNB fork via Hardhat. These validate the smart contract behavior:

| Category | Tests |
|---|---|
| **Happy path** | Request leverage, fill leverage, verify health factor |
| **Fees** | Origination fee deduction, fee sent to treasury, no-treasury scenario |
| **Deleverage** | Request, fill, verify collateral withdrawal and health factor |
| **Stacking** | Adding leverage to an existing position |
| **Cancel** | Cancel leverage request, cancel deleverage request |
| **Rejection** | Fill cancelled request, fill expired request, double fill |
| **Validation** | Margin >= total, expired deadline, deleverage expired deadline |
| **Access control** | Any solver can fill (not just a specific one) |
| **Insufficient funds** | Solver lacks CTF, borrower lacks margin, solver lacks USDT |
| **Edge cases** | Borrow exceeds supply, withdraw > position, overwrite filled request |
| **Multi-user** | Independent requests from different users |

### 2. Solver Logic Tests (`test/Presage.solver.fork.test.ts`)

**17 tests** that replicate the solver bot's decision-making pipeline against a BNB fork. These prove the solver's TypeScript logic matches on-chain reality:

| Category | Tests |
|---|---|
| **Profitability math** | Profitable leverage ($17 profit), unprofitable leverage (-$12.40), min profit threshold |
| **Deleverage math** | Profitable deleverage ($15 profit), unprofitable deleverage (-$15) |
| **Balance gating** | Verify CTF balance check, verify USDT balance check |
| **E2E leverage** | Event detect → evaluate → balance check → fill → verify USDT received + treasury fee + Morpho position |
| **E2E deleverage** | Event detect → evaluate → USDT check → approve → fill → verify collateral change + health factor |
| **Race conditions** | Cancelled between detect and fill, expired between detect and fill, competing solver fills first |
| **Price sensitivity** | Profitable at $0.65, unprofitable at $0.80 (leverage); profitable at $0.65, unprofitable at $0.40 (deleverage) |
| **Zero inventory** | Detects solver has 0 CTF, flags JIT needed |
| **Polling** | Discovers active request from chain state (not event), fills it, skips already-filled requests |

### 3. End-to-End Test (`solver/test/e2e.ts`)

A full integration test that runs the actual solver bot as a child process:

1. **Starts a Hardhat node** (BNB mainnet fork on port 8546)
2. **Deploys all contracts** (WrapperFactory, PriceHub, FixedPriceAdapter, Presage, MockCTF)
3. **Configures market** ($0.65 CTF price, 62.5% LLTV, 2% origination fee)
4. **Funds accounts** (USDT from a whale, CTF from mock mint)
5. **Launches the solver bot** as a subprocess with env vars pointing to the local fork
6. **Waits for solver initialization** (detects "Starting poll loop" in stdout)
7. **Submits a leverage request** as the borrower (margin=200, total=300, borrow=120)
8. **Verifies the solver fills it** within 30 seconds (checks `filled=true` on-chain)
9. **Submits a deleverage request** (repay=30, withdraw=50)
10. **Verifies the solver fills that too**
11. **Checks health factors** after both operations

This test validates the entire pipeline end-to-end: process startup, event detection, profitability evaluation, token approvals, transaction execution, and on-chain state changes.

```bash
# Run the e2e test
cd solver && npx ts-node test/e2e.ts

# Prerequisites:
#   - Parent project compiled: cd .. && npx hardhat compile
#   - BNB_RPC_URL set in parent .env (for forking)
```

### Test Results

All tests pass:

```
Presage Leverage Fork Test: 32 passing
Solver Logic Fork Test:     17 passing
Solver E2E Test:            leverage fill PASSED, deleverage fill PASSED
```

---

## Worked Example: Full Lifecycle

**Setup:** CTF price = $0.65, LLTV = 62.5%, origination fee = 2%

### Step 1: Leverage

Alice has 200 CTF and wants 300 CTF exposure.

```
Alice calls: requestLeverage(market=1, margin=200, total=300, borrow=120, deadline=+5min)
```

Solver evaluates:
- CTF to provide: 300 - 200 = **100 CTF**
- Cost of 100 CTF: 100 * $0.65 = **$65**
- USDT received: 120 - 2% = **$117.60**
- Profit: $117.60 - $65 = **$52.60**
- Max borrow check: 300 * 0.65 * 0.625 = $121.88 >= $120

Solver fills. Alice now has:
- Collateral: 300 WrappedCTF in Morpho
- Debt: 120 USDT
- Health factor: ~1.016

### Step 2: Deleverage

Alice wants to reduce risk. She requests partial exit.

```
Alice calls: requestDeleverage(market=1, repay=30, withdraw=50, deadline=+5min)
```

Solver evaluates:
- USDT to provide: **$30**
- CTF to receive: **50 CTF** worth 50 * $0.65 = **$32.50**
- Profit: $32.50 - $30 = **$2.50**

Solver fills. Alice now has:
- Collateral: 250 WrappedCTF in Morpho
- Debt: ~90 USDT
- Health factor: ~1.128

### Step 3: Solver's Position

After both trades, the solver:
- Started with 2000 CTF and some USDT
- Spent 100 CTF on leverage fill, received 117.60 USDT
- Spent 30 USDT on deleverage fill, received 50 CTF
- Net: -50 CTF, +87.60 USDT
- At $0.65/CTF, the 50 CTF deficit = $32.50, so **net profit = $55.10 USDT**

---

## Risk Considerations for Solver Operators

1. **Oracle price risk** — The profit calculation uses the oracle price at evaluation time. If the price changes between evaluation and on-chain execution (in the same block on BNB, unlikely but possible with MEV), actual profit may differ.

2. **Inventory risk** — In inventory mode, the solver holds CTF tokens whose value can drop. In JIT mode, this risk is minimized since tokens are acquired and used immediately.

3. **Gas costs** — Each fill costs gas. The bot checks gas price against `MAX_GAS_PRICE_GWEI` and skips if too high.

4. **Competition** — Multiple solvers can race to fill the same request. Only the first transaction to land wins; subsequent attempts revert with "already filled". The bot handles this gracefully.

5. **Request cancellation** — Borrowers can cancel requests at any time. The bot handles reverts from cancelled/expired requests without crashing.

6. **LLTV constraints** — The borrower's requested borrow amount must be feasible given the total collateral, oracle price, and LLTV. Infeasible requests will revert on-chain even if they look profitable in evaluation.
