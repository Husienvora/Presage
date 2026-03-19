import { useState, useEffect } from "react";
import { parseEther, formatEther, ethers } from "ethers";
import { usePlayground } from "../../hooks/usePlayground";

export function BorrowModule() {
  const pg = usePlayground();
  const [marketId, setMarketId] = useState("");
  const [depositAmt, setDepositAmt] = useState("100");
  const [borrowAmt, setBorrowAmt] = useState("30");
  const [repayAmt, setRepayAmt] = useState("10");
  const [releaseAmt, setReleaseAmt] = useState("50");
  const [data, setData] = useState<any>(null);

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

    // 1. Ensure price is fresh — reseed if stale, then accrue interest
    let effectivePrice = "0";
    let priceStatus: "ok" | "stale" | "decayed" = "ok";
    const priceData = await pg.contracts.priceHub.prices(posId);
    const decayFactor = await pg.contracts.priceHub.decayFactor(posId);
    const decayPct = Number(decayFactor) / 1e18;

    // Try morphoPrice — if it reverts, price is stale
    let morphoPriceOk = false;
    try {
      const mp = await pg.contracts.priceHub.morphoPrice(posId);
      effectivePrice = (Number(mp) / 1e36).toFixed(6);
      morphoPriceOk = true;
    } catch (err: any) {
      console.error("[BorrowModule] morphoPrice failed:", err.message?.slice(0, 120));
      // Price is stale — try to fix: extend staleness + reseed
      try {
        const ownerContracts = pg.contractsFor("owner")!;
        await (await ownerContracts.priceHub.setStaleness(365 * 86400)).wait();
        await (await ownerContracts.priceHub.seedPrice(posId, priceData.price)).wait();
        const mp = await pg.contracts.priceHub.morphoPrice(posId);
        effectivePrice = (Number(mp) / 1e36).toFixed(6);
        morphoPriceOk = true;
        console.log("[BorrowModule] auto-reseed succeeded, effectivePrice =", effectivePrice);
      } catch (err2: any) {
        console.error("[BorrowModule] auto-reseed failed:", err2.message?.slice(0, 120));
        priceStatus = "stale";
      }
    }

    // Distinguish stale (reverted) from decayed (returned 0)
    if (morphoPriceOk && Number(effectivePrice) === 0) {
      priceStatus = decayPct === 0 ? "decayed" : "ok"; // decay=0 means fully decayed
    }

    // 2. Accrue interest (only works when oracle is fresh — that's why reseed is first)
    if (morphoPriceOk) {
      try {
        const mp = market.morphoParams;
        const ownerContracts = pg.contractsFor("owner")!;
        await (await ownerContracts.morpho.accrueInterest([mp.loanToken, mp.collateralToken, mp.oracle, mp.irm, mp.lltv])).wait();
      } catch (err: any) {
        console.error("[BorrowModule] accrueInterest failed:", err.message?.slice(0, 120));
      }
    }

    const morphoId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "address", "uint256"],
        [market.morphoParams.loanToken, market.morphoParams.collateralToken, market.morphoParams.oracle, market.morphoParams.irm, market.morphoParams.lltv]
      )
    );

    const pos = await pg.contracts.morpho.position(morphoId, signer.address);
    const mkt = await pg.contracts.morpho.market(morphoId);
    const ctfBal = await pg.contracts.mockCTF.balanceOf(signer.address, posId);
    const usdtBal = await pg.contracts.usdt.balanceOf(signer.address);
    const isAuth = await pg.contracts.morpho.isAuthorized(signer.address, pg.addresses!.presage);

    let healthFactor = "N/A";
    try {
      const hf = await pg.contracts.presage.healthFactor(mid, signer.address);
      const hfNum = Number(hf) / 1e18;
      healthFactor = hfNum > 1e15 ? "∞ (no debt)" : hfNum.toFixed(4);
    } catch { /* no debt */ }

    const borrowAssets = BigInt(mkt.totalBorrowShares) > 0n
      ? (BigInt(pos.borrowShares) * BigInt(mkt.totalBorrowAssets) + BigInt(mkt.totalBorrowShares) - 1n) / BigInt(mkt.totalBorrowShares)
      : 0n;

    // Max borrowable: (collateral * effectivePrice * lltv) - currentDebt
    const collateralBN = BigInt(pos.collateral);
    const effectivePriceNum = Number(effectivePrice);
    const selectedMkt = pg.markets.find(m => m.id.toString() === marketId);
    const lltvNum = selectedMkt ? Number(selectedMkt.lltv) / 1e18 : 0.77;
    const collateralValue = Number(formatEther(collateralBN)) * effectivePriceNum;
    const maxBorrow = Math.max(0, collateralValue * lltvNum - Number(formatEther(borrowAssets)));

    setData({
      ctfBal: formatEther(ctfBal),
      usdtBal: formatEther(usdtBal),
      collateral: formatEther(pos.collateral),
      borrowAssets: formatEther(borrowAssets),
      borrowShares: pos.borrowShares.toString(),
      healthFactor,
      isAuth,
      price: (Number(priceData.price) / 1e18).toFixed(4),
      effectivePrice,
      priceStatus,
      decay: (Number(decayFactor) / 1e18 * 100).toFixed(2),
      positionId: posId.toString(),
      maxBorrow: maxBorrow.toFixed(2),
    });
  }

  async function reseedAndRefresh() {
    if (!pg.contracts || !marketId) return;
    try {
      const mid = BigInt(marketId);
      const market = await pg.contracts.presage.getMarket(mid);
      const posId = BigInt(market.ctfPosition.positionId);
      const ownerContracts = pg.contractsFor("owner")!;
      // Extend staleness window so time warps never block the oracle
      await pg.logTx("Extend staleness window", "owner",
        () => ownerContracts.priceHub.setStaleness(365 * 86400)
      );
      const pp = await pg.contracts.priceHub.prices(posId);
      await pg.logTx("Re-seed price", "owner",
        () => ownerContracts.priceHub.seedPrice(posId, pp.price)
      );
      await pg.logTx("Accrue interest", "owner",
        () => ownerContracts.presage.triggerAccrual(mid)
      );
    } catch (err: any) {
      console.error("[BorrowModule] reseedAndRefresh failed:", err.message?.slice(0, 120));
    }
    await refresh();
  }

  async function approveCTF() {
    if (!pg.contracts) return;
    await pg.logTx("Approve CTF for Presage", pg.activeRole,
      () => pg.contracts!.mockCTF.setApprovalForAll(pg.addresses!.presage, true)
    );
  }

  async function authorizeMorpho() {
    if (!pg.contracts) return;
    await pg.logTx("Authorize Presage on Morpho", pg.activeRole,
      () => pg.contracts!.morpho.setAuthorization(pg.addresses!.presage, true)
    );
    await refresh();
  }

  async function deposit() {
    if (!pg.contracts) return;
    await pg.logTx(`Deposit ${depositAmt} CTF collateral`, pg.activeRole,
      () => pg.contracts!.presage.depositCollateral(BigInt(marketId), parseEther(depositAmt))
    );
    await refresh();
  }

  async function borrow() {
    if (!pg.contracts) return;
    await pg.logTx(`Borrow ${borrowAmt} USDT`, pg.activeRole,
      () => pg.contracts!.presage.borrow(BigInt(marketId), parseEther(borrowAmt))
    );
    await refresh();
  }

  async function repay() {
    if (!pg.contracts) return;
    await pg.logTx("Approve USDT for repay", pg.activeRole,
      () => pg.contracts!.usdt.approve(pg.addresses!.presage, parseEther(repayAmt))
    );
    await pg.logTx(`Repay ${repayAmt} USDT`, pg.activeRole,
      () => pg.contracts!.presage.repay(BigInt(marketId), parseEther(repayAmt))
    );
    await refresh();
  }

  async function release() {
    if (!pg.contracts) return;
    await pg.logTx(`Release ${releaseAmt} collateral`, pg.activeRole,
      () => pg.contracts!.presage.releaseCollateral(BigInt(marketId), parseEther(releaseAmt))
    );
    await refresh();
  }

  const selectedMarket = pg.markets.find(m => m.id.toString() === marketId);

  return (
    <div className="module">
      <h2>Borrow</h2>

      <div className="guide-box">
        <h4>Guide</h4>
        <ol>
          <li>Switch to <strong>Bob</strong> (Borrower) in the sidebar</li>
          <li>Ensure a lender has supplied USDT (use Lend tab first)</li>
          <li><strong>Approve CTF</strong> and <strong>Authorize Morpho</strong> (one-time)</li>
          <li><strong>Deposit</strong> CTF collateral, then <strong>Borrow</strong> USDT</li>
          <li>Watch the health factor change as you borrow more</li>
          <li>Try repaying and releasing collateral</li>
        </ol>
      </div>

      {pg.activeRole !== "bob" && (
        <div className="card" style={{ borderColor: "var(--fire-start)", background: "rgba(255,69,0,0.08)" }}>
          <p style={{ color: "var(--fire-mid)", margin: 0 }}>
            You're on <strong>{pg.activeRole}</strong>. Switch to <strong>Bob</strong> (Borrower) — he has the CTF tokens needed for collateral.
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
              <select value={marketId} onChange={e => { setMarketId(e.target.value); setData(null); }} style={{ flex: 1 }}>
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

            {data && (
              <>
                {data.priceStatus === "stale" && (
                  <div style={{ padding: "0.5rem 0.75rem", marginBottom: "0.75rem", background: "rgba(255,69,0,0.12)", borderRadius: "6px", color: "var(--fire-mid)", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span>Oracle price is stale (expired after time warp). Check browser console for details.</span>
                    <button className="btn" onClick={reseedAndRefresh} style={{ flexShrink: 0 }}>Re-seed & Refresh</button>
                  </div>
                )}
                {data.priceStatus === "decayed" && (
                  <div style={{ padding: "0.5rem 0.75rem", marginBottom: "0.75rem", background: "rgba(255,165,0,0.12)", borderRadius: "6px", color: "var(--warning)", fontSize: "0.85rem" }}>
                    <strong>Effective price is $0</strong> — this market is too close to its resolution date ({selectedMarket ? new Date(selectedMarket.resolutionAt * 1000).toLocaleDateString() : "?"}),
                    so LLTV decay has zeroed the oracle price. Go to <strong>Markets → Create Manual Market</strong> with a longer resolution (e.g. 365 days).
                  </div>
                )}
                <div className="stat-grid">
                  <div className="stat"><span className="stat-label">CTF Balance</span><span className="stat-value">{Number(data.ctfBal).toFixed(2)}</span></div>
                  <div className="stat"><span className="stat-label">USDT Balance</span><span className="stat-value">{Number(data.usdtBal).toFixed(2)}</span></div>
                  <div className="stat"><span className="stat-label">Collateral</span><span className="stat-value">{Number(data.collateral).toFixed(4)}</span></div>
                  <div className="stat"><span className="stat-label">Debt</span><span className="stat-value">{Number(data.borrowAssets).toFixed(4)}</span></div>
                  <div className={`stat ${Number(data.healthFactor) < 1.1 && data.healthFactor !== "N/A" ? "danger" : ""}`}>
                    <span className="stat-label">Health Factor</span>
                    <span className="stat-value">{data.healthFactor}</span>
                  </div>
                  <div className="stat"><span className="stat-label">Seed Price</span><span className="stat-value">${data.price}</span></div>
                  <div className="stat"><span className="stat-label">Effective Price</span><span className="stat-value" style={{ color: Number(data.effectivePrice) < Number(data.price) * 0.5 ? "var(--fire-start)" : "inherit" }}>${data.effectivePrice}</span></div>
                  <div className="stat"><span className="stat-label">Decay Factor</span><span className="stat-value">{data.decay}%</span></div>
                  <div className="stat" style={{ borderColor: "var(--fire-mid)" }}><span className="stat-label">Max Borrow</span><span className="stat-value" style={{ color: "var(--fire-end)" }}>{data.maxBorrow} USDT</span></div>
                  <div className="stat"><span className="stat-label">Morpho Auth</span><span className="stat-value">{data.isAuth ? "Yes" : "No"}</span></div>
                </div>
              </>
            )}
          </div>

          <div className="card">
            <h3>Permissions</h3>
            <div className="btn-row">
              <button className="btn" onClick={approveCTF}>Approve CTF</button>
              <button className="btn" onClick={authorizeMorpho}>Authorize Morpho</button>
            </div>
          </div>

          <div className="card">
            <h3>Actions</h3>
            <div className="form-row">
              <input placeholder="CTF amount" value={depositAmt} onChange={e => setDepositAmt(e.target.value)} />
              <button className="btn primary" onClick={deposit}>Deposit Collateral</button>
            </div>
            <div className="form-row">
              <input placeholder="USDT amount" value={borrowAmt} onChange={e => setBorrowAmt(e.target.value)} />
              {data && <button className="btn" onClick={() => setBorrowAmt(Math.floor(Number(data.maxBorrow) * 0.95).toString())} title="Set to 95% of max borrow">Max</button>}
              <button className="btn primary" onClick={borrow}>Borrow</button>
            </div>
            <div className="form-row">
              <input placeholder="USDT amount" value={repayAmt} onChange={e => setRepayAmt(e.target.value)} />
              <button className="btn" onClick={repay}>Repay</button>
            </div>
            <div className="form-row">
              <input placeholder="CTF amount" value={releaseAmt} onChange={e => setReleaseAmt(e.target.value)} />
              <button className="btn" onClick={release}>Release Collateral</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
