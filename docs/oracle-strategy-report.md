# Presage Protocol — Oracle Strategy Report

**Date**: March 12, 2026
**Author**: Presage Core Team
**Status**: Final

---

## 1. Executive Summary

Presage requires a price oracle to feed prediction market probabilities from predict.fun into its on-chain lending markets on BNB Chain. The ideal solution would use **zkTLS** (zero-knowledge Transport Layer Security) to cryptographically prove that price data originated from predict.fun's HTTPS endpoint — eliminating any trusted intermediary.

After evaluating every viable zkTLS provider in the ecosystem, we conclude that **Reclaim Protocol is the only zkTLS solution viable for our use case today** — its `zk-fetch` library supports TLS 1.3, works with JSON API endpoints, and has a production on-chain verifier on BNB Chain. We successfully generated and verified a proof from predict.fun's orderbook API. However, Reclaim carries operational fragility . Our production architecture uses a **signed relayer as the primary oracle** with Reclaim as an authorized secondary verifier, providing both reliability and a path toward trustlessness.

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

| Provider          | TLS 1.2 (works today) | TLS 1.3     | Custom Endpoints   | On-Chain Verifier    | Automated        | Primary Blocker                          |
| ----------------- | --------------------- | ----------- | ------------------ | -------------------- | ---------------- | ---------------------------------------- |
| **TLSNotary**     | Yes                   | No          | Yes                | **In development**   | Yes              | No Solidity verifier                     |
| **Reclaim**       | Yes                   | **Yes**     | **Yes** (zk-fetch) | **Yes** (BNB)        | **Yes**          | Operational fragility (3-party TLS dep.) |
| **zkPass**        | Yes                   | Unconfirmed | Yes                | Yes                  | **No (browser)** | Requires browser extension               |
| **Primus**        | Yes                   | Likely      | Yes (templates)    | Yes                  | Partial          | **AlphaNet** — not production            |
| **Brevis + APRO** | N/A                   | N/A         | Yes                | Yes (ZK coprocessor) | Yes              | **No zkTLS SDK** (outsourced to Primus)  |
| **Opacity**       | Yes                   | No          | No (accounts only) | Yes                  | No               | Account attestation only                 |
| **Pluto**         | Unconfirmed           | Unconfirmed | Yes                | Unconfirmed          | Unconfirmed      | Too early-stage                          |

> **Note:** predict.fun supports both TLS 1.2 and 1.3. **Reclaim Protocol is the only provider that is viable today** — it supports TLS 1.3, works with JSON API endpoints, and has a production on-chain verifier. All other protocols have independent maturity blockers listed in the last column.

### 3.2 Detailed Provider Analysis

#### TLSNotary (TLSN)

- **What it does**: MPC-TLS protocol using garbled circuits and oblivious transfer. A Verifier co-participates in the TLS handshake via 2-party computation.
- **TLS**: Supports TLS 1.2 only. predict.fun accepts TLS 1.2, so connections work today. TLS 1.3 support is "on the roadmap" but no timeline given.
- **Strengths**: Fully open source (Ethereum Foundation grant), endpoint-agnostic, Rust SDK enables server-side automation.
- **Weaknesses**: No production Solidity verifier contract (the critical blocker), high bandwidth overhead (~25MB per session). Their GitHub repository carries the warning: _"This project is currently under active development and should not be used in production. Expect bugs and regular major breaking changes."_
- **Verdict**: Architecturally the closest to viable, but explicitly not production-ready by their own admission. Two blockers remain: the Solidity verifier and the project reaching stability.

#### Reclaim Protocol (**Viable — Deployed as Secondary Verifier**)

- **What it does**: Witness-based web proof system. The `@reclaimprotocol/zk-fetch` npm package generates verifiable proofs of HTTP responses by having Reclaim's witness network observe the TLS session and sign attestations.
- **TLS 1.3**: **Supported.** zk-fetch uses standard HTTPS and supports TLS 1.3 connections. Successfully tested against predict.fun's API (which uses TLS 1.2/1.3 via CDN77).
- **Custom endpoints**: **Yes.** zk-fetch supports arbitrary URL fetching with regex-based data extraction from JSON responses. Not limited to scraping — works natively with JSON APIs.
- **On-chain verifier**: **Yes.** Reclaim singleton deployed on BNB mainnet at `0x5917FaB4808A119560dfADc14F437ae1455AEd40`. Verifies witness signatures and epoch validity.
- **Automation**: **Yes.** zk-fetch is a Node.js library — fully automatable from a server-side process. No browser required.
- **Verified PoC**: We successfully generated a proof from `https://api.predict.fun/v1/markets/900/orderbook` using zk-fetch with regex extraction of `lastOrderSettled.price`. The proof was verified both off-chain (`verifyProof()`) and transformed for on-chain submission (`transformForOnchain()`). See `scripts/reclaim-proof-test.ts`.
- **Fragility risk**: Reclaim's witnesses must negotiate TLS directly with the data source. If the data source updates its TLS configuration in a way the witnesses can't handle, proofs stop generating with no on-chain fix.
- **Our integration**: `ReclaimVerifier.sol` is deployed as a platform-agnostic verifier with endpoint whitelisting and `(endpoint, marketId) → positionId` mapping. It is authorized alongside `SignedProofVerifier` in `PullPriceAdapter`, so either verifier can submit prices. The signed relayer serves as the reliable primary; Reclaim provides a trustless secondary path.
- **Verdict**: **Viable today as a secondary verifier.** Not suitable as the sole oracle due to the possibility of fragility . The dual-verifier architecture (signed relayer + Reclaim) provides both operational reliability and a path toward full trustlessness.

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

Our oracle architecture uses a **dual-verifier** pattern — signed relayer (primary) + Reclaim zkTLS (secondary):

```
predict.fun API (TLS 1.2/1.3)
        |
   ┌────┴────┐
   |         |
[Relayer]  [zk-fetch Microservice]
   |         |
   v         v
SignedProof  ReclaimVerifier.sol ← On-chain: Reclaim singleton verification,
Verifier.sol                       endpoint whitelist, position mapping
   |         |
   └────┬────┘
        v
PullPriceAdapter.sol      ← On-chain: multiple verifiers authorized, validates freshness/bounds
        |
        v
PriceHub.sol              ← On-chain: stores price, applies LLTV decay, feeds Morpho oracle
```

Either verifier path can submit valid prices. The signed relayer provides reliability; Reclaim provides trustless verification. If Reclaim's witnesses fail , the signed relayer continues operating. If the relayer key is compromised, Reclaim proofs still anchor the price to real API data.

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

## 5. Migration Path to Fully Trustless Oracle

Reclaim is already deployed as a secondary verifier. The path to a fully trustless oracle:

### Current State: Dual Verifier (Signed Relayer + Reclaim)

Both `SignedProofVerifier` and `ReclaimVerifier` are authorized in `PullPriceAdapter`. Either can submit valid prices. The signed relayer provides reliability; Reclaim provides trustless verification.

### Step 1: Validate in Parallel

Run both systems simultaneously. Compare prices submitted by the signed relayer against prices submitted via Reclaim proofs. Confirm they agree within acceptable tolerance over a sustained period. Monitor Reclaim witness reliability and proof generation latency.

### Step 2: Deprecate the Signed Relayer

Once Reclaim (or another zkTLS provider) demonstrates sustained reliability:

```solidity
pullPriceAdapter.setVerifier(address(signedProofVerifier), false);
```

The signed relayer is disabled. The oracle is now fully trustless.

### Step 3: Permissionless Submission

Replace the centralized zk-fetch microservice with a permissionless system:

- Anyone can fetch the prediction market price, generate a zk-fetch proof, and submit it on-chain
- Incentivize submissions via keeper rewards or integrate with existing keeper networks
- The `PullPriceAdapter` validates the proof regardless of who submitted it

### Adding Future zkTLS Providers

When additional providers mature (e.g., Primus, TLSNotary), deploy a new `IProofVerifier` and register it:

```solidity
pullPriceAdapter.setVerifier(address(newZkTlsVerifier), true);
```

No changes to `PullPriceAdapter`, `PriceHub`, `Presage`, or any downstream contract.

---

## 6. Protocols to Monitor

### Tier 1 — Actively Deployed or Tracked

| Protocol          | Status                                                      | Watch For                                                                                            |
| ----------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Reclaim**       | **Deployed** as secondary verifier alongside signed relayer | Witness network reliability improvements, reduced TLS fragility, expanded chain support              |
| **Primus**        | Tracking                                                    | Mainnet launch (exit AlphaNet), explicit TLS 1.3 confirmation. Most complete alternative SDK.        |
| **Brevis + APRO** | Tracking                                                    | Public zkTLS SDK release, prediction market oracle availability. Dependent on Primus for TLS proofs. |

### Tier 2 — Check Quarterly

| Protocol      | Watch For                                               | Why                                                                              |
| ------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **TLSNotary** | TLS 1.3 support, Solidity verifier contract             | Best open-source foundation. Once these two ship, it becomes a strong candidate. |
| **Pluto**     | Production launch, on-chain verifier, BNB Chain support | Right positioning ("API for any internet data") but too early today.             |

### Tier 3 — Revisit if Landscape Shifts

| Protocol      | Note                                                                            |
| ------------- | ------------------------------------------------------------------------------- |
| **zkPass**    | Only relevant if they release a server-side SDK (no browser extension).         |
| **Opacity**   | Only relevant if they expand beyond account attestation to arbitrary API data.  |
| **OpenLayer** | Insufficient documentation to evaluate. Revisit if they publish developer docs. |

---

## 7. Conclusion

**Reclaim Protocol is viable today** — we verified this by generating and verifying a proof from predict.fun's orderbook API using `zk-fetch`. It supports TLS 1.3, works with JSON endpoints, and has a production on-chain verifier on BNB Chain. However

The remaining zkTLS providers are not production-ready: TLSNotary lacks an on-chain verifier and explicitly warns against production use, zkPass requires a browser extension, Primus is in AlphaNet, and Brevis has no zkTLS SDK.

Our **dual-verifier architecture** is:

- **Reliable** — signed relayer operates independently of witness network health
- **Trustless-capable** — Reclaim verifier provides cryptographic proof of API data
- **Resilient** — either path can serve prices; failure of one doesn't freeze the protocol
- **Production-proven** — signed relayer follows the Chainlink/Pyth/RedStone pattern
- **Safe by default** — staleness limits, bounds checks, decay curves

The `ReclaimVerifier` is deployed as a platform-agnostic contract with endpoint whitelisting, supporting multiple prediction markets from a single instance. As the zkTLS ecosystem matures — particularly Primus reaching mainnet or TLSNotary shipping a Solidity verifier — additional verifiers can be added via `pullPriceAdapter.setVerifier()` with zero changes to downstream contracts.

---

_This report reflects the state of the zkTLS ecosystem as of March 2026. The space is evolving rapidly and should be reassessed quarterly._
