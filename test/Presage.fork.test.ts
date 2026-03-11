import { expect } from "chai";
import { ethers } from "hardhat";
import { parseUnits, parseEther, formatEther, formatUnits, Contract } from "ethers";

/**
 * Fork Test — BNB Mainnet
 * 
 * Verifies Presage against the actual Morpho Blue and IRM deployments
 * on a local fork of BNB Mainnet.
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

  const POSITION_ID = 1n;

  before(async function () {
    [owner, alice] = await ethers.getSigners();

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

  it("should create a market and accept a deposit", async function () {
    const aliceAddr = await alice.getAddress();
    
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
    
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const encoded = abiCoder.encode(
        ["address", "address", "address", "address", "uint256"],
        [mp.loanToken, mp.collateralToken, mp.oracle, mp.irm, mp.lltv]
    );
    const id = ethers.keccak256(encoded);

    const morpho = await ethers.getContractAt("IMorpho", MORPHO);
    const aliceAddr = await alice.getAddress();
    const position = await morpho.position(id, aliceAddr);
    
    expect(position.supplyShares).to.be.gt(0n);
  });

  it("should allow borrowing against collateral", async function () {
    const marketId = 1n;
    const borrowAmount = parseUnits("20", 18); // 20 USDT against 100 CTF ($100 value)
    
    // 1. Seed Price (Owner can call seedPrice directly)
    const currentPrice = parseUnits("1", 18); // $1.00
    await priceHub.seedPrice(POSITION_ID, currentPrice);

    // 2. Authorize Presage on Morpho
    const morpho = await ethers.getContractAt("IMorpho", MORPHO);
    await morpho.connect(alice).setAuthorization(await presage.getAddress(), true);

    // 3. Borrow
    const usdt = await ethers.getContractAt("IERC20", USDT);
    const balanceBefore = await usdt.balanceOf(await alice.getAddress());
    
    await presage.connect(alice).borrow(marketId, borrowAmount);
    
    const balanceAfter = await usdt.balanceOf(await alice.getAddress());
    expect(balanceAfter - balanceBefore).to.equal(borrowAmount);
    console.log(`    Alice borrowed: ${formatUnits(borrowAmount, 18)} USDT`);
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
  //  INTEREST ACCRUAL
  // ══════════════════════════════════════════════════════════════════════════════

  it("should accrue interest over time", async function () {
    const marketId = 1n;
    const market = await presage.getMarket(marketId);
    const mp = market.morphoParams;
    const mid = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "address", "uint256"],
        [mp.loanToken, mp.collateralToken, mp.oracle, mp.irm, mp.lltv]
      )
    );

    const morpho = await ethers.getContractAt("IMorpho", MORPHO);
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
    // A no-op supply of 0 won't work, so we do a tiny supply to trigger accrueInterest
    const usdt = await ethers.getContractAt("IERC20", USDT);
    await usdt.connect(alice).approve(await presage.getAddress(), 1n);
    await presage.connect(alice).supply(marketId, 1n);

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
  //  LIQUIDATION (settleWithLoanToken)
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

  it("should allow settleWithLoanToken (liquidation)", async function () {
    const marketId = 1n;
    const aliceAddr = await alice.getAddress();

    const morpho = await ethers.getContractAt("IMorpho", MORPHO);
    const market = await presage.getMarket(marketId);
    const mp = market.morphoParams;
    const mid = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "address", "uint256"],
        [mp.loanToken, mp.collateralToken, mp.oracle, mp.irm, mp.lltv]
      )
    );

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

    await presage.connect(owner).settleWithLoanToken(marketId, aliceAddr, repayAmount);

    const ctfBalAfter = await mockCTF.balanceOf(ownerAddr, POSITION_ID);
    const seized = ctfBalAfter - ctfBalBefore;

    console.log(`    Repaid           : ${formatEther(repayAmount)} USDT`);
    console.log(`    CTF seized       : ${formatEther(seized)}`);
    expect(seized).to.be.gt(0n);

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
});
