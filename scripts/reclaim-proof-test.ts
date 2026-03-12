/**
 * Reclaim Protocol zk-fetch Proof of Concept
 *
 * Tests whether we can generate a verifiable proof of a predict.fun
 * market price using Reclaim's zk-fetch library.
 *
 * Usage:
 *   npx ts-node scripts/reclaim-proof-test.ts [marketId]
 *
 * Default marketId = 900 (an OPEN market).
 *
 * The API key is passed in privateOptions so it stays hidden from the proof.
 * Only the URL and response regex are visible to verifiers.
 */

import { ReclaimClient } from "@reclaimprotocol/zk-fetch";
import { verifyProof, transformForOnchain } from "@reclaimprotocol/js-sdk";
import * as dotenv from "dotenv";
dotenv.config();

const APP_ID = "0x40985ae1EA1942f09435Fa862B05eA661e6d30D4";
const APP_SECRET =
    "0x8b7e8cf5410601d774eff123aded17a1f19fe3c5217611df52606f7d47273b18";

const PREDICT_API_KEY = process.env.PREDICT_API_KEY || "";

async function main() {
    const marketId = process.argv[2] || "900";

    if (!PREDICT_API_KEY) {
        console.error("Set PREDICT_API_KEY in .env");
        process.exit(1);
    }

    // ── 1. Pick the endpoint ──
    // The orderbook endpoint returns lastOrderSettled.price (the last traded price).
    // Example response:
    //   {"data":{"asks":[...],"bids":[...],"lastOrderSettled":{"id":"22837977","price":"0.09",...}}}
    const url = `https://api.predict.fun/v1/markets/${marketId}/orderbook`;

    console.log(`\n=== Reclaim zk-fetch PoC ===`);
    console.log(`Market ID : ${marketId}`);
    console.log(`Endpoint  : ${url}`);

    // ── 2. Initialize Reclaim client ──
    const client = new ReclaimClient(APP_ID, APP_SECRET, true);

    // ── 3. Generate proof via zk-fetch ──
    // The API key goes in privateOptions — hidden from the proof/verifier.
    // The regex captures the price from lastOrderSettled.
    console.log(`\nGenerating proof...`);

    try {
        const proof = await client.zkFetch(
            url,
            {
                // Public options — visible in the proof
                method: "GET",
                headers: {
                    accept: "application/json",
                },
            },
            {
                // Private options — hidden from the proof
                headers: {
                    "x-api-key": PREDICT_API_KEY,
                },
                responseMatches: [
                    {
                        type: "regex",
                        value: '"lastOrderSettled":\\{[^}]*"price":"(?<price>[\\d.]+)"',
                    },
                ],
                responseRedactions: [
                    {
                        regex: '"lastOrderSettled":\\{[^}]*"price":"(?<price>[\\d.]+)"',
                    },
                ],
            },
        );

        if (!proof) {
            console.error("\nFailed to generate proof (null response)");
            console.log(
                "This could mean the witness network cannot connect to predict.fun",
            );
            process.exit(1);
        }

        // ── 4. Display the proof ──
        console.log(`\n=== Proof Generated ===`);
        console.log(JSON.stringify(proof, null, 2));

        // ── 5. Extract the price ──
        const extracted = (proof as any).extractedParameterValues;
        if (extracted?.price) {
            console.log(`\n=== Extracted Price ===`);
            console.log(`Last traded price: ${extracted.price}`);
            console.log(
                `As 18-decimal WAD : ${BigInt(Math.round(parseFloat(extracted.price) * 1e18))}`,
            );
        }

        // ── 6. Verify the proof ──
        console.log(`\nVerifying proof...`);
        const isValid = await verifyProof(proof as any);
        console.log(`Proof valid: ${isValid}`);

        if (!isValid) {
            console.error("Proof verification FAILED");
            process.exit(1);
        }

        // ── 7. Transform for on-chain submission ──
        const onchainProof = await transformForOnchain(proof as any);
        console.log(`\n=== On-Chain Proof Data ===`);
        console.log(JSON.stringify(onchainProof, null, 2));

        // ── 8. Show the claim info for contract integration ──
        const claimData = (proof as any).claimData;
        if (claimData) {
            console.log(`\n=== Claim Metadata ===`);
            console.log(`Provider  : ${claimData.provider}`);
            console.log(`Timestamp : ${claimData.timestampS}`);
            console.log(`Owner     : ${claimData.owner}`);
            console.log(`Epoch     : ${claimData.epoch}`);

            try {
                const ctx = JSON.parse(claimData.context);
                console.log(
                    `Extracted : ${JSON.stringify(ctx.extractedParameters)}`,
                );
            } catch {}
        }

        console.log(`\n=== SUCCESS ===`);
        console.log(
            `Reclaim zk-fetch can generate verifiable proofs from predict.fun`,
        );
        console.log(
            `This proof can be verified on-chain via the Reclaim singleton`,
        );
    } catch (err: any) {
        console.error(`\n=== FAILED ===`);
        console.error(`Error: ${err.message}`);
        if (err.message?.includes("TLS") || err.message?.includes("tls")) {
            console.error(
                `\nTLS-related error — witness cannot negotiate TLS with predict.fun`,
            );
        }
        if (
            err.message?.includes("timeout") ||
            err.message?.includes("TIMEOUT")
        ) {
            console.error(
                `\nTimeout — witness network may be overloaded or blocking predict.fun`,
            );
        }
        console.error(`\nFull error:`, err);
        process.exit(1);
    }
}

main();
