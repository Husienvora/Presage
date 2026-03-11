# Reclaim Protocol (zkTLS) Integration Guide

This guide explains how to integrate **Reclaim Protocol** with Presage to create trustless, decentralized price oracles for **predict.fun** markets, specifically handling **TLS 1.3** requirements.

---

## 1. Why Reclaim Protocol?

Many prediction market APIs (including `predict.fun`) enforce **TLS 1.3** for security. Traditional zkTLS solutions limited to TLS 1.2 will fail to verify these sessions.

**Reclaim Protocol** supports:
- **TLS 1.3 Handshakes:** Allowing it to prove data from modern APIs.
- **Selective Disclosure:** Proving a specific price value without revealing API keys or session data.
- **On-Chain Verification:** A deployed singleton verifier on BNB Chain that plugs into Presage's `PullPriceAdapter`.

---

## 2. Architecture

```
predict.fun API  ──(TLS 1.3)──>  Reclaim Witness Network
                                        │
                                   signs proof
                                        │
                                        ▼
User/Bot  ──(proof bytes)──>  PullPriceAdapter.submitPrice()
                                        │
                              abi.decode(verifier, proof)
                                        │
                                        ▼
                              ReclaimVerifier.verify()
                                 │ verifyProof() → Reclaim singleton
                                 │ extract provider check
                                 │ parse price from context JSON
                                 │ return (timestamp, positionId, price)
                                        │
                                        ▼
                              PriceHub.recordPrice()
```

---

## 3. Setting Up the Reclaim Provider

Create a "Provider" at [https://dev.reclaimprotocol.org](https://dev.reclaimprotocol.org):

- **URL:** `https://api.predict.fun/v1/markets/{{marketId}}`
- **Method:** `GET`
- **Response Selection (JSONPath):** `$.lastPrice`
- **TLS Version:** Ensure TLS 1.3 is enabled

The provider's `context` field in proofs will contain:
```json
{"extractedParameters":{"lastPrice":"0.65"},"providerHash":"0x..."}
```

---

## 4. Contract: `ReclaimVerifier.sol`

The contract is fully implemented at `contracts/oracle/ReclaimVerifier.sol`. It:

1. **Verifies** the proof via the deployed Reclaim singleton (`IReclaim.verifyProof`)
2. **Validates** the provider string matches the expected source
3. **Extracts** the price from the proof's `context` JSON field
4. **Parses** the decimal string (e.g. `"0.65"`) into 18-decimal WAD format
5. **Returns** `(timestamp, positionId, price)` matching `IProofVerifier`

### Constructor Parameters

| Parameter | Description | Example |
|---|---|---|
| `_reclaimAddress` | Reclaim singleton on BNB Chain | `0xF93F082989c938d61B93f0b2404Ab6873155f938` |
| `_positionId` | CTF position ID this verifier maps to | `123` |
| `_provider` | Expected provider string from Reclaim portal | `"predict-fun-market"` |
| `_priceField` | JSON key in context holding the price | `"lastPrice"` |

### Deployment

```bash
VERIFIER_TYPE=RECLAIM \
RECLAIM_PROVIDER="your-provider-string" \
RECLAIM_PRICE_FIELD="lastPrice" \
npx hardhat run scripts/launch-predict-fun.ts --network bnb
```

---

## 5. Integration with PullPriceAdapter

### Step 1: Deploy & Authorize

```typescript
const ReclaimVerifier = await ethers.getContractFactory("ReclaimVerifier");
const verifier = await ReclaimVerifier.deploy(
    "0xF93F082989c938d61B93f0b2404Ab6873155f938", // Reclaim singleton
    positionId,                                     // CTF position
    "predict-fun-market",                           // provider string
    "lastPrice"                                     // price field
);

await pullPriceAdapter.setVerifier(await verifier.getAddress(), true);
```

### Step 2: Generate Proof (Off-Chain)

Use `@reclaimprotocol/js-sdk` in your bot or frontend:

```typescript
import { ReclaimProofRequest } from "@reclaimprotocol/js-sdk";

const reclaimProofRequest = await ReclaimProofRequest.init(APP_ID, APP_SECRET, PROVIDER_ID);
const url = await reclaimProofRequest.getRequestUrl();

// User or bot performs the zkTLS handshake and gets the proof
const proof = await reclaimProofRequest.startSession({
    onSuccess: (proofData) => proofData,
    onError: (err) => { throw err; }
});
```

### Step 3: Submit to Chain

ABI-encode the proof and submit through the PullPriceAdapter:

```typescript
const proofBytes = ethers.AbiCoder.defaultAbiCoder().encode(
    [
        "tuple(" +
            "tuple(string provider, string parameters, string context) claimInfo, " +
            "tuple(" +
                "tuple(bytes32 identifier, address owner, uint32 timestampS, uint32 epoch) claim, " +
                "bytes[] signatures" +
            ") signedClaim" +
        ")"
    ],
    [proof]
);

const submitData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "bytes"],
    [reclaimVerifierAddress, proofBytes]
);

await pullPriceAdapter.submitPrice(positionId, submitData);
```

---

## 6. Reclaim Singleton Addresses

| Chain | Address |
|---|---|
| BNB Mainnet | `0xF93F082989c938d61B93f0b2404Ab6873155f938` |

Verify the current address at [Reclaim docs](https://docs.reclaimprotocol.org).

---

## 7. Security Notes

- **TLS 1.3 & PFS:** Reclaim uses a witness network where decentralized nodes attest to the encrypted TLS stream, so proofs remain valid even with Perfect Forward Secrecy.
- **Provider Pinning:** The contract checks that proofs come from the expected provider string, preventing cross-provider spoofing.
- **Price Bounds:** The contract enforces `price <= 1e18` (max 100% probability).
- **Freshness:** The `PullPriceAdapter` enforces that new proofs must have a timestamp newer than the last recorded price.
