# Vault Integration — Mainnet Readiness Gaps

Items that must be addressed before the allocator bot and vault are production-ready.

## Critical

### Allocator Concurrency Lock
Two bot instances submitting conflicting `reallocate()` transactions simultaneously can cause reverts or wasted gas. Add a Redis-based distributed lock (or file lock for single-node) around the `runAllocationCycle()` function.

### Nonce Management
Rapid-fire cycles or retry-on-revert can cause nonce gaps or stuck transactions. Use a nonce manager (ethers `NonceManager` or manual tracking) to serialize transaction submission.

### MetaMorpho Contract Size (EIP-170)
MetaMorpho compiles at 26,043 bytes (limit: 24,576). Currently bypassed with `allowUnlimitedContractSize: true` in Hardhat. On mainnet, use Morpho's officially deployed MetaMorphoFactory (if available on BNB) or deploy via a proxy pattern.

## High

### Dry-Run Mode
Add a `--dry-run` flag to the allocator that simulates `reallocate()` via `eth_call` without submitting. Log the proposed changes and exit. Essential for verifying config before going live.

### Gas Price Limit / Circuit Breaker
Add `MAX_GAS_PRICE_GWEI` env var. If gas exceeds this, skip the cycle and log a warning. Prevents overspending during network congestion.

### Monitoring / Health Endpoint
Add a simple HTTP health endpoint (e.g., Express on port 3001) that returns:
- Last cycle timestamp
- Last reallocation hash
- Current market states
- Redis connection status

### Oracle `positionId()` Failure Handling
In `readMarketStates()`, the catch block silently sets `hoursToDecayOnset = Infinity`. Non-Presage oracles bypass decay logic entirely. Add explicit logging and consider a fallback strategy.

## Medium

### Strategy Multi-Pass Cap Redistribution
When one market hits its cap, the excess currently sits idle. Implement a second pass: redistribute excess to uncapped markets proportionally.

### Alerting Integration
Send alerts (Slack, Telegram, or PagerDuty webhook) on:
- Reallocation failure
- Market approaching decay threshold
- Redis disconnection
- Gas price circuit breaker triggered

### Runbook / Ops Documentation
- Deployment playbook: who deploys the vault, in what order, with what multisig
- Bot restart policy, secret rotation procedure
- Incident response for stuck transactions or stale markets

## Low / Future

### Additional Fork Test Coverage
- Empty vault withdrawal (no deposits, attempt withdraw)
- Insufficient liquidity stress test (borrow > available)
- Multiple pending caps simultaneously
- Fee recipient set to zero address
- Large number of markets in queue (30, the max)

### Allocator Bot Integration Test
End-to-end test against a Hardhat fork that:
1. Deploys vault + Presage markets
2. Runs the allocator's `computeTargets` + `buildReallocatePayload` against real Morpho state
3. Submits `reallocate()` and verifies on-chain changes
