import { useState } from "react";
import { usePlayground } from "../hooks/usePlayground";

export function TxLog() {
  const pg = usePlayground();
  const [expanded, setExpanded] = useState(true);

  if (pg.txLog.length === 0) return null;

  return (
    <div className={`tx-log ${expanded ? "expanded" : "collapsed"}`}>
      <div className="tx-log-header" onClick={() => setExpanded(!expanded)}>
        <span>Transaction Log ({pg.txLog.length})</span>
        <span>{expanded ? "▼" : "▲"}</span>
      </div>
      {expanded && (
        <div className="tx-log-entries">
          {pg.txLog.map(tx => (
            <div key={tx.id} className={`tx-entry ${tx.status}`}>
              <span className="tx-status">
                {tx.status === "pending" ? "..." : tx.status === "success" ? "OK" : "ERR"}
              </span>
              <span className="tx-action">{tx.action}</span>
              <span className="tx-from">{tx.from}</span>
              {tx.hash && <span className="tx-hash">{tx.hash.slice(0, 10)}...</span>}
              {tx.error && <span className="tx-error">{tx.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
