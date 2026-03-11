/**
 * SignedProofVerifier + PullPriceAdapter unit tests
 *
 * Run: npx hardhat test test/SignedProofVerifier.test.ts
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";

describe("SignedProofVerifier", function () {
    let deployer: Signer;
    let relayer: Signer;
    let attacker: Signer;

    let verifier: any;
    let adapter: any;
    let mockHub: any;

    const POSITION_ID = 42n;
    const PRICE = ethers.parseUnits("0.65", 18); // 65%

    before(async function () {
        [deployer, relayer, attacker] = await ethers.getSigners();

        // Deploy MockPriceHub
        const MockPriceHub = await ethers.getContractFactory("MockPriceHub");
        mockHub = await MockPriceHub.deploy();
        await mockHub.waitForDeployment();

        // Deploy SignedProofVerifier with relayer
        const SignedProofVerifier = await ethers.getContractFactory("SignedProofVerifier");
        verifier = await SignedProofVerifier.deploy(await relayer.getAddress());
        await verifier.waitForDeployment();

        // Deploy PullPriceAdapter pointing to mock hub
        const PullPriceAdapter = await ethers.getContractFactory("PullPriceAdapter");
        adapter = await PullPriceAdapter.deploy(await mockHub.getAddress());
        await adapter.waitForDeployment();

        // Authorize verifier in adapter
        await adapter.setVerifier(await verifier.getAddress(), true);
    });

    // ── Helpers ──

    async function signPrice(signer: Signer, ts: number, positionId: bigint, price: bigint) {
        const msgHash = ethers.solidityPackedKeccak256(
            ["uint256", "uint256", "uint256"],
            [ts, positionId, price],
        );
        return signer.signMessage(ethers.getBytes(msgHash));
    }

    function encodeProof(ts: number, positionId: bigint, price: bigint, sig: string) {
        return ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256", "uint256", "uint256", "bytes"],
            [ts, positionId, price, sig],
        );
    }

    function wrapForAdapter(verifierAddr: string, proofBytes: string) {
        return ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "bytes"],
            [verifierAddr, proofBytes],
        );
    }

    // ── SignedProofVerifier Tests ──

    describe("constructor", function () {
        it("rejects zero address relayer", async function () {
            const F = await ethers.getContractFactory("SignedProofVerifier");
            await expect(F.deploy(ethers.ZeroAddress)).to.be.revertedWith("zero relayer");
        });

        it("sets relayer and owner", async function () {
            expect(await verifier.relayer()).to.equal(await relayer.getAddress());
            expect(await verifier.owner()).to.equal(await deployer.getAddress());
        });
    });

    describe("setRelayer", function () {
        it("owner can change relayer", async function () {
            const newRelayer = await attacker.getAddress();
            await verifier.setRelayer(newRelayer);
            expect(await verifier.relayer()).to.equal(newRelayer);
            // restore
            await verifier.setRelayer(await relayer.getAddress());
        });

        it("rejects zero address", async function () {
            await expect(verifier.setRelayer(ethers.ZeroAddress)).to.be.revertedWith("zero relayer");
        });

        it("non-owner cannot change relayer", async function () {
            await expect(
                verifier.connect(attacker).setRelayer(await attacker.getAddress()),
            ).to.be.reverted;
        });
    });

    describe("verify", function () {
        it("accepts valid signature from relayer", async function () {
            const ts = Math.floor(Date.now() / 1000);
            const sig = await signPrice(relayer, ts, POSITION_ID, PRICE);
            const proof = encodeProof(ts, POSITION_ID, PRICE, sig);

            const [retTs, retPos, retPrice] = await verifier.verify(proof);
            expect(retTs).to.equal(ts);
            expect(retPos).to.equal(POSITION_ID);
            expect(retPrice).to.equal(PRICE);
        });

        it("rejects signature from wrong signer", async function () {
            const ts = Math.floor(Date.now() / 1000);
            const sig = await signPrice(attacker, ts, POSITION_ID, PRICE);
            const proof = encodeProof(ts, POSITION_ID, PRICE, sig);

            await expect(verifier.verify(proof)).to.be.revertedWith("invalid signature");
        });

        it("rejects tampered price", async function () {
            const ts = Math.floor(Date.now() / 1000);
            const sig = await signPrice(relayer, ts, POSITION_ID, PRICE);
            // tamper: use different price in encoding
            const tamperedPrice = ethers.parseUnits("0.99", 18);
            const proof = encodeProof(ts, POSITION_ID, tamperedPrice, sig);

            await expect(verifier.verify(proof)).to.be.revertedWith("invalid signature");
        });

        it("rejects tampered positionId", async function () {
            const ts = Math.floor(Date.now() / 1000);
            const sig = await signPrice(relayer, ts, POSITION_ID, PRICE);
            const proof = encodeProof(ts, 999n, PRICE, sig);

            await expect(verifier.verify(proof)).to.be.revertedWith("invalid signature");
        });

        it("rejects tampered timestamp", async function () {
            const ts = Math.floor(Date.now() / 1000);
            const sig = await signPrice(relayer, ts, POSITION_ID, PRICE);
            const proof = encodeProof(ts + 100, POSITION_ID, PRICE, sig);

            await expect(verifier.verify(proof)).to.be.revertedWith("invalid signature");
        });
    });

    // ── PullPriceAdapter Integration ──

    describe("PullPriceAdapter + SignedProofVerifier", function () {
        it("full pipeline: sign → submit → record in hub", async function () {
            const ts = Math.floor(Date.now() / 1000);
            const sig = await signPrice(relayer, ts, POSITION_ID, PRICE);
            const proof = encodeProof(ts, POSITION_ID, PRICE, sig);
            const data = wrapForAdapter(await verifier.getAddress(), proof);

            await adapter.submitPrice(POSITION_ID, data);

            // Check adapter cache
            const [cachedPrice, cachedAt] = await adapter.getPrice(POSITION_ID);
            expect(cachedPrice).to.equal(PRICE);
            expect(cachedAt).to.equal(ts);

            // Check mock hub received it
            expect(await mockHub.recordCount()).to.equal(1);
            const rec = await mockHub.lastRecorded();
            expect(rec.positionId).to.equal(POSITION_ID);
            expect(rec.probability).to.equal(PRICE);
            expect(rec.timestamp).to.equal(ts);
        });

        it("rejects unauthorized verifier", async function () {
            const ts = Math.floor(Date.now() / 1000) + 1000;
            const sig = await signPrice(relayer, ts, POSITION_ID, PRICE);
            const proof = encodeProof(ts, POSITION_ID, PRICE, sig);
            const data = wrapForAdapter(await attacker.getAddress(), proof); // random address as verifier

            await expect(adapter.submitPrice(POSITION_ID, data)).to.be.revertedWith("unknown verifier");
        });

        it("rejects position mismatch", async function () {
            const ts = Math.floor(Date.now() / 1000) + 2000;
            const wrongPos = 999n;
            const sig = await signPrice(relayer, ts, wrongPos, PRICE);
            const proof = encodeProof(ts, wrongPos, PRICE, sig);
            const data = wrapForAdapter(await verifier.getAddress(), proof);

            // Proof says position 999 but we submit for position 42
            await expect(adapter.submitPrice(POSITION_ID, data)).to.be.revertedWith("position mismatch");
        });

        it("rejects price > 1e18", async function () {
            const ts = Math.floor(Date.now() / 1000) + 3000;
            const badPrice = ethers.parseUnits("1.5", 18);
            const sig = await signPrice(relayer, ts, POSITION_ID, badPrice);
            const proof = encodeProof(ts, POSITION_ID, badPrice, sig);
            const data = wrapForAdapter(await verifier.getAddress(), proof);

            await expect(adapter.submitPrice(POSITION_ID, data)).to.be.revertedWith("invalid probability");
        });

        it("rejects stale timestamp", async function () {
            // First submission already happened in the pipeline test above.
            // Try submitting with an older timestamp.
            const staleTs = 1000; // way in the past
            const sig = await signPrice(relayer, staleTs, POSITION_ID, PRICE);
            const proof = encodeProof(staleTs, POSITION_ID, PRICE, sig);
            const data = wrapForAdapter(await verifier.getAddress(), proof);

            await expect(adapter.submitPrice(POSITION_ID, data)).to.be.revertedWith("not newer");
        });

        it("accepts price update with newer timestamp", async function () {
            const ts = Math.floor(Date.now() / 1000) + 5000;
            const newPrice = ethers.parseUnits("0.80", 18);
            const sig = await signPrice(relayer, ts, POSITION_ID, newPrice);
            const proof = encodeProof(ts, POSITION_ID, newPrice, sig);
            const data = wrapForAdapter(await verifier.getAddress(), proof);

            await adapter.submitPrice(POSITION_ID, data);

            const [cachedPrice, cachedAt] = await adapter.getPrice(POSITION_ID);
            expect(cachedPrice).to.equal(newPrice);
            expect(cachedAt).to.equal(ts);
        });

        it("works with boundary prices (0 and 1e18)", async function () {
            // Price = 0 (0%)
            const ts1 = Math.floor(Date.now() / 1000) + 6000;
            const sig1 = await signPrice(relayer, ts1, POSITION_ID, 0n);
            const proof1 = encodeProof(ts1, POSITION_ID, 0n, sig1);
            const data1 = wrapForAdapter(await verifier.getAddress(), proof1);
            await adapter.submitPrice(POSITION_ID, data1);

            let [p] = await adapter.getPrice(POSITION_ID);
            expect(p).to.equal(0n);

            // Price = 1e18 (100%)
            const ts2 = Math.floor(Date.now() / 1000) + 7000;
            const oneWad = ethers.parseUnits("1", 18);
            const sig2 = await signPrice(relayer, ts2, POSITION_ID, oneWad);
            const proof2 = encodeProof(ts2, POSITION_ID, oneWad, sig2);
            const data2 = wrapForAdapter(await verifier.getAddress(), proof2);
            await adapter.submitPrice(POSITION_ID, data2);

            [p] = await adapter.getPrice(POSITION_ID);
            expect(p).to.equal(oneWad);
        });
    });
});
