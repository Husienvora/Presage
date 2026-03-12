import { ethers, network } from "hardhat";

/**
 * Deploy verifiers + PullPriceAdapter for a predict.fun market.
 *
 * Supports two verifier backends (can deploy both for redundancy):
 *   - SignedProofVerifier: Trusted relayer signs price attestations
 *   - ReclaimVerifier:     zkTLS proofs via Reclaim Protocol (platform-agnostic)
 *
 * Required env vars:
 *   PRICE_HUB_ADDR        - Deployed PriceHub
 *
 * Verifier selection (set one or both):
 *   VERIFIER_MODE          - "signed" | "reclaim" | "both" (default: "signed")
 *
 * Signed relayer env vars:
 *   RELAYER_ADDR           - (optional) Relayer address. Defaults to second hardhat signer.
 *
 * Reclaim env vars:
 *   RECLAIM_ADDR           - Reclaim singleton on this chain
 *                            BNB mainnet: 0x5917FaB4808A119560dfADc14F437ae1455AEd40
 *   ENDPOINT_PREFIX        - Approved endpoint prefix for this platform
 *                            e.g. "https://api.predict.fun/v1/markets/"
 *   MARKET_ID              - Market identifier as it appears in the URL (e.g. "900")
 *
 * Optional env vars (skip deployment, reuse existing):
 *   PULL_ADAPTER_ADDR      - Skip adapter deployment
 *   SIGNED_VERIFIER_ADDR   - Skip signed verifier deployment
 *   RECLAIM_VERIFIER_ADDR  - Skip reclaim verifier deployment
 *
 * Market env vars:
 *   YES_POSITION_ID        - Yes token position ID (CTF)
 *   INITIAL_PRICE          - Initial price as decimal string (e.g. "0.50")
 *
 * Usage:
 *   VERIFIER_MODE=both npx hardhat run scripts/launch-predict-fun.ts --network bnb
 */

const RECLAIM_BNB_MAINNET = "0x5917FaB4808A119560dfADc14F437ae1455AEd40";

async function main() {
    const signers = await ethers.getSigners();
    const deployer = signers[0];
    const mode = (process.env.VERIFIER_MODE || "signed").toLowerCase();
    const useSigned = mode === "signed" || mode === "both";
    const useReclaim = mode === "reclaim" || mode === "both";

    const priceHubAddr = process.env.PRICE_HUB_ADDR;

    console.log(`\n=== Predict.fun Market Launcher ===`);
    console.log(`Network  : ${network.name}`);
    console.log(`Deployer : ${deployer.address}`);
    console.log(`Mode     : ${mode}`);

    const verifierAddresses: string[] = [];

    // ── 1. Signed Proof Verifier ──

    if (useSigned) {
        const relayerAddr = process.env.RELAYER_ADDR || signers[1]?.address || deployer.address;
        let addr = process.env.SIGNED_VERIFIER_ADDR || "";

        if (!addr) {
            console.log(`\n1a. Deploying SignedProofVerifier (relayer: ${relayerAddr})...`);
            const F = await ethers.getContractFactory("SignedProofVerifier");
            const v = await F.deploy(relayerAddr);
            await v.waitForDeployment();
            addr = await v.getAddress();
            console.log(`    Deployed: ${addr}`);
        } else {
            console.log(`\n1a. Using existing SignedProofVerifier: ${addr}`);
        }
        verifierAddresses.push(addr);
    }

    // ── 2. Reclaim Verifier ──

    if (useReclaim) {
        let addr = process.env.RECLAIM_VERIFIER_ADDR || "";
        const reclaimAddr = process.env.RECLAIM_ADDR || RECLAIM_BNB_MAINNET;

        if (!addr) {
            console.log(`\n1b. Deploying ReclaimVerifier (reclaim: ${reclaimAddr})...`);
            const F = await ethers.getContractFactory("ReclaimVerifier");
            const v = await F.deploy(reclaimAddr);
            await v.waitForDeployment();
            addr = await v.getAddress();
            console.log(`    Deployed: ${addr}`);

            // Register endpoint prefix if provided
            const endpointPrefix = process.env.ENDPOINT_PREFIX;
            if (endpointPrefix) {
                console.log(`    Adding endpoint: ${endpointPrefix}`);
                const rv = await ethers.getContractAt("ReclaimVerifier", addr);
                const tx = await rv.addEndpoint(endpointPrefix);
                await tx.wait();
                console.log(`    Endpoint registered at index 0`);

                // Map market → positionId if both provided
                const marketId = process.env.MARKET_ID;
                const positionId = process.env.YES_POSITION_ID;
                if (marketId && positionId) {
                    const tx2 = await rv.mapPosition(endpointPrefix, marketId, BigInt(positionId));
                    await tx2.wait();
                    console.log(`    Mapped market ${marketId} → position ${positionId}`);
                }
            }
        } else {
            console.log(`\n1b. Using existing ReclaimVerifier: ${addr}`);
        }
        verifierAddresses.push(addr);
    }

    // ── 3. Deploy or reuse PullPriceAdapter ──

    let adapterAddress = process.env.PULL_ADAPTER_ADDR || "";
    if (!adapterAddress) {
        if (!priceHubAddr) {
            console.error("   ERROR: PRICE_HUB_ADDR required to deploy PullPriceAdapter");
            process.exit(1);
        }
        console.log(`\n2. Deploying PullPriceAdapter (priceHub: ${priceHubAddr})...`);
        const F = await ethers.getContractFactory("PullPriceAdapter");
        const a = await F.deploy(priceHubAddr);
        await a.waitForDeployment();
        adapterAddress = await a.getAddress();
        console.log(`   Deployed: ${adapterAddress}`);
    } else {
        console.log(`\n2. Using existing adapter: ${adapterAddress}`);
    }

    // ── 4. Authorize all verifiers in adapter ──

    console.log(`\n3. Authorizing verifiers in PullPriceAdapter...`);
    const adapter = await ethers.getContractAt("PullPriceAdapter", adapterAddress);
    for (const vAddr of verifierAddresses) {
        const isAuth = await adapter.verifiers(vAddr);
        if (!isAuth) {
            const tx = await adapter.setVerifier(vAddr, true);
            await tx.wait();
            console.log(`   Authorized: ${vAddr}`);
        } else {
            console.log(`   Already authorized: ${vAddr}`);
        }
    }

    // ── 5. Register adapter in PriceHub ──

    if (priceHubAddr && !process.env.PULL_ADAPTER_ADDR) {
        console.log(`\n4. Registering adapter in PriceHub...`);
        const hub = await ethers.getContractAt("PriceHub", priceHubAddr);
        if (process.env.YES_POSITION_ID) {
            const posId = BigInt(process.env.YES_POSITION_ID);
            const tx = await hub.setAdapter(posId, adapterAddress);
            await tx.wait();
            console.log(`   Registered for position ${posId}`);
        } else {
            console.log(`   NOTE: Set YES_POSITION_ID to auto-register, or call manually:`);
            console.log(`   priceHub.setAdapter(positionId, ${adapterAddress})`);
        }
    }

    // ── 6. Submit initial signed price (only for signed mode) ──

    if (useSigned) {
        const yesPositionId = process.env.YES_POSITION_ID;
        const initialPrice = process.env.INITIAL_PRICE;
        const relayerAddr = process.env.RELAYER_ADDR || signers[1]?.address || deployer.address;
        const relayerSigner = signers.find(s => s.address.toLowerCase() === relayerAddr.toLowerCase());

        if (yesPositionId && initialPrice && relayerSigner) {
            console.log(`\n5. Submitting initial signed price...`);

            const posId = BigInt(yesPositionId);
            const price = ethers.parseUnits(initialPrice, 18);
            const ts = Math.floor(Date.now() / 1000);

            const msgHash = ethers.solidityPackedKeccak256(
                ["uint256", "uint256", "uint256"],
                [ts, posId, price],
            );
            const sig = await relayerSigner.signMessage(ethers.getBytes(msgHash));

            const proof = ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256", "uint256", "uint256", "bytes"],
                [ts, posId, price, sig],
            );

            const submitData = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "bytes"],
                [verifierAddresses[0], proof],
            );

            try {
                const submitTx = await adapter.submitPrice(posId, submitData);
                await submitTx.wait();
                console.log(`   Price submitted: ${initialPrice} for position ${posId}`);
            } catch (e) {
                console.error(`   Submit failed: ${(e as Error).message}`);
            }
        } else {
            console.log(`\n5. Skipping initial price submission.`);
        }
    }

    // ── Summary ──

    console.log(`\n=== Deployment Summary ===`);
    console.log(`PullPriceAdapter   : ${adapterAddress}`);
    for (let i = 0; i < verifierAddresses.length; i++) {
        const label = useSigned && i === 0 ? "SignedProofVerifier" :
                      useReclaim && i === verifierAddresses.length - 1 ? "ReclaimVerifier" :
                      `Verifier ${i}`;
        console.log(`${label.padEnd(19)}: ${verifierAddresses[i]}`);
    }
    console.log(`Network            : ${network.name}`);

    if (useSigned) {
        console.log(`\n=== Signed Relayer Commands ===`);
        console.log(`  1. Fetch price from predict.fun API`);
        console.log(`  2. Sign: keccak256(abi.encodePacked(timestamp, positionId, price))`);
        console.log(`  3. Encode: abi.encode(timestamp, positionId, price, signature)`);
        console.log(`  4. Wrap:   abi.encode(verifierAddress, proofBytes)`);
        console.log(`  5. Call:   adapter.submitPrice(positionId, wrappedData)`);
    }

    if (useReclaim) {
        console.log(`\n=== Reclaim zkTLS Commands ===`);
        console.log(`  1. Use zk-fetch to hit the platform API endpoint`);
        console.log(`  2. transformForOnchain(proof) to get ABI-encoded proof`);
        console.log(`  3. Wrap:   abi.encode(reclaimVerifierAddress, proofBytes)`);
        console.log(`  4. Call:   adapter.submitPrice(positionId, wrappedData)`);
    }
}

main().catch(console.error);
