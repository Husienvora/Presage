import { useState } from "react";
import { formatEther, ethers } from "ethers";
import { usePlayground } from "../../hooks/usePlayground";
import { TEST_ACCOUNTS } from "../../lib/constants";
import type { AccountRole } from "../../types";

export function DashboardModule() {
  const pg = usePlayground();
  const [snapshot, setSnapshot] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function takeSnapshot() {
    if (!pg.contracts || !pg.wallets) return;
    setLoading(true);

    try {
      const roles = Object.keys(TEST_ACCOUNTS) as AccountRole[];
      const balances: Record<string, { usdt: string; eth: string }> = {};

      for (const role of roles) {
        const addr = pg.wallets[role].address;
        const [usdt, eth] = await Promise.all([
          pg.contracts.usdt.balanceOf(addr),
          pg.provider!.getBalance(addr),
        ]);
        balances[role] = {
          usdt: Number(formatEther(usdt)).toFixed(2),
          eth: Number(formatEther(eth)).toFixed(4),
        };
      }

      // Market states
      const marketStates = [];
      for (const m of pg.markets) {
        const morphoMkt = await pg.contracts.morpho.market(m.morphoMarketId);
        const priceData = await pg.contracts.priceHub.prices(m.positionId);
        let decay = "N/A";
        try { decay = (Number(await pg.contracts.priceHub.decayFactor(m.positionId)) / 1e18 * 100).toFixed(2); } catch {}

        const utilization = BigInt(morphoMkt.totalSupplyAssets) > 0n
          ? (Number(BigInt(morphoMkt.totalBorrowAssets) * 10000n / BigInt(morphoMkt.totalSupplyAssets)) / 100).toFixed(2)
          : "0.00";

        // Get Bob's position
        const bobPos = await pg.contracts.morpho.position(m.morphoMarketId, pg.wallets.bob.address);
        const bobDebt = BigInt(morphoMkt.totalBorrowShares) > 0n
          ? (BigInt(bobPos.borrowShares) * BigInt(morphoMkt.totalBorrowAssets)) / BigInt(morphoMkt.totalBorrowShares)
          : 0n;

        let bobHF = "N/A";
        try { const hfRaw = Number(await pg.contracts.presage.healthFactor(m.id, pg.wallets.bob.address)) / 1e18; bobHF = hfRaw > 1e15 ? "∞" : hfRaw.toFixed(4); } catch {}

        marketStates.push({
          id: m.id.toString(),
          posId: m.positionId.toString(),
          totalSupply: Number(formatEther(morphoMkt.totalSupplyAssets)).toFixed(2),
          totalBorrow: Number(formatEther(morphoMkt.totalBorrowAssets)).toFixed(2),
          utilization: utilization + "%",
          price: "$" + (Number(priceData.price) / 1e18).toFixed(4),
          decay: decay + "%",
          bobCollateral: Number(formatEther(bobPos.collateral)).toFixed(2),
          bobDebt: Number(formatEther(bobDebt)).toFixed(4),
          bobHF,
        });
      }

      // Vault state
      let vaultState = null;
      if (pg.vaultAddress) {
        const { VAULT_ABI } = await import("../../lib/abis");
        const vault = new ethers.Contract(pg.vaultAddress, VAULT_ABI, pg.provider!);
        const [totalAssets, totalSupply, fee] = await Promise.all([
          vault.totalAssets(), vault.totalSupply(), vault.fee(),
        ]);
        const aliceShares = await vault.balanceOf(pg.wallets.alice.address);
        const treasuryShares = await vault.balanceOf(pg.wallets.treasury.address);

        vaultState = {
          totalAssets: Number(formatEther(totalAssets)).toFixed(2),
          totalSupply: Number(formatEther(totalSupply)).toFixed(2),
          fee: (Number(fee) / 1e18 * 100).toFixed(1) + "%",
          aliceShares: Number(formatEther(aliceShares)).toFixed(4),
          treasuryFeeShares: Number(formatEther(treasuryShares)).toFixed(6),
        };
      }

      setSnapshot({ balances, marketStates, vaultState, timestamp: new Date().toLocaleString() });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="module">
      <h2>Dashboard</h2>

      <div className="card">
        <button className="btn primary" onClick={takeSnapshot} disabled={loading}>
          {loading ? "Loading..." : "Take Snapshot"}
        </button>
        {snapshot && <span className="muted" style={{ marginLeft: "1rem" }}>Taken at {snapshot.timestamp}</span>}
      </div>

      {snapshot && (
        <>
          {/* Account Balances */}
          <div className="card">
            <h3>Account Balances</h3>
            <table className="data-table">
              <thead>
                <tr><th>Account</th><th>Role</th><th>USDT</th><th>BNB</th></tr>
              </thead>
              <tbody>
                {Object.entries(snapshot.balances).map(([role, bal]: [string, any]) => (
                  <tr key={role}>
                    <td>{TEST_ACCOUNTS[role as AccountRole].name}</td>
                    <td>{TEST_ACCOUNTS[role as AccountRole].role}</td>
                    <td>{bal.usdt}</td>
                    <td>{bal.eth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Market States */}
          <div className="card">
            <h3>Market States</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th><th>Pos</th><th>Supply</th><th>Borrow</th><th>Util</th>
                  <th>Price</th><th>Decay</th><th>Bob Coll</th><th>Bob Debt</th><th>Bob HF</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.marketStates.map((m: any) => (
                  <tr key={m.id}>
                    <td>{m.id}</td><td>{m.posId}</td>
                    <td>{m.totalSupply}</td><td>{m.totalBorrow}</td><td>{m.utilization}</td>
                    <td>{m.price}</td><td>{m.decay}</td>
                    <td>{m.bobCollateral}</td><td>{m.bobDebt}</td>
                    <td className={Number(m.bobHF) < 1 ? "danger-text" : ""}>{m.bobHF}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Vault State */}
          {snapshot.vaultState && (
            <div className="card">
              <h3>Vault State</h3>
              <div className="stat-grid">
                <div className="stat"><span className="stat-label">Total Assets</span><span className="stat-value">{snapshot.vaultState.totalAssets} USDT</span></div>
                <div className="stat"><span className="stat-label">Total Shares</span><span className="stat-value">{snapshot.vaultState.totalSupply}</span></div>
                <div className="stat"><span className="stat-label">Fee</span><span className="stat-value">{snapshot.vaultState.fee}</span></div>
                <div className="stat"><span className="stat-label">Alice Shares</span><span className="stat-value">{snapshot.vaultState.aliceShares}</span></div>
                <div className="stat"><span className="stat-label">Treasury Fee</span><span className="stat-value">{snapshot.vaultState.treasuryFeeShares}</span></div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
