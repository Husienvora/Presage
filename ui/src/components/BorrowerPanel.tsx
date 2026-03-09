import { useState } from "react";
import { ethers, Contract } from "ethers";
import { usePresage } from "../context/PresageContext";
import { ERC20_ABI } from "../abis";

export default function BorrowerPanel() {
  const {
    presage,
    morpho,
    loanToken,
    ctfContract,
    factory,
    addresses,
    account,
    txPending,
    setTxPending,
    setLastTxHash,
    fetchMarket,
    fetchUserPosition,
    fetchMarketTotals,
  } = usePresage();

  const [marketId, setMarketId] = useState("1");
  const [depositAmount, setDepositAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [repayAmount, setRepayAmount] = useState("");
  const [releaseAmount, setReleaseAmount] = useState("");
  const [status, setStatus] = useState("");
  const [position, setPosition] = useState<any>(null);
  const [totals, setTotals] = useState<any>(null);
  const [ctfBalance, setCtfBalance] = useState<string | null>(null);
  const [usdtBalance, setUsdtBalance] = useState<string | null>(null);
  const [wrapperBalance, setWrapperBalance] = useState<string | null>(null);
  const [marketInfo, setMarketInfo] = useState<any>(null);

  const refreshData = async () => {
    if (!account || !presage) return;
    try {
      const mid = Number(marketId);
      const [pos, tot, mkt] = await Promise.all([
        fetchUserPosition(mid, account),
        fetchMarketTotals(mid),
        fetchMarket(mid),
      ]);
      setPosition(pos);
      setTotals(tot);
      setMarketInfo(mkt);

      // CTF balance
      if (ctfContract && mkt) {
        const bal = await ctfContract.balanceOf(account, mkt.ctfPosition.positionId);
        setCtfBalance(ethers.formatEther(bal));
      }

      // USDT balance
      if (loanToken) {
        const bal = await loanToken.balanceOf(account);
        setUsdtBalance(ethers.formatEther(bal));
      }

      // Wrapper balance
      if (mkt && mkt.morphoParams.collateralToken !== ethers.ZeroAddress) {
        const runner = presage.runner;
        const wrapper = new Contract(mkt.morphoParams.collateralToken, ERC20_ABI, runner);
        const bal = await wrapper.balanceOf(account);
        setWrapperBalance(ethers.formatEther(bal));
      }
    } catch (err: any) {
      setStatus(`Refresh error: ${err.reason || err.message}`);
    }
  };

  // Step 1: Approve CTF for Presage
  const handleApproveCTF = async () => {
    if (!ctfContract || !addresses.presage) return;
    setTxPending(true);
    setStatus("Approving CTF tokens...");
    try {
      const tx = await ctfContract.setApprovalForAll(addresses.presage, true);
      setLastTxHash(tx.hash);
      await tx.wait();
      setStatus("CTF approved for Presage");
    } catch (err: any) {
      setStatus(`Error: ${err.reason || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

  // Step 2: Authorize Presage on Morpho
  const handleAuthorizeMorpho = async () => {
    if (!morpho || !addresses.presage) return;
    setTxPending(true);
    setStatus("Authorizing Presage on Morpho...");
    try {
      const tx = await morpho.setAuthorization(addresses.presage, true);
      setLastTxHash(tx.hash);
      await tx.wait();
      setStatus("Presage authorized on Morpho");
    } catch (err: any) {
      setStatus(`Error: ${err.reason || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

  // Step 3: Approve USDT for repay
  const handleApproveUSDT = async () => {
    if (!loanToken || !addresses.presage) return;
    setTxPending(true);
    setStatus("Approving USDT...");
    try {
      const tx = await loanToken.approve(addresses.presage, ethers.MaxUint256);
      setLastTxHash(tx.hash);
      await tx.wait();
      setStatus("USDT approved for Presage");
    } catch (err: any) {
      setStatus(`Error: ${err.reason || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

  // Deposit collateral
  const handleDeposit = async () => {
    if (!presage || !depositAmount) return;
    setTxPending(true);
    setStatus("Depositing collateral...");
    try {
      const amount = ethers.parseEther(depositAmount);
      const tx = await presage.depositCollateral(BigInt(marketId), amount);
      setLastTxHash(tx.hash);
      setStatus(`Tx submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Deposited ${depositAmount} CTF as collateral`);
      await refreshData();
    } catch (err: any) {
      setStatus(`Error: ${err.reason || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

  // Borrow
  const handleBorrow = async () => {
    if (!presage || !borrowAmount) return;
    setTxPending(true);
    setStatus("Borrowing USDT...");
    try {
      const amount = ethers.parseEther(borrowAmount);
      const tx = await presage.borrow(BigInt(marketId), amount);
      setLastTxHash(tx.hash);
      setStatus(`Tx submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Borrowed ${borrowAmount} USDT`);
      await refreshData();
    } catch (err: any) {
      setStatus(`Error: ${err.reason || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

  // Repay
  const handleRepay = async () => {
    if (!presage || !repayAmount) return;
    setTxPending(true);
    setStatus("Repaying USDT...");
    try {
      const amount = ethers.parseEther(repayAmount);
      const tx = await presage.repay(BigInt(marketId), amount);
      setLastTxHash(tx.hash);
      setStatus(`Tx submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Repaid ${repayAmount} USDT`);
      await refreshData();
    } catch (err: any) {
      setStatus(`Error: ${err.reason || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

  // Release collateral
  const handleRelease = async () => {
    if (!presage || !releaseAmount) return;
    setTxPending(true);
    setStatus("Releasing collateral...");
    try {
      const amount = ethers.parseEther(releaseAmount);
      const tx = await presage.releaseCollateral(BigInt(marketId), amount);
      setLastTxHash(tx.hash);
      setStatus(`Tx submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Released ${releaseAmount} CTF collateral`);
      await refreshData();
    } catch (err: any) {
      setStatus(`Error: ${err.reason || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

  const formatHF = (hf: bigint) => {
    if (hf === ethers.MaxUint256) return "Infinity (no debt)";
    // hf is in WAD (1e18)
    const formatted = Number(ethers.formatEther(hf)).toFixed(4);
    return formatted;
  };

  return (
    <div className="card">
      <h2>Borrower Panel</h2>
      <p className="hint">
        Deposit CTF collateral, borrow USDT, repay, and release.
      </p>

      <div className="form-field" style={{ maxWidth: 200 }}>
        <label>Market ID</label>
        <input
          type="text"
          value={marketId}
          onChange={(e) => setMarketId(e.target.value)}
        />
      </div>

      {/* Balances */}
      <div className="balance-row">
        <span>CTF Balance: {ctfBalance ?? "—"}</span>
        <span>USDT Balance: {usdtBalance ?? "—"}</span>
        <span>wCTF Balance: {wrapperBalance ?? "—"}</span>
      </div>

      {/* Permissions */}
      <div className="action-row">
        <button className="btn btn-sm" onClick={refreshData}>
          Refresh
        </button>
        <button className="btn btn-sm" onClick={handleApproveCTF} disabled={txPending}>
          1. Approve CTF
        </button>
        <button className="btn btn-sm" onClick={handleAuthorizeMorpho} disabled={txPending}>
          2. Authorize Morpho
        </button>
        <button className="btn btn-sm" onClick={handleApproveUSDT} disabled={txPending}>
          3. Approve USDT (for repay)
        </button>
      </div>

      <hr />

      {/* Deposit Collateral */}
      <h3>Deposit Collateral</h3>
      <div className="form-inline">
        <input
          type="text"
          placeholder="CTF Amount"
          value={depositAmount}
          onChange={(e) => setDepositAmount(e.target.value)}
        />
        <button
          className="btn btn-primary"
          onClick={handleDeposit}
          disabled={txPending || !depositAmount}
        >
          Deposit
        </button>
      </div>

      {/* Borrow */}
      <h3>Borrow USDT</h3>
      <div className="form-inline">
        <input
          type="text"
          placeholder="USDT Amount"
          value={borrowAmount}
          onChange={(e) => setBorrowAmount(e.target.value)}
        />
        <button
          className="btn btn-primary"
          onClick={handleBorrow}
          disabled={txPending || !borrowAmount}
        >
          Borrow
        </button>
      </div>

      {/* Repay */}
      <h3>Repay USDT</h3>
      <div className="form-inline">
        <input
          type="text"
          placeholder="USDT Amount"
          value={repayAmount}
          onChange={(e) => setRepayAmount(e.target.value)}
        />
        <button
          className="btn btn-primary"
          onClick={handleRepay}
          disabled={txPending || !repayAmount}
        >
          Repay
        </button>
      </div>

      {/* Release Collateral */}
      <h3>Release Collateral</h3>
      <div className="form-inline">
        <input
          type="text"
          placeholder="CTF Amount"
          value={releaseAmount}
          onChange={(e) => setReleaseAmount(e.target.value)}
        />
        <button
          className="btn btn-primary"
          onClick={handleRelease}
          disabled={txPending || !releaseAmount}
        >
          Release
        </button>
      </div>

      {/* Position Stats */}
      {position && (
        <div className="stats-grid">
          <h3>Your Borrower Position</h3>
          <div className="stat">
            <span className="stat-label">Collateral (in Morpho)</span>
            <span className="stat-value">
              {ethers.formatEther(position.collateralAssets)} wCTF
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Debt</span>
            <span className="stat-value">
              {ethers.formatEther(position.borrowAssets)} USDT
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Health Factor</span>
            <span
              className={`stat-value ${
                position.healthFactor !== ethers.MaxUint256 &&
                Number(ethers.formatEther(position.healthFactor)) < 1.1
                  ? "hf-danger"
                  : "hf-safe"
              }`}
            >
              {formatHF(position.healthFactor)}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Supply Assets (if lending too)</span>
            <span className="stat-value">
              {ethers.formatEther(position.supplyAssets)} USDT
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Borrow Shares</span>
            <span className="stat-value">
              {position.borrowShares.toString()}
            </span>
          </div>
        </div>
      )}

      {/* Market info */}
      {marketInfo && (
        <div className="stats-grid">
          <h3>Market Details</h3>
          <div className="stat">
            <span className="stat-label">Wrapper (collateral token)</span>
            <span className="stat-value mono">
              {marketInfo.morphoParams.collateralToken}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Oracle</span>
            <span className="stat-value mono">
              {marketInfo.morphoParams.oracle}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">LLTV</span>
            <span className="stat-value">
              {(Number(ethers.formatEther(marketInfo.morphoParams.lltv)) * 100).toFixed(1)}%
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Resolution</span>
            <span className="stat-value">
              {new Date(Number(marketInfo.resolutionAt) * 1000).toLocaleString()}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">CTF Position ID</span>
            <span className="stat-value">
              {marketInfo.ctfPosition.positionId.toString()}
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
