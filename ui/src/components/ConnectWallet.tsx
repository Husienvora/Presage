import { usePresage } from "../context/PresageContext";

export default function ConnectWallet() {
  const { account, chainId, isCorrectChain, connect, switchChain } =
    usePresage();

  if (!account) {
    return (
      <div className="card connect-card">
        <h2>Connect Wallet</h2>
        <p>Connect your MetaMask wallet to begin testing on BNB Chain mainnet.</p>
        <button className="btn btn-primary" onClick={connect}>
          Connect MetaMask
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-bar">
      <span className="wallet-address" title={account}>
        {account.slice(0, 6)}...{account.slice(-4)}
      </span>
      <span className={`chain-badge ${isCorrectChain ? "chain-ok" : "chain-wrong"}`}>
        {isCorrectChain ? "BNB Chain" : `Chain ${chainId}`}
      </span>
      {!isCorrectChain && (
        <button className="btn btn-sm" onClick={switchChain}>
          Switch to BNB
        </button>
      )}
    </div>
  );
}
