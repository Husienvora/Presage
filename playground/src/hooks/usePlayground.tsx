import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { JsonRpcProvider, Wallet, Contract, ethers, NonceManager } from "ethers";
import type { PlaygroundState, DeployedAddresses, Contracts, TxLogEntry, AccountRole, MarketInfo } from "../types";
import { RPC_URL, TEST_ACCOUNTS, MORPHO } from "../lib/constants";
import { PRESAGE_ABI, PRICE_HUB_ABI, MORPHO_ABI, ERC20_ABI, CTF_ABI, VAULT_FACTORY_ABI, VAULT_ABI } from "../lib/abis";

// ─── Context ──────────────────────────────────────────────────────────────
interface PlaygroundCtx extends PlaygroundState {
  connect: () => Promise<void>;
  setActiveRole: (role: AccountRole) => void;
  activeSigner: () => Wallet | null;
  signerFor: (role: AccountRole) => NonceManager | null;
  contractsFor: (role: AccountRole) => Contracts | null;
  logTx: (action: string, from: string, txOrFn: Promise<any> | (() => Promise<any>)) => Promise<any>;
  refreshBlock: () => Promise<void>;
  refreshMarkets: () => Promise<void>;
  warpTime: (seconds: number, onStatus?: (msg: string) => void) => Promise<void>;
  reseedPrices: (onStatus?: (msg: string) => void) => Promise<void>;
  mineBlock: () => Promise<void>;
  setVaultAddress: (addr: string) => void;
  getVaultContract: (role?: AccountRole) => Contract | null;
}

const Ctx = createContext<PlaygroundCtx>(null!);
export const usePlayground = () => useContext(Ctx);

// ─── Provider ─────────────────────────────────────────────────────────────
export function PlaygroundProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PlaygroundState>({
    provider: null,
    wallets: null,
    activeRole: "owner",
    addresses: null,
    contracts: null,
    blockNumber: 0,
    blockTimestamp: 0,
    txLog: [],
    isConnected: false,
    isSetup: false,
    vaultAddress: null,
    markets: [],
  });

  const txIdRef = useRef(0);
  const providerRef = useRef<JsonRpcProvider | null>(null);
  const walletsRef = useRef<Record<AccountRole, Wallet> | null>(null);
  const addressesRef = useRef<DeployedAddresses | null>(null);
  const managedSignersRef = useRef<Record<string, NonceManager>>({});

  // ── Connect to local Hardhat node ───────────────────────────────────
  const connect = useCallback(async () => {
    const provider = new JsonRpcProvider(RPC_URL);
    providerRef.current = provider;
    managedSignersRef.current = {};

    // Verify connection
    const network = await provider.getNetwork();
    const block = await provider.getBlock("latest");

    // Create wallets from well-known keys
    const wallets = {} as Record<AccountRole, Wallet>;
    for (const [role, acc] of Object.entries(TEST_ACCOUNTS)) {
      wallets[role as AccountRole] = new Wallet(acc.pk, provider);
    }
    walletsRef.current = wallets;

    // Try loading deployed addresses
    let addresses: DeployedAddresses | null = null;
    let contracts: Contracts | null = null;
    try {
      const res = await fetch("/deployed.json");
      if (res.ok) {
        addresses = await res.json();
        addressesRef.current = addresses;
        contracts = buildContracts(addresses!, wallets.owner);
      }
    } catch { /* not deployed yet */ }

    // Disable staleness check — playground uses time warps which invalidate it
    if (contracts) {
      try {
        const staleness = await contracts.priceHub.maxStaleness();
        if (Number(staleness) < 365 * 86400) {
          await (await contracts.priceHub.setStaleness(365 * 86400)).wait();
        }
      } catch { /* may fail if not owner */ }
    }

    // Load markets if setup
    let markets: MarketInfo[] = [];
    if (contracts) {
      markets = await loadMarkets(contracts.presage);
    }

    setState({
      provider,
      wallets,
      activeRole: "owner",
      addresses,
      contracts,
      blockNumber: block?.number || 0,
      blockTimestamp: block?.timestamp || 0,
      txLog: [],
      isConnected: true,
      isSetup: !!addresses,
      vaultAddress: null,
      markets,
    });
  }, []);

  // ── Build contract instances for a specific signer ──────────────────
  function getManagedSigner(signer: Wallet): NonceManager {
    const addr = signer.address;
    if (!managedSignersRef.current[addr]) {
      managedSignersRef.current[addr] = new NonceManager(signer);
    }
    return managedSignersRef.current[addr];
  }

  function resetAllNonces() {
    for (const nm of Object.values(managedSignersRef.current)) {
      nm.reset();
    }
  }

  function buildContracts(addrs: DeployedAddresses, signer: Wallet): Contracts {
    const managed = getManagedSigner(signer);
    return {
      presage: new Contract(addrs.presage, PRESAGE_ABI, managed),
      priceHub: new Contract(addrs.priceHub, PRICE_HUB_ABI, managed),
      mockCTF: new Contract(addrs.mockCTF, CTF_ABI, managed),
      usdt: new Contract(addrs.usdt, ERC20_ABI, managed),
      morpho: new Contract(addrs.morpho, MORPHO_ABI, managed),
      vaultFactory: new Contract(addrs.vaultFactory, VAULT_FACTORY_ABI, managed),
      vault: null,
    };
  }

  // ── Load markets from Presage ───────────────────────────────────────
  async function loadMarkets(presage: Contract): Promise<MarketInfo[]> {
    const markets: MarketInfo[] = [];
    try {
      const nextId = Number(await presage.nextMarketId());
      for (let i = 1; i < nextId; i++) {
        const m = await presage.getMarket(i);
        const mid = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "address", "address", "address", "uint256"],
            [m.morphoParams.loanToken, m.morphoParams.collateralToken, m.morphoParams.oracle, m.morphoParams.irm, m.morphoParams.lltv]
          )
        );
        markets.push({
          id: BigInt(i),
          morphoMarketId: mid,
          loanToken: m.morphoParams.loanToken,
          collateralToken: m.morphoParams.collateralToken,
          oracle: m.morphoParams.oracle,
          irm: m.morphoParams.irm,
          lltv: BigInt(m.morphoParams.lltv),
          positionId: BigInt(m.ctfPosition.positionId),
          oppositePositionId: BigInt(m.ctfPosition.oppositePositionId),
          resolutionAt: Number(m.resolutionAt),
        });
      }
    } catch { /* no markets yet */ }
    return markets;
  }

  // ── Switch active account ───────────────────────────────────────────
  const setActiveRole = useCallback((role: AccountRole) => {
    setState(s => {
      if (!s.wallets || !s.addresses) return { ...s, activeRole: role };
      const contracts = buildContracts(s.addresses, s.wallets[role]);
      return { ...s, activeRole: role, contracts };
    });
  }, []);

  const activeSigner = useCallback((): Wallet | null => {
    return walletsRef.current?.[state.activeRole] || null;
  }, [state.activeRole]);

  const signerFor = useCallback((role: AccountRole): NonceManager | null => {
    if (!walletsRef.current) return null;
    return getManagedSigner(walletsRef.current[role]);
  }, []);

  const contractsFor = useCallback((role: AccountRole): Contracts | null => {
    if (!walletsRef.current || !addressesRef.current) return null;
    return buildContracts(addressesRef.current, walletsRef.current[role]);
  }, []);

  // ── Transaction logger ──────────────────────────────────────────────
  // Accepts either a Promise (already-sent tx) or a function that returns one (deferred send).
  // Using a function is safer for sequential txs — it ensures the nonce is correct.
  const logTx = useCallback(async (action: string, from: string, txOrFn: Promise<any> | (() => Promise<any>)) => {
    const id = ++txIdRef.current;
    const entry: TxLogEntry = { id, timestamp: Date.now(), action, from, hash: "", status: "pending" };

    setState(s => ({ ...s, txLog: [entry, ...s.txLog].slice(0, 50) }));

    try {
      const tx = await (typeof txOrFn === "function" ? txOrFn() : txOrFn);
      const receipt = await tx.wait();
      setState(s => ({
        ...s,
        txLog: s.txLog.map(e => e.id === id ? { ...e, hash: receipt.hash, status: "success" as const } : e),
      }));
      return receipt;
    } catch (err: any) {
      // Reset all NonceManagers so next tx gets fresh nonce from chain
      resetAllNonces();
      setState(s => ({
        ...s,
        txLog: s.txLog.map(e => e.id === id ? { ...e, status: "error" as const, error: err.message?.slice(0, 100) } : e),
      }));
      throw err;
    }
  }, []);

  // ── Block info refresh ──────────────────────────────────────────────
  const refreshBlock = useCallback(async () => {
    if (!providerRef.current) return;
    const block = await providerRef.current.getBlock("latest");
    setState(s => ({
      ...s,
      blockNumber: block?.number || s.blockNumber,
      blockTimestamp: block?.timestamp || s.blockTimestamp,
    }));
  }, []);

  const refreshMarkets = useCallback(async () => {
    if (!state.contracts) return;
    const markets = await loadMarkets(state.contracts.presage);
    setState(s => ({ ...s, markets }));
  }, [state.contracts]);

  // ── Re-seed prices + accrue interest on all markets ─────────────────
  async function doReseedAndAccrue(log: (msg: string) => void) {
    if (!addressesRef.current || !walletsRef.current) { log("Not connected"); return; }
    const signer = getManagedSigner(walletsRef.current.owner);
    const presage = new Contract(addressesRef.current.presage, PRESAGE_ABI, signer);
    const priceHub = new Contract(addressesRef.current.priceHub, PRICE_HUB_ABI, signer);
    try {
      const nextId = Number(await presage.nextMarketId());
      const count = nextId - 1;
      if (count === 0) { log("No markets to update"); return; }
      for (let i = 1; i < nextId; i++) {
        log(`Re-seeding price for market ${i}/${count}...`);
        const m = await presage.getMarket(i);
        const posId = BigInt(m.ctfPosition.positionId);
        const pp = await priceHub.prices(posId);
        await (await priceHub.seedPrice(posId, pp.price)).wait();
        log(`Accruing interest for market ${i}/${count}...`);
        await (await presage.triggerAccrual(i)).wait();
      }
      log(`Done — ${count} market${count !== 1 ? "s" : ""} updated`);
    } catch (e: any) {
      resetAllNonces();
      log("Error: " + (e.message?.slice(0, 60) || "unknown"));
    }
  }

  // ── Time manipulation ───────────────────────────────────────────────
  const warpTime = useCallback(async (seconds: number, onStatus?: (msg: string) => void) => {
    if (!providerRef.current) return;
    const log = onStatus || (() => {});

    log("Advancing block time...");
    await providerRef.current.send("evm_increaseTime", [seconds]);
    await providerRef.current.send("evm_mine", []);
    await refreshBlock();
    log("Block mined");

    await doReseedAndAccrue(log);
  }, [refreshBlock]);

  const reseedPrices = useCallback(async (onStatus?: (msg: string) => void) => {
    const log = onStatus || (() => {});
    await doReseedAndAccrue(log);
  }, []);

  const mineBlock = useCallback(async () => {
    if (!providerRef.current) return;
    await providerRef.current.send("evm_mine", []);
    await refreshBlock();
  }, [refreshBlock]);

  // ── Vault address ───────────────────────────────────────────────────
  const setVaultAddress = useCallback((addr: string) => {
    setState(s => ({ ...s, vaultAddress: addr }));
  }, []);

  const getVaultContract = useCallback((role?: AccountRole): Contract | null => {
    const r = role || state.activeRole;
    if (!state.vaultAddress || !walletsRef.current) return null;
    return new Contract(state.vaultAddress, VAULT_ABI, getManagedSigner(walletsRef.current[r]));
  }, [state.vaultAddress, state.activeRole]);

  return (
    <Ctx.Provider value={{
      ...state,
      connect,
      setActiveRole,
      activeSigner,
      signerFor,
      contractsFor,
      logTx,
      refreshBlock,
      refreshMarkets,
      warpTime,
      reseedPrices,
      mineBlock,
      setVaultAddress,
      getVaultContract,
    }}>
      {children}
    </Ctx.Provider>
  );
}
