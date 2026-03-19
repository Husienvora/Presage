# Lending USDT on Presage

Lenders provide the stablecoins (USDT) that borrowers use to unlock liquidity from their prediction market positions. As a lender, you earn interest paid by these borrowers.

There are two ways to lend: the **Presage Vault** (recommended for most users) and **Direct Market Supply** (for advanced users who want per-market control).

---

## Option 1: Presage USDT Vault (Recommended)

The Presage Vault is a MetaMorpho ERC-4626 vault that automatically allocates your USDT across all active Presage lending markets. You deposit once, receive `pUSDT` share tokens, and earn blended yield — no need to pick individual markets or manage positions.

### How it Works

1. A **curator** (Presage team) enables prediction markets in the vault with per-market supply caps
2. An **allocator bot** distributes vault USDT across markets based on utilization and yield
3. As markets approach resolution, the allocator shifts liquidity to newer markets automatically
4. You do nothing — deposit, earn, withdraw when ready

### Yamata UI Flow

```
Yamata --> Earn tab --> "Presage USDT Vault"
  - Shows: blended APY, total deposited, vault TVL
  - [Deposit USDT] — one click
  - [Withdraw USDT] — one click
  - That's it.
```

### Contract Interaction

1. **Approve**: Call `approve(vaultAddress, amount)` on the USDT contract.
2. **Deposit**: Call `deposit(amount, receiverAddress)` on the MetaMorpho vault.
3. You receive `pUSDT` shares proportional to your deposit.

### Withdrawing

1. Call `withdraw(amount, receiver, owner)` on the vault.
2. The vault pulls USDT from underlying Morpho markets (in withdraw queue order) and sends it to you.
3. If all markets are fully utilized, withdrawal may be partially delayed until borrowers repay.

### Vault Risks

- **Utilization Risk**: Same as direct lending — if markets are 100% utilized, withdrawals are delayed.
- **Bad Debt Risk**: If any market in the vault suffers bad debt, it reduces the vault's total assets. All vault depositors share the loss proportionally. Market isolation is preserved at the Morpho level but partially lost at the vault level.
- **Curator Risk**: A negligent curator could enable risky markets. Mitigated by the mandatory 24h+ timelock on cap increases and guardian veto power.
- **Allocator Risk**: A faulty allocator could misallocate funds. Mitigated by per-market supply caps that the allocator cannot exceed.

---

## Option 2: Direct Market Supply (Advanced)

For users who want to choose exactly which prediction outcomes they lend against and earn that market's specific APR (potentially higher than the vault's blended rate, but with concentration risk).

### How it Works

1. **Isolated Markets**: Each prediction market outcome (e.g., "YES on Event X") is an isolated lending market on Morpho Blue. You choose exactly which collateral you are willing to lend against.
2. **Interest Accrual**: Interest is calculated per block based on the market's utilization (the ratio of borrowed funds to supplied funds).
3. **Direct Ownership**: When you lend through the Presage router, the supply position is recorded in your name on Morpho Blue. You own the assets and the interest directly.

### Yamata UI Flow

```
Yamata --> Earn tab --> "Individual Markets" (advanced view)
  - Shows: list of all active Presage markets with per-market APR, utilization, time-to-expiry
  - Pick a market --> [Supply USDT] to that specific market
  - [Withdraw USDT] from that specific market
```

### Manual Supply (EOA)

1. **Approve**: Call `approve(presageAddress, amount)` on the USDT contract.
2. **Supply**: Call `supply(marketId, amount)` on the `Presage` router.

### Batch Supply (Gnosis Safe)

If you are using a Safe wallet, you can use the `SafeBatchHelper` to perform the approval and supply in one transaction:

1. Call `SafeBatchHelper.encodeSupply(marketId, USDT_ADDRESS, amount)`.
2. Submit the resulting bytes to your Safe's `multiSend` contract.

### Withdrawing Funds

1. Call `withdraw(marketId, amount)` on the `Presage` router.
2. Morpho Blue will transfer the USDT directly to your wallet.

### Direct Lending Risks

- **Utilization Risk**: If a market is 100% utilized, you may have to wait for borrowers to repay before you can withdraw.
- **Bad Debt**: If a borrower is liquidated and the collateral sale doesn't cover their full debt, the loss is socialized among all lenders in that specific isolated market. *Note: Presage mitigates this via LLTV decay to ensure liquidations happen early.*
- **Oracle Risk**: If an oracle provides an incorrect price, it could lead to improper liquidations or over-borrowing. Presage defaults to a safe $1 fixed-price oracle to minimize this surface area.
- **Concentration Risk**: Unlike the vault, your entire position is in one market. If that market suffers bad debt, you bear the full loss.
- **Management Overhead**: You must manually rotate liquidity as markets expire and new ones open.

---

## Vault vs Direct: Which to Choose?

| | Vault (pUSDT) | Direct Market Supply |
|---|---|---|
| **Best for** | Passive LPs who want easy yield | Power users who want specific market exposure |
| **Effort** | Deposit once, forget | Must pick markets, monitor, rotate |
| **Yield** | Blended APR across all markets | Single market APR (potentially higher) |
| **Risk** | Diversified across markets | Concentrated in one market |
| **Composability** | pUSDT share token usable in DeFi | Morpho supply position (less composable) |
| **Management** | Curator + allocator bot handle everything | You manage everything yourself |

### Where Borrowers Fit

Borrowers interact with Presage directly — they deposit CTF collateral and borrow USDT. They never interact with the vault. From a borrower's perspective, USDT from the vault and USDT from direct lenders are identical — Morpho Blue pools all supply fungibly within each market.

```
                    +-------------------------+
                    |   Morpho Blue Market    |  (e.g., "BTC >100k" YES)
                    |                         |
  Vault --supply--> |  Total Supply: 80k      | <--supply-- Direct Lender
  (50k USDT)        |  Total Borrow: 60k      |             (30k USDT)
                    |                         |
                    |  Borrower borrows from  | <--borrow-- Borrower
                    |  the combined pool      |
                    +-------------------------+
```
