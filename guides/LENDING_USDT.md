# Lending USDT on Presage

Lenders provide the stablecoins (USDT) that borrowers use to unlock liquidity from their prediction market positions. As a lender, you earn interest paid by these borrowers.

## 💰 How it Works

1. **Isolated Markets**: Each prediction market outcome (e.g., "YES on Event X") is an isolated lending market on Morpho Blue. You choose exactly which collateral you are willing to lend against.
2. **Interest Accrual**: Interest is calculated per block based on the market's utilization (the ratio of borrowed funds to supplied funds).
3. **Direct Ownership**: When you lend through the Presage router, the supply position is recorded in your name on Morpho Blue. You own the assets and the interest directly.

## 🚀 How to Lend

### 1. Manual Supply

If you are using a standard EOA (Metamask, Rabby, etc.):

1. **Approve**: Call `approve(presageAddress, amount)` on the USDT contract.
2. **Supply**: Call `supply(marketId, amount)` on the `Presage` router.

### 2. Batch Supply (Gnosis Safe)

If you are using a Safe wallet, you can use the `SafeBatchHelper` to perform the approval and supply in one transaction:

1. Call `SafeBatchHelper.encodeSupply(marketId, USDT_ADDRESS, amount)`.
2. Submit the resulting bytes to your Safe's `multiSend` contract.

## 📥 Withdrawing Funds

You can withdraw your supplied USDT and earned interest at any time, provided there is enough liquidity in the market (i.e., not all funds are currently borrowed).

1. Call `withdraw(marketId, amount)` on the `Presage` router.
2. Morpho Blue will transfer the USDT directly to your wallet.

## ⚠️ Risks for Lenders

- **Utilization Risk**: If a market is 100% utilized, you may have to wait for borrowers to repay before you can withdraw.
- **Bad Debt**: If a borrower is liquidated and the collateral sale doesn't cover their full debt, the loss is socialized among all lenders in that specific isolated market. *Note: Presage mitigates this via LLTV decay to ensure liquidations happen early.*
- **Oracle Risk**: If an oracle provides an incorrect price, it could lead to improper liquidations or over-borrowing. Presage defaults to a safe $1 fixed-price oracle to minimize this surface area.
