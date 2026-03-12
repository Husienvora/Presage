# Presage Protocol — Oracle Strategy Report

**Date**: March 12, 2026
**Author**: Presage Core Team
**Status**: Final

---

## 1. Executive Summary

Presage requires a price oracle to feed prediction market probabilities from predict.fun into its on-chain lending markets on BNB Chain. The ideal solution would use **zkTLS** (zero-knowledge Transport Layer Security) to cryptographically prove that price data originated from predict.fun's HTTPS endpoint — eliminating any trusted intermediary.

After evaluating every viable zkTLS provider in the ecosystem, we conclude that **no zkTLS protocol is production-ready for our use case today**. The primary blockers are TLS 1.3 incompatibility and protocol immaturity. Our current implementation — a signed relayer architecture with a pluggable verifier interface — is the correct production solution and is already designed for trustless upgrade when the ecosystem matures.

---

## 2. The TLS Version Consideration

### 2.1 Current State

predict.fun's API endpoints support **both TLS 1.2 and TLS 1.3** (verified via CDN77 TLS checker). This means TLS 1.2-only zkTLS protocols (like TLSNotary) can technically establish connections today.

However, this does **not** make TLS 1.2-only protocols viable for production. The TLS version is only one of several blockers — each protocol has independent maturity issues that prevent adoption regardless of TLS compatibility (see Section 3).

### 2.2 Why TLS 1.2 Dependency Is a Forward-Looking Risk

While predict.fun supports TLS 1.2 today, building production oracle infrastructure on this assumption is fragile:

- **TLS 1.2 deprecation is accelerating** — major CDN providers (Cloudflare, AWS CloudFront) are disabling TLS 1.2 by default
- **PCI DSS 4.0** (effective March 2025) recommends TLS 1.3 as the minimum
- predict.fun could disable TLS 1.2 at any time with no notice, breaking our oracle
- For a lending protocol, oracle failure means frozen markets or incorrect liquidations — this is not an acceptable dependency

### 2.3 How zkTLS Protocols Use TLS 1.2

Most zkTLS protocols work by inserting a third party (verifier/notary/attestor) into the TLS handshake using **multi-party computation (MPC)**. In TLS 1.2, this works because:

1. The **pre-master secret** can be split across two parties using 2-party ECDH
2. The **key derivation** (PRF) can be computed via garbled circuits over the split secret
3. The resulting session keys are **shared** — neither the prover nor the verifier holds the full key alone
4. Both parties cooperatively decrypt server responses, proving the data came from the authentic server

TLS 1.3 introduced fundamental changes (encrypted handshake, ephemeral-only keys, HKDF-based key schedule, removed renegotiation) that make this MPC insertion significantly harder. Protocols designed around TLS 1.2's structure require substantial rearchitecting to support TLS 1.3 — this work is on roadmaps but not shipped by any provider.

---

## 3. zkTLS Provider Evaluation

### 3.1 Provider Comparison

| Provider | TLS 1.2 (works today) | TLS 1.3 | Custom Endpoints | On-Chain Verifier | Automated | Primary Blocker |
|---|---|---|---|---|---|---|
| **TLSNotary** | Yes | No | Yes | **In development** | Yes | No Solidity verifier |
| **Reclaim** | N/A (scraping) | N/A | No | Yes | No | Scraping-based, not API-compatible |
| **zkPass** | Yes | Unconfirmed | Yes | Yes | **No (browser)** | Requires browser extension |
| **Primus** | Yes | Likely | Yes (templates) | Yes | Partial | **AlphaNet** — not production |
| **Brevis + APRO** | N/A | N/A | Yes | Yes (ZK coprocessor) | Yes | **No zkTLS SDK** (outsourced to Primus) |
| **Opacity** | Yes | No | No (accounts only) | Yes | No | Account attestation only |
| **Pluto** | Unconfirmed | Unconfirmed | Yes | Unconfirmed | Unconfirmed | Too early-stage |

> **Note:** predict.fun supports TLS 1.2 today, so TLS version is not the immediate blocker. The **primary blocker** for each protocol is listed in the last column. However, dependence on TLS 1.2 remains a forward-looking risk (see Section 2.2).

### 3.2 Detailed Provider Analysis

#### TLSNotary (TLSN)

- **What it does**: MPC-TLS protocol using garbled circuits and oblivious transfer. A Verifier co-participates in the TLS handshake via 2-party computation.
- **TLS**: Supports TLS 1.2 only. predict.fun accepts TLS 1.2, so connections work today. TLS 1.3 support is "on the roadmap" but no timeline given.
- **Strengths**: Fully open source (Ethereum Foundation grant), endpoint-agnostic, Rust SDK enables server-side automation.
- **Weaknesses**: No production Solidity verifier contract (the critical blocker), high bandwidth overhead (~25MB per session). Their GitHub repository carries the warning: *"This project is currently under active development and should not be used in production. Expect bugs and regular major breaking changes."*
- **Verdict**: Architecturally the closest to viable, but explicitly not production-ready by their own admission. Two blockers remain: the Solidity verifier and the project reaching stability.

#### Reclaim Protocol

- **What it does**: Proxy-based web proof system with pre-configured "providers" for specific websites.
- **TLS 1.3**: Not applicable — Reclaim works by **scraping rendered web pages**, not by participating in the TLS handshake. Providers are defined by HTML selectors and page structure.
- **Why it doesn't work for us**: We investigated Reclaim directly. Their provider model requires defining data extraction rules based on DOM scraping of specific web pages. predict.fun's price data comes from a JSON API endpoint, not a rendered webpage. Defining a Reclaim provider for a raw API response is unsupported by their architecture. Additionally, provider definitions are brittle — any frontend redesign by predict.fun would break the provider.
- **Verdict**: Wrong tool for API-based data. Designed for user-facing web pages, not programmatic endpoints.

#### zkPass

- **What it does**: 3-party TLS protocol using MPC, with a browser extension (TransGate) that intercepts network requests.
- **TLS 1.3**: Not explicitly confirmed in their documentation. Their whitepaper describes the MPC protocol over "elliptic curve DH" without specifying TLS version compatibility.
- **Strengths**: Production-ready, custom schema system for arbitrary API endpoints, Solidity verifier deployed on BNB Chain.
- **Critical limitation**: Proof generation requires the **TransGate browser extension**. A human operator must have the extension installed and manually trigger proof generation through a browser session. This makes automated, periodic price feeds impossible without a human in the loop.
- **Verdict**: Cannot automate. Unsuitable for an oracle that must update prices programmatically.

#### Primus (formerly PADO Labs)

- **What it does**: Dual-mode zkTLS — MPC mode (garbled circuits with "garble-then-prove" technique) and Proxy mode (QuickSilver protocol). Attestors witness the TLS session and produce verifiable proofs.
- **TLS 1.3**: Architecturally compatible. Their whitepaper states the protocol "can be extended to TLS 1.3," and the Proxy mode's approach to proving Key Derivation Functions during TLS connection establishment is not structurally limited to TLS 1.2. However, **explicit production confirmation of TLS 1.3 is absent**.
- **Strengths**: Public npm SDKs (`@primuslabs/zktls-js-sdk`, `@primuslabs/zktls-core-sdk`), Solidity verifier contracts on GitHub, template-based system for custom endpoints, 14x communication improvement over DECO.
- **Weaknesses**: Still labeled **"AlphaNet"** — not production-hardened. Template creation requires registration at their Developer Hub. Attestor network reliability is unproven at scale.
- **Verdict**: Most promising candidate for future integration. Needs to reach mainnet stability.

#### Brevis + APRO

- **What it does**: Brevis provides a ZK coprocessor (Pico zkVM) for computation; APRO provides oracle infrastructure. Together they aim to build trust-free prediction market oracles on BNB Chain.
- **Reality check**: Brevis **does not have its own zkTLS implementation**. Their "zkTLS" capability is provided by **Primus** as a partner. Brevis's GitHub organization (94 repositories) contains zero TLS-related code. Their shipped product is the ZK Data Coprocessor, which only processes **on-chain** data (Ethereum receipts, storage proofs, transactions).
- **Status**: The Brevis+APRO prediction market oracle is described as "actively developing, more details to come" (January 2026 blog post). Not available to developers.
- **Verdict**: Vaporware for our use case today. The underlying tech (Primus) is worth tracking independently.

#### Opacity Network

- **What it does**: MPC-TLS built on TLSNotary, with Intel SGX secure enclaves for notary nodes and EigenLayer AVS for economic security.
- **TLS 1.3**: No — inherits TLSNotary's TLS 1.2 limitation.
- **Scope**: Focused exclusively on **account attestation** (proving ownership of LinkedIn, Twitter, Spotify accounts). Does not support arbitrary API data extraction.
- **Verdict**: Wrong scope entirely.

#### Pluto

- **What it does**: "The API for personal web data" — generates Web Proofs on-demand from internet servers using TEE mode and Origo (proxy-based) mode.
- **TLS 1.3**: Not confirmed.
- **Status**: Early stage. Working demos limited to Venmo and Reddit. Sparse developer documentation. No confirmed Solidity verifier or BNB Chain support.
- **Verdict**: Too early to evaluate.

#### OpenLayer

- **What it does**: "Validation as a Service" protocol for HTTPS TLS session data using 3-party TLS with selective hiding.
- **Status**: Minimal public documentation. No developer SDK or integration guides found.
- **Verdict**: Too early to evaluate.

---

## 4. Why the Current Implementation Is Correct

### 4.1 Architecture Overview

Our current oracle architecture uses a **signed relayer** pattern:

```
predict.fun API (TLS 1.3)
        |
   [Relayer Bot]          ← Off-chain: fetches price, signs attestation
        |
        v
SignedProofVerifier.sol   ← On-chain: ECDSA recovery, checks signer == authorized relayer
        |
        v
PullPriceAdapter.sol      ← On-chain: validates freshness, bounds, caches price
        |
        v
PriceHub.sol              ← On-chain: stores price, applies LLTV decay, feeds Morpho oracle
```

### 4.2 Why This Is the Right Choice Today

**TLS 1.3 compatibility**: The relayer connects to predict.fun using standard HTTPS (TLS 1.3). No protocol-level constraints on TLS version — it uses whatever the server supports.

**No browser dependency**: The relayer is a headless server process. No browser extensions, no human interaction required. Prices update automatically on any schedule.

**Battle-tested pattern**: This is the same architecture used by Chainlink (off-chain nodes sign price reports), Pyth (publishers sign price attestations), and RedStone (data packages with ECDSA signatures). Every major oracle network in production today uses a variant of signed relayer.

**Defense in depth**: Multiple safety layers protect against relayer compromise:
- `PullPriceAdapter`: monotonic timestamp guard (`ts > cache.updatedAt`) prevents replay
- `PullPriceAdapter`: probability bounds check (`prob <= 1e18`)
- `PriceHub`: `maxStaleness` parameter freezes markets if the relayer goes offline (fail-safe)
- `PriceHub`: LLTV decay reduces maximum borrowing power as resolution approaches
- Morpho Blue: health factor enforcement prevents borrowing beyond collateral value

**Pluggable verifier interface**: The `IProofVerifier` interface abstracts the proof verification mechanism:

```solidity
interface IProofVerifier {
    function verify(bytes calldata proof)
        external view
        returns (uint256 timestamp, uint256 positionId, uint256 price);
}
```

`PullPriceAdapter` supports **multiple verifiers simultaneously** via its `mapping(address => bool) public verifiers` registry. This means we can add a zkTLS verifier alongside the signed relayer without removing the existing one.

### 4.3 Trust Model — Honest Assessment

The signed relayer introduces a single point of trust: the relayer's private key. If compromised, an attacker could submit false prices and trigger illegitimate liquidations. This risk is mitigated by:

- Key management best practices (hardware wallet, key rotation via `setRelayer()`)
- On-chain bounds checking (probability must be 0–1)
- Staleness limits (relayer failure = market freeze, not market manipulation)
- The relayer has no ability to steal funds directly — it can only influence the oracle price

This is an acceptable trust tradeoff for launch. Every DeFi protocol that went to market before trustless oracles existed (all of them) made this same tradeoff.

---

## 5. Migration Path to Trustless Oracle

When a zkTLS protocol matures to production readiness, the migration is minimal due to the pluggable architecture:

### Step 1: Deploy a New Verifier Contract

Write a contract implementing `IProofVerifier` that wraps the zkTLS provider's verification logic:

```solidity
contract ZkTlsProofVerifier is IProofVerifier {
    function verify(bytes calldata proof)
        external view
        returns (uint256 timestamp, uint256 positionId, uint256 price)
    {
        // Decode and verify the zkTLS proof using the provider's on-chain verifier
        // Extract timestamp, positionId, and price from the verified payload
    }
}
```

### Step 2: Register the New Verifier

```solidity
pullPriceAdapter.setVerifier(address(zkTlsVerifier), true);
```

At this point, **both** the signed relayer and the zkTLS verifier are active. Either can submit valid prices. This enables a parallel-run period for validation.

### Step 3: Validate in Parallel

Run both systems simultaneously. Compare prices submitted by the signed relayer against prices submitted via zkTLS proofs. Confirm they agree within acceptable tolerance over a sustained period.

### Step 4: Deprecate the Signed Relayer

Once confidence is established:

```solidity
pullPriceAdapter.setVerifier(address(signedProofVerifier), false);
```

The signed relayer is disabled. The oracle is now fully trustless.

### Step 5: Update Price Submission Flow

Replace the relayer bot with a permissionless system:
- Anyone can fetch predict.fun's price, generate a zkTLS proof, and submit it on-chain
- Incentivize submissions via keeper rewards or integrate with existing keeper networks
- The `PullPriceAdapter` validates the proof regardless of who submitted it

---

## 6. Protocols to Monitor

### Tier 1 — Track Actively

| Protocol | Watch For | Why |
|---|---|---|
| **Primus** | Mainnet launch (exit AlphaNet), explicit TLS 1.3 confirmation | Most complete SDK and on-chain verifier today. Closest to production. |
| **Brevis + APRO** | Public zkTLS SDK release, prediction market oracle availability | Building exactly our use case on BNB Chain, but dependent on Primus for TLS proofs. |

### Tier 2 — Check Quarterly

| Protocol | Watch For | Why |
|---|---|---|
| **TLSNotary** | TLS 1.3 support, Solidity verifier contract | Best open-source foundation. Once these two ship, it becomes a strong candidate. |
| **Pluto** | Production launch, on-chain verifier, BNB Chain support | Right positioning ("API for any internet data") but too early today. |

### Tier 3 — Revisit if Landscape Shifts

| Protocol | Note |
|---|---|
| **zkPass** | Only relevant if they release a server-side SDK (no browser extension). |
| **Opacity** | Only relevant if they expand beyond account attestation to arbitrary API data. |
| **OpenLayer** | Insufficient documentation to evaluate. Revisit if they publish developer docs. |

---

## 7. Conclusion

The zkTLS ecosystem is not ready for production use in DeFi oracles. While predict.fun supports TLS 1.2 today (removing the immediate TLS version blocker), every evaluated protocol has independent maturity issues that prevent production adoption: TLSNotary lacks an on-chain verifier, zkPass requires a browser extension, Primus is in AlphaNet, and Brevis has no zkTLS SDK. Building on TLS 1.2 also carries forward-looking deprecation risk.

Our signed relayer architecture is:
- **Compatible** with TLS 1.3 (and any future TLS version)
- **Production-proven** (same pattern as Chainlink, Pyth, RedStone)
- **Future-proofed** via the `IProofVerifier` interface for drop-in zkTLS upgrade
- **Safe by default** (staleness limits, bounds checks, decay curves)

When the ecosystem matures — most likely through Primus reaching mainnet — the migration requires deploying one contract and calling one function. No changes to `PullPriceAdapter`, `PriceHub`, `Presage`, or any downstream contract.

---

*This report reflects the state of the zkTLS ecosystem as of March 2026. The space is evolving rapidly and should be reassessed quarterly.*
