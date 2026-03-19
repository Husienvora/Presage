import { Contract, Wallet, JsonRpcProvider } from "ethers";

// ─── Hardhat Default Accounts (well-known test keys) ──────────────────────
export interface TestAccount {
  name: string;
  role: string;
  pk: string;
  address: string;
}

// ─── Deployed Addresses (written by playground-setup.ts) ──────────────────
export interface DeployedAddresses {
  presage: string;
  wrapperFactory: string;
  priceHub: string;
  fixedPriceAdapter: string;
  safeBatchHelper: string;
  mockCTF: string;
  vaultFactory: string;
  morpho: string;
  irm: string;
  usdt: string;
}

// ─── Contract Instances ───────────────────────────────────────────────────
export interface Contracts {
  presage: Contract;
  priceHub: Contract;
  mockCTF: Contract;
  usdt: Contract;
  morpho: Contract;
  vaultFactory: Contract;
  vault: Contract | null;
}

// ─── Market Info ──────────────────────────────────────────────────────────
export interface MarketInfo {
  id: bigint;
  morphoMarketId: string;
  loanToken: string;
  collateralToken: string;
  oracle: string;
  irm: string;
  lltv: bigint;
  positionId: bigint;
  oppositePositionId: bigint;
  resolutionAt: number;
}

// ─── Transaction Log ──────────────────────────────────────────────────────
export interface TxLogEntry {
  id: number;
  timestamp: number;
  action: string;
  from: string;
  hash: string;
  status: "pending" | "success" | "error";
  error?: string;
}

// ─── Predict.fun API types ────────────────────────────────────────────────
export interface PredictMarket {
  id: number;
  title: string;
  conditionId: string;
  outcomes: { name: string; onChainId: string }[];
  isNegRisk: boolean;
  isYieldBearing: boolean;
}

export interface PredictCategory {
  title: string;
  slug: string;
  endsAt: string;
  status: string;
  isNegRisk: boolean;
  isYieldBearing: boolean;
  markets: PredictMarket[];
}

// ─── Module Registry (for extensibility) ──────────────────────────────────
export interface PlaygroundModule {
  id: string;
  name: string;
  icon: string;
  description: string;
  requiresSetup: boolean;
}

// ─── Playground State ─────────────────────────────────────────────────────
export type AccountRole = "owner" | "alice" | "bob" | "liquidator" | "curator" | "allocator" | "treasury";

export interface PlaygroundState {
  provider: JsonRpcProvider | null;
  wallets: Record<AccountRole, Wallet> | null;
  activeRole: AccountRole;
  addresses: DeployedAddresses | null;
  contracts: Contracts | null;
  blockNumber: number;
  blockTimestamp: number;
  txLog: TxLogEntry[];
  isConnected: boolean;
  isSetup: boolean;
  vaultAddress: string | null;
  markets: MarketInfo[];
}
