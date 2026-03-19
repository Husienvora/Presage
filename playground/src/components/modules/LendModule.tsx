import { useState, useEffect } from "react";
import { parseEther, formatEther } from "ethers";
import { usePlayground } from "../../hooks/usePlayground";

export function LendModule() {
  const pg = usePlayground();
  const [marketId, setMarketId] = useState("");
  const [supplyAmount, setSupplyAmount] = useState("1000");
  const [withdrawAmount, setWithdrawAmount] = useState("500");
  const [position, setPosition] = useState<any>(null);
  const [marketData, setMarketData] = useState<any>(null);
  const [usdtBal, setUsdtBal] = useState<string>("");

  // Auto-select first market
  useEffect(() => {
    if (pg.markets.length > 0 && !marketId) {
      setMarketId(pg.markets[0].id.toString());
    }
  }, [pg.markets]);

  async function refresh() {
    if (!pg.contracts || !pg.wallets || !marketId) return;
    const signer = pg.wallets[pg.activeRole];
    const mid = BigInt(marketId);

    const market = await pg.contracts.presage.getMarket(mid);
    const posId = BigInt(market.ctfPosition.positionId);

    // 1. Ensure price is fresh — reseed if stale (must happen before accrueInterest)
    try {
      await pg.contracts.priceHub.morphoPrice(posId);
    } catch {
      try {
        const ownerContracts = pg.contractsFor("owner")!;
        await (await ownerContracts.priceHub.setStaleness(365 * 86400)).wait();
        const pp = await pg.contracts.priceHub.prices(posId);
        await (await ownerContracts.priceHub.seedPrice(posId, pp.price)).wait();
      } catch { /* still failing */ }
    }

    // 2. Accrue interest (only works when oracle is fresh)
    try {
      const mp = market.morphoParams;
      const ownerContracts = pg.contractsFor("owner")!;
      await (await ownerContracts.morpho.accrueInterest([mp.loanToken, mp.collateralToken, mp.oracle, mp.irm, mp.lltv])).wait();
    } catch { /* may fail if no interest model */ }

    const { ethers } = await import("ethers");
    const morphoId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "address", "uint256"],
        [market.morphoParams.loanToken, market.morphoParams.collateralToken, market.morphoParams.oracle, market.morphoParams.irm, market.morphoParams.lltv]
      )
    );

    const pos = await pg.contracts.morpho.position(morphoId, signer.address);
    const mkt = await pg.contracts.morpho.market(morphoId);
    const bal = await pg.contracts.usdt.balanceOf(signer.address);

    const supplyAssets = BigInt(mkt.totalSupplyShares) > 0n
      ? (BigInt(pos.supplyShares) * BigInt(mkt.totalSupplyAssets)) / BigInt(mkt.totalSupplyShares)
      : 0n;
    const utilization = BigInt(mkt.totalSupplyAssets) > 0n
      ? Number(BigInt(mkt.totalBorrowAssets) * 10000n / BigInt(mkt.totalSupplyAssets)) / 100
      : 0;

    setPosition({ supplyAssets: formatEther(supplyAssets) });
    setMarketData({
      totalSupply: formatEther(mkt.totalSupplyAssets),
      totalBorrow: formatEther(mkt.totalBorrowAssets),
      utilization: utilization.toFixed(2),
    });
    setUsdtBal(formatEther(bal));
  }

  async function approve() {
    if (!pg.contracts) return;
    await pg.logTx("Approve USDT for Presage", pg.activeRole,
      () => pg.contracts!.usdt.approve(pg.addresses!.presage, parseEther("1000000"))
    );
  }

  async function supply() {
    if (!pg.contracts) return;
    await pg.logTx(`Supply ${supplyAmount} USDT to market #${marketId}`, pg.activeRole,
      () => pg.contracts!.presage.supply(BigInt(marketId), parseEther(supplyAmount))
    );
    await refresh();
  }

  async function withdraw() {
    if (!pg.contracts) return;
    await pg.logTx(`Withdraw ${withdrawAmount} USDT from market #${marketId}`, pg.activeRole,
      () => pg.contracts!.presage.withdraw(BigInt(marketId), parseEther(withdrawAmount))
    );
    await refresh();
  }

  const selectedMarket = pg.markets.find(m => m.id.toString() === marketId);

  return (
    <div className="module">
      <h2>Lend (Supply USDT)</h2>

      <div className="guide-box">
        <h4>Guide</h4>
        <ol>
          <li>Switch to <strong>Alice</strong> (Lender) in the sidebar</li>
          <li>Select a market from the dropdown, click <strong>Refresh</strong></li>
          <li>Click <strong>Approve USDT</strong>, then <strong>Supply</strong></li>
          <li>Try withdrawing some of your supply</li>
        </ol>
      </div>

      {pg.activeRole !== "alice" && (
        <div className="card" style={{ borderColor: "var(--fire-start)", background: "rgba(255,69,0,0.08)" }}>
          <p style={{ color: "var(--fire-mid)", margin: 0 }}>
            You're on <strong>{pg.activeRole}</strong>. Switch to <strong>Alice</strong> (Lender) — she has USDT to supply.
          </p>
        </div>
      )}

      {pg.markets.length === 0 ? (
        <div className="card">
          <p className="muted">No markets created yet. Go to the Markets tab first.</p>
        </div>
      ) : (
        <>
          <div className="card">
            <h3>Select Market</h3>
            <div className="form-row">
              <select value={marketId} onChange={e => { setMarketId(e.target.value); setPosition(null); setMarketData(null); }} style={{ flex: 1 }}>
                {pg.markets.map(m => (
                  <option key={m.id.toString()} value={m.id.toString()}>
                    Market #{m.id.toString()} — LLTV {(Number(m.lltv) / 1e18 * 100).toFixed(0)}% — Res {new Date(m.resolutionAt * 1000).toLocaleDateString()}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={refresh}>Refresh</button>
            </div>

            {selectedMarket && (
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.5rem", fontFamily: "var(--mono)" }}>
                Position: {selectedMarket.positionId.toString().slice(0, 20)}...
              </div>
            )}

            {usdtBal && (
              <div className="stat-grid">
                <div className="stat"><span className="stat-label">USDT Balance</span><span className="stat-value">{Number(usdtBal).toFixed(2)}</span></div>
                {position && (
                  <div className="stat"><span className="stat-label">Your Supply</span><span className="stat-value">{Number(position.supplyAssets).toFixed(4)}</span></div>
                )}
                {marketData && <>
                  <div className="stat"><span className="stat-label">Total Supply</span><span className="stat-value">{Number(marketData.totalSupply).toFixed(2)}</span></div>
                  <div className="stat"><span className="stat-label">Total Borrow</span><span className="stat-value">{Number(marketData.totalBorrow).toFixed(2)}</span></div>
                  <div className="stat"><span className="stat-label">Utilization</span><span className="stat-value">{marketData.utilization}%</span></div>
                </>}
              </div>
            )}
          </div>

          <div className="card">
            <h3>Actions</h3>
            <button className="btn" onClick={approve}>Approve USDT</button>

            <div className="form-row" style={{ marginTop: "1rem" }}>
              <input placeholder="Amount" value={supplyAmount} onChange={e => setSupplyAmount(e.target.value)} />
              <button className="btn primary" onClick={supply}>Supply</button>
            </div>

            <div className="form-row" style={{ marginTop: "0.5rem" }}>
              <input placeholder="Amount" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} />
              <button className="btn" onClick={withdraw}>Withdraw</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
