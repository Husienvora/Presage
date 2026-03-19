import type { TestAccount, AccountRole } from "../types";

export const RPC_URL = "http://127.0.0.1:8545";

// Hardhat's default well-known test accounts
export const TEST_ACCOUNTS: Record<AccountRole, TestAccount> = {
  owner: {
    name: "Owner",
    role: "Deployer & Admin",
    pk: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  },
  alice: {
    name: "Alice",
    role: "Lender / LP",
    pk: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  },
  bob: {
    name: "Bob",
    role: "Borrower",
    pk: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  },
  curator: {
    name: "Curator",
    role: "Vault Curator",
    pk: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  },
  allocator: {
    name: "Allocator",
    role: "Vault Allocator",
    pk: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
    address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  },
  liquidator: {
    name: "Charlie",
    role: "Liquidator",
    pk: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
    address: "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
  },
  treasury: {
    name: "Treasury",
    role: "Fee Recipient",
    pk: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
    address: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  },
};

// Well-known BNB mainnet addresses
export const MORPHO = "0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a";
export const IRM = "0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979";
export const USDT = "0x55d398326f99059fF775485246999027B3197955";
export const WHALE = "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3";

export const PREDICT_API_BASE = "https://api.predict.fun/v1";

// Real CTF contracts on BNB mainnet (used for reference in the UI)
export const CTF_STANDARD = "0x22DA1810B194ca018378464a58f6Ac2B10C9d244";
export const CTF_YIELD_BEARING = "0x9400F8Ad57e9e0F352345935d6D3175975eb1d9F";
