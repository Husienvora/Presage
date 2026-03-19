import { usePlayground } from "../hooks/usePlayground";
import { TEST_ACCOUNTS } from "../lib/constants";

export function StatusBar() {
  const pg = usePlayground();
  const ts = pg.blockTimestamp;
  const time = ts > 0 ? new Date(ts * 1000).toLocaleString() : "--";

  return (
    <div className="status-bar">
      <div className="status-item">
        <span className={`status-dot ${pg.isConnected ? "ok" : "err"}`} />
        {pg.isConnected ? "Connected" : "Disconnected"}
      </div>
      <div className="status-item">
        Block: <strong>{pg.blockNumber}</strong>
      </div>
      <div className="status-item">
        Time: <strong>{time}</strong>
      </div>
      <div className="status-item">
        Acting as: <strong>{TEST_ACCOUNTS[pg.activeRole].name}</strong>
        <span className="status-role">({TEST_ACCOUNTS[pg.activeRole].role})</span>
      </div>
      {pg.isSetup && <div className="status-badge ok">Setup Complete</div>}
    </div>
  );
}
