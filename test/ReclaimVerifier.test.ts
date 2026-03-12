/**
 * ReclaimVerifier end-to-end integration test
 *
 * Generates a REAL zk-fetch proof from predict.fun's orderbook API,
 * then submits it on-chain through the full pipeline:
 *   zk-fetch proof → ReclaimVerifier → PullPriceAdapter → PriceHub
 *
 * The Reclaim singleton at 0x5917FaB4808A119560dfADc14F437ae1455AEd40
 * on BNB mainnet verifies the witness signatures. This test requires
 * forking BNB mainnet so the singleton is available.
 *
 * Required env vars:
 *   FORK_BNB=true         - Fork BNB mainnet
 *   BNB_RPC_URL            - BNB RPC endpoint
 *   PREDICT_API_KEY         - predict.fun API key
 *
 * Run:
 *   FORK_BNB=true npx hardhat test test/ReclaimVerifier.test.ts
 */

import { expect } from "chai";
import { ethers, network } from "hardhat";

// Reclaim SDK imports
import { ReclaimClient } from "@reclaimprotocol/zk-fetch";
import { verifyProof, transformForOnchain } from "@reclaimprotocol/js-sdk";

const RECLAIM_SINGLETON = "0x5917FaB4808A119560dfADc14F437ae1455AEd40";

// Reclaim app credentials (same as reclaim-proof-test.ts)
const APP_ID = "0x40985ae1EA1942f09435Fa862B05eA661e6d30D4";
const APP_SECRET =
    "0x8b7e8cf5410601d774eff123aded17a1f19fe3c5217611df52606f7d47273b18";

const PREDICT_API_KEY = process.env.PREDICT_API_KEY || "";
const MARKET_ID = "900";
const ENDPOINT_PREFIX = "https://api.predict.fun/v1/markets/";
const POSITION_ID = 42n; // arbitrary test positionId for mapping
const MAX_STALENESS = 3600; // 1 hour

describe("ReclaimVerifier E2E", function () {
    // zk-fetch proof generation can take 30-60 seconds
    this.timeout(120_000);

    let deployer: any;
    let reclaimVerifier: any;
    let adapter: any;
    let priceHub: any;
    let proof: any;
    let onchainProof: any;

    before(async function () {
        // Guard: must be on BNB fork
        if (network.config.chainId !== 56) {
            console.log("  Skipping: requires FORK_BNB=true (BNB mainnet fork)");
            this.skip();
        }

        if (!PREDICT_API_KEY) {
            console.log("  Skipping: PREDICT_API_KEY not set");
            this.skip();
        }

        [deployer] = await ethers.getSigners();
        console.log(`\n  Deployer: ${deployer.address}`);

        // Verify Reclaim singleton exists on fork
        const code = await ethers.provider.getCode(RECLAIM_SINGLETON);
        if (code === "0x") {
            console.log("  Skipping: Reclaim singleton not found at fork block");
            this.skip();
        }
        console.log(`  Reclaim singleton: ${RECLAIM_SINGLETON} (code: ${code.length} bytes)`);
    });

    // ── Step 1: Generate a real zk-fetch proof ──

    it("generates a zk-fetch proof from predict.fun", async function () {
        const url = `${ENDPOINT_PREFIX}${MARKET_ID}/orderbook`;
        console.log(`\n    Fetching: ${url}`);
        console.log(`    Generating zk-fetch proof (this takes 20-60 seconds)...`);

        const client = new ReclaimClient(APP_ID, APP_SECRET, true);

        proof = await client.zkFetch(
            url,
            {
                method: "GET",
                headers: { accept: "application/json" },
            },
            {
                headers: { "x-api-key": PREDICT_API_KEY },
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

        expect(proof).to.not.be.null;
        console.log(`    Proof generated!`);

        // Extract and display price
        const extracted = (proof as any).extractedParameterValues;
        expect(extracted?.price).to.be.a("string");
        console.log(`    Extracted price: ${extracted.price}`);

        // Verify off-chain first
        const isValid = await verifyProof(proof as any);
        expect(isValid).to.be.true;
        console.log(`    Off-chain verification: PASSED`);

        // Transform for on-chain
        onchainProof = transformForOnchain(proof as any);
        expect(onchainProof.claimInfo).to.exist;
        expect(onchainProof.signedClaim).to.exist;
        console.log(`    On-chain proof prepared`);
        console.log(`    Timestamp: ${onchainProof.signedClaim.claim.timestampS}`);
        console.log(`    Epoch: ${onchainProof.signedClaim.claim.epoch}`);
    });

    // ── Step 2: Deploy contracts ──

    it("deploys PriceHub + ReclaimVerifier + PullPriceAdapter", async function () {
        // Real PriceHub
        const PriceHub = await ethers.getContractFactory("PriceHub");
        priceHub = await PriceHub.deploy(MAX_STALENESS);
        await priceHub.waitForDeployment();
        console.log(`\n    PriceHub: ${await priceHub.getAddress()} (maxStaleness: ${MAX_STALENESS}s)`);

        // ReclaimVerifier pointing to real Reclaim singleton
        const ReclaimVerifier = await ethers.getContractFactory("ReclaimVerifier");
        reclaimVerifier = await ReclaimVerifier.deploy(RECLAIM_SINGLETON);
        await reclaimVerifier.waitForDeployment();
        console.log(`    ReclaimVerifier: ${await reclaimVerifier.getAddress()}`);

        // PullPriceAdapter pointing to real PriceHub
        const PullPriceAdapter = await ethers.getContractFactory("PullPriceAdapter");
        adapter = await PullPriceAdapter.deploy(await priceHub.getAddress());
        await adapter.waitForDeployment();
        console.log(`    PullPriceAdapter: ${await adapter.getAddress()}`);

        // Authorize the verifier in adapter
        await adapter.setVerifier(await reclaimVerifier.getAddress(), true);
        console.log(`    Verifier authorized in adapter`);

        // Register adapter in PriceHub for this positionId
        await priceHub.setAdapter(POSITION_ID, await adapter.getAddress());
        console.log(`    Adapter registered in PriceHub for position ${POSITION_ID}`);
    });

    // ── Step 3: Configure endpoint + position mapping ──

    it("configures endpoint and position mapping", async function () {
        // Add predict.fun endpoint prefix
        const tx1 = await reclaimVerifier.addEndpoint(ENDPOINT_PREFIX);
        await tx1.wait();
        console.log(`\n    Endpoint added: ${ENDPOINT_PREFIX}`);

        const storedEndpoint = await reclaimVerifier.endpoints(0);
        expect(storedEndpoint).to.equal(ENDPOINT_PREFIX);

        // Map market 900 → positionId
        const tx2 = await reclaimVerifier.mapPosition(ENDPOINT_PREFIX, MARKET_ID, POSITION_ID);
        await tx2.wait();
        console.log(`    Mapped: (${ENDPOINT_PREFIX}, ${MARKET_ID}) → position ${POSITION_ID}`);

        // Verify mapping
        const key = ethers.solidityPackedKeccak256(
            ["string", "string"],
            [ENDPOINT_PREFIX, MARKET_ID],
        );
        const mapped = await reclaimVerifier.positionIds(key);
        expect(mapped).to.equal(POSITION_ID);
    });

    // ── Step 4: Encode and submit proof on-chain ──

    it("submits the proof through the full pipeline", async function () {
        // ABI-encode the proof as ReclaimProof struct
        const proofTuple = ethers.AbiCoder.defaultAbiCoder().encode(
            [
                "tuple(tuple(string,string,string),tuple(tuple(bytes32,address,uint32,uint32),bytes[]))",
            ],
            [
                [
                    // ClaimInfo
                    [
                        onchainProof.claimInfo.provider,
                        onchainProof.claimInfo.parameters,
                        onchainProof.claimInfo.context,
                    ],
                    // SignedClaim
                    [
                        // CompleteClaimData
                        [
                            onchainProof.signedClaim.claim.identifier,
                            onchainProof.signedClaim.claim.owner,
                            onchainProof.signedClaim.claim.timestampS,
                            onchainProof.signedClaim.claim.epoch,
                        ],
                        // signatures
                        onchainProof.signedClaim.signatures,
                    ],
                ],
            ],
        );

        console.log(`\n    Proof encoded (${proofTuple.length} bytes)`);

        // Wrap for PullPriceAdapter: abi.encode(verifierAddress, proofBytes)
        const submitData = ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "bytes"],
            [await reclaimVerifier.getAddress(), proofTuple],
        );

        console.log(`    Submitting to PullPriceAdapter...`);

        const tx = await adapter.submitPrice(POSITION_ID, submitData);
        const receipt = await tx.wait();
        console.log(`    TX hash: ${receipt.hash}`);
        console.log(`    Gas used: ${receipt.gasUsed.toString()}`);

        // Verify price was cached in adapter
        const [cachedPrice, cachedAt] = await adapter.getPrice(POSITION_ID);
        console.log(`    Adapter cached price: ${ethers.formatUnits(cachedPrice, 18)}`);
        console.log(`    Adapter cached at: ${cachedAt}`);

        expect(cachedPrice).to.be.gt(0n);
        expect(cachedPrice).to.be.lte(ethers.parseUnits("1", 18));
        expect(cachedAt).to.equal(onchainProof.signedClaim.claim.timestampS);

        // Verify PriceHub received it
        const [hubPrice, hubUpdatedAt] = await priceHub.prices(POSITION_ID);
        console.log(`    PriceHub price: ${ethers.formatUnits(hubPrice, 18)}`);
        console.log(`    PriceHub updatedAt: ${hubUpdatedAt}`);

        expect(hubPrice).to.equal(cachedPrice);
        expect(hubUpdatedAt).to.equal(cachedAt);

        // Display the extracted price as a human-readable probability
        const pricePct = (Number(ethers.formatUnits(cachedPrice, 18)) * 100).toFixed(2);
        console.log(`\n    Price ${pricePct}% verified on-chain via Reclaim zkTLS and recorded in PriceHub`);
    });
});
