import { usePlayground } from "../../hooks/usePlayground";
import { TEST_ACCOUNTS } from "../../lib/constants";
import type { AccountRole } from "../../types";

export function SetupModule() {
  const pg = usePlayground();

  if (!pg.isConnected) {
    return (
      <div className="module">
        <h2>Setup</h2>
        <div className="card">
          <h3>Not Connected</h3>
          <p>Start a Hardhat fork node first:</p>
          <pre className="code-block">FORK_BNB=true npx hardhat node</pre>
          <button className="btn primary" onClick={() => pg.connect()}>
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (!pg.isSetup) {
    return (
      <div className="module">
        <h2>Setup</h2>
        <div className="card">
          <h3>Deploy Contracts</h3>
          <p>The fork node is running but contracts aren't deployed yet. Run:</p>
          <pre className="code-block">npx hardhat run scripts/playground-setup.ts --network localhost</pre>
          <p>This deploys all Presage infrastructure and funds test accounts with 50k USDT each.</p>
          <button className="btn primary" onClick={() => pg.connect()}>
            Reload After Deploy
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="module">
      <h2>Setup Complete</h2>

      <div className="guide-box">
        <h4>Getting Started</h4>
        <ol>
          <li><strong>Markets</strong> — Browse live predict.fun markets and create Presage lending markets from them</li>
          <li><strong>Lend</strong> — Switch to Alice and supply USDT to a market</li>
          <li><strong>Borrow</strong> — Switch to Bob, deposit CTF collateral, borrow USDT</li>
          <li><strong>Vault</strong> — Deploy a MetaMorpho vault, set caps, deposit LP funds</li>
          <li><strong>Time Machine</strong> — Fast-forward time to test interest accrual and LLTV decay</li>
          <li><strong>Liquidation</strong> — Drop prices and settle unhealthy positions</li>
          <li><strong>Dashboard</strong> — Full state snapshot of everything</li>
        </ol>
      </div>

      <div className="card">
        <h3>Deployed Contracts</h3>
        <div className="info-grid">
          {Object.entries(pg.addresses!).map(([name, addr]) => (
            <div key={name} className="info-row">
              <span className="info-label">{name}</span>
              <span className="info-value mono">{addr}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Test Accounts</h3>
        <p className="muted" style={{ marginBottom: "0.5rem", fontSize: "0.8rem" }}>
          Each account has 50,000 USDT and 10,000 BNB. Switch accounts in the sidebar.
        </p>
        <table className="data-table">
          <thead>
            <tr><th>Name</th><th>Role</th><th>Address</th></tr>
          </thead>
          <tbody>
            {(Object.entries(TEST_ACCOUNTS) as [AccountRole, typeof TEST_ACCOUNTS.owner][]).map(([role, acc]) => (
              <tr key={role}>
                <td style={{ fontWeight: 600 }}>{acc.name}</td>
                <td className="muted">{acc.role}</td>
                <td className="mono" style={{ fontSize: "0.75rem" }}>{acc.address}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pg.markets.length > 0 && (
        <div className="card">
          <h3>Active Markets ({pg.markets.length})</h3>
          <div className="info-grid">
            {pg.markets.map(m => (
              <div key={m.id.toString()} className="info-row">
                <span className="info-label">Market {m.id.toString()}</span>
                <span className="info-value">
                  LLTV: {(Number(m.lltv) / 1e18 * 100).toFixed(0)}% | Res: {new Date(m.resolutionAt * 1000).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
