import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import dotenv from "dotenv";
dotenv.config();

const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY ?? "0x" + "00".repeat(32);
const BNB_RPC = process.env.BNB_RPC_URL ?? "https://bsc-dataseed1.binance.org/";
const BNB_TESTNET_RPC = process.env.BNB_TESTNET_RPC_URL ?? "https://bsc-testnet-dataseed.bnbchain.org/";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      // For fork tests against BNB mainnet (where Morpho Blue lives)
      forking: process.env.FORK_BNB
        ? { url: BNB_RPC, ...(process.env.FORK_BLOCK ? { blockNumber: Number(process.env.FORK_BLOCK) } : {}) }
        : undefined,
      chainId: process.env.FORK_BNB ? 56 : 31337,
      hardfork: "cancun",
      chains: {
        56: {
          hardforkHistory: {
            berlin: 0,
            london: 0,
            shanghai: 0,
            cancun: 0,
          }
        }
      }
    },
    bnbTestnet: {
      url: BNB_TESTNET_RPC,
      chainId: 97,
      accounts: [PRIVATE_KEY],
    },
    bnb: {
      url: BNB_RPC,
      chainId: 56,
      accounts: [PRIVATE_KEY],
    },
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

export default config;
