# Presage Protocol — Architecture Guidebook

## What Problem Are We Solving?

Prediction markets (Polymarket, predict.fun, Omen) let you buy outcome tokens — "YES this will happen" or "NO it won't." These tokens are ERC1155 tokens from the Gnosis Conditional Tokens Framework (CTF). If the outcome resolves in your favor, each token pays out $1 in the underlying stablecoin. If not, it's worth $0.

The problem: you believe an outcome is likely, you're holding YES tokens worth $0.80 each, but your capital is locked. You can't use those tokens anywhere else in DeFi because they're ERC1155 — and most DeFi protocols (lending, DEXes, vaults) only work with ERC20 tokens.

Presage solves this by letting you borrow stablecoins against your CTF positions. You keep your prediction market exposure while freeing up liquidity. The protocol wraps CTF tokens into ERC20, deposits them as collateral into Morpho Blue lending markets, and lets you borrow against them.

---

## Why Build on Morpho Blue Instead of Writing Our Own Lending Protocol?

This was the first and most consequential decision. Lending protocols are deceptively complex — interest accrual, share accounting, liquidation incentives, bad debt socialization, flash loans, authorization delegation. Morpho Blue has ~650 lines of battle-tested, formally verified code handling all of this.

What Morpho Blue gives us for free:

- **Interest rate management** via the AdaptiveCurveIRM — automatically adjusts rates based on utilization
- **Liquidation engine** with configurable incentives — we don't write liquidation math
- **Share accounting** for supply/borrow positions — handles rounding edge cases that trip up custom implementations
- **Bad debt socialization** — when a position goes underwater, losses distribute proportionally to lenders in that market
- **Authorization system** — users can delegate position management to contracts like Presage
- **Flash loans** — free, protocol-level flash liquidity

What we had to build ourselves:

- ERC1155→ERC20 wrapping layer (CTF tokens aren't ERC20-compatible)
- Oracle system (no Chainlink feed exists for prediction market probabilities)
- The glue that coordinates wrapping + Morpho interactions in one flow

Morpho Blue's permissionless market creation is the key enabler. Anyone can create an isolated lending market with _any_ ERC20 as collateral — we just need to make CTF tokens look like ERC20, which brings us to wrapping.

---

## The Wrapping Problem: Why ERC1155 → ERC20?

Gnosis CTF tokens are ERC1155. This is a multi-token standard — a single contract holds many different token types, each identified by a `tokenId` (also called `positionId`). When you buy "YES on question X", you receive a balance of token ID `12345` on the CTF contract.

Morpho Blue (and most of DeFi) requires ERC20 — one contract per token type, with `transfer`, `approve`, `balanceOf`, etc.

The wrapper creates a 1:1 bridge between these two worlds. For each CTF position (each unique `positionId`), we deploy a separate ERC20 contract that:

1. **Accepts ERC1155 deposits** via `wrap()` — you send CTF tokens in, it mints an equal amount of ERC20 tokens
2. **Returns ERC1155 on withdrawal** via `unwrap()` — you burn ERC20 tokens, it sends back your CTF tokens
3. **Maintains a strict invariant**: `totalSupply()` of the ERC20 always equals `CTF.balanceOf(wrapper, positionId)`

### WrappedCTF Design Decisions

**Permissionless wrap/unwrap (no `onlyOwner`)**: The wrapper is fully permissionless. Anyone can wrap. Anyone can unwrap. The wrapper is a pure utility — it doesn't care who calls it or why. This creates a more robust system where users can interact with the wrapper directly (not just through Presage), which is useful for:

- Emergency unwrapping if Presage has issues
- Third-party integrations that want wrapped CTF tokens
- Composability with other DeFi protocols

**EIP-1167 minimal proxy clones**: Each prediction market outcome needs its own wrapper (its own ERC20 contract). Deploying a full contract each time costs ~2M gas. Instead, we deploy one implementation contract (`WrappedCTF`) and then create cheap clones (~45k gas) that delegate all logic to it. The `WrapperFactory` handles this.

**CREATE2 deterministic addresses**: The factory uses `CREATE2` with `keccak256(abi.encode(ctf, positionId))` as the salt. This means you can compute what the wrapper address _will be_ before it's deployed. This is important for:

- Front-end UIs that need to show "wrapper for this token will be at 0x..."
- Other contracts that want to reference a wrapper before it exists
- Gas optimization — you can skip existence checks by predicting the address

**`initialize()` instead of constructor args**: Since we're using clones, we can't pass constructor arguments. The clone copies the implementation's bytecode exactly. So we use a one-time `initialize()` function that the factory calls right after cloning. The `_initialized` flag prevents anyone from calling it again.

**`flashUnwrap()` for atomic liquidations**: The standard unwrap flow is: burn ERC20, receive ERC1155. But for the merge-based liquidation path, we need to temporarily hold raw CTF tokens mid-transaction, perform a merge, then use the resulting stablecoins. `flashUnwrap` enables this by burning tokens, transferring the CTF out, and then calling back to a specified contract before the transaction ends. This is analogous to flash loans but for unwrapping.

---

## The Oracle Problem: How Do You Price Prediction Market Tokens?

This is the hardest part of the entire system. Morpho Blue requires an oracle that implements a single function:

```solidity
function price() external view returns (uint256);
```

It returns: how many loan tokens is 1 collateral token worth, scaled by 1e36.

For standard assets, you'd use Chainlink (ETH/USD, BTC/USD, etc.). But no price feed exists for "probability that Trump wins the 2024 election" or "probability of a recession by 2026."

### Approach 1: Fixed Price Oracle ($1)

The simplest and safest approach. Every CTF outcome token is priced at $1 — its maximum possible payout.

Why this works:

- A binary outcome token _cannot_ be worth more than $1 (that's the maximum payout if the outcome resolves YES)
- With an LLTV of 77%, a user who deposits 100 tokens can borrow at most 77 USDT
- If the outcome resolves YES: tokens pay out $1 each, user keeps the $77 profit plus gets $23 back
- If the outcome resolves NO: tokens become worthless, but the lender only lent $77 against collateral that was "worth" $100 — the $23 gap is their safety buffer

The downside is capital inefficiency. A token trading at $0.95 (very likely outcome) is still priced at $1.00, so the user can't borrow as much as they "should" be able to.

### Approach 2: Market-Price Oracle

Read the actual trading price from an on-chain or off-chain source. A token at $0.95 probability lets you borrow more than one at $0.50.

The problem: prediction market prices are manipulable. Order books can be thin, AMM pools can be shallow. An attacker could:

1. Artificially inflate the price of a CTF token
2. Deposit the inflated tokens as collateral
3. Borrow a large amount of stablecoins
4. Let the price correct back down
5. Walk away with the stablecoins, leaving worthless collateral

### Approach 3: zkTLS Pull-Oracle

A clever approach involves using zkTLS proofs (like Reclaim Protocol). A user fetches the price from a market's API over HTTPS, and the zkTLS prover generates a cryptographic proof that the price data came from the real server at a specific timestamp. This proof is verified on-chain.

This is a "pull oracle" — users push price updates when they want to interact, rather than a bot constantly pushing prices (which costs gas).

### What Presage Does: Pluggable PriceAdapter Interface

Instead of hardcoding one oracle strategy, Presage introduces the `IPriceAdapter` interface:

```solidity
interface IPriceAdapter {
    function getPrice(uint256 positionId) external view returns (uint256 price, uint256 updatedAt);
    function submitPrice(uint256 positionId, bytes calldata data) external;
}
```

Any oracle backend can implement this. We ship two:

1. **FixedPriceAdapter** — always returns $1. Use for v1.
2. **PullPriceAdapter** — accepts externally-proven prices from pluggable `IProofVerifier` backends (zkTLS, signed feeds, etc.)

The `PriceHub` contract sits between adapters and Morpho. It:

- Stores a default adapter (FixedPriceAdapter initially)
- Allows per-position adapter overrides (switch specific markets to PullPriceAdapter later)
- Applies staleness checks (reverts if price is too old)
- Spawns lightweight `MorphoOracleStub` contracts that implement Morpho's `IOracle` interface

Each `MorphoOracleStub` is a tiny contract (~15 lines) that just calls `PriceHub.morphoPrice(positionId)`. Morpho sees a valid `IOracle` at a unique address — one per lending market.

### Why Separate PriceHub from Presage?

Separation of concerns. The PriceHub is responsible for "what is the price of this CTF token?" Presage is responsible for "manage lending positions on Morpho Blue." They can be upgraded independently. A bug in price logic doesn't require redeploying the lending router.

---

## LLTV Decay: Approaching Resolution

Prediction markets have a known resolution date. On that date, one outcome token goes to $1 and the other goes to $0. This is a binary jump — there's no gradual price decline for liquidators to act on.

If a borrower holds the losing side, their collateral instantly becomes worthless. If they borrowed $0.77 per token, the lender loses everything.

LLTV decay mitigates this by gradually reducing the effective loan-to-value ratio as the resolution date approaches. The timeline:

```
|  Full LLTV  |  Linear decay  |  LLTV = 0  |
|             |                |            |
start ────────────────────────── end ─────── resolution
              ← decayDuration → ← cooldown →
```

During the decay window, the oracle multiplies the price by a decay factor that linearly drops from 1.0 to 0.0. This effectively reduces how much each collateral token is "worth" to Morpho, pushing positions toward liquidation before the market resolves.

In the cooldown period (right before resolution), LLTV is zero — meaning all positions are liquidatable. This gives liquidators a guaranteed window to clean up any remaining positions.

The decay formula lives in `PriceHub._decayFactor()`:

```solidity
function _decayFactor(MarketConfig memory cfg) internal view returns (uint256) {
    uint256 end = cfg.resolutionAt - cfg.decayCooldown;
    uint256 start = end - cfg.decayDuration;
    if (block.timestamp < start) return 1e18;  // full price
    if (block.timestamp >= end) return 0;       // zero price
    return ((end - block.timestamp) * 1e18) / cfg.decayDuration;  // linear interpolation
}
```

---

## How Presage Coordinates Everything

The `Presage` contract is the router — it orchestrates the interaction between the user, the CTF tokens, the wrapper, and Morpho Blue. Each operation involves multiple steps that must happen atomically.

### Deposit Collateral Flow

When a user calls `depositCollateral(marketId, amount)`:

1. **Pull CTF**: Presage transfers ERC1155 tokens from the user.
2. **Wrap**: Presage calls `wrap()` on the `WrappedCTF` clone.
3. **Supply**: Presage calls `supplyCollateral` on Morpho Blue on behalf of the user.

Key detail: `supplyCollateral` is called with `onBehalf: msg.sender` (the user). This means the collateral position is owned by the user on Morpho, not by Presage. Presage is just a pass-through — it never holds positions.

### Borrow Flow

Users can borrow against their collateral directly through Presage. For this to work, the user must have called `morpho.setAuthorization(presage, true)` beforehand. This tells Morpho: "Presage is allowed to borrow on my behalf."

### Repay Flow — The Rounding Problem

When repaying debt, there's a subtle issue with share-based accounting. Morpho tracks debt in "borrow shares," not in absolute token amounts. Converting between shares and assets involves integer division, which rounds.

To prevent leaving "dust" (1 wei of debt), Presage checks if the repayment amount covers the full debt assets. If so, it repays using the full share count instead of a rounded asset amount.

---

## Two Liquidation Paths

When a borrower's position becomes unhealthy (their health factor drops below 1.0), anyone can liquidate them. Presage offers two liquidation mechanisms:

### Path 1: Settle With Loan Token

The straightforward path. A liquidator provides stablecoins, which are used to repay the borrower's debt. In exchange, the liquidator receives the borrower's CTF collateral at a discount (Morpho's liquidation incentive).

### Path 2: Settle With Merge (Opposite Shares)

This is the creative path, unique to prediction markets. It exploits a fundamental property of CTF: if you hold _both_ outcomes of a binary market, you can merge them back into the underlying stablecoin. 1 YES + 1 NO = 1 USDT (always).

A liquidator who holds NO tokens can liquidate a YES-collateralized position without needing any stablecoins by using `flashUnwrap` to seize the collateral, merging it with their NO tokens, and settling the debt with the resulting USDT.

---

## Safe Wallet Integration

Gnosis Safe wallets are multi-signature smart contract wallets. Users who hold CTF tokens in a Safe need to execute multiple contract calls atomically. The `SafeBatchHelper` encodes these into Safe's `multiSend` format.

Instead of a high-permission Module, `SafeBatchHelper` is a pure encoder. It produces calldata that the Safe executes through its normal multiSend mechanism, with all the usual signature requirements. No elevated permissions, no trust assumptions beyond what's already there.

---

## WrapperFactory Architecture

The factory makes wrapper deployment permissionless and gas-efficient using EIP-1167 minimal proxies.

- **CREATE2**: Deterministic addresses allow front-ends and contracts to predict wrapper addresses before deployment.
- **Registry**: Prevents duplicate wrappers and serves as a central look-up for the protocol.

---

## The Morpho Blue Interaction Model

Morpho Blue uses an authorization system for delegated operations. Presage acts "on behalf of" the user, which requires the user to explicitly authorize Presage on Morpho.

The user's positions are always on Morpho, owned by the user. Presage is just a convenience layer that never holds user positions or funds.

---

## Testing on BNB Testnet with predict.fun

Presage compatibility is verified through a three-tier testing strategy:

1. **Unit tests (Local)**: Fast verification of wrapping, factory, and oracle logic using mock tokens.
2. **Integration tests (BNB Testnet)**: Real-world verification using `predict.fun` CTF tokens (both standard and yield-bearing).
3. **Fork tests (BNB Mainnet Fork)**: End-to-end verification of the full lending lifecycle against live Morpho Blue state.

---

## Risk Model Summary

| Risk | Severity | How Presage Handles It |
|---|---|---|
| Resolution risk | Critical | LLTV decay + mandatory cooldown window |
| Wrapper bug | High | Minimal code, no admin, no upgradeability |
| Oracle manipulation | Medium-High | Fixed-price fallback + pull-oracle staleness checks |
| Bad debt | Medium | Isolated markets + Morpho socialization |
| Smart contract risk | Medium | Lean router design + reliance on verified primitives |

---

## File Map

```
contracts/
├── Presage.sol              # Router: market creation, supply/borrow/repay, liquidation
├── WrappedCTF.sol           # Permissionless ERC20 ↔ ERC1155 wrapper
├── WrapperFactory.sol       # EIP-1167 clone factory with CREATE2
├── PriceHub.sol             # Oracle registry + decay + Morpho stub spawning
├── SafeBatchHelper.sol      # Encodes Safe multiSend payloads
├── interfaces/
│   ├── ICTF.sol             # Gnosis Conditional Tokens interface
│   └── IPriceAdapter.sol    # Pluggable oracle backend interface
├── oracle/
│   ├── FixedPriceAdapter.sol    # $1 always (v1 default)
│   └── PullPriceAdapter.sol     # Accepts proven price observations
├── test/
│   └── MockCTF.sol          # Minimal ERC1155 for unit tests
└── vendor/morpho/           # Vendored Morpho Blue interfaces + libraries
    ├── IMorpho.sol
    ├── IOracle.sol
    ├── Types.sol
    └── Libraries.sol
```
