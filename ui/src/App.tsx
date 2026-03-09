import { useState } from "react";
import { usePresage } from "./context/PresageContext";
import ConnectWallet from "./components/ConnectWallet";
import Configure from "./components/Configure";
import AdminPanel from "./components/AdminPanel";
import LenderPanel from "./components/LenderPanel";
import BorrowerPanel from "./components/BorrowerPanel";
import Dashboard from "./components/Dashboard";
import "./App.css";

type Tab = "configure" | "admin" | "lender" | "borrower" | "dashboard";

export default function App() {
  const { account, isCorrectChain, lastTxHash } = usePresage();
  const [tab, setTab] = useState<Tab>("configure");

  const tabs: { id: Tab; label: string }[] = [
    { id: "configure", label: "Configure" },
    { id: "admin", label: "Admin" },
    { id: "lender", label: "Lend" },
    { id: "borrower", label: "Borrow" },
    { id: "dashboard", label: "Dashboard" },
  ];

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1>Presage Protocol</h1>
          <span className="subtitle">Mainnet Test UI</span>
        </div>
        <ConnectWallet />
      </header>

      {lastTxHash && (
        <div className="tx-banner">
          Last tx:{" "}
          <a
            href={`https://bscscan.com/tx/${lastTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {lastTxHash.slice(0, 10)}...{lastTxHash.slice(-8)}
          </a>
        </div>
      )}

      {account && !isCorrectChain && (
        <div className="warning-banner">
          Wrong network. Please switch to BNB Smart Chain (chain ID 56).
        </div>
      )}

      <nav className="tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "tab-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="main">
        {!account && tab !== "configure" ? (
          <div className="card">
            <p>Connect your wallet first.</p>
          </div>
        ) : (
          <>
            {tab === "configure" && <Configure />}
            {tab === "admin" && <AdminPanel />}
            {tab === "lender" && <LenderPanel />}
            {tab === "borrower" && <BorrowerPanel />}
            {tab === "dashboard" && <Dashboard />}
          </>
        )}
      </main>

      <footer className="footer">
        <span>
          Presage Protocol v0.1.0 — Testing UI for mainnet validation
        </span>
        <span className="footer-links">
          <a
            href="https://bscscan.com/address/0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a"
            target="_blank"
            rel="noopener noreferrer"
          >
            Morpho Blue
          </a>
        </span>
      </footer>
    </div>
  );
}
