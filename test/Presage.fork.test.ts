import { expect } from "chai";
import { ethers } from "hardhat";
import { parseUnits, parseEther, formatEther, Contract } from "ethers";

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

    const resolutionAt = Math.floor(Date.now() / 1000) + 86400 * 30;
    await presage.openMarket(ctfPos, USDT, parseEther("0.77"), resolutionAt, 86400, 3600);
    
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
    
    // 2. Calculate Market Id (using same logic as contract)
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const encoded = abiCoder.encode(
        ["address", "address", "address", "address", "uint256"],
        [mp.loanToken, mp.collateralToken, mp.oracle, mp.irm, mp.lltv]
    );
    const id = ethers.keccak256(encoded);

    // 3. Check Morpho position
    const morpho = await ethers.getContractAt("IMorpho", MORPHO);
    const aliceAddr = await alice.getAddress();
    const position = await morpho.position(id, aliceAddr);
    
    // Morpho uses virtual shares/assets, but supplyShares should be > 0
    expect(position.supplyShares).to.be.gt(0n);
    console.log(`    Alice supplyShares: ${position.supplyShares}`);
  });
});
