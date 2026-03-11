import { ethers, network } from "hardhat";

/**
 * Deploy SignedProofVerifier + PullPriceAdapter, authorize, and submit an initial price.
 *
 * Required env vars:
 *   PRESAGE_ADDR          - Deployed Presage router
 *   PRICE_HUB_ADDR        - Deployed PriceHub
 *   RELAYER_ADDR           - (optional) Relayer address. Defaults to second hardhat signer.
 *
 * Optional env vars (if adapter already exists):
 *   PULL_ADAPTER_ADDR      - Skip adapter deployment, use existing
 *   VERIFIER_ADDR          - Skip verifier deployment, use existing
 *
 * Market env vars:
 *   CTF_ADDR               - Gnosis CTF contract
 *   CONDITION_ID           - Market condition ID
 *   YES_POSITION_ID        - Yes token position ID
 *   NO_POSITION_ID         - No token position ID
 *   INITIAL_PRICE          - Initial price as decimal string (e.g. "0.50")
 *
 * Usage:
 *   npx hardhat run scripts/launch-predict-fun.ts --network bnb
 */

const USDT = "0x55d398326f99059fF775485246999027B3197955";
const MORPHO = "0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a";

async function main() {
    const signers = await ethers.getSigners();
    const deployer = signers[0];

    // Relayer: explicit env var, or second signer, or deployer as fallback
    const relayerAddr = process.env.RELAYER_ADDR || signers[1]?.address || deployer.address;
    // We need the relayer signer for signing the initial price proof
    const relayerSigner = signers.find(s => s.address.toLowerCase() === relayerAddr.toLowerCase());

    console.log(`\n=== Predict.fun Market Launcher ===`);
    console.log(`Network  : ${network.name}`);
    console.log(`Deployer : ${deployer.address}`);
    console.log(`Relayer  : ${relayerAddr}`);

    // ── 1. Deploy or reuse SignedProofVerifier ──

    let verifierAddress = process.env.VERIFIER_ADDR || "";
    if (!verifierAddress) {
        console.log(`\n1. Deploying SignedProofVerifier...`);
        const SignedProofVerifier = await ethers.getContractFactory("SignedProofVerifier");
        const v = await SignedProofVerifier.deploy(relayerAddr);
        await v.waitForDeployment();
        verifierAddress = await v.getAddress();
        console.log(`   Deployed: ${verifierAddress}`);
    } else {
        console.log(`\n1. Using existing verifier: ${verifierAddress}`);
    }

    // ── 2. Deploy or reuse PullPriceAdapter ──

    const priceHubAddr = process.env.PRICE_HUB_ADDR;
    let adapterAddress = process.env.PULL_ADAPTER_ADDR || "";
    if (!adapterAddress) {
        if (!priceHubAddr) {
            console.error("   ERROR: PRICE_HUB_ADDR required to deploy PullPriceAdapter");
            process.exit(1);
        }
        console.log(`\n2. Deploying PullPriceAdapter (priceHub: ${priceHubAddr})...`);
        const PullPriceAdapter = await ethers.getContractFactory("PullPriceAdapter");
        const a = await PullPriceAdapter.deploy(priceHubAddr);
        await a.waitForDeployment();
        adapterAddress = await a.getAddress();
        console.log(`   Deployed: ${adapterAddress}`);
    } else {
        console.log(`\n2. Using existing adapter: ${adapterAddress}`);
    }

    // ── 3. Authorize verifier in adapter ──

    console.log(`\n3. Authorizing verifier in PullPriceAdapter...`);
    const adapter = await ethers.getContractAt("PullPriceAdapter", adapterAddress);
    const isAuthorized = await adapter.verifiers(verifierAddress);
    if (!isAuthorized) {
        const tx = await adapter.setVerifier(verifierAddress, true);
        await tx.wait();
        console.log(`   Authorized.`);
    } else {
        console.log(`   Already authorized.`);
    }

    // ── 4. Register adapter in PriceHub (if new) ──

    if (priceHubAddr && !process.env.PULL_ADAPTER_ADDR) {
        console.log(`\n4. Registering adapter in PriceHub...`);
        console.log(`   NOTE: You need to call priceHub.setAdapter(positionId, adapterAddress)`);
        console.log(`   for each position that should use this adapter.`);
    }

    // ── 5. Submit initial signed price (if market params provided) ──

    const yesPositionId = process.env.YES_POSITION_ID;
    const initialPrice = process.env.INITIAL_PRICE;

    if (yesPositionId && initialPrice && relayerSigner) {
        console.log(`\n5. Submitting initial signed price...`);

        const posId = BigInt(yesPositionId);
        const price = ethers.parseUnits(initialPrice, 18);
        const ts = Math.floor(Date.now() / 1000);

        // Sign: keccak256(abi.encodePacked(timestamp, positionId, price))
        const msgHash = ethers.solidityPackedKeccak256(
            ["uint256", "uint256", "uint256"],
            [ts, posId, price],
        );
        const sig = await relayerSigner.signMessage(ethers.getBytes(msgHash));

        // Encode proof: (timestamp, positionId, price, signature)
        const proof = ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256", "uint256", "uint256", "bytes"],
            [ts, posId, price, sig],
        );

        // Wrap for PullPriceAdapter: (verifierAddress, proofBytes)
        const submitData = ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "bytes"],
            [verifierAddress, proof],
        );

        // Submit through PullPriceAdapter directly
        try {
            const submitTx = await adapter.submitPrice(posId, submitData);
            await submitTx.wait();
            console.log(`   Price submitted: ${initialPrice} for position ${posId}`);
        } catch (e) {
            console.error(`   Submit failed: ${(e as Error).message}`);
            console.log(`   This is expected if the adapter isn't registered in PriceHub yet.`);
        }
    } else {
        console.log(`\n5. Skipping price submission.`);
        if (!yesPositionId) console.log(`   Set YES_POSITION_ID to enable.`);
        if (!initialPrice) console.log(`   Set INITIAL_PRICE to enable (e.g. "0.50").`);
        if (!relayerSigner) console.log(`   Relayer signer not available locally (needed to sign).`);
    }

    // ── Summary ──

    console.log(`\n=== Deployment Summary ===`);
    console.log(`SignedProofVerifier : ${verifierAddress}`);
    console.log(`PullPriceAdapter   : ${adapterAddress}`);
    console.log(`Relayer            : ${relayerAddr}`);
    console.log(`Network            : ${network.name}`);

    console.log(`\n=== Price Update Command ===`);
    console.log(`To update prices, your relayer bot should:`);
    console.log(`  1. Fetch price from predict.fun API`);
    console.log(`  2. Sign: keccak256(abi.encodePacked(timestamp, positionId, price))`);
    console.log(`  3. Encode: abi.encode(timestamp, positionId, price, signature)`);
    console.log(`  4. Wrap:   abi.encode(verifierAddress, proofBytes)`);
    console.log(`  5. Call:   priceHub.submitPrice(positionId, wrappedData)`);
}

main().catch(console.error);
