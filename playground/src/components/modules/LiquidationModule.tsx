import { useState, useEffect } from "react";
import { parseEther, formatEther, ethers } from "ethers";
import { usePlayground } from "../../hooks/usePlayground";

interface BalanceSnapshot {
  liquidatorUsdt: string;
  liquidatorCtf: string;
  borrowerUsdt: string;
  borrowerCollateral: string;
  borrowerDebt: string;
  borrowerHF: string;
}

export function LiquidationModule() {
  const pg = usePlayground();
  const [marketId, setMarketId] = useState("");
  const [borrower, setBorrower] = useState("");
  const [newPrice, setNewPrice] = useState("0.10");
  const [repayAmt, setRepayAmt] = useState("10");
  const [hf, setHf] = useState<string | null>(null);
  const [borrowerDebt, setBorrowerDebt] = useState<string>("0");
  const [borrowerCollateral, setBorrowerCollateral] = useState<string>("0");
  const [maxSafeRepay, setMaxSafeRepay] = useState<string>("0");
  const [before, setBefore] = useState<BalanceSnapshot | null>(null);
  const [after, setAfter] = useState<BalanceSnapshot | null>(null);

  // Auto-select first market
  useEffect(() => {
    if (pg.markets.length > 0 && !marketId) {
      setMarketId(pg.markets[0].id.toString());
    }
  }, [pg.markets]);

  // Auto-fill Bob's address as default borrower
  useEffect(() => {
    if (pg.wallets && !borrower) {
      setBorrower(pg.wallets.bob.address);
    }
  }, [pg.wallets]);

  async function getSnapshot(posId: bigint, morphoId: string): Promise<BalanceSnapshot> {
    const contracts = pg.contracts!;
    const wallets = pg.wallets!;
    const liquidatorAddr = wallets.liquidator.address;
    const mid = BigInt(marketId);

    const [liqUsdt, liqCtf, borrowerUsdt] = await Promise.all([
      contracts.usdt.balanceOf(liquidatorAddr),
      contracts.mockCTF.balanceOf(liquidatorAddr, posId),
      contracts.usdt.balanceOf(borrower),
    ]);

    const pos = await contracts.morpho.position(morphoId, borrower);
    const mkt = await contracts.morpho.market(morphoId);
    const debt = BigInt(mkt.totalBorrowShares) > 0n
      ? (BigInt(pos.borrowShares) * BigInt(mkt.totalBorrowAssets) + BigInt(mkt.totalBorrowShares) - 1n) / BigInt(mkt.totalBorrowShares)
      : 0n;

    let borrowerHF = "N/A";
    try {
      const h = await contracts.presage.healthFactor(mid, borrower);
      const hfNum = Number(h) / 1e18;
      borrowerHF = hfNum > 1e15 ? "∞ (no debt)" : hfNum.toFixed(4);
    } catch { borrowerHF = "No debt"; }

    return {
      liquidatorUsdt: Number(formatEther(liqUsdt)).toFixed(2),
      liquidatorCtf: Number(formatEther(liqCtf)).toFixed(4),
      borrowerUsdt: Number(formatEther(borrowerUsdt)).toFixed(2),
      borrowerCollateral: Number(formatEther(pos.collateral)).toFixed(4),
      borrowerDebt: Number(formatEther(debt)).toFixed(4),
      borrowerHF,
    };
  }

  async function checkHealth() {
    if (!pg.contracts || !borrower || !marketId) return;
    try {
      const health = await pg.contracts.presage.healthFactor(BigInt(marketId), borrower);
      const hfNum = Number(health) / 1e18;
      setHf(hfNum > 1e15 ? "∞ (no debt)" : hfNum.toFixed(4));
    } catch {
      setHf("No debt");
    }

    // Fetch borrower's debt, collateral, and compute max safe repay
    try {
      const market = await pg.contracts.presage.getMarket(BigInt(marketId));
      const mp = market.morphoParams;
      const morphoId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "address", "address", "uint256"],
          [mp.loanToken, mp.collateralToken, mp.oracle, mp.irm, mp.lltv]
        )
      );
      const pos = await pg.contracts.morpho.position(morphoId, borrower);
      const mkt = await pg.contracts.morpho.market(morphoId);
      const debt = BigInt(mkt.totalBorrowShares) > 0n
        ? (BigInt(pos.borrowShares) * BigInt(mkt.totalBorrowAssets) + BigInt(mkt.totalBorrowShares) - 1n) / BigInt(mkt.totalBorrowShares)
        : 0n;
      const collateral = Number(formatEther(pos.collateral));
      setBorrowerDebt(formatEther(debt));
      setBorrowerCollateral(collateral.toFixed(4));

      // Max safe repay = min(debt, collateral * price / incentiveFactor)
      // incentiveFactor ≈ 1.15 (Morpho default), apply 90% safety margin
      let effectivePrice = 0;
      const liqPosId = BigInt(market.ctfPosition.positionId);
      try {
        const mp2 = await pg.contracts.priceHub.morphoPrice(liqPosId);
        effectivePrice = Number(mp2) / 1e36;
      } catch {
        // stale — extend staleness, reseed, retry
        try {
          const ownerContracts = pg.contractsFor("owner")!;
          await (await ownerContracts.priceHub.setStaleness(365 * 86400)).wait();
          const pp = await pg.contracts.priceHub.prices(liqPosId);
          await (await ownerContracts.priceHub.seedPrice(liqPosId, pp.price)).wait();
          const mp2 = await pg.contracts.priceHub.morphoPrice(liqPosId);
          effectivePrice = Number(mp2) / 1e36;
        } catch { /* give up */ }
      }

      const maxFromCollateral = effectivePrice > 0 ? (collateral * effectivePrice / 1.15) : 0;
      const debtNum = Number(formatEther(debt));
      const safeMax = Math.floor(Math.min(debtNum, maxFromCollateral) * 90) / 100; // 90% safety
      setMaxSafeRepay(safeMax > 0 ? safeMax.toFixed(2) : "0");
    } catch {
      setBorrowerDebt("0");
      setBorrowerCollateral("0");
      setMaxSafeRepay("0");
    }
  }

  async function dropPrice() {
    if (!pg.contracts || !marketId) return;
    const market = await pg.contracts.presage.getMarket(BigInt(marketId));
    const posId = BigInt(market.ctfPosition.positionId);
    const ownerContracts = pg.contractsFor("owner")!;
    await pg.logTx(`Drop price to $${newPrice}`, "owner",
      () => ownerContracts.priceHub.seedPrice(posId, parseEther(newPrice))
    );
    if (borrower) await checkHealth();
  }

  async function settleWithLoan() {
    if (!pg.contracts || !pg.wallets || !borrower || !marketId) return;

    const market = await pg.contracts.presage.getMarket(BigInt(marketId));
    const posId = BigInt(market.ctfPosition.positionId);
    const mp = market.morphoParams;
    const morphoId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "address", "uint256"],
        [mp.loanToken, mp.collateralToken, mp.oracle, mp.irm, mp.lltv]
      )
    );

    // Snapshot before
    const snap = await getSnapshot(posId, morphoId);
    setBefore(snap);
    setAfter(null);

    // Execute liquidation as liquidator
    const liqContracts = pg.contractsFor("liquidator")!;
    await pg.logTx("Approve USDT for settlement", "liquidator",
      () => liqContracts.usdt.approve(pg.addresses!.presage, parseEther(repayAmt))
    );
    await pg.logTx(`Settle with loan token (${repayAmt} USDT)`, "liquidator",
      () => liqContracts.presage.settleWithLoanToken(BigInt(marketId), borrower, parseEther(repayAmt))
    );

    // Snapshot after
    const snapAfter = await getSnapshot(posId, morphoId);
    setAfter(snapAfter);
    setHf(snapAfter.borrowerHF);
  }

  const selectedMarket = pg.markets.find(m => m.id.toString() === marketId);

  return (
    <div className="module">
      <h2>Liquidation</h2>

      <div className="guide-box">
        <h4>Guide</h4>
        <ol>
          <li>First, create a debt position (Borrow tab as Bob)</li>
          <li>Switch to <strong>Charlie</strong> (Liquidator) in the sidebar</li>
          <li>Check Bob's health factor below</li>
          <li><strong>Drop price</strong> to make the position unhealthy (HF &lt; 1.0)</li>
          <li><strong>Settle</strong> — Charlie pays USDT, seizes Bob's collateral at a discount</li>
        </ol>
      </div>

      {pg.activeRole !== "liquidator" && (
        <div className="card" style={{ borderColor: "var(--fire-start)", background: "rgba(255,69,0,0.08)" }}>
          <p style={{ color: "var(--fire-mid)", margin: 0 }}>
            You're on <strong>{pg.activeRole}</strong>. Switch to <strong>Charlie</strong> (Liquidator) — he has USDT to execute settlements.
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
            <h3>Check Position Health</h3>
            <div className="form-row">
              <select value={marketId} onChange={e => { setMarketId(e.target.value); setHf(null); setBorrowerDebt("0"); setBorrowerCollateral("0"); setMaxSafeRepay("0"); setBefore(null); setAfter(null); }} style={{ flex: 1 }}>
                {pg.markets.map(m => (
                  <option key={m.id.toString()} value={m.id.toString()}>
                    Market #{m.id.toString()} — LLTV {(Number(m.lltv) / 1e18 * 100).toFixed(0)}%
                  </option>
                ))}
              </select>
            </div>

            {selectedMarket && (
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.5rem", fontFamily: "var(--mono)" }}>
                Position: {selectedMarket.positionId.toString().slice(0, 20)}...
              </div>
            )}

            <div className="form-row" style={{ marginTop: "0.75rem" }}>
              <input placeholder="Borrower address" value={borrower} onChange={e => setBorrower(e.target.value)} style={{ flex: 1 }} />
              <button className="btn" onClick={checkHealth}>Check</button>
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
              Bob: {pg.wallets?.bob.address}
            </div>

            {hf !== null && (
              <div className={`stat-inline ${Number(hf) < 1 ? "danger" : Number(hf) < 1.1 ? "warning" : "ok"}`}>
                Health Factor: <strong>{hf}</strong>
                {Number(hf) < 1 && " — LIQUIDATABLE"}
              </div>
            )}
          </div>

          <div className="card">
            <h3>Manipulate Price</h3>
            <div className="form-row">
              <input placeholder="New price (0-1)" value={newPrice} onChange={e => setNewPrice(e.target.value)} />
              <button className="btn danger" onClick={dropPrice}>Set Price</button>
            </div>
          </div>

          <div className="card">
            <h3>Settle (Liquidate)</h3>
            {Number(borrowerDebt) > 0 && (
              <div style={{ fontSize: "0.8rem", marginBottom: "0.5rem", color: "var(--text-muted)" }}>
                Borrower debt: <strong style={{ color: "var(--fire-end)" }}>{Number(borrowerDebt).toFixed(4)} USDT</strong>
                {" | "}Collateral: <strong>{borrowerCollateral} CTF</strong>
                {Number(maxSafeRepay) > 0 && (
                  <>{" | "}Max safe repay: <strong style={{ color: "var(--fire-mid)" }}>{maxSafeRepay} USDT</strong></>
                )}
              </div>
            )}
            <div className="form-row">
              <input placeholder="Repay USDT amount" value={repayAmt} onChange={e => setRepayAmt(e.target.value)} />
              <button className="btn" onClick={() => {
                // Use maxSafeRepay (considers both debt and remaining collateral / incentive factor)
                if (Number(maxSafeRepay) > 0) {
                  setRepayAmt(maxSafeRepay);
                } else {
                  const safe = Math.floor(Number(borrowerDebt) * 90) / 100;
                  setRepayAmt(safe.toFixed(2));
                }
              }} title="Set to max safe amount (considers collateral + incentive factor)">Max Safe</button>
              <button className="btn primary" onClick={settleWithLoan}>Settle with Loan Token</button>
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.5rem 0 0" }}>
              Charlie pays USDT to cover Bob's debt and receives Bob's CTF collateral at a liquidation discount.
              Max safe = min(debt, collateral × price / 1.15) × 90%.
            </p>
          </div>

          {/* Before / After comparison */}
          {before && (
            <div className="card">
              <h3>Liquidation Result</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Before</th>
                    <th>After</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Charlie USDT</td>
                    <td>{before.liquidatorUsdt}</td>
                    <td>{after?.liquidatorUsdt ?? "..."}</td>
                    <td style={{ color: after ? "var(--fire-start)" : "var(--text-muted)" }}>
                      {after ? (Number(after.liquidatorUsdt) - Number(before.liquidatorUsdt)).toFixed(2) : ""}
                    </td>
                  </tr>
                  <tr>
                    <td>Charlie CTF (seized)</td>
                    <td>{before.liquidatorCtf}</td>
                    <td>{after?.liquidatorCtf ?? "..."}</td>
                    <td style={{ color: after ? "var(--fire-end)" : "var(--text-muted)" }}>
                      {after ? "+" + (Number(after.liquidatorCtf) - Number(before.liquidatorCtf)).toFixed(4) : ""}
                    </td>
                  </tr>
                  <tr><td colSpan={4} style={{ borderBottom: "1px solid var(--border)", padding: 0 }} /></tr>
                  <tr>
                    <td>Bob Collateral</td>
                    <td>{before.borrowerCollateral}</td>
                    <td>{after?.borrowerCollateral ?? "..."}</td>
                    <td style={{ color: after ? "var(--fire-start)" : "var(--text-muted)" }}>
                      {after ? (Number(after.borrowerCollateral) - Number(before.borrowerCollateral)).toFixed(4) : ""}
                    </td>
                  </tr>
                  <tr>
                    <td>Bob Debt</td>
                    <td>{before.borrowerDebt}</td>
                    <td>{after?.borrowerDebt ?? "..."}</td>
                    <td style={{ color: after ? "var(--fire-end)" : "var(--text-muted)" }}>
                      {after ? (Number(after.borrowerDebt) - Number(before.borrowerDebt)).toFixed(4) : ""}
                    </td>
                  </tr>
                  <tr>
                    <td>Bob Health Factor</td>
                    <td>{before.borrowerHF}</td>
                    <td>{after?.borrowerHF ?? "..."}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
