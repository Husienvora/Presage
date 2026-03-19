import { useState } from "react";
import { formatEther } from "ethers";
import { usePlayground } from "../../hooks/usePlayground";

const PRESETS = [
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "7 days", seconds: 86400 * 7 },
  { label: "30 days", seconds: 86400 * 30 },
  { label: "90 days", seconds: 86400 * 90 },
  { label: "180 days", seconds: 86400 * 180 },
];

export function TimeModule() {
  const pg = usePlayground();
  const [customHours, setCustomHours] = useState("24");
  const [decayData, setDecayData] = useState<{ posId: string; decay: string }[]>([]);

  async function warp(seconds: number) {
    await pg.warpTime(seconds);
    await refreshDecay();
  }

  async function refreshDecay() {
    if (!pg.contracts) return;
    const results = [];
    for (const m of pg.markets) {
      try {
        const factor = await pg.contracts.priceHub.decayFactor(m.positionId);
        results.push({
          posId: m.positionId.toString(),
          decay: (Number(factor) / 1e18 * 100).toFixed(2),
        });
      } catch {
        results.push({ posId: m.positionId.toString(), decay: "N/A" });
      }
    }
    setDecayData(results);
    await pg.refreshBlock();
  }

  async function triggerAccrual() {
    if (!pg.contracts) return;
    const ownerContracts = pg.contractsFor("owner")!;
    for (const m of pg.markets) {
      try {
        await pg.logTx(`Accrue interest (market ${m.id.toString()})`, "owner",
          ownerContracts.presage.triggerAccrual(m.id)
        );
      } catch { /* no borrows in this market */ }
    }
  }

  const ts = pg.blockTimestamp;
  const time = ts > 0 ? new Date(ts * 1000) : null;

  return (
    <div className="module">
      <h2>Time Machine</h2>

      <div className="guide-box">
        <h4>How Time Affects Presage</h4>
        <ul>
          <li><strong>Interest accrual</strong> — Borrows accrue interest over time (Morpho IRM)</li>
          <li><strong>LLTV decay</strong> — As markets approach resolution, borrowing power decreases linearly</li>
          <li><strong>Price staleness</strong> — Oracle prices expire after maxStaleness (1 hour default)</li>
          <li><strong>Vault fees</strong> — Performance fees accrue on interest earned</li>
        </ul>
      </div>

      <div className="card">
        <h3>Current Time</h3>
        <div className="stat-grid">
          <div className="stat">
            <span className="stat-label">Block Number</span>
            <span className="stat-value">{pg.blockNumber}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Block Time</span>
            <span className="stat-value">{time?.toLocaleString() || "--"}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Unix Timestamp</span>
            <span className="stat-value">{ts}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Fast Forward</h3>
        <div className="btn-grid">
          {PRESETS.map(p => (
            <button key={p.label} className="btn" onClick={() => warp(p.seconds)}>
              + {p.label}
            </button>
          ))}
        </div>
        <div className="form-row" style={{ marginTop: "1rem" }}>
          <input placeholder="Custom hours" value={customHours} onChange={e => setCustomHours(e.target.value)} />
          <button className="btn primary" onClick={() => warp(Number(customHours) * 3600)}>
            Warp {customHours}h
          </button>
        </div>
        <div className="btn-row" style={{ marginTop: "0.5rem" }}>
          <button className="btn" onClick={() => pg.mineBlock()}>Mine 1 Block</button>
          <button className="btn" onClick={triggerAccrual}>Trigger Interest Accrual</button>
        </div>
      </div>

      <div className="card">
        <h3>LLTV Decay Status</h3>
        <button className="btn" onClick={refreshDecay} style={{ marginBottom: "1rem" }}>Refresh Decay</button>
        {decayData.length > 0 && (
          <table className="data-table">
            <thead>
              <tr><th>Position ID</th><th>Decay Factor</th><th>Status</th></tr>
            </thead>
            <tbody>
              {decayData.map(d => (
                <tr key={d.posId}>
                  <td>{d.posId}</td>
                  <td>{d.decay}%</td>
                  <td>
                    {d.decay === "N/A" ? "Unknown" :
                     Number(d.decay) === 100 ? "No decay" :
                     Number(d.decay) === 0 ? "Fully decayed" :
                     "Decaying"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
