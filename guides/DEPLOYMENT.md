# Deployment Guide

Presage protocol consists of several components. Depending on the environment, you may deploy the full stack or only the wrapping layer.

## 📋 Prerequisites

1. **Private Key**: A wallet with enough BNB for gas (Testnet or Mainnet).
2. **Environment Variables**: Configure these in `.env`.

## 🏗️ Deploying to BNB Testnet (Wrapping Layer)

The BNB Testnet currently only supports the wrapping layer, as Morpho Blue is not yet deployed there.

```sh
npx hardhat run deploy.ts --network bnbTestnet
```

This will deploy:
- `WrapperFactory`
- `PriceHub`
- `FixedPriceAdapter`

## 🚀 Deploying to BNB Mainnet (Full Stack)

To deploy the full protocol on BNB Mainnet, you must specify the live addresses for Morpho Blue and the Adaptive Curve IRM.

```sh
# Set environment variables for the session
$env:MORPHO_BLUE="0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a"; 
$env:IRM="0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979"; 

# Run the deployment script
npx hardhat run deploy.ts --network bnb
```

This will deploy:
- `WrapperFactory`
- `PriceHub`
- `FixedPriceAdapter`
- `Presage` (Router)
- `SafeBatchHelper` (Multisend encoder)

## 🔧 Post-Deployment Tasks

1. **Verification**: After deployment, verify your contracts on BscScan.
    ```sh
    npx hardhat verify --network bnb <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
    ```
2. **Setup Oracles**: For each new market, use the `PriceHub` to set up the appropriate oracle stub.
3. **Seed Liquidity**: If needed, supply initial loan tokens to Morpho Blue via the `Presage` router.
