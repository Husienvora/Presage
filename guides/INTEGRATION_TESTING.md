# Integration Testing Guide (BNB Testnet)

Presage integrates with **predict.fun** on the **BNB Testnet** (Chain 97) to test real-world scenarios of acquiring and wrapping CTF tokens.

## Prerequisites

1. **Wallet Private Key**: A private key for an EOA (Externally Owned Account) on the BNB Testnet.
2. **Funds**: Your account must have:
    - **tBNB**: For gas fees.
    - **Testnet USDT**: For buying tokens on predict.fun.

## Environment Setup

Create a `.env` file in the project root:

```sh
WALLET_PRIVATE_KEY="your_private_key_here"
PREDICT_API_BASE_URL="https://api-testnet.predict.fun/v1"
```

## SDK Installation (Optional but Recommended)

The integration test uses predict.fun's SDK to automate the buying process. If the SDK is not installed, the test will skip the order placement and focus on the wrapping/unwrapping logic (assuming you have pre-existing tokens).

```sh
npm install @aspect-build/predict-sdk
```

## Running the Test

Run the following command:

```sh
npx hardhat test test/Presage.integration.test.ts --network bnbTestnet
```

## Test Flow Summary

1. **Authentication**: Authenticates with predict.fun's API via JWT.
2. **Order Placement**: Automatically finds a market with liquidity and places a BUY order.
3. **Polling**: Waits until the order is `FILLED`.
4. **Wrapping**: Deploys a `WrappedCTF` clone and converts the acquired CTF tokens (ERC1155) into ERC20s.
5. **Transfer**: Verifies the ERC20s can be transferred to a recipient wallet.
6. **Unwrapping**: The recipient converts the ERC20s back to the original CTF tokens.

## Verified Testnet Addresses

These addresses are auto-discovered via the predict.fun API/SDK:
- **CTF Registry**: Discovered dynamically (supports both standard and yield-bearing).
- **Exchange**: Used for automated order placement.
