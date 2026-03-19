import { expect } from "chai";
import { ethers } from "hardhat";
import { parseUnits, parseEther, formatEther, formatUnits } from "ethers";

/**
 * Safe Fork Test — BNB Mainnet
 * 
 * Verifies that a Gnosis Safe can use SafeBatchHelper to perform
 * an atomic "Approve + Authorize + Deposit + Borrow" flow in ONE transaction.
 */

describe("Presage Safe Batch Fork Test", function () {
  const MORPHO = "0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a";
  const IRM = "0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979";
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const MULTI_SEND = "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761"; // Standard Gnosis MultiSend

  let presage: any;
  let factory: any;
  let priceHub: any;
  let batchHelper: any;
  let mockCTF: any;
  let mockSafe: any;
  let owner: any;

  const POSITION_ID = 99n;

  before(async function () {
    [owner] = await ethers.getSigners();

    // 1. Deploy Core
    const WrapperFactory = await ethers.getContractFactory("WrapperFactory");
    factory = await WrapperFactory.deploy();
    
    const PriceHub = await ethers.getContractFactory("PriceHub");
    priceHub = await PriceHub.deploy(3600);

    batchHelper = await (await ethers.getContractFactory("SafeBatchHelper")).deploy(
        await (await ethers.getContractFactory("Presage")).deploy(MORPHO, await factory.getAddress(), await priceHub.getAddress(), IRM),
        MORPHO
    );
    presage = await ethers.getContractAt("Presage", await batchHelper.presage());

    // 2. Deploy Mock CTF
    const MockCTF = await ethers.getContractFactory("MockCTF");
    mockCTF = await MockCTF.deploy();

    // 3. Setup Price & Market
    await priceHub.seedPrice(POSITION_ID, parseUnits("1", 18));
    
    const ctfPos = {
        ctf: await mockCTF.getAddress(),
        parentCollectionId: ethers.ZeroHash,
        conditionId: ethers.ZeroHash,
        positionId: POSITION_ID,
        oppositePositionId: 100n
    };
    await presage.openMarket(ctfPos, USDT, parseUnits("0.77", 18), Math.floor(Date.now() / 1000) + 86400, 86400, 3600);

    // 4. Deploy Mock Safe
    const MockSafe = await ethers.getContractFactory("MockSafe");
    mockSafe = await MockSafe.deploy();

    // 5. Give Mock Safe some CTF tokens
    console.log(`    Seeding Safe with 100 CTF (Pos: ${POSITION_ID})...`);
    await mockCTF.mint(await mockSafe.getAddress(), POSITION_ID, parseEther("100"));

    // 6. Seed Market Liquidity (Need USDT in the market so Safe can borrow)
    const WHALE = "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3";
    await ethers.provider.send("hardhat_impersonateAccount", [WHALE]);
    const whaleSigner = await ethers.getSigner(WHALE);
    const usdt = await ethers.getContractAt("IERC20", USDT);
    await owner.sendTransaction({ to: WHALE, value: parseEther("1") }); // gas
    await usdt.connect(whaleSigner).approve(await presage.getAddress(), parseUnits("1000", 18));
    await presage.connect(whaleSigner).supply(1n, parseUnits("1000", 18));
    console.log("    ✓ Market seeded with 1000 USDT liquidity");
  });

  it("should execute an atomic batch (Approve + Authorize + Deposit + Borrow)", async function () {
    const safeAddr = await mockSafe.getAddress();
    const marketId = 1n;
    const collateralAmount = parseEther("100");
    const borrowAmount = parseUnits("50", 18);

    // 1. Generate the multiSend payload via SafeBatchHelper
    const payload = await batchHelper.encodeBorrow(
        marketId,
        await mockCTF.getAddress(),
        collateralAmount,
        borrowAmount
    );

    // 2. Execute the batch via MultiSend (from the Safe's context)
    const usdt = await ethers.getContractAt("IERC20", USDT);
    const balanceBefore = await usdt.balanceOf(safeAddr);

    console.log("    Executing atomic Safe batch...");
    await mockSafe.executeBatch(MULTI_SEND, payload);

    // 3. VERIFICATIONS
    
    // Check USDT Balance (Borrowing worked)
    const balanceAfter = await usdt.balanceOf(safeAddr);
    expect(balanceAfter - balanceBefore).to.equal(borrowAmount);
    console.log(`    ✓ Safe received ${formatUnits(borrowAmount, 18)} USDT borrow`);

    // Check Collateral on Morpho
    const market = await presage.getMarket(marketId);
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const mid = ethers.keccak256(abiCoder.encode(
        ["address", "address", "address", "address", "uint256"],
        [market.morphoParams.loanToken, market.morphoParams.collateralToken, market.morphoParams.oracle, market.morphoParams.irm, market.morphoParams.lltv]
    ));
    const morpho = await ethers.getContractAt("contracts/vendor/morpho/IMorpho.sol:IMorpho", MORPHO);
    const position = await morpho.position(mid, safeAddr);
    
    expect(position.collateral).to.equal(collateralAmount);
    console.log(`    ✓ Safe has ${formatEther(collateralAmount)} collateral in Morpho`);

    // Check Authorization (Authorization worked)
    expect(await morpho.isAuthorized(safeAddr, await presage.getAddress())).to.be.true;
    console.log("    ✓ Router is authorized on Morpho for this Safe");
  });
});
