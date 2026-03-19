import { expect } from "chai";
import { ethers } from "hardhat";
import { parseUnits, parseEther, formatEther, formatUnits, Contract } from "ethers";

/**
 * Fork Test — BNB Mainnet
 *
 * Verifies Presage against the actual Morpho Blue and IRM deployments
 * on a local fork of BNB Mainnet.
 *
 * Test flow (sequential, shared state):
 *   1. Create market + deposit collateral (no fees configured)
 *   2. Supply USDT (lender)
 *   3. Borrow 20 USDT — verify zero fees (no treasury, 0 bps)
 *   4. Partial repay 5 USDT
 *   5. Interest accrual (30-day warp) — Alice still has ~15 USDT debt
 *   6. Price drop → Alice becomes liquidatable
 *   7. settleWithLoanToken — verify zero liquidation fee
 *   8. Full repay (remaining debt after liquidation)
 *   9. Fee admin: validation, caps, onlyOwner, events
 *  10. Default fees inherited on new market creation
 *  11. Set treasury + per-market fees on market 1
 *  12. Borrow with origination fee
 *  13. settleWithLoanToken with liquidation fee
 */

describe("Presage Fork Test (BNB Mainnet)", function () {
  // User-provided Addresses (BNB Chain)
  const MORPHO = ethers.getAddress("0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a");
  const IRM = ethers.getAddress("0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979");
  const USDT = ethers.getAddress("0x55d398326f99059fF775485246999027B3197955");
  const WHALE = ethers.getAddress("0x8894E0a0c962CB723c1976a4421c95949bE2D4E3");

  let presage: any;
  let factory: any;
  let priceHub: any;
  let mockCTF: any;
  let owner: any;
  let alice: any;
  let bob: any;
  let treasuryWallet: any;

  const POSITION_ID = 1n;

  // Helper: compute Morpho market ID from MarketParams tuple
  function morphoMarketId(mp: any): string {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "address", "uint256"],
        [mp.loanToken, mp.collateralToken, mp.oracle, mp.irm, mp.lltv]
      )
    );
  }

  before(async function () {
    [owner, alice, bob, treasuryWallet] = await ethers.getSigners();

    // 1. Deploy Core
    const WrapperFactory = await ethers.getContractFactory("WrapperFactory");
    factory = await WrapperFactory.deploy();

    const PriceHub = await ethers.getContractFactory("PriceHub");
    priceHub = await PriceHub.deploy(3600);

    const Presage = await ethers.getContractFactory("Presage");
    presage = await Presage.deploy(MORPHO, await factory.getAddress(), await priceHub.getAddress(), IRM);

    // 2. Deploy Mock CTF (since we are forking but don't want to rely on a specific market's state)
    const MockCTF = await ethers.getContractFactory("MockCTF");
    mockCTF = await MockCTF.deploy();

    // 3. Setup Price
    const FixedPriceAdapter = await ethers.getContractFactory("FixedPriceAdapter");
    const adapter = await FixedPriceAdapter.deploy();
    await priceHub.setDefaultAdapter(await adapter.getAddress());

    // 4. Impersonate a USDT whale to fund Alice
    await ethers.provider.send("hardhat_impersonateAccount", [WHALE]);
    const whaleSigner = await ethers.getSigner(WHALE);
    const usdt = await ethers.getContractAt("IERC20", USDT);

    // Send some gas to the whale first (since it's a fork, it might have 0 BNB)
    await owner.sendTransaction({ to: WHALE, value: parseEther("1") });
    await usdt.connect(whaleSigner).transfer(await alice.getAddress(), parseUnits("1000", 18));
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  CORE FLOW (no fees configured)
  // ══════════════════════════════════════════════════════════════════════════════

  it("should create a market with zero fees by default", async function () {
    const aliceAddr = await alice.getAddress();

    // Verify defaults are zero
    expect(await presage.treasury()).to.equal(ethers.ZeroAddress);
    expect(await presage.defaultOriginationFeeBps()).to.equal(0n);
    expect(await presage.defaultLiquidationFeeBps()).to.equal(0n);

    // 1. Create market
    const ctfPos = {
        ctf: await mockCTF.getAddress(),
        parentCollectionId: ethers.ZeroHash,
        conditionId: ethers.ZeroHash,
        positionId: POSITION_ID,
        oppositePositionId: 2n
    };

    const resolutionAt = Math.floor(Date.now() / 1000) + 86400 * 365; // 1 year — room for time warps
    await presage.openMarket(ctfPos, USDT, parseEther("0.77"), resolutionAt, 86400 * 7, 3600);

    const marketId = 1n;
    const market = await presage.getMarket(marketId);
    expect(market.morphoParams.loanToken).to.equal(USDT);

    // Market should inherit zero default fees
    expect(market.originationFeeBps_).to.equal(0n);
    expect(market.liquidationFeeBps_).to.equal(0n);

    // 2. Alice gets CTF tokens
    await mockCTF.mint(aliceAddr, POSITION_ID, parseEther("100"));

    // 3. Alice deposits collateral
    await mockCTF.connect(alice).setApprovalForAll(await presage.getAddress(), true);
    await presage.connect(alice).depositCollateral(marketId, parseEther("100"));

    const wrapperAddr = await factory.getWrapper(POSITION_ID);
    const wrapper = await ethers.getContractAt("WrappedCTF", wrapperAddr);
    expect(await wrapper.balanceOf(aliceAddr)).to.equal(0n); // It's in Morpho

    // Check Morpho balance
    expect(await wrapper.balanceOf(MORPHO)).to.equal(parseEther("100"));
  });

  it("should allow supplying loan tokens", async function () {
    const usdt = await ethers.getContractAt("IERC20", USDT);
    const amount = parseUnits("500", 18);
    await usdt.connect(alice).approve(await presage.getAddress(), amount);

    await presage.connect(alice).supply(1n, amount);

    // 1. Get Market Params
    const market = await presage.getMarket(1n);
    const mp = market.morphoParams;
    const mid = morphoMarketId(mp);

    const morpho = await ethers.getContractAt("contracts/vendor/morpho/IMorpho.sol:IMorpho", MORPHO);
    const aliceAddr = await alice.getAddress();
    const position = await morpho.position(mid, aliceAddr);

    expect(position.supplyShares).to.be.gt(0n);
  });

  it("should borrow with zero fee when no treasury and fees are 0", async function () {
    const marketId = 1n;
    const borrowAmount = parseUnits("20", 18); // 20 USDT against 100 CTF ($100 value)

    // 1. Seed Price (Owner can call seedPrice directly)
    const currentPrice = parseUnits("1", 18); // $1.00
    await priceHub.seedPrice(POSITION_ID, currentPrice);

    // 2. Authorize Presage on Morpho
    const morpho = await ethers.getContractAt("contracts/vendor/morpho/IMorpho.sol:IMorpho", MORPHO);
    await morpho.connect(alice).setAuthorization(await presage.getAddress(), true);

    // 3. Borrow
    const usdt = await ethers.getContractAt("IERC20", USDT);
    const balanceBefore = await usdt.balanceOf(await alice.getAddress());
    const presageBalBefore = await usdt.balanceOf(await presage.getAddress());

    const tx = await presage.connect(alice).borrow(marketId, borrowAmount);

    const balanceAfter = await usdt.balanceOf(await alice.getAddress());
    const presageBalAfter = await usdt.balanceOf(await presage.getAddress());

    // Alice receives full amount — no fee
    expect(balanceAfter - balanceBefore).to.equal(borrowAmount);
    // Presage should not retain any USDT
    expect(presageBalAfter).to.equal(presageBalBefore);
    // No OriginationFeeCollected event
    await expect(tx).to.not.emit(presage, "OriginationFeeCollected");

    console.log(`    Alice borrowed: ${formatUnits(borrowAmount, 18)} USDT (no fee)`);
  });

  it("should allow repaying debt", async function () {
    const marketId = 1n;
    const repayAmount = parseUnits("5", 18); // Repay a portion

    const usdt = await ethers.getContractAt("IERC20", USDT);
    await usdt.connect(alice).approve(await presage.getAddress(), repayAmount);

    await presage.connect(alice).repay(marketId, repayAmount);

    console.log(`    Alice repaid: ${formatUnits(repayAmount, 18)} USDT`);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  INTEREST ACCRUAL (Alice still has ~15 USDT debt)
  // ══════════════════════════════════════════════════════════════════════════════

  it("should accrue interest over time", async function () {
    const marketId = 1n;
    const market = await presage.getMarket(marketId);
    const mp = market.morphoParams;
    const mid = morphoMarketId(mp);

    const morpho = await ethers.getContractAt("contracts/vendor/morpho/IMorpho.sol:IMorpho", MORPHO);
    const aliceAddr = await alice.getAddress();

    // Snapshot borrow state before time warp
    const mktBefore = await morpho.market(mid);
    const posBefore = await morpho.position(mid, aliceAddr);
    const debtBefore = BigInt(mktBefore.totalBorrowShares) > 0n
      ? (BigInt(posBefore.borrowShares) * BigInt(mktBefore.totalBorrowAssets)) / BigInt(mktBefore.totalBorrowShares)
      : 0n;

    // Fast-forward 30 days
    await ethers.provider.send("evm_increaseTime", [86400 * 30]);
    await ethers.provider.send("evm_mine", []);

    // Accrue interest by touching the market (Morpho accrues on any state-changing call)
    await presage.triggerAccrual(marketId);

    const mktAfter = await morpho.market(mid);
    const posAfter = await morpho.position(mid, aliceAddr);
    const debtAfter = BigInt(mktAfter.totalBorrowShares) > 0n
      ? (BigInt(posAfter.borrowShares) * BigInt(mktAfter.totalBorrowAssets)) / BigInt(mktAfter.totalBorrowShares)
      : 0n;

    console.log(`    Debt before  : ${formatEther(debtBefore)} USDT`);
    console.log(`    Debt after   : ${formatEther(debtAfter)} USDT (30 days later)`);
    console.log(`    Interest     : ${formatEther(debtAfter - debtBefore)} USDT`);

    expect(debtAfter).to.be.gt(debtBefore);

    // Supplier should also have earned — check supply shares are worth more
    const supplyBefore = (BigInt(posBefore.supplyShares) * BigInt(mktBefore.totalSupplyAssets)) / BigInt(mktBefore.totalSupplyShares);
    const supplyAfter = (BigInt(posAfter.supplyShares) * BigInt(mktAfter.totalSupplyAssets)) / BigInt(mktAfter.totalSupplyShares);

    console.log(`    Supply value : ${formatEther(supplyBefore)} → ${formatEther(supplyAfter)} USDT`);
    expect(supplyAfter).to.be.gt(supplyBefore);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  LIQUIDATION (settleWithLoanToken) — no fees configured
  // ══════════════════════════════════════════════════════════════════════════════

  it("should become liquidatable when oracle price drops", async function () {
    const marketId = 1n;
    const aliceAddr = await alice.getAddress();

    // Re-seed at $1 first (previous test warped time 30 days, making the old price stale)
    await priceHub.seedPrice(POSITION_ID, parseEther("1"));

    // HF should currently be healthy
    const hfBefore = await presage.healthFactor(marketId, aliceAddr);
    console.log(`    HF before price drop: ${formatEther(hfBefore)}`);
    expect(Number(formatEther(hfBefore))).to.be.gt(1.0);

    // Drop oracle price to $0.10 (90% crash) — makes position deeply underwater
    await priceHub.seedPrice(POSITION_ID, parseEther("0.10"));

    const hfAfter = await presage.healthFactor(marketId, aliceAddr);
    console.log(`    HF after price drop : ${formatEther(hfAfter)}`);
    expect(Number(formatEther(hfAfter))).to.be.lt(1.0);
  });

  it("should settleWithLoanToken with zero liquidation fee", async function () {
    const marketId = 1n;
    const aliceAddr = await alice.getAddress();

    const morpho = await ethers.getContractAt("contracts/vendor/morpho/IMorpho.sol:IMorpho", MORPHO);
    const market = await presage.getMarket(marketId);
    const mp = market.morphoParams;
    const mid = morphoMarketId(mp);

    // Owner acts as liquidator
    const ownerAddr = await owner.getAddress();
    const usdt = await ethers.getContractAt("IERC20", USDT);

    // Get Alice's current debt — liquidate half to stay within Morpho's math bounds
    const mkt = await morpho.market(mid);
    const pos = await morpho.position(mid, aliceAddr);
    const totalDebt = BigInt(mkt.totalBorrowShares) > 0n
      ? (BigInt(pos.borrowShares) * BigInt(mkt.totalBorrowAssets) + BigInt(mkt.totalBorrowShares) - 1n) / BigInt(mkt.totalBorrowShares)
      : 0n;

    // Liquidate half the debt
    const repayAmount = totalDebt / 2n;

    console.log(`    Alice total debt : ${formatEther(totalDebt)} USDT`);
    console.log(`    Liquidating      : ${formatEther(repayAmount)} USDT`);
    console.log(`    Alice collateral : ${formatEther(BigInt(pos.collateral))} wCTF`);

    // Fund owner with USDT for liquidation (Alice has surplus from initial funding)
    await usdt.connect(alice).transfer(ownerAddr, repayAmount + parseEther("1"));

    // Approve with buffer for rounding (settleWithLoanToken may pull up to 1 wei extra)
    await usdt.connect(owner).approve(await presage.getAddress(), repayAmount + 1n);

    const ctfBalBefore = await mockCTF.balanceOf(ownerAddr, POSITION_ID);

    const tx = await presage.connect(owner).settleWithLoanToken(marketId, aliceAddr, repayAmount);

    const ctfBalAfter = await mockCTF.balanceOf(ownerAddr, POSITION_ID);
    const seized = ctfBalAfter - ctfBalBefore;

    console.log(`    Repaid           : ${formatEther(repayAmount)} USDT`);
    console.log(`    CTF seized       : ${formatEther(seized)}`);
    expect(seized).to.be.gt(0n);

    // No liquidation fee event — fees are 0
    await expect(tx).to.not.emit(presage, "LiquidationFeeCollected");

    // Alice's position should have reduced debt and collateral
    const mktAfter = await morpho.market(mid);
    const posAfter = await morpho.position(mid, aliceAddr);
    const debtAfter = BigInt(mktAfter.totalBorrowShares) > 0n
      ? (BigInt(posAfter.borrowShares) * BigInt(mktAfter.totalBorrowAssets)) / BigInt(mktAfter.totalBorrowShares)
      : 0n;
    console.log(`    Alice debt after : ${formatEther(debtAfter)} USDT`);
    console.log(`    Alice coll after : ${formatEther(BigInt(posAfter.collateral))} wCTF`);
    expect(BigInt(posAfter.borrowShares)).to.be.lt(BigInt(pos.borrowShares));
    expect(BigInt(posAfter.collateral)).to.be.lt(BigInt(pos.collateral));
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  FULL REPAYMENT
  // ══════════════════════════════════════════════════════════════════════════════

  it("should allow full repayment with a buffer (refunds dust)", async function () {
    const marketId = 1n;
    const market = await presage.getMarket(marketId);
    const mp = market.morphoParams;
    const mid = morphoMarketId(mp);

    const morpho = await ethers.getContractAt("contracts/vendor/morpho/IMorpho.sol:IMorpho", MORPHO);
    const usdt = await ethers.getContractAt("IERC20", USDT);
    const aliceAddr = await alice.getAddress();
    const pos = await morpho.position(mid, aliceAddr);
    const mkt = await morpho.market(mid);

    if (BigInt(pos.borrowShares) === 0n) {
      console.log("    No debt remaining — skipping");
      this.skip();
      return;
    }

    // Calculate actual debt
    const debt = (BigInt(pos.borrowShares) * BigInt(mkt.totalBorrowAssets) + BigInt(mkt.totalBorrowShares) - 1n) / BigInt(mkt.totalBorrowShares);

    // Attempt full repayment with a buffer
    const repayAmount = debt + parseUnits("1", 18); // $1 extra
    await usdt.connect(alice).approve(await presage.getAddress(), repayAmount);

    const balBefore = await usdt.balanceOf(aliceAddr);
    await presage.connect(alice).repay(marketId, repayAmount);
    const balAfter = await usdt.balanceOf(aliceAddr);

    // Verify debt is gone
    const posAfter = await morpho.position(mid, aliceAddr);
    expect(posAfter.borrowShares).to.equal(0n);

    const spent = balBefore - balAfter;
    expect(spent).to.be.lt(repayAmount);
    expect(spent).to.be.gte(debt);

    console.log(`    Alice repaid full debt. Spent: ${formatUnits(spent, 18)} USDT, Buffer: 1.0 USDT`);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  FEE ADMIN VALIDATION
  // ══════════════════════════════════════════════════════════════════════════════

  it("should reject setTreasury with zero address", async function () {
    await expect(
      presage.setTreasury(ethers.ZeroAddress)
    ).to.be.revertedWith("zero address");
  });

  it("should reject setTreasury from non-owner", async function () {
    await expect(
      presage.connect(alice).setTreasury(await treasuryWallet.getAddress())
    ).to.be.revertedWithCustomError(presage, "OwnableUnauthorizedAccount");
  });

  it("should set treasury and emit event", async function () {
    const treasuryAddr = await treasuryWallet.getAddress();
    const tx = await presage.setTreasury(treasuryAddr);
    await expect(tx).to.emit(presage, "TreasurySet").withArgs(treasuryAddr);
    expect(await presage.treasury()).to.equal(treasuryAddr);
  });

  it("should reject setDefaultOriginationFee exceeding cap", async function () {
    // MAX_ORIGINATION_FEE_BPS = 500 (5%)
    await expect(
      presage.setDefaultOriginationFee(501)
    ).to.be.revertedWith("exceeds cap");
  });

  it("should reject setDefaultOriginationFee from non-owner", async function () {
    await expect(
      presage.connect(alice).setDefaultOriginationFee(50)
    ).to.be.revertedWithCustomError(presage, "OwnableUnauthorizedAccount");
  });

  it("should set default origination fee and emit event", async function () {
    const tx = await presage.setDefaultOriginationFee(200); // 2%
    await expect(tx).to.emit(presage, "DefaultOriginationFeeSet").withArgs(200);
    expect(await presage.defaultOriginationFeeBps()).to.equal(200n);
  });

  it("should reject setDefaultLiquidationFee exceeding cap", async function () {
    // MAX_LIQUIDATION_FEE_BPS = 2000 (20%)
    await expect(
      presage.setDefaultLiquidationFee(2001)
    ).to.be.revertedWith("exceeds cap");
  });

  it("should reject setDefaultLiquidationFee from non-owner", async function () {
    await expect(
      presage.connect(alice).setDefaultLiquidationFee(500)
    ).to.be.revertedWithCustomError(presage, "OwnableUnauthorizedAccount");
  });

  it("should set default liquidation fee and emit event", async function () {
    const tx = await presage.setDefaultLiquidationFee(1500); // 15%
    await expect(tx).to.emit(presage, "DefaultLiquidationFeeSet").withArgs(1500);
    expect(await presage.defaultLiquidationFeeBps()).to.equal(1500n);
  });

  it("should reject setMarketFees exceeding origination cap", async function () {
    await expect(
      presage.setMarketFees(1n, 501, 1000)
    ).to.be.revertedWith("exceeds cap");
  });

  it("should reject setMarketFees exceeding liquidation cap", async function () {
    await expect(
      presage.setMarketFees(1n, 100, 2001)
    ).to.be.revertedWith("exceeds cap");
  });

  it("should reject setMarketFees from non-owner", async function () {
    await expect(
      presage.connect(alice).setMarketFees(1n, 100, 1000)
    ).to.be.revertedWithCustomError(presage, "OwnableUnauthorizedAccount");
  });

  it("should allow max fee values at the cap boundary", async function () {
    // Set at exactly the cap — should succeed
    await presage.setDefaultOriginationFee(500);  // exactly MAX_ORIGINATION_FEE_BPS
    expect(await presage.defaultOriginationFeeBps()).to.equal(500n);

    await presage.setDefaultLiquidationFee(2000); // exactly MAX_LIQUIDATION_FEE_BPS
    expect(await presage.defaultLiquidationFeeBps()).to.equal(2000n);

    await presage.setMarketFees(1n, 500, 2000);   // both at cap
    const market = await presage.getMarket(1n);
    expect(market.originationFeeBps_).to.equal(500n);
    expect(market.liquidationFeeBps_).to.equal(2000n);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  DEFAULT FEES INHERITED ON MARKET CREATION
  // ══════════════════════════════════════════════════════════════════════════════

  it("should inherit default fees when opening a new market", async function () {
    // Set non-zero defaults (still set from previous test: 500, 2000)
    // Reset to reasonable values for the test
    await presage.setDefaultOriginationFee(75);  // 0.75%
    await presage.setDefaultLiquidationFee(800); // 8%

    // Create market 2 with a different position
    const POSITION_ID_2 = 99n;
    const ctfPos = {
      ctf: await mockCTF.getAddress(),
      parentCollectionId: ethers.ZeroHash,
      conditionId: ethers.ZeroHash,
      positionId: POSITION_ID_2,
      oppositePositionId: 100n,
    };

    const resolutionAt = Math.floor(Date.now() / 1000) + 86400 * 365;
    await presage.openMarket(ctfPos, USDT, parseEther("0.77"), resolutionAt, 86400 * 7, 3600);

    const market2 = await presage.getMarket(2n);
    expect(market2.originationFeeBps_).to.equal(75n);
    expect(market2.liquidationFeeBps_).to.equal(800n);

    console.log(`    Market 2 inherited: origination=75 bps, liquidation=800 bps`);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  FEE-ENABLED BORROW + LIQUIDATION (market 1)
  // ══════════════════════════════════════════════════════════════════════════════

  it("should set per-market fees and emit event", async function () {
    // Set market 1: 1% origination, 10% liquidation
    const tx = await presage.setMarketFees(1n, 100, 1000);
    await expect(tx).to.emit(presage, "MarketFeesSet").withArgs(1n, 100, 1000);

    const market = await presage.getMarket(1n);
    expect(market.originationFeeBps_).to.equal(100n);
    expect(market.liquidationFeeBps_).to.equal(1000n);

    console.log(`    Market 1 fees: origination=100 bps (1%), liquidation=1000 bps (10%)`);
  });

  it("should deduct origination fee on borrow and emit events", async function () {
    const marketId = 1n;
    const aliceAddr = await alice.getAddress();
    const treasuryAddr = await treasuryWallet.getAddress();

    // Re-seed price to $1 so Alice can borrow
    await priceHub.seedPrice(POSITION_ID, parseEther("1"));

    // Check Alice has remaining collateral
    const market = await presage.getMarket(marketId);
    const mp = market.morphoParams;
    const mid = morphoMarketId(mp);
    const morpho = await ethers.getContractAt("contracts/vendor/morpho/IMorpho.sol:IMorpho", MORPHO);
    const pos = await morpho.position(mid, aliceAddr);
    console.log(`    Alice collateral: ${formatEther(BigInt(pos.collateral))} wCTF`);

    if (BigInt(pos.collateral) === 0n) {
      console.log("    No collateral — skipping");
      this.skip();
      return;
    }

    // Borrow a small amount
    const borrowAmount = parseUnits("2", 18);
    const usdt = await ethers.getContractAt("IERC20", USDT);

    const aliceBefore = await usdt.balanceOf(aliceAddr);
    const treasuryBefore = await usdt.balanceOf(treasuryAddr);

    const tx = await presage.connect(alice).borrow(marketId, borrowAmount);

    const aliceAfter = await usdt.balanceOf(aliceAddr);
    const treasuryAfter = await usdt.balanceOf(treasuryAddr);

    // Fee = 2 USDT * 100/10000 = 0.02 USDT
    const expectedFee = (borrowAmount * 100n) / 10000n;
    const aliceReceived = aliceAfter - aliceBefore;
    const treasuryReceived = treasuryAfter - treasuryBefore;

    expect(aliceReceived).to.equal(borrowAmount - expectedFee);
    expect(treasuryReceived).to.equal(expectedFee);

    // Verify events
    await expect(tx).to.emit(presage, "LoanTaken").withArgs(marketId, aliceAddr, borrowAmount);
    await expect(tx).to.emit(presage, "OriginationFeeCollected").withArgs(marketId, aliceAddr, expectedFee);

    console.log(`    Borrowed: ${formatUnits(borrowAmount, 18)} USDT`);
    console.log(`    Fee (1%): ${formatUnits(expectedFee, 18)} USDT → treasury`);
    console.log(`    Alice received: ${formatUnits(aliceReceived, 18)} USDT`);
  });

  it("should deduct liquidation fee on settleWithLoanToken and emit events", async function () {
    const marketId = 1n;
    const aliceAddr = await alice.getAddress();
    const ownerAddr = await owner.getAddress();
    const treasuryAddr = await treasuryWallet.getAddress();

    // Drop price to make Alice liquidatable (2 USDT debt against remaining collateral)
    // At $0.01: even small collateral → deeply underwater
    await priceHub.seedPrice(POSITION_ID, parseEther("0.01"));

    const hf = await presage.healthFactor(marketId, aliceAddr);
    console.log(`    HF after price drop: ${formatEther(hf)}`);
    expect(Number(formatEther(hf))).to.be.lt(1.0);

    const morpho = await ethers.getContractAt("contracts/vendor/morpho/IMorpho.sol:IMorpho", MORPHO);
    const market = await presage.getMarket(marketId);
    const mp = market.morphoParams;
    const mid = morphoMarketId(mp);

    const pos = await morpho.position(mid, aliceAddr);
    const mkt = await morpho.market(mid);
    const debt = BigInt(mkt.totalBorrowShares) > 0n
      ? (BigInt(pos.borrowShares) * BigInt(mkt.totalBorrowAssets) + BigInt(mkt.totalBorrowShares) - 1n) / BigInt(mkt.totalBorrowShares)
      : 0n;

    if (debt === 0n) {
      console.log("    No debt to liquidate — skipping");
      this.skip();
      return;
    }

    // At $0.01 price, seized collateral = repayAmount / price * LIF
    // Alice has ~19.4 wCTF, so we must repay a small enough amount
    // Max safe repay ≈ collateral * price / LIF ≈ 19 * 0.01 / 1.074 ≈ 0.17 USDT
    // Use a conservative 0.1 USDT to stay within bounds
    const repayAmount = parseUnits("0.1", 18);
    const usdt = await ethers.getContractAt("IERC20", USDT);
    const wrapperAddr = await factory.getWrapper(POSITION_ID);
    const wrapper = await ethers.getContractAt("WrappedCTF", wrapperAddr);

    // Fund owner for liquidation
    const ownerBal = await usdt.balanceOf(ownerAddr);
    if (ownerBal < repayAmount + parseEther("1")) {
      await ethers.provider.send("hardhat_impersonateAccount", [WHALE]);
      const whaleSigner = await ethers.getSigner(WHALE);
      await usdt.connect(whaleSigner).transfer(ownerAddr, repayAmount + parseEther("1"));
    }
    await usdt.connect(owner).approve(await presage.getAddress(), repayAmount + 1n);

    // Track balances: liquidator gets CTF tokens, treasury gets wrapped CTF
    const treasuryWrapBefore = await wrapper.balanceOf(treasuryAddr);
    const ownerCtfBefore = await mockCTF.balanceOf(ownerAddr, POSITION_ID);

    const tx = await presage.connect(owner).settleWithLoanToken(marketId, aliceAddr, repayAmount);

    const treasuryWrapAfter = await wrapper.balanceOf(treasuryAddr);
    const ownerCtfAfter = await mockCTF.balanceOf(ownerAddr, POSITION_ID);
    const feeCollected = treasuryWrapAfter - treasuryWrapBefore;
    const ctfReceived = ownerCtfAfter - ownerCtfBefore;

    console.log(`    Debt: ${formatEther(debt)} USDT`);
    console.log(`    Liquidation fee (wrapped CTF → treasury): ${formatEther(feeCollected)}`);
    console.log(`    CTF received by liquidator: ${formatEther(ctfReceived)}`);
    expect(feeCollected).to.be.gt(0n);
    expect(ctfReceived).to.be.gt(0n);

    // Fee should be 10% of seized (fee + ctfReceived = total seized from Morpho, approximately)
    // fee = seized * 1000 / 10000 = seized / 10
    // So fee ≈ ctfReceived / 9 (since ctfReceived = seized - fee = seized * 9/10)
    const expectedFeeApprox = BigInt(ctfReceived) / 9n;
    // Allow 1 wei rounding tolerance
    expect(feeCollected).to.be.gte(expectedFeeApprox - 1n);
    expect(feeCollected).to.be.lte(expectedFeeApprox + 1n);

    // Verify events
    await expect(tx).to.emit(presage, "SettledWithLoanToken");
    await expect(tx).to.emit(presage, "LiquidationFeeCollected").withArgs(marketId, feeCollected);

    // Verify Alice's debt is reduced
    const posAfter = await morpho.position(mid, aliceAddr);
    console.log(`    Alice debt after: ${BigInt(posAfter.borrowShares)} shares`);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  EDGE CASE: FEE BPS > 0 BUT TREASURY IS ZERO → NO FEE
  // ══════════════════════════════════════════════════════════════════════════════

  it("should not deduct origination fee when treasury is unset (even if bps > 0)", async function () {
    // Deploy a second Presage instance with no treasury
    const Presage2 = await ethers.getContractFactory("Presage");
    const presage2 = await Presage2.deploy(MORPHO, await factory.getAddress(), await priceHub.getAddress(), IRM);

    // Set non-zero default fees but don't set treasury
    await presage2.setDefaultOriginationFee(100);
    await presage2.setDefaultLiquidationFee(1000);

    expect(await presage2.treasury()).to.equal(ethers.ZeroAddress);
    expect(await presage2.defaultOriginationFeeBps()).to.equal(100n);

    // Create a market on presage2 with fresh position
    const POSITION_ID_3 = 200n;
    await mockCTF.mint(await alice.getAddress(), POSITION_ID_3, parseEther("50"));

    const ctfPos = {
      ctf: await mockCTF.getAddress(),
      parentCollectionId: ethers.ZeroHash,
      conditionId: ethers.ZeroHash,
      positionId: POSITION_ID_3,
      oppositePositionId: 201n,
    };

    const resolutionAt = Math.floor(Date.now() / 1000) + 86400 * 365;
    await presage2.openMarket(ctfPos, USDT, parseEther("0.77"), resolutionAt, 86400 * 7, 3600);

    // Market should have fee bps from defaults
    const market = await presage2.getMarket(1n);
    expect(market.originationFeeBps_).to.equal(100n);

    // Deposit collateral
    await mockCTF.connect(alice).setApprovalForAll(await presage2.getAddress(), true);
    await presage2.connect(alice).depositCollateral(1n, parseEther("50"));

    // Supply USDT
    const usdt = await ethers.getContractAt("IERC20", USDT);

    // Fund Alice if needed
    const aliceBal = await usdt.balanceOf(await alice.getAddress());
    if (aliceBal < parseUnits("100", 18)) {
      await ethers.provider.send("hardhat_impersonateAccount", [WHALE]);
      const whaleSigner = await ethers.getSigner(WHALE);
      await usdt.connect(whaleSigner).transfer(await alice.getAddress(), parseUnits("200", 18));
    }

    await usdt.connect(alice).approve(await presage2.getAddress(), parseUnits("100", 18));
    await presage2.connect(alice).supply(1n, parseUnits("100", 18));

    // Seed price + authorize
    await priceHub.seedPrice(POSITION_ID_3, parseEther("1"));
    const morpho = await ethers.getContractAt("contracts/vendor/morpho/IMorpho.sol:IMorpho", MORPHO);
    await morpho.connect(alice).setAuthorization(await presage2.getAddress(), true);

    // Borrow
    const borrowAmount = parseUnits("5", 18);
    const balBefore = await usdt.balanceOf(await alice.getAddress());

    const tx = await presage2.connect(alice).borrow(1n, borrowAmount);

    const balAfter = await usdt.balanceOf(await alice.getAddress());

    // Alice should receive full amount — no fee because treasury is zero address
    expect(balAfter - balBefore).to.equal(borrowAmount);
    await expect(tx).to.not.emit(presage2, "OriginationFeeCollected");

    console.log(`    Borrowed ${formatUnits(borrowAmount, 18)} USDT with bps=100 but treasury=0x0 → no fee deducted`);

    // Cleanup: deauthorize presage2
    await morpho.connect(alice).setAuthorization(await presage2.getAddress(), false);
  });

  it("should allow setting fee to zero to disable fees", async function () {
    // Reset market 1 fees to zero
    const tx = await presage.setMarketFees(1n, 0, 0);
    await expect(tx).to.emit(presage, "MarketFeesSet").withArgs(1n, 0, 0);

    const market = await presage.getMarket(1n);
    expect(market.originationFeeBps_).to.equal(0n);
    expect(market.liquidationFeeBps_).to.equal(0n);

    console.log(`    Market 1 fees reset to 0/0`);
  });
});
