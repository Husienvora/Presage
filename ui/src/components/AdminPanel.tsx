import { useState } from "react";
import { ethers } from "ethers";
import { usePresage } from "../context/PresageContext";

export default function AdminPanel() {
  const { presage, priceHub, addresses, account, txPending, setTxPending, setLastTxHash } =
    usePresage();

  // Open Market form
  const [positionId, setPositionId] = useState("1");
  const [oppositePositionId, setOppositePositionId] = useState("2");
  const [lltv, setLltv] = useState("0.77");
  const [resolutionDays, setResolutionDays] = useState("30");
  const [decayDays, setDecayDays] = useState("7");
  const [decayCooldownHours, setDecayCooldownHours] = useState("1");
  const [parentCollectionId, setParentCollectionId] = useState(ethers.ZeroHash);
  const [conditionId, setConditionId] = useState(ethers.ZeroHash);

  // Seed Price form
  const [seedPositionId, setSeedPositionId] = useState("1");
  const [seedPrice, setSeedPrice] = useState("1.0");

  // Status
  const [status, setStatus] = useState("");
  const [nextId, setNextId] = useState<string | null>(null);

  const handleOpenMarket = async () => {
    if (!presage || !addresses.ctf || !addresses.loanToken) {
      setStatus("Error: Presage and CTF address required");
      return;
    }
    setTxPending(true);
    setStatus("Opening market...");
    try {
      const ctfPos = {
        ctf: addresses.ctf,
        parentCollectionId,
        conditionId,
        positionId: BigInt(positionId),
        oppositePositionId: BigInt(oppositePositionId),
      };
      const resolutionAt =
        Math.floor(Date.now() / 1000) + Number(resolutionDays) * 86400;
      const decayDuration = Number(decayDays) * 86400;
      const decayCooldown = Number(decayCooldownHours) * 3600;

      const tx = await presage.openMarket(
        ctfPos,
        addresses.loanToken,
        ethers.parseEther(lltv),
        resolutionAt,
        decayDuration,
        decayCooldown
      );
      setLastTxHash(tx.hash);
      setStatus(`Tx submitted: ${tx.hash}`);
      const receipt = await tx.wait();
      setStatus(`Market opened! Gas used: ${receipt.gasUsed.toString()}`);

      // Fetch new nextMarketId
      const nid = await presage.nextMarketId();
      setNextId(nid.toString());
    } catch (err: any) {
      setStatus(`Error: ${err.reason || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

  const handleSeedPrice = async () => {
    if (!priceHub) {
      setStatus("Error: PriceHub not configured");
      return;
    }
    setTxPending(true);
    setStatus("Seeding price...");
    try {
      const probability = ethers.parseEther(seedPrice);
      const tx = await priceHub.seedPrice(BigInt(seedPositionId), probability);
      setLastTxHash(tx.hash);
      setStatus(`Tx submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(
        `Price seeded: position ${seedPositionId} = ${seedPrice} (${ethers.formatEther(probability)} in 18-dec)`
      );
    } catch (err: any) {
      setStatus(`Error: ${err.reason || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

  const handleFetchNextId = async () => {
    if (!presage) return;
    try {
      const nid = await presage.nextMarketId();
      setNextId(nid.toString());
    } catch (err: any) {
      setStatus(`Error: ${err.reason || err.message}`);
    }
  };

  return (
    <div className="card">
      <h2>Admin Panel</h2>
      <p className="hint">
        Only the Presage owner can open markets and seed prices.
        {account && <span> Connected as: <code>{account.slice(0, 10)}...</code></span>}
      </p>

      {/* Next Market ID */}
      <div className="info-row">
        <button className="btn btn-sm" onClick={handleFetchNextId}>
          Fetch Next Market ID
        </button>
        {nextId && <span className="info-value">Next ID: {nextId}</span>}
      </div>

      <hr />

      {/* Open Market */}
      <h3>Open Market</h3>
      <div className="form-grid form-grid-2col">
        <div className="form-field">
          <label>Position ID (YES token)</label>
          <input
            type="text"
            value={positionId}
            onChange={(e) => setPositionId(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>Opposite Position ID (NO token)</label>
          <input
            type="text"
            value={oppositePositionId}
            onChange={(e) => setOppositePositionId(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>Parent Collection ID</label>
          <input
            type="text"
            value={parentCollectionId}
            onChange={(e) => setParentCollectionId(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>Condition ID</label>
          <input
            type="text"
            value={conditionId}
            onChange={(e) => setConditionId(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>LLTV (e.g. 0.77 = 77%)</label>
          <input
            type="text"
            value={lltv}
            onChange={(e) => setLltv(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>Resolution (days from now)</label>
          <input
            type="text"
            value={resolutionDays}
            onChange={(e) => setResolutionDays(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>Decay Duration (days)</label>
          <input
            type="text"
            value={decayDays}
            onChange={(e) => setDecayDays(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>Decay Cooldown (hours)</label>
          <input
            type="text"
            value={decayCooldownHours}
            onChange={(e) => setDecayCooldownHours(e.target.value)}
          />
        </div>
      </div>
      <button
        className="btn btn-primary"
        onClick={handleOpenMarket}
        disabled={txPending}
      >
        {txPending ? "Submitting..." : "Open Market"}
      </button>

      <hr />

      {/* Seed Price */}
      <h3>Seed Price</h3>
      <p className="hint">
        Seeds a price directly on PriceHub (owner only). Probability: 0.0-1.0
        where 1.0 = $1 = 100% probability.
      </p>
      <div className="form-grid form-grid-2col">
        <div className="form-field">
          <label>Position ID</label>
          <input
            type="text"
            value={seedPositionId}
            onChange={(e) => setSeedPositionId(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>Probability (0.0 - 1.0)</label>
          <input
            type="text"
            value={seedPrice}
            onChange={(e) => setSeedPrice(e.target.value)}
          />
        </div>
      </div>
      <button
        className="btn btn-primary"
        onClick={handleSeedPrice}
        disabled={txPending}
      >
        {txPending ? "Submitting..." : "Seed Price"}
      </button>

      {/* Status */}
      {status && (
        <div className={`status-msg ${status.startsWith("Error") ? "status-error" : "status-success"}`}>
          {status}
        </div>
      )}
    </div>
  );
}
