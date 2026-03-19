import { expect } from "chai";
import { ethers } from "hardhat";
import { parseUnits, parseEther, formatEther, formatUnits, Contract } from "ethers";

/**
 * Vault Fork Test — BNB Mainnet
 *
 * Verifies MetaMorpho ERC-4626 vault integration with Presage on a local fork
 * of BNB Mainnet. Tests full vault lifecycle: deployment, cap governance,
 * LP deposits, allocator reallocation, borrowing through Presage, withdrawals,
 * interest accrual, fee distribution, market rotation, and removal.
 *
 * Test flow (sequential, shared state):
 *   1.  Vault deploys with correct config
 *   2.  Curator submits + accepts caps for 3 markets
 *   3.  Allocator sets supply and withdraw queues
 *   4.  LP deposits USDT via ERC-4626 deposit()
 *   5.  Allocator reallocates across markets
 *   6.  Borrower borrows vault-supplied USDT via Presage
 *   7.  LP withdraws via ERC-4626 redeem()
 *   8.  Supply cap enforcement
 *   9.  Interest accrual increases share price
 *  10.  Performance fee accrues to fee recipient
 *  11.  Allocator pulls from expiring market
 *  12.  Cap decrease + market removal
 */

describe("Presage Vault Fork Test (BNB Mainnet)", function () {
  // Addresses (BNB Chain)
  const MORPHO = ethers.getAddress("0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a");
  const IRM = ethers.getAddress("0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979");
  const USDT = ethers.getAddress("0x55d398326f99059fF775485246999027B3197955");
  const WHALE = ethers.getAddress("0x8894E0a0c962CB723c1976a4421c95949bE2D4E3");

  let presage: any;
  let wrapperFactory: any;
  let priceHub: any;
  let mockCTF: any;
  let vault: any;
  let vaultFactory: any;

  let owner: any;
  let curator: any;
  let allocator: any;
  let alice: any; // LP
  let bob: any;   // Borrower
  let treasury: any;

  const POSITION_IDS = [10n, 20n, 30n];
  const MARKET_IDS = [1n, 2n, 3n];
  const TIMELOCK = 86400; // 1 day
  const VAULT_CAP = parseEther("10000"); // 10k USDT per market
  const DEPOSIT_AMOUNT = parseEther("3000"); // 3k USDT

  // Morpho market IDs (computed from MarketParams)
  const morphoMarketIds: string[] = [];

  // Helper: compute Morpho market ID from MarketParams tuple
  function morphoMarketId(mp: any): string {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "address", "uint256"],
        [mp.loanToken, mp.collateralToken, mp.oracle, mp.irm, mp.lltv]
      )
    );
  }

  // Helper: get Morpho supply position for the vault in a given market
  async function getVaultSupply(morphoMid: string, vaultAddress: string): Promise<bigint> {
    const morpho = await ethers.getContractAt("contracts/vendor/morpho/IMorpho.sol:IMorpho", MORPHO);
    const mkt = await morpho.market(morphoMid);
    const pos = await morpho.position(morphoMid, vaultAddress);
    if (BigInt(mkt.totalSupplyShares) === 0n) return 0n;
    return (BigInt(pos.supplyShares) * BigInt(mkt.totalSupplyAssets)) / BigInt(mkt.totalSupplyShares);
  }

  // Helper: build MarketParams struct from Presage market data
  function toMarketParams(mp: any) {
    return {
      loanToken: mp.loanToken,
      collateralToken: mp.collateralToken,
      oracle: mp.oracle,
      irm: mp.irm,
      lltv: mp.lltv
    };
  }

  before(async function () {
    [owner, curator, allocator, alice, bob, treasury] = await ethers.getSigners();

    // 1. Deploy Presage infrastructure
    const WrapperFactory = await ethers.getContractFactory("WrapperFactory");
    wrapperFactory = await WrapperFactory.deploy();

    const PriceHub = await ethers.getContractFactory("PriceHub");
    priceHub = await PriceHub.deploy(3600);

    const FixedPriceAdapter = await ethers.getContractFactory("FixedPriceAdapter");
    const adapter = await FixedPriceAdapter.deploy();
    await priceHub.setDefaultAdapter(await adapter.getAddress());

    const Presage = await ethers.getContractFactory("Presage");
    presage = await Presage.deploy(MORPHO, await wrapperFactory.getAddress(), await priceHub.getAddress(), IRM);

    const MockCTF = await ethers.getContractFactory("MockCTF");
    mockCTF = await MockCTF.deploy();

    // 2. Deploy MetaMorpho vault
    const MetaMorphoFactory = await ethers.getContractFactory("MetaMorphoFactory");
    vaultFactory = await MetaMorphoFactory.deploy(MORPHO);

    const salt = ethers.keccak256(ethers.toUtf8Bytes("presage-usdt-vault-v1"));
    const tx = await vaultFactory.createMetaMorpho(
      await owner.getAddress(),
      TIMELOCK,
      USDT,
      "Presage USDT Vault",
      "pUSDT",
      salt
    );
    const receipt = await tx.wait();

    // Find vault address from CreateMetaMorpho event
    const iface = vaultFactory.interface;
    const createEvent = receipt.logs
      .map((log: any) => { try { return iface.parseLog(log); } catch { return null; } })
      .find((e: any) => e && e.name === "CreateMetaMorpho");
    const vaultAddress = createEvent!.args[0];
    vault = await ethers.getContractAt("MetaMorpho", vaultAddress);

    // 3. Set roles
    await vault.setCurator(await curator.getAddress());
    await vault.setIsAllocator(await allocator.getAddress(), true);

    // 4. Set fee: 10% performance fee
    await vault.setFeeRecipient(await treasury.getAddress());
    await vault.setFee(parseEther("0.1")); // 10%

    // 5. Create 3 Presage markets with different positions and resolution times
    const now = Math.floor(Date.now() / 1000);
    const resolutions = [
      now + 86400 * 365,    // Market 1: 1 year
      now + 86400 * 180,    // Market 2: 6 months
      now + 86400 * 30,     // Market 3: 30 days (short — for pullback test)
    ];

    for (let i = 0; i < 3; i++) {
      const posId = POSITION_IDS[i];
      const ctfPos = {
        ctf: await mockCTF.getAddress(),
        parentCollectionId: ethers.ZeroHash,
        conditionId: ethers.ZeroHash,
        positionId: posId,
        oppositePositionId: posId + 1n,
      };
      await presage.openMarket(ctfPos, USDT, parseEther("0.77"), resolutions[i], 86400 * 7, 3600);

      // Seed prices at $1
      await priceHub.seedPrice(posId, parseEther("1"));

      // Store morpho market IDs
      const market = await presage.getMarket(MARKET_IDS[i]);
      morphoMarketIds.push(morphoMarketId(market.morphoParams));
    }

    // 6. Fund actors with USDT via whale impersonation
    await ethers.provider.send("hardhat_impersonateAccount", [WHALE]);
    const whaleSigner = await ethers.getSigner(WHALE);
    const usdt = await ethers.getContractAt("IERC20", USDT);

    await owner.sendTransaction({ to: WHALE, value: parseEther("1") });
    await usdt.connect(whaleSigner).transfer(await alice.getAddress(), parseEther("10000"));
    await usdt.connect(whaleSigner).transfer(await bob.getAddress(), parseEther("1000"));

    // 7. Mint CTF tokens for Bob (borrower)
    for (const posId of POSITION_IDS) {
      await mockCTF.mint(await bob.getAddress(), posId, parseEther("500"));
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  1. VAULT DEPLOYMENT VERIFICATION
  // ══════════════════════════════════════════════════════════════════════════════

  it("1. Vault deploys with correct config", async function () {
    expect(await vault.name()).to.equal("Presage USDT Vault");
    expect(await vault.symbol()).to.equal("pUSDT");
    expect(await vault.asset()).to.equal(USDT);
    expect(await vault.MORPHO()).to.equal(MORPHO);
    expect(await vault.timelock()).to.equal(TIMELOCK);
    expect(await vault.curator()).to.equal(await curator.getAddress());
    expect(await vault.isAllocator(await allocator.getAddress())).to.be.true;
    expect(await vault.feeRecipient()).to.equal(await treasury.getAddress());
    expect(await vault.fee()).to.equal(parseEther("0.1"));
    expect(await vault.owner()).to.equal(await owner.getAddress());

    console.log(`    Vault address: ${await vault.getAddress()}`);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  2. CAP GOVERNANCE
  // ══════════════════════════════════════════════════════════════════════════════

  it("2. Curator submits + accepts caps for 3 markets", async function () {
    for (let i = 0; i < 3; i++) {
      const market = await presage.getMarket(MARKET_IDS[i]);
      const mp = toMarketParams(market.morphoParams);

      // Curator submits cap
      await vault.connect(curator).submitCap(mp, VAULT_CAP);

      // Fast-forward past timelock
      await ethers.provider.send("evm_increaseTime", [TIMELOCK + 1]);
      await ethers.provider.send("evm_mine", []);

      // Accept cap
      await vault.acceptCap(mp);

      // Verify config
      const mid = morphoMarketIds[i];
      const cfg = await vault.config(mid);
      expect(cfg.cap).to.equal(VAULT_CAP);
      expect(cfg.enabled).to.be.true;

      console.log(`    Market ${i + 1} cap set: ${formatEther(VAULT_CAP)} USDT`);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  3. QUEUE SETUP
  // ══════════════════════════════════════════════════════════════════════════════

  it("3. Allocator sets supply and withdraw queues", async function () {
    // Set supply queue = all 3 markets
    await vault.connect(allocator).setSupplyQueue(morphoMarketIds);

    // Verify supply queue
    expect(await vault.supplyQueueLength()).to.equal(3);
    for (let i = 0; i < 3; i++) {
      expect(await vault.supplyQueue(i)).to.equal(morphoMarketIds[i]);
    }

    // Withdraw queue is auto-populated when caps are set, verify all 3 are there
    expect(await vault.withdrawQueueLength()).to.equal(3);

    console.log(`    Supply queue: ${3} markets`);
    console.log(`    Withdraw queue: ${await vault.withdrawQueueLength()} markets`);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  4. LP DEPOSIT
  // ══════════════════════════════════════════════════════════════════════════════

  it("4. LP deposits USDT via ERC-4626 deposit()", async function () {
    const usdt = await ethers.getContractAt("IERC20", USDT);
    const vaultAddr = await vault.getAddress();
    const aliceAddr = await alice.getAddress();

    await usdt.connect(alice).approve(vaultAddr, DEPOSIT_AMOUNT);

    const sharesBefore = await vault.balanceOf(aliceAddr);
    await vault.connect(alice).deposit(DEPOSIT_AMOUNT, aliceAddr);
    const sharesAfter = await vault.balanceOf(aliceAddr);

    const sharesReceived = sharesAfter - sharesBefore;
    expect(sharesReceived).to.be.gt(0n);

    // Verify vault total assets increased
    const totalAssets = await vault.totalAssets();
    expect(totalAssets).to.be.gte(DEPOSIT_AMOUNT - 1n); // Allow 1 wei rounding

    // Verify USDT was supplied to Morpho through the first market in supply queue
    const supply1 = await getVaultSupply(morphoMarketIds[0], vaultAddr);
    expect(supply1).to.be.gt(0n);

    console.log(`    Alice deposited: ${formatEther(DEPOSIT_AMOUNT)} USDT`);
    console.log(`    Shares received: ${formatEther(sharesReceived)} pUSDT`);
    console.log(`    Total vault assets: ${formatEther(totalAssets)} USDT`);
    console.log(`    Market 1 supply: ${formatEther(supply1)} USDT`);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  5. REALLOCATION
  // ══════════════════════════════════════════════════════════════════════════════

  it("5. Allocator reallocates across markets", async function () {
    const vaultAddr = await vault.getAddress();
    const target = DEPOSIT_AMOUNT / 3n; // ~1000 each

    // Build reallocation:
    // 1. Withdraw from market 1 (set to target)
    // 2. Supply to market 2 (set to target)
    // 3. Supply to market 3 (sweep remainder)
    const markets = [];
    for (let i = 0; i < 3; i++) {
      const market = await presage.getMarket(MARKET_IDS[i]);
      markets.push(toMarketParams(market.morphoParams));
    }

    const allocations = [
      { marketParams: markets[0], assets: target },               // Withdraw excess from market 1
      { marketParams: markets[1], assets: target },               // Supply to market 2
      { marketParams: markets[2], assets: ethers.MaxUint256 },    // Sweep remainder to market 3
    ];

    await vault.connect(allocator).reallocate(allocations);

    // Verify allocations
    for (let i = 0; i < 3; i++) {
      const supply = await getVaultSupply(morphoMarketIds[i], vaultAddr);
      expect(supply).to.be.gt(0n);
      console.log(`    Market ${i + 1} supply: ${formatEther(supply)} USDT`);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  6. BORROWER BORROWS VAULT-SUPPLIED USDT VIA PRESAGE
  // ══════════════════════════════════════════════════════════════════════════════

  it("6. Borrower borrows vault-supplied USDT via Presage", async function () {
    const marketId = MARKET_IDS[0];
    const bobAddr = await bob.getAddress();
    const usdt = await ethers.getContractAt("IERC20", USDT);

    // Re-seed prices (time advanced during cap timelocks)
    for (const posId of POSITION_IDS) {
      await priceHub.seedPrice(posId, parseEther("1"));
    }

    // Deposit collateral
    await mockCTF.connect(bob).setApprovalForAll(await presage.getAddress(), true);
    await presage.connect(bob).depositCollateral(marketId, parseEther("100"));

    // Authorize Presage on Morpho
    const morpho = await ethers.getContractAt("contracts/vendor/morpho/IMorpho.sol:IMorpho", MORPHO);
    await morpho.connect(bob).setAuthorization(await presage.getAddress(), true);

    // Borrow 50 USDT
    const borrowAmount = parseEther("50");
    const balBefore = await usdt.balanceOf(bobAddr);
    await presage.connect(bob).borrow(marketId, borrowAmount);
    const balAfter = await usdt.balanceOf(bobAddr);

    expect(balAfter - balBefore).to.equal(borrowAmount);

    // Verify vault's supply in that market decreased (utilization increased)
    const market = await presage.getMarket(marketId);
    const mid = morphoMarketId(market.morphoParams);
    const morphoMkt = await morpho.market(mid);
    expect(BigInt(morphoMkt.totalBorrowAssets)).to.be.gt(0n);

    console.log(`    Bob borrowed: ${formatEther(borrowAmount)} USDT from vault-supplied market`);
    console.log(`    Market total borrows: ${formatEther(BigInt(morphoMkt.totalBorrowAssets))} USDT`);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  7. LP WITHDRAWAL
  // ══════════════════════════════════════════════════════════════════════════════

  it("7. LP withdraws via ERC-4626 redeem()", async function () {
    const usdt = await ethers.getContractAt("IERC20", USDT);
    const aliceAddr = await alice.getAddress();

    // Redeem 25% of shares
    const totalShares = await vault.balanceOf(aliceAddr);
    const redeemShares = totalShares / 4n;

    const balBefore = await usdt.balanceOf(aliceAddr);
    await vault.connect(alice).redeem(redeemShares, aliceAddr, aliceAddr);
    const balAfter = await usdt.balanceOf(aliceAddr);

    const received = balAfter - balBefore;
    expect(received).to.be.gt(0n);

    const remainingShares = await vault.balanceOf(aliceAddr);
    expect(remainingShares).to.be.lt(totalShares);

    console.log(`    Alice redeemed: ${formatEther(redeemShares)} pUSDT shares`);
    console.log(`    USDT received: ${formatEther(received)}`);
    console.log(`    Remaining shares: ${formatEther(remainingShares)} pUSDT`);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  8. SUPPLY CAP ENFORCEMENT
  // ══════════════════════════════════════════════════════════════════════════════

  it("8. Supply cap enforcement on reallocate", async function () {
    const vaultAddr = await vault.getAddress();

    // Try to reallocate more than the cap to market 1
    const market1 = await presage.getMarket(MARKET_IDS[0]);
    const mp1 = toMarketParams(market1.morphoParams);
    const market2 = await presage.getMarket(MARKET_IDS[1]);
    const mp2 = toMarketParams(market2.morphoParams);

    // Get current supply in market 2
    const supply2 = await getVaultSupply(morphoMarketIds[1], vaultAddr);
    if (supply2 === 0n) {
      console.log("    Market 2 has no supply — skipping cap test");
      this.skip();
      return;
    }

    // Attempt: withdraw from market 2 and put everything into market 1 (exceeding cap)
    const overCapAmount = VAULT_CAP + parseEther("1");
    const allocations = [
      { marketParams: mp2, assets: 0n },           // Withdraw all from market 2
      { marketParams: mp1, assets: overCapAmount }, // Try to supply over cap
    ];

    await expect(
      vault.connect(allocator).reallocate(allocations)
    ).to.be.reverted; // SupplyCapExceeded

    console.log(`    Reallocate over cap correctly reverted`);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  9. INTEREST ACCRUAL
  // ══════════════════════════════════════════════════════════════════════════════

  it("9. Interest accrual increases share price", async function () {
    const totalAssetsBefore = await vault.totalAssets();

    // Fast-forward 30 days
    await ethers.provider.send("evm_increaseTime", [86400 * 30]);
    await ethers.provider.send("evm_mine", []);

    // Accrue interest on the market with borrows
    await presage.triggerAccrual(MARKET_IDS[0]);

    const totalAssetsAfter = await vault.totalAssets();
    expect(totalAssetsAfter).to.be.gt(totalAssetsBefore);

    // Check that redeeming shares now gives more USDT
    const aliceAddr = await alice.getAddress();
    const shares = await vault.balanceOf(aliceAddr);
    const maxWithdraw = await vault.maxWithdraw(aliceAddr);

    console.log(`    Total assets before: ${formatEther(totalAssetsBefore)}`);
    console.log(`    Total assets after:  ${formatEther(totalAssetsAfter)}`);
    console.log(`    Interest earned: ${formatEther(totalAssetsAfter - totalAssetsBefore)} USDT`);
    console.log(`    Alice max withdraw: ${formatEther(maxWithdraw)} USDT`);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  10. PERFORMANCE FEE
  // ══════════════════════════════════════════════════════════════════════════════

  it("10. Performance fee accrues to fee recipient", async function () {
    const treasuryAddr = await treasury.getAddress();
    const aliceAddr = await alice.getAddress();

    // Trigger fee accrual by doing a small deposit
    const usdt = await ethers.getContractAt("IERC20", USDT);
    const smallAmount = parseEther("1");
    await usdt.connect(alice).approve(await vault.getAddress(), smallAmount);
    await vault.connect(alice).deposit(smallAmount, aliceAddr);

    // Treasury should have received fee shares
    const feeShares = await vault.balanceOf(treasuryAddr);
    expect(feeShares).to.be.gt(0n);

    // Estimate fee value
    const feeValue = await vault.convertToAssets(feeShares);

    console.log(`    Fee shares (treasury): ${formatEther(feeShares)} pUSDT`);
    console.log(`    Fee value: ${formatEther(feeValue)} USDT`);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  11. PULL FROM EXPIRING MARKET
  // ══════════════════════════════════════════════════════════════════════════════

  it("11. Allocator pulls from expiring market", async function () {
    const vaultAddr = await vault.getAddress();

    // Re-seed prices (they may be stale after time warps)
    for (const posId of POSITION_IDS) {
      await priceHub.seedPrice(posId, parseEther("1"));
    }

    // Get current allocations
    const supply3Before = await getVaultSupply(morphoMarketIds[2], vaultAddr);
    if (supply3Before === 0n) {
      console.log("    Market 3 has no supply — skipping");
      this.skip();
      return;
    }

    // Reallocate: pull everything from market 3, push to market 1
    const markets = [];
    for (let i = 0; i < 3; i++) {
      const market = await presage.getMarket(MARKET_IDS[i]);
      markets.push(toMarketParams(market.morphoParams));
    }

    const allocations = [
      { marketParams: markets[2], assets: 0n },                 // Withdraw all from market 3
      { marketParams: markets[0], assets: ethers.MaxUint256 },  // Sweep to market 1
    ];

    await vault.connect(allocator).reallocate(allocations);

    const supply3After = await getVaultSupply(morphoMarketIds[2], vaultAddr);
    expect(supply3After).to.equal(0n);

    console.log(`    Market 3 supply before: ${formatEther(supply3Before)} USDT`);
    console.log(`    Market 3 supply after: ${formatEther(supply3After)} USDT (pulled)`);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  12. CAP DECREASE + MARKET REMOVAL
  // ══════════════════════════════════════════════════════════════════════════════

  it("12. Cap decrease + market removal", async function () {
    // Decrease cap of market 3 to 0 (instant, no timelock needed for decrease)
    const market3 = await presage.getMarket(MARKET_IDS[2]);
    const mp3 = toMarketParams(market3.morphoParams);
    const mid3 = morphoMarketIds[2];

    await vault.connect(curator).submitCap(mp3, 0n);

    // Verify cap is now 0
    const cfg = await vault.config(mid3);
    expect(cfg.cap).to.equal(0n);

    // Market 3 should still be in withdraw queue but with 0 cap
    // Since supply is already 0 (pulled in test 11), we can remove from queue
    // The withdraw queue has 3 entries: [market1, market2, market3]
    // Remove market3 by passing indexes [0, 1] (keeping only first two)
    const wqLen = await vault.withdrawQueueLength();

    // Find index of market 3 in withdraw queue
    let market3Index = -1;
    const reorderIndexes: number[] = [];
    for (let i = 0; i < Number(wqLen); i++) {
      const queueId = await vault.withdrawQueue(i);
      if (queueId === mid3) {
        market3Index = i;
      } else {
        reorderIndexes.push(i);
      }
    }

    expect(market3Index).to.be.gte(0);

    await vault.connect(allocator).updateWithdrawQueue(reorderIndexes);

    // Verify market 3 config is deleted
    const cfgAfter = await vault.config(mid3);
    expect(cfgAfter.enabled).to.be.false;

    // Verify withdraw queue is now 2 markets
    expect(await vault.withdrawQueueLength()).to.equal(Number(wqLen) - 1);

    console.log(`    Market 3 cap set to 0 and removed from withdraw queue`);
    console.log(`    Withdraw queue length: ${await vault.withdrawQueueLength()}`);
  });
});
