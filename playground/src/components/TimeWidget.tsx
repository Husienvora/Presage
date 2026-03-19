import { useState, useRef } from "react";
import { parseEther } from "ethers";
import { usePlayground } from "../hooks/usePlayground";

const PRESETS = [
  { label: "+1h", seconds: 3600 },
  { label: "+1d", seconds: 86400 },
  { label: "+7d", seconds: 86400 * 7 },
  { label: "+30d", seconds: 86400 * 30 },
  { label: "+90d", seconds: 86400 * 90 },
  { label: "+180d", seconds: 86400 * 180 },
];

export function TimeWidget() {
  const pg = usePlayground();
  const [collapsed, setCollapsed] = useState(true);
  const [warping, setWarping] = useState(false);
  const [statusLines, setStatusLines] = useState<string[]>([]);
  const [seedMarketId, setSeedMarketId] = useState("");
  const [seedPriceVal, setSeedPriceVal] = useState("0.50");
  const statusRef = useRef<HTMLDivElement>(null);

  if (!pg.isConnected || !pg.isSetup) return null;

  function pushStatus(msg: string) {
    setStatusLines(prev => [...prev, msg]);
    setTimeout(() => {
      if (statusRef.current) {
        statusRef.current.scrollTop = statusRef.current.scrollHeight;
      }
    }, 0);
  }

  async function warp(seconds: number) {
    setWarping(true);
    setCollapsed(false);
    setStatusLines([]);
    try {
      await pg.warpTime(seconds, pushStatus);
    } finally {
      setWarping(false);
    }
  }

  async function reseed() {
    setWarping(true);
    setCollapsed(false);
    setStatusLines([]);
    try {
      await pg.reseedPrices(pushStatus);
    } finally {
      setWarping(false);
    }
  }

  async function manualSeed() {
    if (!pg.contracts || !seedMarketId) return;
    setWarping(true);
    setCollapsed(false);
    setStatusLines([]);
    try {
      pushStatus(`Setting price $${seedPriceVal} for market ${seedMarketId}...`);
      const ownerContracts = pg.contractsFor("owner")!;
      const market = await pg.contracts.presage.getMarket(BigInt(seedMarketId));
      const posId = BigInt(market.ctfPosition.positionId);
      await (await ownerContracts.priceHub.seedPrice(posId, parseEther(seedPriceVal))).wait();
      // Also accrue interest
      pushStatus("Accruing interest...");
      await (await ownerContracts.presage.triggerAccrual(BigInt(seedMarketId))).wait();
      pushStatus(`Done — Market ${seedMarketId} price set to $${seedPriceVal}`);
    } catch (e: any) {
      pushStatus("Error: " + (e.message?.slice(0, 60) || "unknown"));
    } finally {
      setWarping(false);
    }
  }

  // Auto-select first market for manual seed
  if (!seedMarketId && pg.markets.length > 0) {
    setSeedMarketId(pg.markets[0].id.toString());
  }

  const ts = pg.blockTimestamp;
  const time = ts > 0 ? new Date(ts * 1000) : null;
  const lastStatus = statusLines[statusLines.length - 1];
  const isDone = lastStatus?.startsWith("Done") || lastStatus?.startsWith("No markets");

  return (
    <div className={`time-widget ${collapsed ? "collapsed" : ""}`}>
      <div className="time-widget-header" onClick={() => setCollapsed(!collapsed)}>
        <span>
          <span className={`time-pulse ${warping ? "warping" : ""}`} />
          Time Machine
        </span>
        <span>
          {time ? time.toLocaleTimeString() : "--"}
          {" "}
          {collapsed ? "▲" : "▼"}
        </span>
      </div>
      <div className="time-widget-body">
        <div className="time-widget-clock">
          <span>Block #{pg.blockNumber}</span>
          <span>{time?.toLocaleDateString() || "--"}</span>
        </div>

        {/* Time warp presets */}
        <div className="time-widget-presets">
          {PRESETS.map(p => (
            <button
              key={p.label}
              className="btn"
              disabled={warping}
              onClick={() => warp(p.seconds)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Reseed all + manual seed */}
        <div className="time-widget-seed">
          <button className="btn" disabled={warping} onClick={reseed} style={{ width: "100%", marginBottom: "0.35rem" }}>
            Re-seed All Prices
          </button>
          {pg.markets.length > 0 && (
            <div className="time-widget-manual-seed">
              <select
                value={seedMarketId}
                onChange={e => setSeedMarketId(e.target.value)}
                disabled={warping}
              >
                {pg.markets.map(m => (
                  <option key={m.id.toString()} value={m.id.toString()}>
                    Mkt #{m.id.toString()}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={seedPriceVal}
                onChange={e => setSeedPriceVal(e.target.value)}
                placeholder="$"
                disabled={warping}
                style={{ width: "3.5rem", textAlign: "center" }}
              />
              <button className="btn primary" disabled={warping} onClick={manualSeed}>
                Seed
              </button>
            </div>
          )}
        </div>

        {/* Status feed */}
        {statusLines.length > 0 && (
          <div className="time-widget-status" ref={statusRef}>
            {statusLines.map((line, i) => (
              <div key={i} className={`status-line ${i === statusLines.length - 1 && isDone ? "done" : ""}`}>
                {i === statusLines.length - 1 && !isDone && <span className="status-spinner" />}
                {i < statusLines.length - 1 && <span className="status-check">✓</span>}
                {i === statusLines.length - 1 && isDone && <span className="status-check">✓</span>}
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
