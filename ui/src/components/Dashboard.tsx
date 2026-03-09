import { useState } from "react";
import { ethers, Contract } from "ethers";
import { usePresage } from "../context/PresageContext";
import { ERC20_ABI } from "../abis";

export default function Dashboard() {
  const {
    presage,
    morpho,
    priceHub,
    factory,
    loanToken,
    ctfContract,
    addresses,
    account,
    fetchMarket,
    fetchUserPosition,
    fetchMarketTotals,
    getMorphoMarketId,
  } = usePresage();

  const [marketId, setMarketId] = useState("1");
  const [targetUser, setTargetUser] = useState("");
  const [loading, setLoading] = useState(false);

  // All fetched data
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  const fetchAll = async () => {
    if (!presage || !morpho || !account) {
      setError("Connect wallet and configure addresses first");
      return;
    }
    setLoading(true);
    setError("");
    setData(null);

    const user = targetUser || account;
    const mid = Number(marketId);

    try {
      // Fetch market info
      const market = await fetchMarket(mid);
      const morphoId = getMorphoMarketId(market.morphoParams);

      // Fetch position + totals
      const [position, totals] = await Promise.all([
        fetchUserPosition(mid, user),
        fetchMarketTotals(mid),
      ]);

      // Fetch balances
      let usdtBalance = 0n;
      let ctfBalance = 0n;
      let wrapperBalance = 0n;
      let wrapperTotalSupply = 0n;

      if (loanToken) {
        usdtBalance = await loanToken.balanceOf(user);
      }

      if (ctfContract) {
        ctfBalance = await ctfContract.balanceOf(user, market.ctfPosition.positionId);
      }

      const wrapperAddr = market.morphoParams.collateralToken;
      if (wrapperAddr !== ethers.ZeroAddress) {
        const wrapper = new Contract(wrapperAddr, ERC20_ABI, presage.runner);
        wrapperBalance = await wrapper.balanceOf(user);
        wrapperTotalSupply = await wrapper.totalSupply();
      }

      // Fetch price data
      let priceData = null;
      let decayFactor = null;
      let maxStaleness = null;
      if (priceHub) {
        try {
          priceData = await priceHub.prices(market.ctfPosition.positionId);
          decayFactor = await priceHub.decayFactor(market.ctfPosition.positionId);
          maxStaleness = await priceHub.maxStaleness();
        } catch {}
      }

      // Morpho authorization check
      let isAuthorized = false;
      if (morpho && addresses.presage) {
        try {
          isAuthorized = await morpho.isAuthorized(user, addresses.presage);
        } catch {}
      }

      // CTF approval check
      let ctfApproved = false;
      if (ctfContract && addresses.presage) {
        try {
          ctfApproved = await ctfContract.isApprovedForAll(user, addresses.presage);
        } catch {}
      }

      // USDT allowance
      let usdtAllowance = 0n;
      if (loanToken && addresses.presage) {
        usdtAllowance = await loanToken.allowance(user, addresses.presage);
      }

      setData({
        user,
        market,
        morphoId,
        position,
        totals,
        usdtBalance,
        ctfBalance,
        wrapperBalance,
        wrapperTotalSupply,
        priceData,
        decayFactor,
        maxStaleness,
        isAuthorized,
        ctfApproved,
        usdtAllowance,
      });
    } catch (err: any) {
      setError(err.reason || err.message);
    } finally {
      setLoading(false);
    }
  };

  const fmt = (v: bigint) => ethers.formatEther(v);

  const formatHF = (hf: bigint) => {
    if (hf === ethers.MaxUint256) return "Infinity (no debt)";
    return Number(ethers.formatEther(hf)).toFixed(4);
  };

  const fmtTime = (ts: bigint | number) => {
    const n = Number(ts);
    if (n === 0) return "Never";
    return new Date(n * 1000).toLocaleString();
  };

  return (
    <div className="card">
      <h2>Dashboard</h2>
      <p className="hint">
        Full snapshot of a user's position and market state. Use this to verify
        everything after operations.
      </p>

      <div className="form-grid form-grid-2col">
        <div className="form-field">
          <label>Market ID</label>
          <input
            type="text"
            value={marketId}
            onChange={(e) => setMarketId(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>User Address (blank = self)</label>
          <input
            type="text"
            placeholder={account || "0x..."}
            value={targetUser}
            onChange={(e) => setTargetUser(e.target.value.trim())}
          />
        </div>
      </div>

      <button
        className="btn btn-primary"
        onClick={fetchAll}
        disabled={loading}
      >
        {loading ? "Loading..." : "Fetch Full Dashboard"}
      </button>

      {error && <div className="status-msg status-error">{error}</div>}

      {data && (
        <div className="dashboard-results">
          {/* User Info */}
          <div className="stats-grid">
            <h3>User: {data.user}</h3>
          </div>

          {/* Permissions */}
          <div className="stats-grid">
            <h3>Permissions</h3>
            <div className="stat">
              <span className="stat-label">Morpho Authorization</span>
              <span className={`stat-value ${data.isAuthorized ? "hf-safe" : "hf-danger"}`}>
                {data.isAuthorized ? "Authorized" : "NOT Authorized"}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">CTF Approval</span>
              <span className={`stat-value ${data.ctfApproved ? "hf-safe" : "hf-danger"}`}>
                {data.ctfApproved ? "Approved" : "NOT Approved"}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">USDT Allowance</span>
              <span className="stat-value">
                {data.usdtAllowance === ethers.MaxUint256
                  ? "Unlimited"
                  : fmt(data.usdtAllowance) + " USDT"}
              </span>
            </div>
          </div>

          {/* Wallet Balances */}
          <div className="stats-grid">
            <h3>Wallet Balances</h3>
            <div className="stat">
              <span className="stat-label">USDT</span>
              <span className="stat-value">{fmt(data.usdtBalance)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">CTF (position {data.market.ctfPosition.positionId.toString()})</span>
              <span className="stat-value">{fmt(data.ctfBalance)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">wCTF (wrapped)</span>
              <span className="stat-value">{fmt(data.wrapperBalance)}</span>
            </div>
          </div>

          {/* Position in Morpho */}
          <div className="stats-grid">
            <h3>Morpho Position</h3>
            <div className="stat">
              <span className="stat-label">Supply Assets</span>
              <span className="stat-value">{fmt(data.position.supplyAssets)} USDT</span>
            </div>
            <div className="stat">
              <span className="stat-label">Borrow Assets (Debt)</span>
              <span className="stat-value">{fmt(data.position.borrowAssets)} USDT</span>
            </div>
            <div className="stat">
              <span className="stat-label">Collateral in Morpho</span>
              <span className="stat-value">{fmt(data.position.collateralAssets)} wCTF</span>
            </div>
            <div className="stat">
              <span className="stat-label">Health Factor</span>
              <span
                className={`stat-value ${
                  data.position.healthFactor !== ethers.MaxUint256 &&
                  Number(ethers.formatEther(data.position.healthFactor)) < 1.1
                    ? "hf-danger"
                    : "hf-safe"
                }`}
              >
                {formatHF(data.position.healthFactor)}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Supply Shares</span>
              <span className="stat-value mono">{data.position.supplyShares.toString()}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Borrow Shares</span>
              <span className="stat-value mono">{data.position.borrowShares.toString()}</span>
            </div>
          </div>

          {/* Market Totals */}
          <div className="stats-grid">
            <h3>Market Totals</h3>
            <div className="stat">
              <span className="stat-label">Total Supply</span>
              <span className="stat-value">{fmt(data.totals.totalSupplyAssets)} USDT</span>
            </div>
            <div className="stat">
              <span className="stat-label">Total Borrow</span>
              <span className="stat-value">{fmt(data.totals.totalBorrowAssets)} USDT</span>
            </div>
            <div className="stat">
              <span className="stat-label">Utilization</span>
              <span className="stat-value">
                {data.totals.totalSupplyAssets > 0n
                  ? ((Number(data.totals.totalBorrowAssets) * 100) / Number(data.totals.totalSupplyAssets)).toFixed(2) + "%"
                  : "0%"}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">wCTF Total Supply</span>
              <span className="stat-value">{fmt(data.wrapperTotalSupply)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Last Accrual</span>
              <span className="stat-value">{fmtTime(data.totals.lastUpdate)}</span>
            </div>
          </div>

          {/* Market Config */}
          <div className="stats-grid">
            <h3>Market Config</h3>
            <div className="stat">
              <span className="stat-label">Presage Market ID</span>
              <span className="stat-value">{data.market.id}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Morpho Market ID</span>
              <span className="stat-value mono">{data.morphoId}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Loan Token</span>
              <span className="stat-value mono">{data.market.morphoParams.loanToken}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Collateral (Wrapper)</span>
              <span className="stat-value mono">{data.market.morphoParams.collateralToken}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Oracle</span>
              <span className="stat-value mono">{data.market.morphoParams.oracle}</span>
            </div>
            <div className="stat">
              <span className="stat-label">IRM</span>
              <span className="stat-value mono">{data.market.morphoParams.irm}</span>
            </div>
            <div className="stat">
              <span className="stat-label">LLTV</span>
              <span className="stat-value">
                {(Number(ethers.formatEther(data.market.morphoParams.lltv)) * 100).toFixed(1)}%
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Resolution At</span>
              <span className="stat-value">{fmtTime(data.market.resolutionAt)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">CTF Address</span>
              <span className="stat-value mono">{data.market.ctfPosition.ctf}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Position ID (YES)</span>
              <span className="stat-value">{data.market.ctfPosition.positionId.toString()}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Opposite Position ID (NO)</span>
              <span className="stat-value">{data.market.ctfPosition.oppositePositionId.toString()}</span>
            </div>
          </div>

          {/* Price & Decay */}
          {data.priceData && (
            <div className="stats-grid">
              <h3>Oracle & Decay</h3>
              <div className="stat">
                <span className="stat-label">Current Price (probability)</span>
                <span className="stat-value">
                  {Number(ethers.formatEther(data.priceData.price)).toFixed(6)}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">Price Updated At</span>
                <span className="stat-value">{fmtTime(data.priceData.updatedAt)}</span>
              </div>
              {data.decayFactor !== null && (
                <div className="stat">
                  <span className="stat-label">Decay Factor</span>
                  <span className="stat-value">
                    {(Number(ethers.formatEther(data.decayFactor)) * 100).toFixed(2)}%
                  </span>
                </div>
              )}
              {data.maxStaleness !== null && (
                <div className="stat">
                  <span className="stat-label">Max Staleness</span>
                  <span className="stat-value">{data.maxStaleness.toString()}s</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
