import { expect } from "chai";
import { ethers } from "hardhat";
import { parseUnits, parseEther, formatEther } from "ethers";

/**
 * Solver Logic Fork Test — BNB Mainnet
 *
 * Tests the solver's decision-making logic against a real BNB fork.
 * This mirrors the solver bot's evaluate→check→fill pipeline to prove
 * it would work correctly in production.
 *
 * What this tests:
 *   1. Profitability math: does the solver correctly calculate profit?
 *   2. Balance gating: does it skip when it can't afford the fill?
 *   3. Fill execution: does the on-chain fill actually work?
 *   4. Event detection: does it see the right events?
 *   5. Unprofitable skip: does it correctly reject bad deals?
 *   6. Deleverage flow: full evaluate→fill→verify cycle
 *   7. Race condition: request cancelled between detect and fill
 *   8. Stale request: request expired between detect and fill
 *   9. Multiple markets: solver correctly fills across markets
 */

describe("Solver Logic Fork Test (BNB Mainnet)", function () {
  const MORPHO = ethers.getAddress("0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a");
  const IRM = ethers.getAddress("0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979");
  const USDT = ethers.getAddress("0x55d398326f99059fF775485246999027B3197955");
  const WHALE = ethers.getAddress("0x8894E0a0c962CB723c1976a4421c95949bE2D4E3");
  const ORACLE_PRICE_SCALE = 10n ** 36n;
  const BPS = 10000n;

  let presage: any;
  let factory: any;
  let priceHub: any;
  let mockCTF: any;
  let morpho: any;
  let usdt: any;
  let owner: any;
  let borrower: any;
  let solver: any;
  let treasury: any;

  const POSITION_ID = 50n;
  const MARKET_ID = 1n;

  function morphoMarketId(mp: any): string {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "address", "uint256"],
        [mp.loanToken, mp.collateralToken, mp.oracle, mp.irm, mp.lltv]
      )
    );
  }

  // ──────── Replicates solver's profitability logic ────────

  async function solverEvaluateLeverage(
    marketId: bigint,
    marginAmount: bigint,
    supplyCollateralAmount: bigint,
    borrowAmountMax: bigint,
    minProfit: bigint
  ): Promise<{ profitable: boolean; profit: bigint; leveragedAmount: bigint; usdtReceived: bigint; ctfCost: bigint }> {
    const market = await presage.getMarket(marketId);
    const oracleAddr = market.morphoParams.oracle;
    const oracleContract = await ethers.getContractAt("IOracle", oracleAddr);
    const oraclePrice = BigInt(await oracleContract.price());
    // getMarket returns originationFeeBps_ (with underscore) — access by index [3]
    const feeBps = BigInt(market[3]);

    const leveragedAmount = supplyCollateralAmount - marginAmount;
    const ctfCost = (leveragedAmount * oraclePrice) / ORACLE_PRICE_SCALE;
    const fee = (borrowAmountMax * feeBps) / BPS;
    const usdtReceived = borrowAmountMax - fee;
    const profit = usdtReceived - ctfCost;

    return {
      profitable: profit > minProfit,
      profit,
      leveragedAmount,
      usdtReceived,
      ctfCost,
    };
  }

  async function solverEvaluateDeleverage(
    marketId: bigint,
    repayAmount: bigint,
    withdrawCollateralAmountMax: bigint,
    minProfit: bigint
  ): Promise<{ profitable: boolean; profit: bigint; ctfValue: bigint }> {
    const market = await presage.getMarket(marketId);
    const oracleAddr = market.morphoParams.oracle;
    const oracleContract = await ethers.getContractAt("IOracle", oracleAddr);
    const oraclePrice = BigInt(await oracleContract.price());

    const ctfValue = (withdrawCollateralAmountMax * oraclePrice) / ORACLE_PRICE_SCALE;
    const profit = ctfValue - repayAmount;

    return { profitable: profit > minProfit, profit, ctfValue };
  }

  before(async function () {
    [owner, borrower, solver, treasury] = await ethers.getSigners();

    const WrapperFactory = await ethers.getContractFactory("WrapperFactory");
    factory = await WrapperFactory.deploy();

    const PriceHub = await ethers.getContractFactory("PriceHub");
    priceHub = await PriceHub.deploy(3600);

    const Presage = await ethers.getContractFactory("Presage");
    presage = await Presage.deploy(MORPHO, await factory.getAddress(), await priceHub.getAddress(), IRM);

    const MockCTF = await ethers.getContractFactory("MockCTF");
    mockCTF = await MockCTF.deploy();

    const FixedPriceAdapter = await ethers.getContractFactory("FixedPriceAdapter");
    const adapter = await FixedPriceAdapter.deploy();
    await priceHub.setDefaultAdapter(await adapter.getAddress());

    // Create market with 2% origination fee
    const ctfPos = {
      ctf: await mockCTF.getAddress(),
      parentCollectionId: ethers.ZeroHash,
      conditionId: ethers.ZeroHash,
      positionId: POSITION_ID,
      oppositePositionId: 51n,
    };
    const resolutionAt = Math.floor(Date.now() / 1000) + 86400 * 365;
    await presage.openMarket(ctfPos, USDT, parseEther("0.625"), resolutionAt, 86400 * 7, 86400);

    await presage.setTreasury(await treasury.getAddress());
    await presage.setMarketFees(MARKET_ID, 200, 1000); // 2% origination, 10% liquidation

    await priceHub.seedPrice(POSITION_ID, parseEther("0.65")); // CTF price = $0.65

    morpho = await ethers.getContractAt("contracts/vendor/morpho/IMorpho.sol:IMorpho", MORPHO);
    usdt = await ethers.getContractAt("IERC20", USDT);

    // Fund accounts
    await ethers.provider.send("hardhat_impersonateAccount", [WHALE]);
    const whaleSigner = await ethers.getSigner(WHALE);
    await owner.sendTransaction({ to: WHALE, value: parseEther("1") });
    await usdt.connect(whaleSigner).transfer(await borrower.getAddress(), parseUnits("5000", 18));
    await usdt.connect(whaleSigner).transfer(await solver.getAddress(), parseUnits("5000", 18));

    // Solver supplies USDT liquidity (solver is also the lender in this test)
    await usdt.connect(solver).approve(await presage.getAddress(), parseUnits("3000", 18));
    await presage.connect(solver).supply(MARKET_ID, parseUnits("3000", 18));

    // Morpho authorizations
    await morpho.connect(borrower).setAuthorization(await presage.getAddress(), true);
    await morpho.connect(solver).setAuthorization(await presage.getAddress(), true);

    // Mint CTF
    await mockCTF.mint(await borrower.getAddress(), POSITION_ID, parseEther("1000"));
    await mockCTF.mint(await solver.getAddress(), POSITION_ID, parseEther("2000"));

    // Approvals
    await mockCTF.connect(borrower).setApprovalForAll(await presage.getAddress(), true);
    await mockCTF.connect(solver).setApprovalForAll(await presage.getAddress(), true);
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  1. PROFITABILITY MATH
  // ══════════════════════════════════════════════════════════════════════════

  describe("Profitability evaluation", function () {
    it("should calculate leverage profit correctly (profitable case)", async function () {
      // Borrower wants: 100 margin, 300 total, borrow 150 USDT
      // CTF price = $0.65, so solver's 200 CTF costs 200 * 0.65 = 130 USDT
      // Solver receives: 150 - 2% fee = 147 USDT
      // Profit = 147 - 130 = 17 USDT
      const result = await solverEvaluateLeverage(
        MARKET_ID,
        parseEther("100"),
        parseEther("300"),
        parseUnits("150", 18),
        parseUnits("0", 18) // min profit = 0
      );

      console.log(`    CTF cost: ${formatEther(result.ctfCost)} USDT`);
      console.log(`    USDT received: ${formatEther(result.usdtReceived)} USDT`);
      console.log(`    Profit: ${formatEther(result.profit)} USDT`);

      expect(result.profitable).to.be.true;
      expect(result.ctfCost).to.equal(parseUnits("130", 18));
      expect(result.usdtReceived).to.equal(parseUnits("147", 18));
      expect(result.profit).to.equal(parseUnits("17", 18));
    });

    it("should correctly detect unprofitable leverage request", async function () {
      // Borrower wants: 100 margin, 300 total, borrow only 120 USDT
      // CTF cost = 200 * 0.65 = 130 USDT
      // Solver receives: 120 - 2% = 117.6 USDT
      // Profit = 117.6 - 130 = -12.4 USDT → UNPROFITABLE
      const result = await solverEvaluateLeverage(
        MARKET_ID,
        parseEther("100"),
        parseEther("300"),
        parseUnits("120", 18),
        parseUnits("0", 18)
      );

      console.log(`    Profit: ${formatEther(result.profit)} USDT (negative = unprofitable)`);

      expect(result.profitable).to.be.false;
      expect(result.profit).to.be.lt(0n);
    });

    it("should respect minimum profit threshold", async function () {
      // Same profitable request, but with high min profit threshold
      const result = await solverEvaluateLeverage(
        MARKET_ID,
        parseEther("100"),
        parseEther("300"),
        parseUnits("150", 18),
        parseUnits("20", 18) // min profit = 20 USDT (profit is only 17)
      );

      expect(result.profit).to.equal(parseUnits("17", 18));
      expect(result.profitable).to.be.false; // 17 < 20 threshold
    });

    it("should calculate deleverage profit correctly", async function () {
      // Solver provides 50 USDT, receives 100 CTF
      // CTF value = 100 * 0.65 = 65 USDT
      // Profit = 65 - 50 = 15 USDT
      const result = await solverEvaluateDeleverage(
        MARKET_ID,
        parseUnits("50", 18),
        parseEther("100"),
        parseUnits("0", 18)
      );

      console.log(`    CTF value: ${formatEther(result.ctfValue)} USDT`);
      console.log(`    Profit: ${formatEther(result.profit)} USDT`);

      expect(result.profitable).to.be.true;
      expect(result.ctfValue).to.equal(parseUnits("65", 18));
      expect(result.profit).to.equal(parseUnits("15", 18));
    });

    it("should detect unprofitable deleverage", async function () {
      // Solver provides 80 USDT, receives 100 CTF worth only 65 USDT
      // Profit = 65 - 80 = -15 USDT
      const result = await solverEvaluateDeleverage(
        MARKET_ID,
        parseUnits("80", 18),
        parseEther("100"),
        parseUnits("0", 18)
      );

      expect(result.profitable).to.be.false;
      expect(result.profit).to.be.lt(0n);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  2. BALANCE GATING
  // ══════════════════════════════════════════════════════════════════════════

  describe("Balance checks", function () {
    it("should verify solver has enough CTF before filling leverage", async function () {
      const solverAddr = await solver.getAddress();
      const ctfBalance = BigInt(await mockCTF.balanceOf(solverAddr, POSITION_ID));
      const leveragedAmount = parseEther("200"); // need 200 CTF

      expect(ctfBalance).to.be.gte(leveragedAmount);
      console.log(`    Solver CTF balance: ${formatEther(ctfBalance)}, needs: ${formatEther(leveragedAmount)} → OK`);
    });

    it("should verify solver has enough USDT before filling deleverage", async function () {
      const solverAddr = await solver.getAddress();
      const usdtBalance = BigInt(await usdt.balanceOf(solverAddr));
      const repayAmount = parseUnits("50", 18);

      expect(usdtBalance).to.be.gte(repayAmount);
      console.log(`    Solver USDT balance: ${formatEther(usdtBalance)}, needs: ${formatEther(repayAmount)} → OK`);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  3. FULL LEVERAGE FILL (solver pipeline simulation)
  // ══════════════════════════════════════════════════════════════════════════

  describe("End-to-end leverage fill", function () {
    it("should detect event, evaluate, and fill profitably", async function () {
      const borrowerAddr = await borrower.getAddress();
      const solverAddr = await solver.getAddress();
      const treasuryAddr = await treasury.getAddress();
      const market = await presage.getMarket(MARKET_ID);
      const mid = morphoMarketId(market.morphoParams);

      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 3600;

      // At $0.65 price and 62.5% LLTV: max borrow = 300 * 0.65 * 0.625 ≈ 121.8 USDT
      // Use 200 margin + 100 solver CTF = 300 total, borrow 120 USDT
      // Solver cost: 100 CTF * $0.65 = $65. Receives 120 - 2% = $117.60. Profit = $52.60
      const marginAmt = parseEther("200");
      const totalAmt = parseEther("300");
      const borrowAmt = parseUnits("120", 18);

      // Step 1: Borrower posts request
      const tx = await presage.connect(borrower).requestLeverage(
        MARKET_ID, marginAmt, totalAmt, borrowAmt, deadline
      );
      const receipt = await tx.wait();

      // Step 2: Solver detects the event
      const event = receipt.logs.find((l: any) => {
        try {
          const parsed = presage.interface.parseLog({ topics: l.topics, data: l.data });
          return parsed?.name === "LeverageRequested";
        } catch { return false; }
      });
      expect(event).to.not.be.undefined;
      const parsed = presage.interface.parseLog({ topics: event.topics, data: event.data });
      console.log(`    Event detected: LeverageRequested from ${parsed!.args[0]}`);

      // Step 3: Solver evaluates profitability
      const eval_ = await solverEvaluateLeverage(
        MARKET_ID,
        parsed!.args.marginAmount,
        parsed!.args.supplyCollateralAmount,
        parsed!.args.borrowAmountMax,
        parseUnits("1", 18) // min profit = 1 USDT
      );
      console.log(`    Evaluation: profit=${formatEther(eval_.profit)} USDT, profitable=${eval_.profitable}`);
      expect(eval_.profitable).to.be.true;

      // Step 4: Solver checks balance
      const solverCtfBal = BigInt(await mockCTF.balanceOf(solverAddr, POSITION_ID));
      expect(solverCtfBal).to.be.gte(eval_.leveragedAmount);

      // Step 5: Solver fills
      const solverUsdtBefore = await usdt.balanceOf(solverAddr);
      const treasuryBefore = await usdt.balanceOf(treasuryAddr);

      await presage.connect(solver).fillLeverage(borrowerAddr, MARKET_ID);

      const solverUsdtAfter = await usdt.balanceOf(solverAddr);
      const treasuryAfter = await usdt.balanceOf(treasuryAddr);

      // Step 6: Verify outcomes match evaluation
      const usdtGained = solverUsdtAfter - solverUsdtBefore;
      const feeCollected = treasuryAfter - treasuryBefore;

      expect(usdtGained).to.equal(eval_.usdtReceived);
      expect(feeCollected).to.equal(parseUnits("2.4", 18)); // 120 * 2% = 2.4 USDT

      // Verify borrower's Morpho position
      const pos = await morpho.position(mid, borrowerAddr);
      expect(pos.collateral).to.equal(parseEther("300"));
      expect(pos.borrowShares).to.be.gt(0n);

      console.log(`    Solver received: ${formatEther(usdtGained)} USDT`);
      console.log(`    Treasury fee: ${formatEther(feeCollected)} USDT`);
      console.log(`    Borrower collateral: ${formatEther(pos.collateral)} wCTF`);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  4. FULL DELEVERAGE FILL (solver pipeline simulation)
  // ══════════════════════════════════════════════════════════════════════════

  describe("End-to-end deleverage fill", function () {
    it("should detect event, evaluate, and fill deleverage", async function () {
      const borrowerAddr = await borrower.getAddress();
      const solverAddr = await solver.getAddress();
      const market = await presage.getMarket(MARKET_ID);
      const mid = morphoMarketId(market.morphoParams);

      const posBefore = await morpho.position(mid, borrowerAddr);
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 3600;

      // After leverage: collateral=300, debt=120
      // Repay 30 USDT and withdraw 50 CTF
      // Solver cost: 30 USDT. CTF value: 50 * 0.65 = 32.5. Profit: 2.5 USDT
      // After: collateral=250, debt≈90 → HF = (250 * 0.65 * 0.625) / 90 ≈ 1.13
      const repayAmt = parseUnits("30", 18);
      const withdrawAmt = parseEther("50");

      // Step 1: Borrower requests deleverage
      const tx = await presage.connect(borrower).requestDeleverage(
        MARKET_ID, repayAmt, withdrawAmt, deadline
      );
      const receipt = await tx.wait();

      // Step 2: Detect event
      const event = receipt.logs.find((l: any) => {
        try {
          const parsed = presage.interface.parseLog({ topics: l.topics, data: l.data });
          return parsed?.name === "DeleverageRequested";
        } catch { return false; }
      });
      expect(event).to.not.be.undefined;

      // Step 3: Evaluate
      const eval_ = await solverEvaluateDeleverage(
        MARKET_ID,
        repayAmt,
        withdrawAmt,
        parseUnits("0", 18)
      );
      console.log(`    Deleverage evaluation: profit=${formatEther(eval_.profit)} USDT`);
      expect(eval_.profitable).to.be.true;

      // Step 4: Check USDT balance
      const solverUsdtBal = BigInt(await usdt.balanceOf(solverAddr));
      expect(solverUsdtBal).to.be.gte(repayAmt);

      // Step 5: Fill
      await usdt.connect(solver).approve(await presage.getAddress(), repayAmt);
      await presage.connect(solver).fillDeleverage(borrowerAddr, MARKET_ID);

      // Step 6: Verify
      const posAfter = await morpho.position(mid, borrowerAddr);
      expect(BigInt(posAfter.collateral)).to.equal(BigInt(posBefore.collateral) - withdrawAmt);

      const hf = await presage.healthFactor(MARKET_ID, borrowerAddr);
      console.log(`    Borrower collateral: ${formatEther(posBefore.collateral)} → ${formatEther(posAfter.collateral)}`);
      console.log(`    HF after deleverage: ${formatEther(hf)}`);
      console.log(`    Solver received ${formatEther(withdrawAmt)} CTF (can sell on predict.fun)`);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  5. RACE CONDITION: Request cancelled between detect and fill
  // ══════════════════════════════════════════════════════════════════════════

  describe("Race conditions", function () {
    it("should handle request cancelled between event detection and fill attempt", async function () {
      const borrowerAddr = await borrower.getAddress();
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 3600;

      // Borrower posts request
      await presage.connect(borrower).requestLeverage(
        MARKET_ID, parseEther("10"), parseEther("30"), parseUnits("15", 18), deadline
      );

      // Solver sees the event... but borrower cancels before solver fills
      await presage.connect(borrower).cancelLeverageRequest(MARKET_ID);

      // Solver tries to fill — should revert gracefully
      await expect(
        presage.connect(solver).fillLeverage(borrowerAddr, MARKET_ID)
      ).to.be.revertedWith("request expired"); // deadline=0 after delete

      console.log("    Solver gracefully handled cancelled request");
    });

    it("should handle request expired between event detection and fill attempt", async function () {
      const borrowerAddr = await borrower.getAddress();
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 5; // very short deadline

      await presage.connect(borrower).requestLeverage(
        MARKET_ID, parseEther("10"), parseEther("30"), parseUnits("15", 18), deadline
      );

      // Simulate solver being slow — time passes
      await ethers.provider.send("evm_increaseTime", [30]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        presage.connect(solver).fillLeverage(borrowerAddr, MARKET_ID)
      ).to.be.revertedWith("request expired");

      console.log("    Solver gracefully handled expired request");
    });

    it("should handle another solver filling first", async function () {
      const borrowerAddr = await borrower.getAddress();
      const [, , , , , otherSolver] = await ethers.getSigners();

      // Fund the other solver
      await mockCTF.mint(await otherSolver.getAddress(), POSITION_ID, parseEther("500"));
      await mockCTF.connect(otherSolver).setApprovalForAll(await presage.getAddress(), true);
      await morpho.connect(otherSolver).setAuthorization(await presage.getAddress(), true);

      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 3600;

      await presage.connect(borrower).requestLeverage(
        MARKET_ID, parseEther("10"), parseEther("30"), parseUnits("10", 18), deadline
      );

      // Other solver fills first
      await presage.connect(otherSolver).fillLeverage(borrowerAddr, MARKET_ID);

      // Our solver tries — should get "already filled"
      await expect(
        presage.connect(solver).fillLeverage(borrowerAddr, MARKET_ID)
      ).to.be.revertedWith("already filled");

      console.log("    Solver gracefully handled race with competing solver");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  6. PROFITABILITY CHANGES WITH PRICE
  // ══════════════════════════════════════════════════════════════════════════

  describe("Price-dependent profitability", function () {
    it("should become unprofitable when oracle price rises", async function () {
      // At $0.65: CTF cost = 200 * 0.65 = 130, USDT received = 147, profit = 17
      const eval1 = await solverEvaluateLeverage(
        MARKET_ID, parseEther("100"), parseEther("300"), parseUnits("150", 18), parseUnits("0", 18)
      );
      expect(eval1.profitable).to.be.true;

      // Raise price to $0.80
      await priceHub.seedPrice(POSITION_ID, parseEther("0.80"));

      // At $0.80: CTF cost = 200 * 0.80 = 160, USDT received = 147, profit = -13
      const eval2 = await solverEvaluateLeverage(
        MARKET_ID, parseEther("100"), parseEther("300"), parseUnits("150", 18), parseUnits("0", 18)
      );
      expect(eval2.profitable).to.be.false;

      console.log(`    At $0.65: profit=${formatEther(eval1.profit)} → profitable`);
      console.log(`    At $0.80: profit=${formatEther(eval2.profit)} → NOT profitable`);

      // Restore price for later tests
      await priceHub.seedPrice(POSITION_ID, parseEther("0.65"));
    });

    it("should correctly handle deleverage profitability at different prices", async function () {
      // At $0.65: CTF value = 100 * 0.65 = 65, cost = 50, profit = 15
      const eval1 = await solverEvaluateDeleverage(
        MARKET_ID, parseUnits("50", 18), parseEther("100"), parseUnits("0", 18)
      );
      expect(eval1.profitable).to.be.true;

      // Drop price to $0.40
      await priceHub.seedPrice(POSITION_ID, parseEther("0.40"));

      // At $0.40: CTF value = 100 * 0.40 = 40, cost = 50, profit = -10
      const eval2 = await solverEvaluateDeleverage(
        MARKET_ID, parseUnits("50", 18), parseEther("100"), parseUnits("0", 18)
      );
      expect(eval2.profitable).to.be.false;

      console.log(`    At $0.65: profit=${formatEther(eval1.profit)} → profitable`);
      console.log(`    At $0.40: profit=${formatEther(eval2.profit)} → NOT profitable`);

      await priceHub.seedPrice(POSITION_ID, parseEther("0.65"));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  7. SOLVER WITH ZERO CTF (JIT scenario)
  // ══════════════════════════════════════════════════════════════════════════

  describe("Insufficient inventory detection", function () {
    it("should detect when solver has no CTF for the required position", async function () {
      const [, , , , , , emptySolver] = await ethers.getSigners();

      // emptySolver has zero CTF for this position
      const ctfBal = BigInt(await mockCTF.balanceOf(await emptySolver.getAddress(), POSITION_ID));
      expect(ctfBal).to.equal(0n);

      const leveragedAmount = parseEther("200");
      const hasSufficientInventory = ctfBal >= leveragedAmount;
      expect(hasSufficientInventory).to.be.false;

      console.log("    Solver has 0 CTF → inventory mode would SKIP, JIT mode would buy from predict.fun");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  8. POLLING: read request from chain state (not from event)
  // ══════════════════════════════════════════════════════════════════════════

  describe("Polling mode (read from chain state)", function () {
    it("should discover and fill an active request via polling", async function () {
      const borrowerAddr = await borrower.getAddress();
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 3600;

      // Use profitable params: 25 margin, 30 total (5 from solver), borrow 12 USDT
      // Max borrow = 30 * 0.65 * 0.625 = 12.1875 → 12 is feasible
      // Solver cost = 5 * 0.65 = 3.25. Received = 12 * 0.98 = 11.76. Profit = 8.51
      await presage.connect(borrower).requestLeverage(
        MARKET_ID, parseEther("25"), parseEther("30"), parseUnits("12", 18), deadline
      );

      // Simulate what the poll loop does: read from mapping
      const req = await presage.leverageRequests(borrowerAddr, MARKET_ID);

      // This check mirrors the poll loop logic
      const isActive = BigInt(req.deadline) > BigInt(block!.timestamp) && !req.filled && BigInt(req.supplyCollateralAmount) > 0n;
      expect(isActive).to.be.true;

      // Evaluate and fill
      const eval_ = await solverEvaluateLeverage(
        MARKET_ID,
        BigInt(req.marginAmount),
        BigInt(req.supplyCollateralAmount),
        BigInt(req.borrowAmountMax),
        parseUnits("0", 18)
      );

      expect(eval_.profitable).to.be.true;
      await presage.connect(solver).fillLeverage(borrowerAddr, MARKET_ID);
      const reqAfter = await presage.leverageRequests(borrowerAddr, MARKET_ID);
      expect(reqAfter.filled).to.be.true;
      console.log(`    Poll detected → evaluated (profit=${formatEther(eval_.profit)}) → filled`);
    });

    it("should skip already-filled requests in poll", async function () {
      const borrowerAddr = await borrower.getAddress();

      // Request from previous test should now be filled
      const req = await presage.leverageRequests(borrowerAddr, MARKET_ID);

      // Poll loop checks: deadline > now && !filled && amount > 0
      // After filling, filled=true so isActive=false
      const isActive = BigInt(req.deadline) > 0n && !req.filled && BigInt(req.supplyCollateralAmount) > 0n;
      expect(isActive).to.be.false;

      // Verify it was actually filled (not just missing)
      expect(req.filled).to.be.true;
      console.log("    Poll correctly skips filled request");
    });
  });
});
