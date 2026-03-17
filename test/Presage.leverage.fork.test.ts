import { expect } from "chai";
import { ethers } from "hardhat";
import { parseUnits, parseEther, formatEther, formatUnits } from "ethers";

/**
 * Leverage Fork Test — BNB Mainnet
 *
 * Comprehensive tests for the solver-assisted leverage/deleverage mechanism
 * against actual Morpho Blue on a local fork of BNB Mainnet.
 *
 * Actors:
 *   - owner: deploys contracts, acts as admin
 *   - alice: borrower who requests leverage/deleverage
 *   - bob:   solver who fills leverage/deleverage requests
 *   - carol: third party (for access control tests)
 */

describe("Presage Leverage Fork Test (BNB Mainnet)", function () {
  const MORPHO = ethers.getAddress("0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a");
  const IRM = ethers.getAddress("0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979");
  const USDT = ethers.getAddress("0x55d398326f99059fF775485246999027B3197955");
  const WHALE = ethers.getAddress("0x8894E0a0c962CB723c1976a4421c95949bE2D4E3");

  let presage: any;
  let factory: any;
  let priceHub: any;
  let mockCTF: any;
  let morpho: any;
  let usdt: any;
  let owner: any;
  let alice: any; // borrower
  let bob: any;   // solver
  let carol: any; // third party
  let treasuryWallet: any;

  const POSITION_ID = 10n;
  const OPPOSITE_POSITION_ID = 11n;
  const MARKET_ID = 1n;

  function morphoMarketId(mp: any): string {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "address", "uint256"],
        [mp.loanToken, mp.collateralToken, mp.oracle, mp.irm, mp.lltv]
      )
    );
  }

  before(async function () {
    [owner, alice, bob, carol, treasuryWallet] = await ethers.getSigners();

    // Deploy core contracts
    const WrapperFactory = await ethers.getContractFactory("WrapperFactory");
    factory = await WrapperFactory.deploy();

    const PriceHub = await ethers.getContractFactory("PriceHub");
    priceHub = await PriceHub.deploy(3600);

    const Presage = await ethers.getContractFactory("Presage");
    presage = await Presage.deploy(MORPHO, await factory.getAddress(), await priceHub.getAddress(), IRM);

    const MockCTF = await ethers.getContractFactory("MockCTF");
    mockCTF = await MockCTF.deploy();

    // Fixed price oracle at $1
    const FixedPriceAdapter = await ethers.getContractFactory("FixedPriceAdapter");
    const adapter = await FixedPriceAdapter.deploy();
    await priceHub.setDefaultAdapter(await adapter.getAddress());

    // Create market
    const ctfPos = {
      ctf: await mockCTF.getAddress(),
      parentCollectionId: ethers.ZeroHash,
      conditionId: ethers.ZeroHash,
      positionId: POSITION_ID,
      oppositePositionId: OPPOSITE_POSITION_ID,
    };
    const resolutionAt = Math.floor(Date.now() / 1000) + 86400 * 365;
    await presage.openMarket(ctfPos, USDT, parseEther("0.625"), resolutionAt, 86400 * 7, 86400);

    // Seed oracle price
    await priceHub.seedPrice(POSITION_ID, parseEther("1"));

    // Get contract references
    morpho = await ethers.getContractAt("IMorpho", MORPHO);
    usdt = await ethers.getContractAt("IERC20", USDT);

    // Fund USDT
    await ethers.provider.send("hardhat_impersonateAccount", [WHALE]);
    const whaleSigner = await ethers.getSigner(WHALE);
    await owner.sendTransaction({ to: WHALE, value: parseEther("1") });
    await usdt.connect(whaleSigner).transfer(await alice.getAddress(), parseUnits("10000", 18));
    await usdt.connect(whaleSigner).transfer(await bob.getAddress(), parseUnits("10000", 18));
    await usdt.connect(whaleSigner).transfer(await carol.getAddress(), parseUnits("5000", 18));

    // Alice supplies USDT as lender (to provide borrowable liquidity)
    await usdt.connect(alice).approve(await presage.getAddress(), parseUnits("5000", 18));
    await presage.connect(alice).supply(MARKET_ID, parseUnits("5000", 18));

    // All actors authorize Presage on Morpho (needed for borrow/withdrawCollateral on behalf)
    await morpho.connect(alice).setAuthorization(await presage.getAddress(), true);
    await morpho.connect(bob).setAuthorization(await presage.getAddress(), true);
    await morpho.connect(carol).setAuthorization(await presage.getAddress(), true);

    // Mint CTF tokens for all actors
    await mockCTF.mint(await alice.getAddress(), POSITION_ID, parseEther("1000"));
    await mockCTF.mint(await bob.getAddress(), POSITION_ID, parseEther("3000"));
    await mockCTF.mint(await carol.getAddress(), POSITION_ID, parseEther("500"));

    // Approve Presage to pull CTF
    await mockCTF.connect(alice).setApprovalForAll(await presage.getAddress(), true);
    await mockCTF.connect(bob).setApprovalForAll(await presage.getAddress(), true);
    await mockCTF.connect(carol).setApprovalForAll(await presage.getAddress(), true);
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  LEVERAGE: REQUEST + FILL (HAPPY PATH)
  // ══════════════════════════════════════════════════════════════════════════

  it("should allow borrower to request leverage", async function () {
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    const tx = await presage.connect(alice).requestLeverage(
      MARKET_ID,
      parseEther("100"),  // margin
      parseEther("300"),  // total collateral
      parseUnits("150", 18), // max borrow
      deadline
    );

    await expect(tx).to.emit(presage, "LeverageRequested").withArgs(
      await alice.getAddress(),
      MARKET_ID,
      parseEther("100"),
      parseEther("300"),
      parseUnits("150", 18),
      deadline
    );

    const req = await presage.leverageRequests(await alice.getAddress(), MARKET_ID);
    expect(req.marginAmount).to.equal(parseEther("100"));
    expect(req.supplyCollateralAmount).to.equal(parseEther("300"));
    expect(req.borrowAmountMax).to.equal(parseUnits("150", 18));
    expect(req.filled).to.equal(false);

    console.log("    Alice requested: 100 CTF margin → 300 CTF total, borrow up to 150 USDT");
  });

  it("should allow solver to fill leverage request", async function () {
    const aliceAddr = await alice.getAddress();
    const bobAddr = await bob.getAddress();
    const market = await presage.getMarket(MARKET_ID);
    const mp = market.morphoParams;
    const mid = morphoMarketId(mp);

    const aliceCtfBefore = await mockCTF.balanceOf(aliceAddr, POSITION_ID);
    const bobCtfBefore = await mockCTF.balanceOf(bobAddr, POSITION_ID);
    const bobUsdtBefore = await usdt.balanceOf(bobAddr);

    const tx = await presage.connect(bob).fillLeverage(aliceAddr, MARKET_ID);

    await expect(tx).to.emit(presage, "LeverageFilled").withArgs(
      aliceAddr, MARKET_ID, bobAddr, parseUnits("150", 18)
    );

    // Verify Morpho position
    const pos = await morpho.position(mid, aliceAddr);
    expect(pos.collateral).to.equal(parseEther("300"));
    expect(pos.borrowShares).to.be.gt(0n);

    // Alice lost 100 CTF (margin)
    const aliceCtfAfter = await mockCTF.balanceOf(aliceAddr, POSITION_ID);
    expect(aliceCtfBefore - aliceCtfAfter).to.equal(parseEther("100"));

    // Bob lost 200 CTF (leveraged amount), received 150 USDT
    const bobCtfAfter = await mockCTF.balanceOf(bobAddr, POSITION_ID);
    expect(bobCtfBefore - bobCtfAfter).to.equal(parseEther("200"));
    const bobUsdtAfter = await usdt.balanceOf(bobAddr);
    expect(bobUsdtAfter - bobUsdtBefore).to.equal(parseUnits("150", 18));

    // Request marked as filled
    const req = await presage.leverageRequests(aliceAddr, MARKET_ID);
    expect(req.filled).to.equal(true);

    console.log(`    Alice position: ${formatEther(pos.collateral)} wCTF, ${pos.borrowShares} borrow shares`);
    console.log(`    Bob spent 200 CTF, received 150 USDT`);
  });

  it("should verify health factor after leverage", async function () {
    const hf = await presage.healthFactor(MARKET_ID, await alice.getAddress());
    console.log(`    Alice HF after leverage: ${formatEther(hf)}`);
    // 300 CTF at $1, LLTV 62.5%, 150 USDT debt → HF = (300 * 1 * 0.625) / 150 = 1.25
    expect(Number(formatEther(hf))).to.be.closeTo(1.25, 0.01);
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  LEVERAGE WITH ORIGINATION FEE
  // ══════════════════════════════════════════════════════════════════════════

  it("should deduct origination fee on leveraged borrow", async function () {
    await presage.setTreasury(await treasuryWallet.getAddress());
    await presage.setMarketFees(MARKET_ID, 200, 1000); // 2% origination, 10% liquidation

    const treasuryAddr = await treasuryWallet.getAddress();
    const bobAddr = await bob.getAddress();
    const POSITION_ID_2 = 20n;
    const MARKET_ID_2 = 2n;

    const ctfPos = {
      ctf: await mockCTF.getAddress(),
      parentCollectionId: ethers.ZeroHash,
      conditionId: ethers.ZeroHash,
      positionId: POSITION_ID_2,
      oppositePositionId: 21n,
    };
    const resolutionAt = Math.floor(Date.now() / 1000) + 86400 * 365;
    await presage.openMarket(ctfPos, USDT, parseEther("0.625"), resolutionAt, 86400 * 7, 86400);
    await presage.setMarketFees(MARKET_ID_2, 200, 1000);
    await priceHub.seedPrice(POSITION_ID_2, parseEther("1"));

    // Supply liquidity to market 2
    await usdt.connect(alice).approve(await presage.getAddress(), parseUnits("3000", 18));
    await presage.connect(alice).supply(MARKET_ID_2, parseUnits("3000", 18));

    // Mint CTF tokens
    await mockCTF.mint(bobAddr, POSITION_ID_2, parseEther("200"));
    await mockCTF.mint(await alice.getAddress(), POSITION_ID_2, parseEther("500"));

    // Bob requests leverage: 50 margin → 200 total, borrow 100 USDT
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;
    await presage.connect(bob).requestLeverage(
      MARKET_ID_2, parseEther("50"), parseEther("200"), parseUnits("100", 18), deadline
    );

    const treasuryBefore = await usdt.balanceOf(treasuryAddr);
    const aliceUsdtBefore = await usdt.balanceOf(await alice.getAddress());

    const tx = await presage.connect(alice).fillLeverage(bobAddr, MARKET_ID_2);

    const treasuryAfter = await usdt.balanceOf(treasuryAddr);
    const aliceUsdtAfter = await usdt.balanceOf(await alice.getAddress());

    // Fee = 100 * 2% = 2 USDT
    expect(treasuryAfter - treasuryBefore).to.equal(parseUnits("2", 18));
    expect(aliceUsdtAfter - aliceUsdtBefore).to.equal(parseUnits("98", 18));
    await expect(tx).to.emit(presage, "OriginationFeeCollected").withArgs(MARKET_ID_2, bobAddr, parseUnits("2", 18));

    console.log(`    Fee (2%): 2 USDT → treasury, solver received 98 USDT`);
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  DELEVERAGE: REQUEST + FILL (HAPPY PATH)
  // ══════════════════════════════════════════════════════════════════════════

  it("should allow borrower to request deleverage", async function () {
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    const tx = await presage.connect(alice).requestDeleverage(
      MARKET_ID, parseUnits("50", 18), parseEther("100"), deadline
    );

    await expect(tx).to.emit(presage, "DeleverageRequested").withArgs(
      await alice.getAddress(), MARKET_ID, parseUnits("50", 18), parseEther("100"), deadline
    );

    const req = await presage.deleverageRequests(await alice.getAddress(), MARKET_ID);
    expect(req.repayAmount).to.equal(parseUnits("50", 18));
    expect(req.withdrawCollateralAmountMax).to.equal(parseEther("100"));
    expect(req.filled).to.equal(false);

    console.log("    Alice requested deleverage: repay 50 USDT, withdraw 100 CTF");
  });

  it("should allow solver to fill deleverage request", async function () {
    const aliceAddr = await alice.getAddress();
    const bobAddr = await bob.getAddress();
    const market = await presage.getMarket(MARKET_ID);
    const mp = market.morphoParams;
    const mid = morphoMarketId(mp);

    const posBefore = await morpho.position(mid, aliceAddr);
    const bobCtfBefore = await mockCTF.balanceOf(bobAddr, POSITION_ID);
    const bobUsdtBefore = await usdt.balanceOf(bobAddr);

    await usdt.connect(bob).approve(await presage.getAddress(), parseUnits("50", 18));
    const tx = await presage.connect(bob).fillDeleverage(aliceAddr, MARKET_ID);

    await expect(tx).to.emit(presage, "DeleverageFilled").withArgs(
      aliceAddr, MARKET_ID, bobAddr, parseEther("100")
    );

    const posAfter = await morpho.position(mid, aliceAddr);
    expect(BigInt(posAfter.collateral)).to.equal(BigInt(posBefore.collateral) - parseEther("100"));
    expect(BigInt(posAfter.borrowShares)).to.be.lt(BigInt(posBefore.borrowShares));

    const bobCtfAfter = await mockCTF.balanceOf(bobAddr, POSITION_ID);
    expect(bobCtfAfter - bobCtfBefore).to.equal(parseEther("100"));

    const bobUsdtAfter = await usdt.balanceOf(bobAddr);
    expect(bobUsdtBefore - bobUsdtAfter).to.be.lte(parseUnits("50", 18));

    const req = await presage.deleverageRequests(aliceAddr, MARKET_ID);
    expect(req.filled).to.equal(true);

    console.log(`    Alice collateral: ${formatEther(posBefore.collateral)} → ${formatEther(posAfter.collateral)} wCTF`);
    console.log(`    Bob spent ≤50 USDT, received 100 CTF`);
  });

  it("should verify health factor after deleverage", async function () {
    const hf = await presage.healthFactor(MARKET_ID, await alice.getAddress());
    console.log(`    Alice HF after deleverage: ${formatEther(hf)}`);
    expect(Number(formatEther(hf))).to.be.gt(1.0);
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  LEVERAGE STACKING (add leverage on top of existing position)
  // ══════════════════════════════════════════════════════════════════════════

  it("should allow stacking leverage on an existing position", async function () {
    const aliceAddr = await alice.getAddress();
    const market = await presage.getMarket(MARKET_ID);
    const mp = market.morphoParams;
    const mid = morphoMarketId(mp);

    const posBefore = await morpho.position(mid, aliceAddr);
    const collateralBefore = BigInt(posBefore.collateral);
    const borrowSharesBefore = BigInt(posBefore.borrowShares);

    console.log(`    Before: ${formatEther(collateralBefore)} wCTF, ${borrowSharesBefore} borrow shares`);

    // Alice requests additional leverage on market 1
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;
    await presage.connect(alice).requestLeverage(
      MARKET_ID, parseEther("50"), parseEther("150"), parseUnits("60", 18), deadline
    );

    await presage.connect(bob).fillLeverage(aliceAddr, MARKET_ID);

    const posAfter = await morpho.position(mid, aliceAddr);
    const collateralAfter = BigInt(posAfter.collateral);
    const borrowSharesAfter = BigInt(posAfter.borrowShares);

    // Collateral should increase by 150
    expect(collateralAfter - collateralBefore).to.equal(parseEther("150"));
    // Debt should increase
    expect(borrowSharesAfter).to.be.gt(borrowSharesBefore);

    const hf = await presage.healthFactor(MARKET_ID, aliceAddr);
    console.log(`    After stacking: ${formatEther(collateralAfter)} wCTF, HF=${formatEther(hf)}`);
    expect(Number(formatEther(hf))).to.be.gt(1.0);
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  CANCEL REQUESTS
  // ══════════════════════════════════════════════════════════════════════════

  it("should allow borrower to cancel a leverage request", async function () {
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    await presage.connect(alice).requestLeverage(
      MARKET_ID, parseEther("10"), parseEther("30"), parseUnits("15", 18), deadline
    );

    const tx = await presage.connect(alice).cancelLeverageRequest(MARKET_ID);
    await expect(tx).to.emit(presage, "LeverageCancelled").withArgs(await alice.getAddress(), MARKET_ID);

    // Request should be zeroed out
    const req = await presage.leverageRequests(await alice.getAddress(), MARKET_ID);
    expect(req.deadline).to.equal(0n);
    expect(req.marginAmount).to.equal(0n);

    console.log("    Leverage request cancelled successfully");
  });

  it("should allow borrower to cancel a deleverage request", async function () {
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    await presage.connect(alice).requestDeleverage(
      MARKET_ID, parseUnits("10", 18), parseEther("20"), deadline
    );

    const tx = await presage.connect(alice).cancelDeleverageRequest(MARKET_ID);
    await expect(tx).to.emit(presage, "DeleverageCancelled").withArgs(await alice.getAddress(), MARKET_ID);

    const req = await presage.deleverageRequests(await alice.getAddress(), MARKET_ID);
    expect(req.deadline).to.equal(0n);
    expect(req.repayAmount).to.equal(0n);

    console.log("    Deleverage request cancelled successfully");
  });

  it("should reject filling a cancelled leverage request", async function () {
    // After cancellation, deadline = 0, so "request expired" is the revert
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    await presage.connect(alice).requestLeverage(
      MARKET_ID, parseEther("10"), parseEther("30"), parseUnits("15", 18), deadline
    );
    await presage.connect(alice).cancelLeverageRequest(MARKET_ID);

    await expect(
      presage.connect(bob).fillLeverage(await alice.getAddress(), MARKET_ID)
    ).to.be.revertedWith("request expired");
  });

  it("should reject filling a cancelled deleverage request", async function () {
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    await presage.connect(alice).requestDeleverage(
      MARKET_ID, parseUnits("10", 18), parseEther("20"), deadline
    );
    await presage.connect(alice).cancelDeleverageRequest(MARKET_ID);

    await usdt.connect(bob).approve(await presage.getAddress(), parseUnits("10", 18));
    await expect(
      presage.connect(bob).fillDeleverage(await alice.getAddress(), MARKET_ID)
    ).to.be.revertedWith("request expired");
  });

  it("should reject cancelling a non-existent leverage request", async function () {
    // carol has never requested leverage
    await expect(
      presage.connect(carol).cancelLeverageRequest(MARKET_ID)
    ).to.be.revertedWith("no active request");
  });

  it("should reject cancelling an already-filled leverage request", async function () {
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    await presage.connect(alice).requestLeverage(
      MARKET_ID, parseEther("10"), parseEther("30"), parseUnits("10", 18), deadline
    );
    await presage.connect(bob).fillLeverage(await alice.getAddress(), MARKET_ID);

    await expect(
      presage.connect(alice).cancelLeverageRequest(MARKET_ID)
    ).to.be.revertedWith("already filled");
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  EDGE CASES: EXPIRED / DOUBLE-FILL / INVALID PARAMS
  // ══════════════════════════════════════════════════════════════════════════

  it("should reject filling an expired leverage request", async function () {
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 10;

    await presage.connect(alice).requestLeverage(
      MARKET_ID, parseEther("10"), parseEther("30"), parseUnits("15", 18), deadline
    );

    await ethers.provider.send("evm_increaseTime", [60]);
    await ethers.provider.send("evm_mine", []);

    await expect(
      presage.connect(bob).fillLeverage(await alice.getAddress(), MARKET_ID)
    ).to.be.revertedWith("request expired");
  });

  it("should reject double-filling a leverage request", async function () {
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 7200;

    await presage.connect(alice).requestLeverage(
      MARKET_ID, parseEther("10"), parseEther("30"), parseUnits("10", 18), deadline
    );

    await presage.connect(bob).fillLeverage(await alice.getAddress(), MARKET_ID);

    await expect(
      presage.connect(bob).fillLeverage(await alice.getAddress(), MARKET_ID)
    ).to.be.revertedWith("already filled");
  });

  it("should reject leverage request where margin >= total collateral", async function () {
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    await expect(
      presage.connect(alice).requestLeverage(
        MARKET_ID, parseEther("100"), parseEther("100"), parseUnits("50", 18), deadline
      )
    ).to.be.revertedWith("margin >= total");

    // Also test margin > total
    await expect(
      presage.connect(alice).requestLeverage(
        MARKET_ID, parseEther("200"), parseEther("100"), parseUnits("50", 18), deadline
      )
    ).to.be.revertedWith("margin >= total");
  });

  it("should reject leverage request with expired deadline", async function () {
    const block = await ethers.provider.getBlock("latest");
    const pastDeadline = block!.timestamp - 100;

    await expect(
      presage.connect(alice).requestLeverage(
        MARKET_ID, parseEther("10"), parseEther("30"), parseUnits("15", 18), pastDeadline
      )
    ).to.be.revertedWith("deadline passed");
  });

  it("should reject filling an expired deleverage request", async function () {
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 10;

    await presage.connect(alice).requestDeleverage(
      MARKET_ID, parseUnits("10", 18), parseEther("20"), deadline
    );

    await ethers.provider.send("evm_increaseTime", [60]);
    await ethers.provider.send("evm_mine", []);

    await usdt.connect(bob).approve(await presage.getAddress(), parseUnits("10", 18));
    await expect(
      presage.connect(bob).fillDeleverage(await alice.getAddress(), MARKET_ID)
    ).to.be.revertedWith("request expired");
  });

  it("should allow overwriting a request with a new one", async function () {
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 7200;

    await presage.connect(alice).requestLeverage(
      MARKET_ID, parseEther("10"), parseEther("50"), parseUnits("20", 18), deadline
    );

    // Overwrite with different params
    await presage.connect(alice).requestLeverage(
      MARKET_ID, parseEther("20"), parseEther("60"), parseUnits("25", 18), deadline
    );

    const req = await presage.leverageRequests(await alice.getAddress(), MARKET_ID);
    expect(req.marginAmount).to.equal(parseEther("20"));
    expect(req.supplyCollateralAmount).to.equal(parseEther("60"));
    expect(req.borrowAmountMax).to.equal(parseUnits("25", 18));
    expect(req.filled).to.equal(false);

    console.log("    Overwrite verified: request updated to 20 margin → 60 total, 25 USDT borrow");
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  ACCESS CONTROL: ANYONE CAN FILL (PERMISSIONLESS)
  // ══════════════════════════════════════════════════════════════════════════

  it("should allow any solver (carol) to fill a leverage request", async function () {
    const aliceAddr = await alice.getAddress();
    const carolAddr = await carol.getAddress();

    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    await presage.connect(alice).requestLeverage(
      MARKET_ID, parseEther("10"), parseEther("30"), parseUnits("10", 18), deadline
    );

    const carolUsdtBefore = await usdt.balanceOf(carolAddr);
    await presage.connect(carol).fillLeverage(aliceAddr, MARKET_ID);
    const carolUsdtAfter = await usdt.balanceOf(carolAddr);

    // Carol received borrow proceeds (minus fee since treasury is set)
    expect(carolUsdtAfter).to.be.gt(carolUsdtBefore);

    console.log(`    Carol (third party) filled leverage, received ${formatUnits(carolUsdtAfter - carolUsdtBefore, 18)} USDT`);
  });

  it("should allow any solver (carol) to fill a deleverage request", async function () {
    const aliceAddr = await alice.getAddress();
    const carolAddr = await carol.getAddress();

    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    await presage.connect(alice).requestDeleverage(
      MARKET_ID, parseUnits("5", 18), parseEther("10"), deadline
    );

    const carolCtfBefore = await mockCTF.balanceOf(carolAddr, POSITION_ID);
    await usdt.connect(carol).approve(await presage.getAddress(), parseUnits("5", 18));
    await presage.connect(carol).fillDeleverage(aliceAddr, MARKET_ID);
    const carolCtfAfter = await mockCTF.balanceOf(carolAddr, POSITION_ID);

    expect(carolCtfAfter - carolCtfBefore).to.equal(parseEther("10"));

    console.log(`    Carol (third party) filled deleverage, received 10 CTF`);
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  INSUFFICIENT BALANCE EDGE CASES
  // ══════════════════════════════════════════════════════════════════════════

  it("should revert if solver has insufficient CTF for leverage fill", async function () {
    const aliceAddr = await alice.getAddress();
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    // Alice requests massive leverage — solver needs 9990 CTF (more than anyone has)
    await presage.connect(alice).requestLeverage(
      MARKET_ID, parseEther("10"), parseEther("10000"), parseUnits("5000", 18), deadline
    );

    // Carol doesn't have enough CTF
    await expect(
      presage.connect(carol).fillLeverage(aliceAddr, MARKET_ID)
    ).to.be.reverted;
  });

  it("should revert if borrower has insufficient CTF for margin", async function () {
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    // Give a fresh address minimal CTF — insufficient for the margin amount
    const [, , , , , freshUser] = await ethers.getSigners();
    await mockCTF.mint(await freshUser.getAddress(), POSITION_ID, parseEther("5"));
    await mockCTF.connect(freshUser).setApprovalForAll(await presage.getAddress(), true);
    await morpho.connect(freshUser).setAuthorization(await presage.getAddress(), true);

    // Request 100 margin but only has 5 CTF
    await presage.connect(freshUser).requestLeverage(
      MARKET_ID, parseEther("100"), parseEther("200"), parseUnits("50", 18), deadline
    );

    await expect(
      presage.connect(bob).fillLeverage(await freshUser.getAddress(), MARKET_ID)
    ).to.be.reverted;
  });

  it("should revert if solver has insufficient USDT for deleverage fill", async function () {
    const aliceAddr = await alice.getAddress();
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    // Alice requests deleverage with huge repay amount
    await presage.connect(alice).requestDeleverage(
      MARKET_ID, parseUnits("999999", 18), parseEther("10"), deadline
    );

    // Carol can't afford this
    await usdt.connect(carol).approve(await presage.getAddress(), parseUnits("999999", 18));
    await expect(
      presage.connect(carol).fillDeleverage(aliceAddr, MARKET_ID)
    ).to.be.reverted;
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  BORROW EXCEEDS AVAILABLE LIQUIDITY
  // ══════════════════════════════════════════════════════════════════════════

  it("should revert if leverage borrow exceeds available supply", async function () {
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    // Create a market with minimal liquidity
    const POSITION_ID_3 = 30n;
    const MARKET_ID_3 = 3n;
    const ctfPos = {
      ctf: await mockCTF.getAddress(),
      parentCollectionId: ethers.ZeroHash,
      conditionId: ethers.ZeroHash,
      positionId: POSITION_ID_3,
      oppositePositionId: 31n,
    };
    const resolutionAt = Math.floor(Date.now() / 1000) + 86400 * 365;
    await presage.openMarket(ctfPos, USDT, parseEther("0.625"), resolutionAt, 86400 * 7, 86400);
    await priceHub.seedPrice(POSITION_ID_3, parseEther("1"));

    // Supply only 10 USDT
    await usdt.connect(bob).approve(await presage.getAddress(), parseUnits("10", 18));
    await presage.connect(bob).supply(MARKET_ID_3, parseUnits("10", 18));

    // Mint CTF
    await mockCTF.mint(await alice.getAddress(), POSITION_ID_3, parseEther("500"));
    await mockCTF.mint(await bob.getAddress(), POSITION_ID_3, parseEther("500"));

    // Alice requests leverage that needs 100 USDT borrow (only 10 available)
    await presage.connect(alice).requestLeverage(
      MARKET_ID_3, parseEther("50"), parseEther("200"), parseUnits("100", 18), deadline
    );

    await expect(
      presage.connect(bob).fillLeverage(await alice.getAddress(), MARKET_ID_3)
    ).to.be.reverted;
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  DELEVERAGE WITHDRAWING MORE THAN POSITION
  // ══════════════════════════════════════════════════════════════════════════

  it("should revert if deleverage tries to withdraw more collateral than position has", async function () {
    const aliceAddr = await alice.getAddress();
    const market = await presage.getMarket(MARKET_ID);
    const mp = market.morphoParams;
    const mid = morphoMarketId(mp);
    const pos = await morpho.position(mid, aliceAddr);
    const currentCollateral = BigInt(pos.collateral);

    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    // Request more collateral withdrawal than exists
    await presage.connect(alice).requestDeleverage(
      MARKET_ID, parseUnits("5", 18), currentCollateral + parseEther("100"), deadline
    );

    await usdt.connect(bob).approve(await presage.getAddress(), parseUnits("5", 18));
    await expect(
      presage.connect(bob).fillDeleverage(aliceAddr, MARKET_ID)
    ).to.be.reverted;
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  MULTIPLE USERS WITH INDEPENDENT REQUESTS
  // ══════════════════════════════════════════════════════════════════════════

  it("should handle independent leverage requests from multiple users", async function () {
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    // Alice and Carol both request leverage on the same market
    await presage.connect(alice).requestLeverage(
      MARKET_ID, parseEther("10"), parseEther("30"), parseUnits("10", 18), deadline
    );
    await presage.connect(carol).requestLeverage(
      MARKET_ID, parseEther("5"), parseEther("15"), parseUnits("5", 18), deadline
    );

    // Fill Alice's request — should not affect Carol's
    await presage.connect(bob).fillLeverage(await alice.getAddress(), MARKET_ID);

    const aliceReq = await presage.leverageRequests(await alice.getAddress(), MARKET_ID);
    const carolReq = await presage.leverageRequests(await carol.getAddress(), MARKET_ID);

    expect(aliceReq.filled).to.equal(true);
    expect(carolReq.filled).to.equal(false);

    // Now fill Carol's
    await presage.connect(bob).fillLeverage(await carol.getAddress(), MARKET_ID);
    const carolReqAfter = await presage.leverageRequests(await carol.getAddress(), MARKET_ID);
    expect(carolReqAfter.filled).to.equal(true);

    console.log("    Both Alice and Carol leverage requests filled independently");
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  DELEVERAGE REQUEST WITH EXPIRED DEADLINE
  // ══════════════════════════════════════════════════════════════════════════

  it("should reject deleverage request with expired deadline", async function () {
    const block = await ethers.provider.getBlock("latest");
    const pastDeadline = block!.timestamp - 100;

    await expect(
      presage.connect(alice).requestDeleverage(
        MARKET_ID, parseUnits("10", 18), parseEther("20"), pastDeadline
      )
    ).to.be.revertedWith("deadline passed");
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  DOUBLE-FILL DELEVERAGE
  // ══════════════════════════════════════════════════════════════════════════

  it("should reject double-filling a deleverage request", async function () {
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    await presage.connect(alice).requestDeleverage(
      MARKET_ID, parseUnits("5", 18), parseEther("10"), deadline
    );

    await usdt.connect(bob).approve(await presage.getAddress(), parseUnits("10", 18));
    await presage.connect(bob).fillDeleverage(await alice.getAddress(), MARKET_ID);

    await usdt.connect(bob).approve(await presage.getAddress(), parseUnits("10", 18));
    await expect(
      presage.connect(bob).fillDeleverage(await alice.getAddress(), MARKET_ID)
    ).to.be.revertedWith("already filled");
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  REQUEST OVERWRITE ON FILLED REQUEST (RESETS FILLED FLAG)
  // ══════════════════════════════════════════════════════════════════════════

  it("should allow overwriting a filled leverage request with a new one", async function () {
    const aliceAddr = await alice.getAddress();
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    // First request and fill
    await presage.connect(alice).requestLeverage(
      MARKET_ID, parseEther("10"), parseEther("30"), parseUnits("10", 18), deadline
    );
    await presage.connect(bob).fillLeverage(aliceAddr, MARKET_ID);

    const reqFilled = await presage.leverageRequests(aliceAddr, MARKET_ID);
    expect(reqFilled.filled).to.equal(true);

    // Overwrite with new request — should reset filled flag
    await presage.connect(alice).requestLeverage(
      MARKET_ID, parseEther("5"), parseEther("15"), parseUnits("8", 18), deadline
    );

    const reqNew = await presage.leverageRequests(aliceAddr, MARKET_ID);
    expect(reqNew.filled).to.equal(false);
    expect(reqNew.marginAmount).to.equal(parseEther("5"));

    // Should be fillable again
    await presage.connect(bob).fillLeverage(aliceAddr, MARKET_ID);
    const reqFinal = await presage.leverageRequests(aliceAddr, MARKET_ID);
    expect(reqFinal.filled).to.equal(true);

    console.log("    Filled → overwritten → filled again: works correctly");
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  LEVERAGE WITHOUT FEE (NO TREASURY SET)
  // ══════════════════════════════════════════════════════════════════════════

  it("should send full borrow amount to solver when no treasury is set", async function () {
    // Deploy a fresh Presage with no treasury
    const Presage2 = await ethers.getContractFactory("Presage");
    const presage2 = await Presage2.deploy(MORPHO, await factory.getAddress(), await priceHub.getAddress(), IRM);

    // Create market (reuse position 40)
    const POSITION_ID_4 = 40n;
    const ctfPos = {
      ctf: await mockCTF.getAddress(),
      parentCollectionId: ethers.ZeroHash,
      conditionId: ethers.ZeroHash,
      positionId: POSITION_ID_4,
      oppositePositionId: 41n,
    };
    const resolutionAt = Math.floor(Date.now() / 1000) + 86400 * 365;
    await presage2.openMarket(ctfPos, USDT, parseEther("0.625"), resolutionAt, 86400 * 7, 86400);
    await priceHub.seedPrice(POSITION_ID_4, parseEther("1"));

    // Supply liquidity
    await usdt.connect(bob).approve(await presage2.getAddress(), parseUnits("1000", 18));
    await presage2.connect(bob).supply(1, parseUnits("1000", 18));

    // Authorize
    await morpho.connect(alice).setAuthorization(await presage2.getAddress(), true);
    await morpho.connect(bob).setAuthorization(await presage2.getAddress(), true);

    // Mint CTF
    await mockCTF.mint(await alice.getAddress(), POSITION_ID_4, parseEther("200"));
    await mockCTF.mint(await bob.getAddress(), POSITION_ID_4, parseEther("500"));

    // Approve
    await mockCTF.connect(alice).setApprovalForAll(await presage2.getAddress(), true);
    await mockCTF.connect(bob).setApprovalForAll(await presage2.getAddress(), true);

    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    // Set origination fee on market (but no treasury)
    await presage2.setDefaultOriginationFee(200);
    await presage2.setMarketFees(1, 200, 0);

    await presage2.connect(alice).requestLeverage(
      1, parseEther("50"), parseEther("150"), parseUnits("50", 18), deadline
    );

    const bobUsdtBefore = await usdt.balanceOf(await bob.getAddress());
    await presage2.connect(bob).fillLeverage(await alice.getAddress(), 1);
    const bobUsdtAfter = await usdt.balanceOf(await bob.getAddress());

    // Full 50 USDT to solver (no fee deducted since no treasury)
    expect(bobUsdtAfter - bobUsdtBefore).to.equal(parseUnits("50", 18));

    console.log("    No treasury → solver received full borrow amount (no fee deducted)");
  });
});
