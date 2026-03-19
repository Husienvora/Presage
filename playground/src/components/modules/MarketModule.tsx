import { useState, useEffect } from "react";
import { parseEther, ethers } from "ethers";
import { usePlayground } from "../../hooks/usePlayground";
import { hasApiKey, fetchCategories, fetchMarkets } from "../../lib/predict-api";
import { CTF_STANDARD, CTF_YIELD_BEARING, USDT } from "../../lib/constants";
import type { PredictCategory, PredictMarket } from "../../types";

export function MarketModule() {
  const pg = usePlayground();
  const [categories, setCategories] = useState<PredictCategory[]>([]);
  const [flatMarkets, setFlatMarkets] = useState<PredictMarket[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<number | null>(null);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);

  // Create market form state
  const [selectedMarket, setSelectedMarket] = useState<{
    market: PredictMarket;
    category?: PredictCategory;
  } | null>(null);
  const [lltv, setLltv] = useState("0.77");
  const [resDaysOverride, setResDaysOverride] = useState("365");
  const [useRealResolution, setUseRealResolution] = useState(false);
  const [decayDays, setDecayDays] = useState("7");
  const [cooldownHours, setCooldownHours] = useState("1");
  const [seedPrice, setSeedPrice] = useState("0.50");
  const [mintAmount, setMintAmount] = useState("1000");

  // Manual market form
  const [showManual, setShowManual] = useState(false);
  const [manualPosId, setManualPosId] = useState("");
  const [manualOppId, setManualOppId] = useState("");
  const [manualResDays, setManualResDays] = useState("365");
  const [manualPrice, setManualPrice] = useState("0.65");

  useEffect(() => {
    loadMarkets();
  }, []);

  async function loadMarkets() {
    if (!hasApiKey()) return;
    setLoading(true);
    try {
      const [cats, mkts] = await Promise.all([
        fetchCategories(15),
        fetchMarkets(30),
      ]);
      setCategories(cats);
      setFlatMarkets(mkts);
    } finally {
      setLoading(false);
    }
  }

  // ── Create Presage market from a predict.fun market ─────────────────
  async function createFromPredict(market: PredictMarket, category?: PredictCategory) {
    if (!pg.contracts || !pg.wallets) return;
    setCreating(market.id);
    try {
      const ownerContracts = pg.contractsFor("owner")!;
      const wallets = pg.wallets;
      const yesOutcome = market.outcomes[0];
      const noOutcome = market.outcomes[1];
      if (!yesOutcome?.onChainId) throw new Error("No outcome token ID found");

      const positionId = BigInt(yesOutcome.onChainId);
      const oppositeId = noOutcome ? BigInt(noOutcome.onChainId) : 0n;

      // Resolution: use real predict.fun date or override with custom days
      let resolutionAt: number;
      if (useRealResolution && category?.endsAt) {
        resolutionAt = Math.floor(new Date(category.endsAt).getTime() / 1000);
      } else {
        resolutionAt = Math.floor(Date.now() / 1000) + 86400 * Number(resDaysOverride);
      }

      // Mint MockCTF tokens with the real position IDs for testing
      await pg.logTx(`Mint YES tokens for Bob`, "owner",
        () => ownerContracts.mockCTF.mint(wallets.bob.address, positionId, parseEther(mintAmount))
      );
      await pg.logTx(`Mint YES tokens for Alice`, "owner",
        () => ownerContracts.mockCTF.mint(wallets.alice.address, positionId, parseEther(mintAmount))
      );
      await pg.logTx(`Mint YES tokens for Charlie (solver)`, "owner",
        () => ownerContracts.mockCTF.mint(wallets.liquidator.address, positionId, parseEther(mintAmount))
      );
      if (oppositeId > 0n) {
        await pg.logTx(`Mint NO tokens for Bob`, "owner",
          () => ownerContracts.mockCTF.mint(wallets.bob.address, oppositeId, parseEther(mintAmount))
        );
      }

      // Seed price
      await pg.logTx(`Seed price $${seedPrice}`, "owner",
        () => ownerContracts.priceHub.seedPrice(positionId, parseEther(seedPrice))
      );

      // Create Presage market
      const ctfPos = {
        ctf: pg.addresses!.mockCTF,
        parentCollectionId: ethers.ZeroHash,
        conditionId: market.conditionId || ethers.ZeroHash,
        positionId,
        oppositePositionId: oppositeId,
      };

      await pg.logTx(
        `Open market: "${market.title}"`,
        "owner",
        () => ownerContracts.presage.openMarket(
          ctfPos, USDT, parseEther(lltv),
          resolutionAt,
          Number(decayDays) * 86400,
          Number(cooldownHours) * 3600
        )
      );

      await pg.refreshMarkets();
    } catch (err: any) {
      console.error("Failed to create market:", err);
    } finally {
      setCreating(null);
      setSelectedMarket(null);
    }
  }

  // ── Create manual market ────────────────────────────────────────────
  async function createManualMarket() {
    if (!pg.contracts || !pg.wallets || !manualPosId) return;
    const ownerContracts = pg.contractsFor("owner")!;
    const w = pg.wallets;
    const posId = BigInt(manualPosId);
    const oppId = manualOppId ? BigInt(manualOppId) : 0n;
    const now = Math.floor(Date.now() / 1000);
    const resAt = now + Number(manualResDays) * 86400;

    await pg.logTx("Mint CTF for Bob", "owner",
      () => ownerContracts.mockCTF.mint(w.bob.address, posId, parseEther(mintAmount))
    );
    await pg.logTx("Mint CTF for Alice", "owner",
      () => ownerContracts.mockCTF.mint(w.alice.address, posId, parseEther(mintAmount))
    );
    await pg.logTx("Mint CTF for Charlie (solver)", "owner",
      () => ownerContracts.mockCTF.mint(w.liquidator.address, posId, parseEther(mintAmount))
    );
    await pg.logTx(`Seed price $${manualPrice}`, "owner",
      () => ownerContracts.priceHub.seedPrice(posId, parseEther(manualPrice))
    );

    const ctfPos = {
      ctf: pg.addresses!.mockCTF,
      parentCollectionId: ethers.ZeroHash,
      conditionId: ethers.ZeroHash,
      positionId: posId,
      oppositePositionId: oppId,
    };
    await pg.logTx(`Open manual market (pos ${posId})`, "owner",
      () => ownerContracts.presage.openMarket(ctfPos, USDT, parseEther(lltv), resAt, Number(decayDays) * 86400, Number(cooldownHours) * 3600)
    );
    await pg.refreshMarkets();
  }

  // ── Seed price for existing market ──────────────────────────────────
  const [seedPosId, setSeedPosId] = useState("");
  const [seedProb, setSeedProb] = useState("");
  async function updatePrice() {
    if (!pg.contracts || !seedPosId || !seedProb) return;
    const ownerContracts = pg.contractsFor("owner")!;
    await pg.logTx(`Seed price (pos ${seedPosId} = $${seedProb})`, "owner",
      () => ownerContracts.priceHub.seedPrice(BigInt(seedPosId), parseEther(seedProb))
    );
  }

  function formatEndDate(d: string) {
    if (!d) return "N/A";
    const date = new Date(d);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const days = Math.ceil(diff / 86400000);
    if (days < 0) return "Ended";
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    return `${days}d (${date.toLocaleDateString()})`;
  }

  function truncId(id: string) {
    if (id.length <= 16) return id;
    return id.slice(0, 8) + "..." + id.slice(-6);
  }

  const [copyToast, setCopyToast] = useState<string | null>(null);
  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopyToast(text.length > 20 ? text.slice(0, 12) + "..." : text);
    setTimeout(() => setCopyToast(null), 1500);
  }

  return (
    <div className="module">
      <h2>Markets</h2>

      {/* ── Active Presage Markets ────────────────────────────────── */}
      <div className="card">
        <h3>Active Presage Markets ({pg.markets.length})</h3>
        {pg.markets.length === 0 ? (
          <p className="muted">No markets yet. Create one from predict.fun below or use manual creation.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>ID</th><th>Position ID</th><th>Morpho Market ID</th><th>LLTV</th><th>Resolution</th></tr>
            </thead>
            <tbody>
              {pg.markets.map(m => (
                <tr key={m.id.toString()}>
                  <td>{m.id.toString()}</td>
                  <td>
                    <span
                      className="mono copyable"
                      title="Click to copy full Position ID"
                      onClick={() => copyToClipboard(m.positionId.toString())}
                    >
                      {truncId(m.positionId.toString())}
                    </span>
                  </td>
                  <td>
                    <span
                      className="mono copyable"
                      title="Click to copy Morpho Market ID"
                      onClick={() => copyToClipboard(m.morphoMarketId)}
                    >
                      {m.morphoMarketId.slice(0, 10)}...
                    </span>
                  </td>
                  <td>{(Number(m.lltv) / 1e18 * 100).toFixed(0)}%</td>
                  <td>{new Date(m.resolutionAt * 1000).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── predict.fun Live Markets ──────────────────────────────── */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <h3 style={{ margin: 0 }}>predict.fun Markets</h3>
          <button className="btn" onClick={loadMarkets} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {!hasApiKey() ? (
          <div className="guide-box">
            <h4>API Key Required</h4>
            <p>Add your predict.fun API key to <code>playground/.env</code>:</p>
            <pre className="code-block">VITE_PREDICT_API_KEY=your_key_here</pre>
            <p className="muted">Then restart the dev server.</p>
          </div>
        ) : loading ? (
          <p className="muted">Fetching live markets from predict.fun...</p>
        ) : categories.length === 0 && flatMarkets.length === 0 ? (
          <p className="muted">No markets returned. Check API key or try refreshing.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {/* Category cards */}
            {categories.map(cat => (
              <div key={cat.slug} style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                overflow: "hidden",
              }}>
                {/* Category header */}
                <div
                  onClick={() => setExpandedCat(expandedCat === cat.slug ? null : cat.slug)}
                  style={{
                    padding: "0.75rem 1rem",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    borderBottom: expandedCat === cat.slug ? "1px solid var(--border)" : "none",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{cat.title}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
                      {cat.markets.length} market{cat.markets.length !== 1 ? "s" : ""}
                      {" · "}Ends {formatEndDate(cat.endsAt)}
                      {cat.isYieldBearing && <span style={{ color: "var(--success)", marginLeft: "0.5rem" }}>Yield</span>}
                      {cat.isNegRisk && <span style={{ color: "var(--warning)", marginLeft: "0.5rem" }}>NegRisk</span>}
                    </div>
                  </div>
                  <span style={{ color: "var(--text-muted)" }}>{expandedCat === cat.slug ? "▲" : "▼"}</span>
                </div>

                {/* Expanded market list */}
                {expandedCat === cat.slug && (
                  <div style={{ padding: "0.5rem" }}>
                    {cat.markets.map(m => (
                      <div key={m.id} style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "0.5rem 0.75rem",
                        borderBottom: "1px solid var(--border)",
                        fontSize: "0.85rem",
                      }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500 }}>{m.title}</div>
                          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "var(--mono)" }}>
                            ID: {m.id} · {m.outcomes.map(o => o.name).join(" / ")}
                          </div>
                        </div>
                        <button
                          className="btn primary"
                          style={{ fontSize: "0.75rem", padding: "0.3rem 0.75rem" }}
                          disabled={creating === m.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedMarket({ market: m, category: cat });
                          }}
                        >
                          {creating === m.id ? "Creating..." : "Create Market"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Flat markets (categories without embedding) */}
            {categories.length === 0 && flatMarkets.length > 0 && (
              <div>
                {flatMarkets.map(m => (
                  <div key={m.id} style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "0.75rem 1rem",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    marginBottom: "0.5rem",
                  }}>
                    <div>
                      <div style={{ fontWeight: 500 }}>{m.title}</div>
                      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "var(--mono)" }}>
                        ID: {m.id} · {m.outcomes.map(o => o.name).join(" / ")}
                      </div>
                    </div>
                    <button
                      className="btn primary"
                      style={{ fontSize: "0.75rem", padding: "0.3rem 0.75rem" }}
                      disabled={creating === m.id}
                      onClick={() => setSelectedMarket({ market: m })}
                    >
                      Create Market
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Create Market Modal ───────────────────────────────────── */}
      {selectedMarket && (
        <div className="card" style={{ borderColor: "var(--primary)", borderWidth: 2 }}>
          <h3>Create Presage Market</h3>
          <div style={{ marginBottom: "1rem" }}>
            <div style={{ fontWeight: 600, fontSize: "1rem", marginBottom: "0.25rem" }}>
              {selectedMarket.category?.title || "Market"}: {selectedMarket.market.title}
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              predict.fun #{selectedMarket.market.id}
              {selectedMarket.category && ` · Ends ${formatEndDate(selectedMarket.category.endsAt)}`}
            </div>
          </div>

          <div className="info-grid" style={{ marginBottom: "1rem" }}>
            <div className="info-row">
              <span className="info-label">YES Token (Position ID)</span>
              <span className="info-value mono" style={{ fontSize: "0.7rem" }}>
                {truncId(selectedMarket.market.outcomes[0]?.onChainId || "N/A")}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">NO Token (Opposite ID)</span>
              <span className="info-value mono" style={{ fontSize: "0.7rem" }}>
                {truncId(selectedMarket.market.outcomes[1]?.onChainId || "N/A")}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Condition ID</span>
              <span className="info-value mono" style={{ fontSize: "0.7rem" }}>
                {selectedMarket.market.conditionId.slice(0, 18)}...
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Real CTF Contract</span>
              <span className="info-value mono" style={{ fontSize: "0.7rem" }}>
                {selectedMarket.market.isYieldBearing ? "YieldBearing" : "Standard"}
              </span>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label>LLTV (0-1)</label>
              <input value={lltv} onChange={e => setLltv(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Seed Price ($)</label>
              <input value={seedPrice} onChange={e => setSeedPrice(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Resolution</label>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {useRealResolution ? (
                  <span style={{ fontSize: "0.8rem" }}>
                    {selectedMarket.category?.endsAt
                      ? new Date(selectedMarket.category.endsAt).toLocaleDateString()
                      : "No end date"}
                  </span>
                ) : (
                  <input value={resDaysOverride} onChange={e => setResDaysOverride(e.target.value)} style={{ width: "4rem" }} />
                )}
                {!useRealResolution && <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>days</span>}
                {selectedMarket.category?.endsAt && (
                  <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                    <input type="checkbox" checked={useRealResolution} onChange={e => setUseRealResolution(e.target.checked)} />
                    Use real date
                  </label>
                )}
              </div>
            </div>
            <div className="form-group">
              <label>Decay Duration (days)</label>
              <input value={decayDays} onChange={e => setDecayDays(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Cooldown (hours)</label>
              <input value={cooldownHours} onChange={e => setCooldownHours(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Mint CTF Amount (for testing)</label>
              <input value={mintAmount} onChange={e => setMintAmount(e.target.value)} />
            </div>
          </div>

          <div className="guide-box" style={{ marginTop: "0.5rem", marginBottom: "1rem" }}>
            <p style={{ fontSize: "0.8rem", margin: 0 }}>
              This will mint <strong>{mintAmount}</strong> MockCTF tokens with the real position ID for Bob and Alice,
              seed the oracle price, and create the Presage lending market. You can then supply USDT (Lend tab)
              and borrow against this position (Borrow tab).
            </p>
          </div>

          <div className="btn-row">
            <button
              className="btn primary"
              disabled={creating !== null}
              onClick={() => createFromPredict(selectedMarket.market, selectedMarket.category)}
            >
              {creating ? "Creating..." : "Create Market"}
            </button>
            <button className="btn" onClick={() => setSelectedMarket(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Update Price ──────────────────────────────────────────── */}
      <div className="card">
        <h3>Update Oracle Price</h3>
        <div className="form-row">
          <input placeholder="Position ID" value={seedPosId} onChange={e => setSeedPosId(e.target.value)} style={{ flex: 2 }} />
          <input placeholder="Price (0-1)" value={seedProb} onChange={e => setSeedProb(e.target.value)} />
          <button className="btn" onClick={updatePrice}>Set Price</button>
        </div>
      </div>

      {/* ── Manual Market Creation ────────────────────────────────── */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Manual Market Creation</h3>
          <button className="btn" onClick={() => setShowManual(!showManual)} style={{ fontSize: "0.75rem" }}>
            {showManual ? "Hide" : "Show"}
          </button>
        </div>
        {showManual && (
          <div style={{ marginTop: "0.75rem" }}>
            <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.75rem" }}>
              Create a market with arbitrary position IDs (not from predict.fun).
            </p>
            <div className="form-grid">
              <div className="form-group">
                <label>Position ID (YES)</label>
                <input value={manualPosId} onChange={e => setManualPosId(e.target.value)} placeholder="e.g. 42" />
              </div>
              <div className="form-group">
                <label>Opposite ID (NO)</label>
                <input value={manualOppId} onChange={e => setManualOppId(e.target.value)} placeholder="e.g. 43" />
              </div>
              <div className="form-group">
                <label>Resolution (days from now)</label>
                <input value={manualResDays} onChange={e => setManualResDays(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Seed Price ($)</label>
                <input value={manualPrice} onChange={e => setManualPrice(e.target.value)} />
              </div>
            </div>
            <button className="btn primary" onClick={createManualMarket}>Create Manual Market</button>
          </div>
        )}
      </div>

      {copyToast && <div className="copy-toast">Copied: {copyToast}</div>}
    </div>
  );
}
