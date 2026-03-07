# Fork Testing Guide

Presage uses **BNB Mainnet Forks** to verify integration with Morpho Blue without requiring testnet deployments or real funds.

## 📋 Prerequisites

1. **Alchemy RPC URL**: You must have a valid BNB Mainnet RPC. We recommend [Alchemy](https://www.alchemy.com/) (Free Tier).
2. **Node.js**: v20+ recommended.
3. **Hardhat**: Core development environment.

## 🚀 Running the Fork Test

Execute the following command in your terminal (PowerShell format):

```powershell
$env:BNB_RPC_URL="your_alchemy_rpc_url_here"; 
$env:FORK_BNB="true"; 
npx hardhat test test/Presage.fork.test.ts --network hardhat
```

### What this command does:
- `BNB_RPC_URL`: Points Hardhat to the live BNB Chain.
- `FORK_BNB`: A flag that triggers the `hardhat.config.ts` to enable the `forking` block.
- `--network hardhat`: Runs the test on a local, ephemeral instance of the BNB Chain.

## 🔧 Configuration Details

The fork is configured in `hardhat.config.ts`. Key settings include:

- **Hardfork**: Set to `cancun` (standard for current BNB Chain).
- **Chain ID**: 56 (BNB Mainnet).
- **Hardfork History**: Explicitly mapped to ensure compatibility with historical blocks.

```typescript
networks: {
  hardhat: {
    forking: {
      url: process.env.BNB_RPC_URL,
      blockNumber: undefined, // Defaults to latest
    },
    chainId: 56,
    hardfork: "cancun",
    chains: {
      56: {
        hardforkHistory: {
          shanghai: 0,
          cancun: 0,
        }
      }
    }
  }
}
```

## 🔍 Troubleshooting

### "LLTV not enabled"
Morpho Blue only allows specific LLTV (Loan-to-Value) ratios. If you encounter this error, ensure the `openMarket` call in your test uses an enabled LLTV (e.g., `0.77`, `0.86`, `0.915`).

### "No known hardfork for execution"
This usually occurs when the RPC provider doesn't support the requested block or the Hardhat config is missing `hardforkHistory`. Ensure your `hardhat.config.ts` matches the one provided in this repo.

### "bad address checksum"
Ethers v6 is strict about address checksums. Use `ethers.getAddress("0x...")` to normalize addresses in your test scripts.

## 🧪 Verified Integration Addresses

The fork test uses these live addresses on BNB Chain:
- **Morpho Blue**: `0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a`
- **Adaptive Curve IRM**: `0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979`
- **USDT**: `0x55d398326f99059fF775485246999027B3197955`
