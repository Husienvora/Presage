import { useState } from "react";
import { usePresage, Addresses } from "../context/PresageContext";

export default function Configure() {
  const { addresses, setAddresses, isConfigured } = usePresage();
  const [local, setLocal] = useState<Addresses>(addresses);

  const fields: { key: keyof Addresses; label: string; hint: string }[] = [
    {
      key: "presage",
      label: "Presage Router",
      hint: "Main protocol contract",
    },
    {
      key: "factory",
      label: "WrapperFactory",
      hint: "EIP-1167 clone factory",
    },
    {
      key: "priceHub",
      label: "PriceHub",
      hint: "Oracle registry",
    },
    {
      key: "morpho",
      label: "Morpho Blue",
      hint: "0x01b0...83a on BNB",
    },
    {
      key: "loanToken",
      label: "Loan Token (USDT)",
      hint: "0x55d3...955 on BNB",
    },
    {
      key: "ctf",
      label: "CTF Contract",
      hint: "ERC1155 prediction market tokens",
    },
  ];

  const handleSave = () => {
    setAddresses(local);
  };

  return (
    <div className="card">
      <h2>Contract Addresses</h2>
      <p className="hint">
        Deploy contracts first with{" "}
        <code>npx hardhat run deploy.ts --network bnb</code>, then paste the
        addresses here. They are saved to localStorage.
      </p>

      <div className="form-grid">
        {fields.map(({ key, label, hint }) => (
          <div key={key} className="form-field">
            <label>
              {label}
              <span className="field-hint">{hint}</span>
            </label>
            <input
              type="text"
              placeholder="0x..."
              value={local[key]}
              onChange={(e) => setLocal({ ...local, [key]: e.target.value.trim() })}
              className={local[key] ? "input-filled" : ""}
            />
          </div>
        ))}
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" onClick={handleSave}>
          Save Addresses
        </button>
        <span className={`status-badge ${isConfigured ? "status-ok" : "status-warn"}`}>
          {isConfigured ? "Configured" : "Missing required addresses"}
        </span>
      </div>
    </div>
  );
}
