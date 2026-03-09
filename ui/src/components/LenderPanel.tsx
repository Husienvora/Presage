import { useState } from "react";
import { ethers } from "ethers";
import { usePresage } from "../context/PresageContext";

export default function LenderPanel() {
  const {
    presage,
    loanToken,
    addresses,
    account,
    txPending,
    setTxPending,
    setLastTxHash,
    fetchUserPosition,
    fetchMarketTotals,
  } = usePresage();

  const [marketId, setMarketId] = useState("1");
  const [supplyAmount, setSupplyAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [status, setStatus] = useState("");
  const [position, setPosition] = useState<any>(null);
  const [totals, setTotals] = useState<any>(null);
  const [usdtBalance, setUsdtBalance] = useState<string | null>(null);

  const refreshData = async () => {
    if (!account) return;
    try {
      const mid = Number(marketId);
      const [pos, tot] = await Promise.all([
        fetchUserPosition(mid, account),
        fetchMarketTotals(mid),
      ]);
      setPosition(pos);
      setTotals(tot);
      if (loanToken) {
        const bal = await loanToken.balanceOf(account);
        setUsdtBalance(ethers.formatEther(bal));
      }
    } catch (err: any) {
      setStatus(`Refresh error: ${err.reason || err.message}`);
    }
  };

  const handleApprove = async () => {
    if (!loanToken || !addresses.presage) return;
    setTxPending(true);
    setStatus("Approving USDT...");
    try {
      const tx = await loanToken.approve(
        addresses.presage,
        ethers.MaxUint256
      );
      setLastTxHash(tx.hash);
      await tx.wait();
      setStatus("USDT approved for Presage");
    } catch (err: any) {
      setStatus(`Error: ${err.reason || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

  const handleSupply = async () => {
    if (!presage || !supplyAmount) return;
    setTxPending(true);
    setStatus("Supplying USDT...");
    try {
      const amount = ethers.parseEther(supplyAmount);
      const tx = await presage.supply(BigInt(marketId), amount);
      setLastTxHash(tx.hash);
      setStatus(`Tx submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Supplied ${supplyAmount} USDT to market ${marketId}`);
      await refreshData();
    } catch (err: any) {
      setStatus(`Error: ${err.reason || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

  const handleWithdraw = async () => {
    if (!presage || !withdrawAmount) return;
    setTxPending(true);
    setStatus("Withdrawing USDT...");
    try {
      const amount = ethers.parseEther(withdrawAmount);
      const tx = await presage.withdraw(BigInt(marketId), amount);
      setLastTxHash(tx.hash);
      setStatus(`Tx submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Withdrew ${withdrawAmount} USDT from market ${marketId}`);
      await refreshData();
    } catch (err: any) {
      setStatus(`Error: ${err.reason || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

  return (
    <div className="card">
      <h2>Lender Panel</h2>
      <p className="hint">Supply USDT to earn interest from borrowers.</p>

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
          <label>USDT Balance</label>
          <div className="info-value">
            {usdtBalance !== null ? `${usdtBalance} USDT` : "—"}
          </div>
        </div>
      </div>

      <div className="action-row">
        <button className="btn btn-sm" onClick={refreshData}>
          Refresh Position
        </button>
        <button className="btn btn-sm" onClick={handleApprove} disabled={txPending}>
          Approve USDT
        </button>
      </div>

      <hr />

      {/* Supply */}
      <div className="form-inline">
        <input
          type="text"
          placeholder="Amount (e.g. 100)"
          value={supplyAmount}
          onChange={(e) => setSupplyAmount(e.target.value)}
        />
        <button
          className="btn btn-primary"
          onClick={handleSupply}
          disabled={txPending || !supplyAmount}
        >
          Supply
        </button>
      </div>

      {/* Withdraw */}
      <div className="form-inline">
        <input
          type="text"
          placeholder="Amount (e.g. 50)"
          value={withdrawAmount}
          onChange={(e) => setWithdrawAmount(e.target.value)}
        />
        <button
          className="btn btn-primary"
          onClick={handleWithdraw}
          disabled={txPending || !withdrawAmount}
        >
          Withdraw
        </button>
      </div>

      {/* Position Stats */}
      {position && (
        <div className="stats-grid">
          <h3>Your Lending Position</h3>
          <div className="stat">
            <span className="stat-label">Supply Assets</span>
            <span className="stat-value">
              {ethers.formatEther(position.supplyAssets)} USDT
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Supply Shares</span>
            <span className="stat-value">
              {position.supplyShares.toString()}
            </span>
          </div>
        </div>
      )}

      {totals && (
        <div className="stats-grid">
          <h3>Market Totals</h3>
          <div className="stat">
            <span className="stat-label">Total Supply</span>
            <span className="stat-value">
              {ethers.formatEther(totals.totalSupplyAssets)} USDT
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Total Borrow</span>
            <span className="stat-value">
              {ethers.formatEther(totals.totalBorrowAssets)} USDT
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Utilization</span>
            <span className="stat-value">
              {totals.totalSupplyAssets > 0n
                ? (
                    (Number(totals.totalBorrowAssets) * 100) /
                    Number(totals.totalSupplyAssets)
                  ).toFixed(2) + "%"
                : "0%"}
            </span>
          </div>
        </div>
      )}

      {status && (
        <div className={`status-msg ${status.startsWith("Error") ? "status-error" : "status-success"}`}>
          {status}
        </div>
      )}
    </div>
  );
}
