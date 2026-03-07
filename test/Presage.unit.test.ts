/**
 * Unit tests — Hardhat local network
 *
 * Tests the wrapping layer with a mock CTF contract.
 * No predict.fun SDK or testnet required.
 *
 * Run: npx hardhat test test/Presage.unit.test.ts
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";

// Minimal mock CTF (ERC1155) — just enough to test wrapping
const MOCK_CTF_ABI = [
  "function balanceOf(address, uint256) view returns (uint256)",
  "function setApprovalForAll(address, bool)",
  "function isApprovedForAll(address, address) view returns (bool)",
  "function safeTransferFrom(address, address, uint256, uint256, bytes)",
];

describe("Presage Unit Tests", function () {
  let deployer: Signer;
  let alice: Signer;
  let bob: Signer;

  let mockCTF: any;
  let wrapperFactory: any;

  const POSITION_ID = 12345n;
  const AMOUNT = ethers.parseEther("100");

  before(async function () {
    [deployer, alice, bob] = await ethers.getSigners();

    // Deploy mock CTF
    const MockCTF = await ethers.getContractFactory("MockCTF");
    mockCTF = await MockCTF.deploy();
    await mockCTF.waitForDeployment();

    // Deploy WrapperFactory
    const WrapperFactory = await ethers.getContractFactory("WrapperFactory");
    wrapperFactory = await WrapperFactory.deploy();
    await wrapperFactory.waitForDeployment();
  });

  describe("WrapperFactory", function () {
    it("should deploy a WrappedCTF clone", async function () {
      const ctfAddr = await mockCTF.getAddress();
      const tx = await wrapperFactory.create(ctfAddr, POSITION_ID, 18);
      await tx.wait();

      const wrapperAddr = await wrapperFactory.getWrapper(POSITION_ID);
      expect(wrapperAddr).to.not.equal(ethers.ZeroAddress);
    });

    it("should predict address via CREATE2", async function () {
      const ctfAddr = await mockCTF.getAddress();
      const predicted = await wrapperFactory.predictAddress(
        ctfAddr,
        POSITION_ID,
      );
      const actual = await wrapperFactory.getWrapper(POSITION_ID);
      expect(predicted).to.equal(actual);
    });

    it("should revert on duplicate create", async function () {
      const ctfAddr = await mockCTF.getAddress();
      await expect(
        wrapperFactory.create(ctfAddr, POSITION_ID, 18),
      ).to.be.revertedWith("exists");
    });
  });

  describe("WrappedCTF", function () {
    let wrapper: any;

    before(async function () {
      const wrapperAddr = await wrapperFactory.getWrapper(POSITION_ID);
      wrapper = await ethers.getContractAt("WrappedCTF", wrapperAddr);

      // Mint mock CTF tokens to alice
      const aliceAddr = await alice.getAddress();
      await mockCTF.mint(aliceAddr, POSITION_ID, AMOUNT);
    });

    it("should wrap CTF → ERC20", async function () {
      const aliceAddr = await alice.getAddress();
      const wrapperAddr = await wrapper.getAddress();

      // Approve wrapper
      await mockCTF.connect(alice).setApprovalForAll(wrapperAddr, true);

      // Wrap
      await wrapper.connect(alice).wrap(AMOUNT);

      // Verify
      const wctfBal = await wrapper.balanceOf(aliceAddr);
      const ctfBal = await mockCTF.balanceOf(aliceAddr, POSITION_ID);
      const wrapperCtfBal = await mockCTF.balanceOf(wrapperAddr, POSITION_ID);

      expect(wctfBal).to.equal(AMOUNT);
      expect(ctfBal).to.equal(0n);
      expect(wrapperCtfBal).to.equal(AMOUNT);
    });

    it("should transfer ERC20 between users", async function () {
      const bobAddr = await bob.getAddress();
      await wrapper.connect(alice).transfer(bobAddr, AMOUNT);

      const aliceBal = await wrapper.balanceOf(await alice.getAddress());
      const bobBal = await wrapper.balanceOf(bobAddr);
      expect(aliceBal).to.equal(0n);
      expect(bobBal).to.equal(AMOUNT);
    });

    it("should unwrap ERC20 → CTF", async function () {
      const bobAddr = await bob.getAddress();
      const wrapperAddr = await wrapper.getAddress();

      await wrapper.connect(bob).unwrap(AMOUNT);

      const wctfBal = await wrapper.balanceOf(bobAddr);
      const ctfBal = await mockCTF.balanceOf(bobAddr, POSITION_ID);
      const supply = await wrapper.totalSupply();

      expect(wctfBal).to.equal(0n);
      expect(ctfBal).to.equal(AMOUNT);
      expect(supply).to.equal(0n);
    });

    it("should revert unwrap without balance", async function () {
      await expect(wrapper.connect(alice).unwrap(1n)).to.be.reverted;
    });
  });

  describe("PriceHub", function () {
    let priceHub: any;
    let fixedAdapter: any;

    before(async function () {
      const PriceHub = await ethers.getContractFactory("PriceHub");
      priceHub = await PriceHub.deploy(3600); // 1 hour staleness
      await priceHub.waitForDeployment();

      const FixedPriceAdapter = await ethers.getContractFactory(
        "FixedPriceAdapter",
      );
      fixedAdapter = await FixedPriceAdapter.deploy();
      await fixedAdapter.waitForDeployment();

      await priceHub.setDefaultAdapter(await fixedAdapter.getAddress());
    });

    it("should spawn an oracle stub", async function () {
      const now = Math.floor(Date.now() / 1000);
      const resolution = now + 86400 * 30; // 30 days from now

      const tx = await priceHub.spawnOracle(
        POSITION_ID,
        resolution,
        86400 * 7, // 7 day decay
        86400, // 1 day cooldown
        18, // loan decimals
        18, // collateral decimals
      );
      await tx.wait();

      const oracleAddr = await priceHub.oracles(POSITION_ID);
      expect(oracleAddr).to.not.equal(ethers.ZeroAddress);
    });

    it("should seed and read price", async function () {
      // Seed price at 0.75 (75% probability)
      await priceHub.seedPrice(POSITION_ID, ethers.parseEther("0.75"));

      const oracleAddr = await priceHub.oracles(POSITION_ID);
      const oracle = await ethers.getContractAt("MorphoOracleStub", oracleAddr);

      const price = await oracle.price();
      // 0.75 * 1e36 (since loan and collateral both 18 dec → scale factor is 1e18 * 1e18 = 1e36)
      expect(price).to.equal(ethers.parseEther("0.75") * BigInt(1e18));
    });

    it("should revert on stale price", async function () {
      // Set staleness to 1 second
      await priceHub.setStaleness(1);

      // Mine a block far in the future
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);

      const oracleAddr = await priceHub.oracles(POSITION_ID);
      const oracle = await ethers.getContractAt("MorphoOracleStub", oracleAddr);

      await expect(oracle.price()).to.be.revertedWith("stale price");
    });
  });
});
