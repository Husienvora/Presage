# Presage Playground

Interactive testing dashboard for the Presage lending protocol. Runs against a BNB mainnet fork — no real funds, no MetaMask needed.

## Prerequisites

- **Node.js** v18+
- **npm** (comes with Node)
- **BNB RPC URL** — free from [Alchemy](https://www.alchemy.com/), [QuickNode](https://www.quicknode.com/), or any BNB provider

## Environment Setup

Add these to your `.env` file in the **project root** (`Presage/.env`):

```env
# Required — BNB mainnet RPC for forking
BNB_RPC_URL=https://bnb-mainnet.g.alchemy.com/v2/YOUR_KEY

# Optional — enables live predict.fun market data in the Markets tab
PREDICT_API_KEY=your_key_here
```

## Quick Start (One Command)

From the project root:

```bash
npm run playground
```

Or directly:

```bash
node playground/start.cjs
```

This will:
1. Install playground dependencies (first run only)
2. Start a Hardhat fork of BNB mainnet on port 8545
3. Deploy all Presage contracts, fund test accounts, create 3 sample markets
4. Start the UI on http://localhost:5173

Press `Ctrl+C` to stop everything.

## Manual Start (3 Terminals)

If you prefer to run each piece separately:

**Terminal 1 — Fork Node:**
```bash
FORK_BNB=true npx hardhat node
```

**Terminal 2 — Deploy Contracts:**
```bash
npx hardhat run scripts/playground-setup.ts --network localhost
```

**Terminal 3 — UI:**
```bash
cd playground && npm install && npm run dev
```

Open http://localhost:5173.

## Walkthrough

The playground has 8 modules. Follow this order for the full experience:

### 1. Setup
Auto-connects to the fork node. Shows deployed contract addresses and test accounts.

### 2. Markets
Browse live predict.fun categories and markets. Click **Create Market** on any real market to create a Presage lending market from it — this uses the real position IDs and condition IDs from predict.fun. The playground mints MockCTF tokens with matching IDs so you can test borrowing. Manual market creation is also available.

### 3. Lend (as Alice)
Switch to **Alice** in the sidebar. Approve USDT, then supply to a market. This provides liquidity for borrowers.

### 4. Borrow (as Bob)
Switch to **Bob**. Approve CTF tokens, authorize Morpho, deposit collateral, borrow USDT. Watch the health factor in real time.

### 5. Vault
Deploy a MetaMorpho ERC-4626 vault:
- **Deploy Vault** — creates vault with owner, curator, allocator roles and 10% fee
- **Submit Cap** for each market (as Curator), then **Accept Cap** (auto-warps past timelock)
- **Set Supply Queue** (as Allocator)
- **LP Deposit** (as Alice) — deposits USDT into the vault
- **Reallocate** — spreads vault funds across markets

### 6. Time Machine
Fast-forward time with presets (1 hour to 180 days). Trigger interest accrual. View LLTV decay status per market.

### 7. Liquidation
Drop oracle prices to make a position unhealthy (HF < 1.0), then settle it. Enter Bob's address as the borrower.

### 8. Dashboard
Full snapshot: all account balances, all market states (supply, borrow, utilization, price, decay, Bob's position), and vault state.

## Test Accounts

| Name | Role | Address |
|------|------|---------|
| Owner | Deployer & Admin | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Alice | Lender / LP | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| Bob | Borrower | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| Curator | Vault Curator | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |
| Allocator | Vault Allocator | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` |
| Treasury | Fee Recipient | `0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc` |

Each account starts with 50,000 USDT and 10,000 BNB. CTF tokens are minted when you create markets from the Markets tab.

## Adding New Modules

See [MODULES.md](./MODULES.md) for a detailed guide on extending the playground with new modules (safety bot, liquidity bot, etc.).

## Troubleshooting

**"BNB_RPC_URL not set"** — Add it to `Presage/.env`. You need a BNB mainnet RPC endpoint.

**Node takes long to start** — First fork takes 10-20 seconds to fetch state from the RPC. Subsequent starts are faster if using a provider with caching.

**Port already in use** — The start script auto-kills processes on ports 8545 and 5173. If that fails, manually kill them: `lsof -ti :8545 | xargs kill`.

**Contracts not loading** — Make sure the setup script completed. Check that `playground/public/deployed.json` exists. Click "Retry Connection" on the Setup tab.

**Transactions failing** — The fork state resets each time you restart the Hardhat node. Re-run the setup script after restarting.
