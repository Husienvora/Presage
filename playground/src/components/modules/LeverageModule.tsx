import { useState, useEffect } from "react";
import { parseEther, formatEther, ethers } from "ethers";
import { usePlayground } from "../../hooks/usePlayground";

interface RequestStatus {
  marginAmount: string;
  supplyCollateralAmount: string;
  borrowAmountMax: string;
  deadline: number;
  filled: boolean;
}

interface DeleverageStatus {
  repayAmount: string;
  withdrawCollateralAmountMax: string;
  deadline: number;
  filled: boolean;
}

export function LeverageModule() {
  const pg = usePlayground();
  const [marketId, setMarketId] = useState("");
  const [data, setData] = useState<any>(null);

  // Leverage form
  const [marginAmt, setMarginAmt] = useState("100");
  const [totalCollateral, setTotalCollateral] = useState("300");
  const [maxBorrow, setMaxBorrow] = useState("100");

  // Deleverage form
  const [repayAmt, setRepayAmt] = useState("50");
  const [maxWithdraw, setMaxWithdraw] = useState("100");

  // Request status
  const [levReq, setLevReq] = useState<RequestStatus | null>(null);
  const [delevReq, setDelevReq] = useState<DeleverageStatus | null>(null);

  useEffect(() => {
    if (pg.markets.length > 0 && !marketId) {
      setMarketId(pg.markets[0].id.toString());
    }
  }, [pg.markets]);

  async function refresh() {
    if (!pg.contracts || !pg.wallets || !marketId) return;
    const mid = BigInt(marketId);
    const market = await pg.contracts.presage.getMarket(mid);
    const posId = BigInt(market.ctfPosition.positionId);
    const bob = pg.wallets.bob.address;
    const charlie = pg.wallets.liquidator.address;

    const morphoId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "address", "uint256"],
        [market.morphoParams.loanToken, market.morphoParams.collateralToken, market.morphoParams.oracle, market.morphoParams.irm, market.morphoParams.lltv]
      )
    );

    const [bobCtf, bobUsdt, bobPos, charlieCtf, charlieUsdt, mkt] = await Promise.all([
      pg.contracts.mockCTF.balanceOf(bob, posId),
      pg.contracts.usdt.balanceOf(bob),
      pg.contracts.morpho.position(morphoId, bob),
      pg.contracts.mockCTF.balanceOf(charlie, posId),
      pg.contracts.usdt.balanceOf(charlie),
      pg.contracts.morpho.market(morphoId),
    ]);

    const bobDebt = BigInt(mkt.totalBorrowShares) > 0n
      ? (BigInt(bobPos.borrowShares) * BigInt(mkt.totalBorrowAssets) + BigInt(mkt.totalBorrowShares) - 1n) / BigInt(mkt.totalBorrowShares)
      : 0n;

    let bobHF = "N/A";
    try {
      const hf = await pg.contracts.presage.healthFactor(mid, bob);
      const hfNum = Number(hf) / 1e18;
      bobHF = hfNum > 1e15 ? "∞ (no debt)" : hfNum.toFixed(4);
    } catch { /* no debt */ }

    // Check Bob's approvals
    const bobCtfApproved = await pg.contracts.mockCTF.isApprovedForAll(bob, pg.addresses!.presage);
    const bobMorphoAuth = await pg.contracts.morpho.isAuthorized(bob, pg.addresses!.presage);
    const charlieCtfApproved = await pg.contracts.mockCTF.isApprovedForAll(charlie, pg.addresses!.presage);
    const charlieMorphoAuth = await pg.contracts.morpho.isAuthorized(charlie, pg.addresses!.presage);

    setData({
      bobCtf: formatEther(bobCtf),
      bobUsdt: formatEther(bobUsdt),
      bobCollateral: formatEther(bobPos.collateral),
      bobDebt: formatEther(bobDebt),
      bobHF,
      bobCtfApproved,
      bobMorphoAuth,
      charlieCtf: formatEther(charlieCtf),
      charlieUsdt: formatEther(charlieUsdt),
      charlieCtfApproved,
      charlieMorphoAuth,
    });

    // Check active requests
    try {
      const lr = await pg.contracts.presage.leverageRequests(bob, mid);
      if (Number(lr.deadline) > 0) {
        setLevReq({
          marginAmount: formatEther(lr.marginAmount),
          supplyCollateralAmount: formatEther(lr.supplyCollateralAmount),
          borrowAmountMax: formatEther(lr.borrowAmountMax),
          deadline: Number(lr.deadline),
          filled: lr.filled,
        });
      } else {
        setLevReq(null);
      }
    } catch { setLevReq(null); }

    try {
      const dr = await pg.contracts.presage.deleverageRequests(bob, mid);
      if (Number(dr.deadline) > 0) {
        setDelevReq({
          repayAmount: formatEther(dr.repayAmount),
          withdrawCollateralAmountMax: formatEther(dr.withdrawCollateralAmountMax),
          deadline: Number(dr.deadline),
          filled: dr.filled,
        });
      } else {
        setDelevReq(null);
      }
    } catch { setDelevReq(null); }
  }

  // ── Mint CTF for Charlie ────────────────────────────────────────
  async function mintForCharlie(amount: string) {
    if (!pg.contracts || !pg.wallets || !marketId) return;
    const market = await pg.contracts.presage.getMarket(BigInt(marketId));
    const posId = BigInt(market.ctfPosition.positionId);
    const ownerContracts = pg.contractsFor("owner")!;
    await pg.logTx(`Mint ${amount} CTF for Charlie`, "owner",
      () => ownerContracts.mockCTF.mint(pg.wallets!.liquidator.address, posId, parseEther(amount))
    );
    await refresh();
  }

  // ── Approvals ─────────────────────────────────────────────────────
  async function approveBob() {
    const bobContracts = pg.contractsFor("bob")!;
    await pg.logTx("Bob: Approve CTF for Presage", "bob",
      () => bobContracts.mockCTF.setApprovalForAll(pg.addresses!.presage, true)
    );
    await pg.logTx("Bob: Authorize Presage on Morpho", "bob",
      () => bobContracts.morpho.setAuthorization(pg.addresses!.presage, true)
    );
    await refresh();
  }

  async function approveCharlie() {
    const charlieContracts = pg.contractsFor("liquidator")!;
    await pg.logTx("Charlie: Approve CTF for Presage", "liquidator",
      () => charlieContracts.mockCTF.setApprovalForAll(pg.addresses!.presage, true)
    );
    await pg.logTx("Charlie: Authorize Presage on Morpho", "liquidator",
      () => charlieContracts.morpho.setAuthorization(pg.addresses!.presage, true)
    );
    await pg.logTx("Charlie: Approve USDT for Presage", "liquidator",
      () => charlieContracts.usdt.approve(pg.addresses!.presage, parseEther("1000000"))
    );
    await refresh();
  }

  // ── Leverage ──────────────────────────────────────────────────────
  async function requestLeverage() {
    if (!pg.contracts || !pg.wallets) return;
    const block = await pg.provider!.getBlock("latest");
    const deadline = (block?.timestamp || 0) + 3600;
    const bobContracts = pg.contractsFor("bob")!;
    await pg.logTx("Bob: Request leverage", "bob",
      () => bobContracts.presage.requestLeverage(
        BigInt(marketId),
        parseEther(marginAmt),
        parseEther(totalCollateral),
        parseEther(maxBorrow),
        deadline
      )
    );
    await refresh();
  }

  async function fillLeverage() {
    if (!pg.contracts || !pg.wallets) return;
    const charlieContracts = pg.contractsFor("liquidator")!;
    await pg.logTx("Charlie: Fill leverage request", "liquidator",
      () => charlieContracts.presage.fillLeverage(pg.wallets!.bob.address, BigInt(marketId))
    );
    await refresh();
  }

  async function cancelLeverage() {
    const bobContracts = pg.contractsFor("bob")!;
    await pg.logTx("Bob: Cancel leverage request", "bob",
      () => bobContracts.presage.cancelLeverageRequest(BigInt(marketId))
    );
    await refresh();
  }

  // ── Deleverage ────────────────────────────────────────────────────
  async function requestDeleverage() {
    if (!pg.contracts || !pg.wallets) return;
    const block = await pg.provider!.getBlock("latest");
    const deadline = (block?.timestamp || 0) + 3600;
    const bobContracts = pg.contractsFor("bob")!;
    await pg.logTx("Bob: Request deleverage", "bob",
      () => bobContracts.presage.requestDeleverage(
        BigInt(marketId),
        parseEther(repayAmt),
        parseEther(maxWithdraw),
        deadline
      )
    );
    await refresh();
  }

  async function fillDeleverage() {
    if (!pg.contracts || !pg.wallets) return;
    const charlieContracts = pg.contractsFor("liquidator")!;
    await pg.logTx("Charlie: Fill deleverage request", "liquidator",
      () => charlieContracts.presage.fillDeleverage(pg.wallets!.bob.address, BigInt(marketId))
    );
    await refresh();
  }

  async function cancelDeleverage() {
    const bobContracts = pg.contractsFor("bob")!;
    await pg.logTx("Bob: Cancel deleverage request", "bob",
      () => bobContracts.presage.cancelDeleverageRequest(BigInt(marketId))
    );
    await refresh();
  }

  const selectedMarket = pg.markets.find(m => m.id.toString() === marketId);

  return (
    <div className="module">
      <h2>Leverage / Deleverage</h2>

      <div className="guide-box">
        <h4>How it works</h4>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
          Leverage lets Bob amplify his CTF position using a solver (Charlie).
          All operations auto-run as the correct role.
        </p>
        <ol>
          <li><strong>Leverage:</strong> Bob puts up 100 CTF margin, requests 300 CTF total collateral.
            Charlie provides the extra 200 CTF, Presage borrows USDT on Bob's behalf, Charlie receives the USDT.</li>
          <li><strong>Deleverage:</strong> Bob wants to unwind. Charlie provides USDT to repay Bob's debt,
            receives Bob's CTF collateral in return.</li>
          <li>Both sides profit: Bob gets leveraged exposure, Charlie earns the spread.</li>
        </ol>
      </div>

      {pg.markets.length === 0 ? (
        <div className="card">
          <p className="muted">No markets created yet. Go to the Markets tab first.</p>
        </div>
      ) : (
        <>
          {/* Market + Refresh */}
          <div className="card">
            <h3>Select Market</h3>
            <div className="form-row">
              <select value={marketId} onChange={e => { setMarketId(e.target.value); setData(null); setLevReq(null); setDelevReq(null); }} style={{ flex: 1 }}>
                {pg.markets.map(m => (
                  <option key={m.id.toString()} value={m.id.toString()}>
                    Market #{m.id.toString()} — LLTV {(Number(m.lltv) / 1e18 * 100).toFixed(0)}%
                  </option>
                ))}
              </select>
              <button className="btn" onClick={refresh}>Refresh</button>
            </div>
          </div>

          {/* Balances & Approvals */}
          {data && (
            <div className="card">
              <h3>Balances & Approvals</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>Bob (Borrower)</h4>
                  <div className="stat-grid">
                    <div className="stat"><span className="stat-label">CTF</span><span className="stat-value">{Number(data.bobCtf).toFixed(2)}</span></div>
                    <div className="stat"><span className="stat-label">USDT</span><span className="stat-value">{Number(data.bobUsdt).toFixed(2)}</span></div>
                    <div className="stat"><span className="stat-label">Collateral</span><span className="stat-value">{Number(data.bobCollateral).toFixed(2)}</span></div>
                    <div className="stat"><span className="stat-label">Debt</span><span className="stat-value">{Number(data.bobDebt).toFixed(4)}</span></div>
                    <div className="stat"><span className="stat-label">Health</span><span className="stat-value">{data.bobHF}</span></div>
                  </div>
                  {(!data.bobCtfApproved || !data.bobMorphoAuth) && (
                    <button className="btn" onClick={approveBob} style={{ marginTop: "0.5rem", width: "100%" }}>
                      Approve Bob (CTF + Morpho)
                    </button>
                  )}
                </div>
                <div>
                  <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>Charlie (Solver)</h4>
                  <div className="stat-grid">
                    <div className="stat"><span className="stat-label">CTF</span><span className="stat-value">{Number(data.charlieCtf).toFixed(2)}</span></div>
                    <div className="stat"><span className="stat-label">USDT</span><span className="stat-value">{Number(data.charlieUsdt).toFixed(2)}</span></div>
                  </div>
                  {Number(data.charlieCtf) < Number(totalCollateral) - Number(marginAmt) && (
                    <div style={{ marginTop: "0.5rem", padding: "0.4rem 0.6rem", background: "rgba(255,165,0,0.12)", borderRadius: "6px", fontSize: "0.8rem", color: "var(--warning)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span>Needs {(Number(totalCollateral) - Number(marginAmt) - Number(data.charlieCtf)).toFixed(0)}+ more CTF</span>
                      <button className="btn" onClick={() => mintForCharlie(String(Math.ceil(Number(totalCollateral) - Number(marginAmt))))} style={{ padding: "0.15rem 0.5rem", fontSize: "0.75rem", flexShrink: 0 }}>
                        Mint {Math.ceil(Number(totalCollateral) - Number(marginAmt))}
                      </button>
                    </div>
                  )}
                  {(!data.charlieCtfApproved || !data.charlieMorphoAuth) && (
                    <button className="btn" onClick={approveCharlie} style={{ marginTop: "0.5rem", width: "100%" }}>
                      Approve Charlie (CTF + Morpho + USDT)
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Leverage */}
          <div className="card">
            <h3>Leverage (Open Position)</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
              Bob posts margin CTF. Charlie provides the rest + Presage borrows USDT for Bob. Charlie gets the USDT.
            </p>
            <div className="form-grid">
              <div className="form-group">
                <label>Bob's Margin (CTF)</label>
                <input value={marginAmt} onChange={e => setMarginAmt(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Total Collateral (CTF)</label>
                <input value={totalCollateral} onChange={e => setTotalCollateral(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Max Borrow (USDT)</label>
                <input value={maxBorrow} onChange={e => setMaxBorrow(e.target.value)} />
              </div>
            </div>
            {data && Number(totalCollateral) > Number(marginAmt) && (
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.5rem 0" }}>
                Charlie provides: {(Number(totalCollateral) - Number(marginAmt)).toFixed(0)} CTF |
                Leverage: {(Number(totalCollateral) / Number(marginAmt)).toFixed(1)}x
              </div>
            )}
            <div className="btn-row">
              <button className="btn primary" onClick={requestLeverage}>1. Request (Bob)</button>
              <button className="btn primary" onClick={fillLeverage}>2. Fill (Charlie)</button>
            </div>

            {levReq && (
              <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.75rem", background: "var(--bg-card)", borderRadius: "6px", fontSize: "0.8rem" }}>
                <strong>Active Request:</strong>{" "}
                Margin: {Number(levReq.marginAmount).toFixed(0)} |
                Total: {Number(levReq.supplyCollateralAmount).toFixed(0)} |
                Max Borrow: {Number(levReq.borrowAmountMax).toFixed(0)} USDT |
                {levReq.filled ? (
                  <span style={{ color: "var(--fire-end)" }}> Filled</span>
                ) : (
                  <>
                    <span style={{ color: "var(--warning)" }}> Pending</span>
                    <button className="btn" onClick={cancelLeverage} style={{ marginLeft: "0.5rem", padding: "0.15rem 0.5rem", fontSize: "0.75rem" }}>Cancel</button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Deleverage */}
          <div className="card">
            <h3>Deleverage (Unwind Position)</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
              Charlie provides USDT to repay Bob's debt. In return, Charlie receives Bob's CTF collateral.
            </p>
            <div className="form-grid">
              <div className="form-group">
                <label>Repay Amount (USDT)</label>
                <input value={repayAmt} onChange={e => setRepayAmt(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Max Collateral to Withdraw (CTF)</label>
                <input value={maxWithdraw} onChange={e => setMaxWithdraw(e.target.value)} />
              </div>
            </div>
            {data && Number(data.bobDebt) > 0 && (
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.5rem 0" }}>
                Bob's current debt: {Number(data.bobDebt).toFixed(4)} USDT |
                Collateral: {Number(data.bobCollateral).toFixed(2)} CTF
                <button className="btn" onClick={() => {
                  const safe = Math.floor(Number(data.bobDebt) * 99) / 100;
                  setRepayAmt(safe.toFixed(2));
                  setMaxWithdraw(data.bobCollateral);
                }} style={{ marginLeft: "0.5rem", padding: "0.15rem 0.5rem", fontSize: "0.75rem" }}>Fill from position</button>
              </div>
            )}
            <div className="btn-row">
              <button className="btn primary" onClick={requestDeleverage}>1. Request (Bob)</button>
              <button className="btn primary" onClick={fillDeleverage}>2. Fill (Charlie)</button>
            </div>

            {delevReq && (
              <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.75rem", background: "var(--bg-card)", borderRadius: "6px", fontSize: "0.8rem" }}>
                <strong>Active Request:</strong>{" "}
                Repay: {Number(delevReq.repayAmount).toFixed(2)} USDT |
                Max Withdraw: {Number(delevReq.withdrawCollateralAmountMax).toFixed(0)} CTF |
                {delevReq.filled ? (
                  <span style={{ color: "var(--fire-end)" }}> Filled</span>
                ) : (
                  <>
                    <span style={{ color: "var(--warning)" }}> Pending</span>
                    <button className="btn" onClick={cancelDeleverage} style={{ marginLeft: "0.5rem", padding: "0.15rem 0.5rem", fontSize: "0.75rem" }}>Cancel</button>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
