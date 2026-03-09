import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { BrowserProvider, JsonRpcSigner, Contract, ethers } from "ethers";
import {
  PRESAGE_ABI,
  PRICEHUB_ABI,
  MORPHO_ABI,
  ERC20_ABI,
  CTF_ABI,
  WRAPPER_FACTORY_ABI,
} from "../abis";

// BNB Chain mainnet
const BNB_CHAIN_ID = 56;
const BNB_CHAIN_HEX = "0x38";

export interface Addresses {
  presage: string;
  factory: string;
  priceHub: string;
  morpho: string;
  loanToken: string; // USDT
  ctf: string; // CTF contract (ERC1155)
}

const STORAGE_KEY = "presage_addresses";
const DEFAULT_ADDRESSES: Addresses = {
  presage: "",
  factory: "",
  priceHub: "",
  morpho: "0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a",
  loanToken: "0x55d398326f99059fF775485246999027B3197955",
  ctf: "",
};

export interface MarketInfo {
  id: number;
  morphoParams: {
    loanToken: string;
    collateralToken: string;
    oracle: string;
    irm: string;
    lltv: bigint;
  };
  ctfPosition: {
    ctf: string;
    parentCollectionId: string;
    conditionId: string;
    positionId: bigint;
    oppositePositionId: bigint;
  };
  resolutionAt: bigint;
}

export interface UserPosition {
  supplyAssets: bigint;
  borrowAssets: bigint;
  collateralAssets: bigint;
  supplyShares: bigint;
  borrowShares: bigint;
  healthFactor: bigint;
}

export interface MarketTotals {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
}

interface PresageContextType {
  // Connection
  account: string | null;
  chainId: number | null;
  isCorrectChain: boolean;
  connect: () => Promise<void>;
  switchChain: () => Promise<void>;

  // Addresses
  addresses: Addresses;
  setAddresses: (a: Addresses) => void;
  isConfigured: boolean;

  // Contracts
  presage: Contract | null;
  priceHub: Contract | null;
  morpho: Contract | null;
  factory: Contract | null;
  loanToken: Contract | null;
  ctfContract: Contract | null;

  // Data fetching
  fetchMarket: (marketId: number) => Promise<MarketInfo>;
  fetchUserPosition: (marketId: number, user: string) => Promise<UserPosition>;
  fetchMarketTotals: (marketId: number) => Promise<MarketTotals>;
  getMorphoMarketId: (morphoParams: MarketInfo["morphoParams"]) => string;

  // Tx state
  txPending: boolean;
  setTxPending: (v: boolean) => void;
  lastTxHash: string | null;
  setLastTxHash: (h: string | null) => void;
}

const PresageContext = createContext<PresageContextType>(null!);

export function usePresage() {
  return useContext(PresageContext);
}

export function PresageProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [txPending, setTxPending] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const [addresses, setAddressesRaw] = useState<Addresses>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...DEFAULT_ADDRESSES, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_ADDRESSES;
  });

  const setAddresses = useCallback((a: Addresses) => {
    setAddressesRaw(a);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
  }, []);

  const isCorrectChain = chainId === BNB_CHAIN_ID;
  const isConfigured =
    !!addresses.presage &&
    !!addresses.factory &&
    !!addresses.priceHub &&
    !!addresses.morpho &&
    !!addresses.loanToken;

  // Build contracts from addresses + signer
  const presage =
    signer && addresses.presage
      ? new Contract(addresses.presage, PRESAGE_ABI, signer)
      : null;
  const priceHub =
    signer && addresses.priceHub
      ? new Contract(addresses.priceHub, PRICEHUB_ABI, signer)
      : null;
  const morpho =
    signer && addresses.morpho
      ? new Contract(addresses.morpho, MORPHO_ABI, signer)
      : null;
  const factory =
    signer && addresses.factory
      ? new Contract(addresses.factory, WRAPPER_FACTORY_ABI, signer)
      : null;
  const loanToken =
    signer && addresses.loanToken
      ? new Contract(addresses.loanToken, ERC20_ABI, signer)
      : null;
  const ctfContract =
    signer && addresses.ctf
      ? new Contract(addresses.ctf, CTF_ABI, signer)
      : null;

  const connect = useCallback(async () => {
    if (!(window as any).ethereum) {
      alert("MetaMask not found. Please install MetaMask.");
      return;
    }
    const p = new BrowserProvider((window as any).ethereum);
    const s = await p.getSigner();
    const network = await p.getNetwork();
    setProvider(p);
    setSigner(s);
    setAccount(await s.getAddress());
    setChainId(Number(network.chainId));
  }, []);

  const switchChain = useCallback(async () => {
    try {
      await (window as any).ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BNB_CHAIN_HEX }],
      });
      // Reconnect after chain switch
      await connect();
    } catch (err: any) {
      if (err.code === 4902) {
        await (window as any).ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: BNB_CHAIN_HEX,
              chainName: "BNB Smart Chain",
              nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
              rpcUrls: ["https://bsc-dataseed1.binance.org/"],
              blockExplorerUrls: ["https://bscscan.com"],
            },
          ],
        });
        await connect();
      }
    }
  }, [connect]);

  // Listen for account/chain changes
  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth) return;
    const handleAccounts = (accounts: string[]) => {
      if (accounts.length === 0) {
        setAccount(null);
        setSigner(null);
      } else {
        connect();
      }
    };
    const handleChain = (chainIdHex: string) => {
      setChainId(parseInt(chainIdHex, 16));
      connect();
    };
    eth.on("accountsChanged", handleAccounts);
    eth.on("chainChanged", handleChain);
    return () => {
      eth.removeListener("accountsChanged", handleAccounts);
      eth.removeListener("chainChanged", handleChain);
    };
  }, [connect]);

  // Helpers

  const getMorphoMarketId = useCallback(
    (mp: MarketInfo["morphoParams"]): string => {
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "address", "uint256"],
        [mp.loanToken, mp.collateralToken, mp.oracle, mp.irm, mp.lltv]
      );
      return ethers.keccak256(encoded);
    },
    []
  );

  const fetchMarket = useCallback(
    async (marketId: number): Promise<MarketInfo> => {
      if (!presage) throw new Error("Presage not connected");
      const m = await presage.getMarket(marketId);
      return {
        id: marketId,
        morphoParams: {
          loanToken: m.morphoParams.loanToken,
          collateralToken: m.morphoParams.collateralToken,
          oracle: m.morphoParams.oracle,
          irm: m.morphoParams.irm,
          lltv: m.morphoParams.lltv,
        },
        ctfPosition: {
          ctf: m.ctfPosition.ctf,
          parentCollectionId: m.ctfPosition.parentCollectionId,
          conditionId: m.ctfPosition.conditionId,
          positionId: m.ctfPosition.positionId,
          oppositePositionId: m.ctfPosition.oppositePositionId,
        },
        resolutionAt: m.resolutionAt,
      };
    },
    [presage]
  );

  const fetchMarketTotals = useCallback(
    async (marketId: number): Promise<MarketTotals> => {
      if (!presage || !morpho) throw new Error("Not connected");
      const m = await presage.getMarket(marketId);
      const mId = getMorphoMarketId(m.morphoParams);
      const mk = await morpho.market(mId);
      return {
        totalSupplyAssets: mk.totalSupplyAssets,
        totalSupplyShares: mk.totalSupplyShares,
        totalBorrowAssets: mk.totalBorrowAssets,
        totalBorrowShares: mk.totalBorrowShares,
        lastUpdate: mk.lastUpdate,
        fee: mk.fee,
      };
    },
    [presage, morpho, getMorphoMarketId]
  );

  const fetchUserPosition = useCallback(
    async (marketId: number, user: string): Promise<UserPosition> => {
      if (!presage || !morpho) throw new Error("Not connected");
      const m = await presage.getMarket(marketId);
      const mId = getMorphoMarketId(m.morphoParams);

      const [pos, mk] = await Promise.all([
        morpho.position(mId, user),
        morpho.market(mId),
      ]);

      const supplyAssets =
        mk.totalSupplyShares > 0n
          ? (BigInt(pos.supplyShares) * BigInt(mk.totalSupplyAssets)) /
            BigInt(mk.totalSupplyShares)
          : 0n;

      const borrowAssets =
        mk.totalBorrowShares > 0n
          ? (BigInt(pos.borrowShares) * BigInt(mk.totalBorrowAssets)) /
            BigInt(mk.totalBorrowShares)
          : 0n;

      let healthFactor = ethers.MaxUint256;
      try {
        healthFactor = await presage.healthFactor(marketId, user);
      } catch {}

      return {
        supplyAssets,
        borrowAssets,
        collateralAssets: BigInt(pos.collateral),
        supplyShares: BigInt(pos.supplyShares),
        borrowShares: BigInt(pos.borrowShares),
        healthFactor,
      };
    },
    [presage, morpho, getMorphoMarketId]
  );

  return (
    <PresageContext.Provider
      value={{
        account,
        chainId,
        isCorrectChain,
        connect,
        switchChain,
        addresses,
        setAddresses,
        isConfigured,
        presage,
        priceHub,
        morpho,
        factory,
        loanToken,
        ctfContract,
        fetchMarket,
        fetchUserPosition,
        fetchMarketTotals,
        getMorphoMarketId,
        txPending,
        setTxPending,
        lastTxHash,
        setLastTxHash,
      }}
    >
      {children}
    </PresageContext.Provider>
  );
}
