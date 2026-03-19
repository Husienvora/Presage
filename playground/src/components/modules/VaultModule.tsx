import { useState, useEffect } from "react";
import { parseEther, formatEther, ethers, Contract } from "ethers";
import { usePlayground } from "../../hooks/usePlayground";
import { USDT } from "../../lib/constants";

export function VaultModule() {
  const pg = usePlayground();
  const [vaultData, setVaultData] = useState<any>(null);
  const [depositAmt, setDepositAmt] = useState("3000");
  const [redeemPct, setRedeemPct] = useState("25");
  const [capAmount, setCapAmount] = useState("10000");
  const [capMarketId, setCapMarketId] = useState("");
  const [timelock] = useState(86400);
  const [allocations, setAllocations] = useState<any[]>([]);

  // Auto-select first market for cap
  useEffect(() => {
    if (pg.markets.length > 0 && !capMarketId) {
      setCapMarketId(pg.markets[0].id.toString());
    }
  }, [pg.markets]);

  // ── Deploy Vault ────────────────────────────────────────────────────
  async function deployVault() {
    if (!pg.contracts || !pg.wallets) return;
    const ownerContracts = pg.contractsFor("owner")!;
    const salt = ethers.keccak256(ethers.toUtf8Bytes("presage-playground-vault-" + Date.now()));

    const receipt = await pg.logTx("Deploy MetaMorpho vault", "owner",
      () => ownerContracts.vaultFactory.createMetaMorpho(
        pg.wallets!.owner.address, timelock, USDT, "Presage USDT Vault", "pUSDT", salt
      )
    );

    // Find vault address from event
    const iface = ownerContracts.vaultFactory.interface;
    const event = receipt.logs
      .map((log: any) => { try { return iface.parseLog(log); } catch { return null; } })
      .find((e: any) => e?.name === "CreateMetaMorpho");

    if (!event) throw new Error("Vault creation event not found");
    const vaultAddr = event.args[0];
    pg.setVaultAddress(vaultAddr);

    const { VAULT_ABI } = await import("../../lib/abis");
    const vaultContract = new Contract(vaultAddr, VAULT_ABI, pg.signerFor("owner")!);
    await pg.logTx("Set curator → Curator", "owner", () => vaultContract.setCurator(pg.wallets!.curator.address));
    await pg.logTx("Set allocator → Allocator", "owner", () => vaultContract.setIsAllocator(pg.wallets!.allocator.address, true));
    await pg.logTx("Set fee recipient → Treasury", "owner", () => vaultContract.setFeeRecipient(pg.wallets!.treasury.address));
    await pg.logTx("Set 10% performance fee", "owner", () => vaultContract.setFee(parseEther("0.1")));

    await refreshVault(vaultAddr);
  }

  // ── Submit & Accept Cap ─────────────────────────────────────────────
  async function submitCap() {
    if (!pg.vaultAddress || !pg.contracts || !capMarketId) return;
    const market = await pg.contracts.presage.getMarket(BigInt(capMarketId));
    const mp = [market.morphoParams.loanToken, market.morphoParams.collateralToken, market.morphoParams.oracle, market.morphoParams.irm, market.morphoParams.lltv];

    const { VAULT_ABI } = await import("../../lib/abis");
    const curatorVault = new Contract(pg.vaultAddress, VAULT_ABI, pg.signerFor("curator")!);
    await pg.logTx(`Submit cap ${capAmount} USDT for market #${capMarketId}`, "curator",
      () => curatorVault.submitCap(mp, parseEther(capAmount))
    );
  }

  async function acceptCap() {
    if (!pg.vaultAddress || !pg.contracts || !capMarketId) return;
    const market = await pg.contracts.presage.getMarket(BigInt(capMarketId));
    const mp = [market.morphoParams.loanToken, market.morphoParams.collateralToken, market.morphoParams.oracle, market.morphoParams.irm, market.morphoParams.lltv];

    // Fast-forward past timelock
    await pg.warpTime(timelock + 1);

    const { VAULT_ABI } = await import("../../lib/abis");
    const ownerVault = new Contract(pg.vaultAddress, VAULT_ABI, pg.signerFor("owner")!);
    await pg.logTx(`Accept cap for market #${capMarketId}`, "owner", () => ownerVault.acceptCap(mp));
    await refreshVault();
  }

  // ── Set Supply Queue ────────────────────────────────────────────────
  async function setSupplyQueue() {
    if (!pg.vaultAddress) return;
    const { VAULT_ABI } = await import("../../lib/abis");
    const vault = new Contract(pg.vaultAddress, VAULT_ABI, pg.provider!);

    // Only include markets that have accepted caps (cap > 0)
    const enabledIds: string[] = [];
    for (const m of pg.markets) {
      try {
        const cfg = await vault.config(m.morphoMarketId);
        if (BigInt(cfg.cap) > 0n) {
          enabledIds.push(m.morphoMarketId);
        }
      } catch { /* skip */ }
    }

    if (enabledIds.length === 0) {
      alert("No markets have accepted caps yet. Submit and accept caps first (Steps 2 & 3).");
      return;
    }

    const allocatorVault = new Contract(pg.vaultAddress, VAULT_ABI, pg.signerFor("allocator")!);
    await pg.logTx(`Set supply queue (${enabledIds.length} markets with caps)`, "allocator",
      () => allocatorVault.setSupplyQueue(enabledIds)
    );
    await refreshVault();
  }

  // ── LP Deposit ──────────────────────────────────────────────────────
  async function lpDeposit() {
    if (!pg.vaultAddress || !pg.contracts) return;
    const { ERC20_ABI, VAULT_ABI } = await import("../../lib/abis");
    const aliceUsdt = new Contract(USDT, ERC20_ABI, pg.signerFor("alice")!);
    await pg.logTx("Approve USDT for vault", "alice", () => aliceUsdt.approve(pg.vaultAddress!, parseEther(depositAmt)));

    const aliceVault = new Contract(pg.vaultAddress, VAULT_ABI, pg.signerFor("alice")!);
    await pg.logTx(`Deposit ${depositAmt} USDT`, "alice", () => aliceVault.deposit(parseEther(depositAmt), pg.wallets!.alice.address));
    await refreshVault();
  }

  // ── LP Redeem ───────────────────────────────────────────────────────
  async function lpRedeem() {
    if (!pg.vaultAddress) return;
    const { VAULT_ABI } = await import("../../lib/abis");
    const aliceVault = new Contract(pg.vaultAddress, VAULT_ABI, pg.signerFor("alice")!);
    const totalShares = await aliceVault.balanceOf(pg.wallets!.alice.address);
    const redeemShares = totalShares * BigInt(redeemPct) / 100n;

    await pg.logTx(`Redeem ${redeemPct}% shares`, "alice",
      () => aliceVault.redeem(redeemShares, pg.wallets!.alice.address, pg.wallets!.alice.address)
    );
    await refreshVault();
  }

  // ── Reallocate ──────────────────────────────────────────────────────
  async function reallocateEvenly() {
    if (!pg.vaultAddress || !pg.contracts) return;
    const { VAULT_ABI } = await import("../../lib/abis");
    const vault = new Contract(pg.vaultAddress, VAULT_ABI, pg.provider!);

    // Only reallocate to markets with accepted caps
    const marketParams = [];
    for (const m of pg.markets) {
      try {
        const cfg = await vault.config(m.morphoMarketId);
        if (BigInt(cfg.cap) > 0n) {
          const market = await pg.contracts.presage.getMarket(m.id);
          marketParams.push([market.morphoParams.loanToken, market.morphoParams.collateralToken, market.morphoParams.oracle, market.morphoParams.irm, market.morphoParams.lltv]);
        }
      } catch { /* skip */ }
    }

    if (marketParams.length === 0) {
      alert("No markets have accepted caps. Submit and accept caps first.");
      return;
    }

    const allocatorVault = new Contract(pg.vaultAddress, VAULT_ABI, pg.signerFor("allocator")!);
    const totalAssets = await allocatorVault.totalAssets();
    const perMarket = totalAssets / BigInt(marketParams.length);

    // Withdrawals first (from current positions), then supplies
    // For a simple even split: just supply to each, last one sweeps remainder
    const allocs = marketParams.map((mp, i) => ({
      marketParams: mp,
      assets: i === marketParams.length - 1 ? ethers.MaxUint256 : perMarket,
    }));

    await pg.logTx(`Reallocate evenly (${marketParams.length} markets)`, "allocator",
      () => allocatorVault.reallocate(allocs)
    );
    await refreshVault();
  }

  // ── Refresh ─────────────────────────────────────────────────────────
  async function refreshVault(addr?: string) {
    const vaultAddr = addr || pg.vaultAddress;
    if (!vaultAddr || !pg.contracts) return;

    const { VAULT_ABI } = await import("../../lib/abis");
    const vault = new Contract(vaultAddr, VAULT_ABI, pg.provider!);

    const [name, symbol, totalAssets, totalSupply, fee, curator, tl, wqLen, sqLen] = await Promise.all([
      vault.name(), vault.symbol(), vault.totalAssets(), vault.totalSupply(),
      vault.fee(), vault.curator(), vault.timelock(),
      vault.withdrawQueueLength(), vault.supplyQueueLength(),
    ]);

    const allocs = [];
    for (let i = 0; i < Number(wqLen); i++) {
      const mid = await vault.withdrawQueue(i);
      const cfg = await vault.config(mid);
      const pos = await pg.contracts.morpho.position(mid, vaultAddr);
      const mkt = await pg.contracts.morpho.market(mid);
      const supply = BigInt(mkt.totalSupplyShares) > 0n
        ? (BigInt(pos.supplyShares) * BigInt(mkt.totalSupplyAssets)) / BigInt(mkt.totalSupplyShares)
        : 0n;
      allocs.push({
        marketId: mid.slice(0, 10) + "...",
        cap: formatEther(BigInt(cfg.cap)),
        enabled: cfg.enabled,
        supply: formatEther(supply),
      });
    }

    const aliceShares = await vault.balanceOf(pg.wallets!.alice.address);
    const treasuryShares = await vault.balanceOf(pg.wallets!.treasury.address);

    setVaultData({
      address: vaultAddr, name, symbol,
      totalAssets: formatEther(totalAssets),
      totalSupply: formatEther(totalSupply),
      fee: (Number(fee) / 1e18 * 100).toFixed(1),
      curator,
      timelock: Number(tl),
      wqLen: Number(wqLen),
      sqLen: Number(sqLen),
      aliceShares: formatEther(aliceShares),
      treasuryShares: formatEther(treasuryShares),
    });
    setAllocations(allocs);
  }

  return (
    <div className="module">
      <h2>MetaMorpho Vault</h2>

      <div className="guide-box">
        <h4>Vault Lifecycle</h4>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
          A MetaMorpho vault pools USDT from LPs and supplies it across Presage markets.
          Each step below auto-runs as the correct role — you don't need to switch accounts.
        </p>
        <ol>
          <li><strong>Deploy Vault</strong> <span className="muted">(as Owner)</span> — creates vault, sets Curator, Allocator, Treasury, and 10% fee</li>
          <li><strong>Submit Cap</strong> <span className="muted">(as Curator)</span> — proposes max USDT the vault can supply to a market</li>
          <li><strong>Accept Cap</strong> <span className="muted">(as Owner)</span> — approves the cap after a 24h timelock (auto-warped)</li>
          <li><strong>Set Supply Queue</strong> <span className="muted">(as Allocator)</span> — tells the vault which markets to route deposits into</li>
          <li><strong>LP Deposit</strong> <span className="muted">(as Alice)</span> — deposits USDT, receives vault shares</li>
          <li><strong>Reallocate</strong> <span className="muted">(as Allocator)</span> — spreads vault USDT across markets</li>
          <li>Go to Borrow tab → borrow from a market with vault supply</li>
          <li>Warp time → vault earns interest → Treasury accrues fee shares</li>
        </ol>
      </div>

      {!pg.vaultAddress ? (
        <div className="card">
          <h3>Step 1 — Deploy Vault</h3>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
            Creates a MetaMorpho ERC-4626 vault. Automatically assigns:<br />
            <strong>Curator</strong> = Curator account, <strong>Allocator</strong> = Allocator account,
            <strong> Fee Recipient</strong> = Treasury, <strong>Fee</strong> = 10%.
          </p>
          <button className="btn primary" onClick={deployVault}>Deploy Vault (as Owner)</button>
        </div>
      ) : (
        <>
          {/* Vault Info */}
          <div className="card">
            <h3>Vault Info</h3>
            {vaultData ? (
              <div className="stat-grid">
                <div className="stat"><span className="stat-label">Address</span><span className="stat-value mono">{vaultData.address.slice(0, 20)}...</span></div>
                <div className="stat"><span className="stat-label">Name</span><span className="stat-value">{vaultData.name} ({vaultData.symbol})</span></div>
                <div className="stat"><span className="stat-label">Total Assets</span><span className="stat-value">{Number(vaultData.totalAssets).toFixed(2)} USDT</span></div>
                <div className="stat"><span className="stat-label">Total Shares</span><span className="stat-value">{Number(vaultData.totalSupply).toFixed(2)}</span></div>
                <div className="stat"><span className="stat-label">Fee</span><span className="stat-value">{vaultData.fee}%</span></div>
                <div className="stat"><span className="stat-label">Alice Shares</span><span className="stat-value">{Number(vaultData.aliceShares).toFixed(4)}</span></div>
                <div className="stat"><span className="stat-label">Treasury Shares</span><span className="stat-value">{Number(vaultData.treasuryShares).toFixed(6)}</span></div>
                <div className="stat"><span className="stat-label">Supply Queue</span><span className="stat-value">{vaultData.sqLen} markets</span></div>
                <div className="stat"><span className="stat-label">Withdraw Queue</span><span className="stat-value">{vaultData.wqLen} markets</span></div>
              </div>
            ) : (
              <button className="btn" onClick={() => refreshVault()}>Refresh</button>
            )}
          </div>

          {/* Market Allocations */}
          {allocations.length > 0 && (
            <div className="card">
              <h3>Market Allocations</h3>
              <table className="data-table">
                <thead>
                  <tr><th>Market</th><th>Cap</th><th>Supply</th><th>Enabled</th></tr>
                </thead>
                <tbody>
                  {allocations.map((a, i) => (
                    <tr key={i}>
                      <td className="mono">{a.marketId}</td>
                      <td>{Number(a.cap).toFixed(0)}</td>
                      <td>{Number(a.supply).toFixed(2)}</td>
                      <td>{a.enabled ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Cap Governance */}
          <div className="card">
            <h3>Step 2 & 3 — Cap Governance</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
              The <strong>cap</strong> limits how much USDT the vault can supply to a specific market.
              Curator proposes it, Owner accepts after a 24h timelock (auto-warped here).
            </p>
            <div className="form-row">
              <select value={capMarketId} onChange={e => setCapMarketId(e.target.value)} style={{ flex: 1 }}>
                {pg.markets.map(m => (
                  <option key={m.id.toString()} value={m.id.toString()}>
                    Market #{m.id.toString()} — LLTV {(Number(m.lltv) / 1e18 * 100).toFixed(0)}%
                  </option>
                ))}
              </select>
              <input placeholder="Cap (USDT)" value={capAmount} onChange={e => setCapAmount(e.target.value)} style={{ width: "6rem" }} />
            </div>
            <div className="btn-row" style={{ marginTop: "0.5rem" }}>
              <button className="btn" onClick={submitCap}>Submit Cap (Curator)</button>
              <button className="btn primary" onClick={acceptCap}>Accept Cap (Owner, warps 24h)</button>
            </div>
          </div>

          {/* Queue & Allocation */}
          <div className="card">
            <h3>Step 4 & 6 — Queue & Allocation</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
              <strong>Supply queue</strong> = which markets receive deposits. <strong>Reallocate</strong> = move funds across markets.
            </p>
            <div className="btn-row">
              <button className="btn" onClick={setSupplyQueue}>Set Supply Queue (Allocator)</button>
              <button className="btn primary" onClick={reallocateEvenly}>Reallocate Evenly (Allocator)</button>
            </div>
          </div>

          {/* LP Operations */}
          <div className="card">
            <h3>Step 5 — LP Operations (Alice)</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
              Alice deposits USDT into the vault, receives pUSDT shares. Her yield comes from Presage borrowers.
            </p>
            <div className="form-row">
              <input placeholder="USDT amount" value={depositAmt} onChange={e => setDepositAmt(e.target.value)} />
              <button className="btn primary" onClick={lpDeposit}>Deposit (Alice)</button>
            </div>
            <div className="form-row">
              <input placeholder="% to redeem" value={redeemPct} onChange={e => setRedeemPct(e.target.value)} />
              <button className="btn" onClick={lpRedeem}>Redeem {redeemPct}% (Alice)</button>
            </div>
          </div>

          <div className="card">
            <button className="btn" onClick={() => refreshVault()} style={{ width: "100%" }}>Refresh Vault Data</button>
          </div>
        </>
      )}
    </div>
  );
}
