import { ethers, Contract, Signer, Provider, BigNumberish } from "ethers";
import { PRESAGE_ABI, SAFE_BATCH_HELPER_ABI, ERC20_ABI, WRAPPER_FACTORY_ABI, MORPHO_ABI, PRICE_HUB_ABI, IRM_ABI, CTF_ABI, ORACLE_ABI } from "./abis";

export interface PresageConfig {
  presageAddress: string;
  factoryAddress: string;
  batchHelperAddress: string;
  morphoAddress: string; // Morpho Blue Singleton address
  provider: Provider;
  signer?: Signer;
}

export class PresageClient {
  public readonly config: PresageConfig;
  public readonly presage: Contract;
  public readonly factory: Contract;
  public readonly batchHelper: Contract;
  public readonly morpho: Contract;
  private _priceHub?: Contract;

  constructor(config: PresageConfig) {
    this.config = config;
    const runner = config.signer || config.provider;
    this.presage = new Contract(config.presageAddress, PRESAGE_ABI, runner);
    this.factory = new Contract(config.factoryAddress, WRAPPER_FACTORY_ABI, runner);
    this.batchHelper = new Contract(config.batchHelperAddress, SAFE_BATCH_HELPER_ABI, runner);
    this.morpho = new Contract(config.morphoAddress, MORPHO_ABI, runner);
  }

  // ──────── Core Operations ────────

  async supply(marketId: BigNumberish, amount: BigNumberish) {
    return this.presage.supply(marketId, amount);
  }

  async withdraw(marketId: BigNumberish, amount: BigNumberish) {
    return this.presage.withdraw(marketId, amount);
  }

  async depositCollateral(marketId: BigNumberish, amount: BigNumberish) {
    return this.presage.depositCollateral(marketId, amount);
  }

  async borrow(marketId: BigNumberish, amount: BigNumberish) {
    return this.presage.borrow(marketId, amount);
  }

  async repay(marketId: BigNumberish, amount: BigNumberish) {
    return this.presage.repay(marketId, amount);
  }

  // ──────── Leverage / Deleverage ────────

  /**
   * Borrower requests a leveraged position. A solver fills it atomically.
   *
   * @param marketId      Presage market ID
   * @param marginAmount  CTF tokens the borrower contributes as margin
   * @param totalCollateral  Total CTF collateral (margin + solver-provided)
   * @param maxBorrow     Max USDT to borrow (goes to solver as payment)
   * @param deadline      Unix timestamp after which the request expires
   */
  async requestLeverage(
    marketId: BigNumberish,
    marginAmount: BigNumberish,
    totalCollateral: BigNumberish,
    maxBorrow: BigNumberish,
    deadline: BigNumberish
  ) {
    return this.presage.requestLeverage(marketId, marginAmount, totalCollateral, maxBorrow, deadline);
  }

  /**
   * Borrower requests a deleverage. A solver fills it atomically.
   *
   * @param marketId      Presage market ID
   * @param repayAmount   USDT the solver provides to repay borrower's debt
   * @param maxWithdraw   Max CTF to withdraw from collateral (goes to solver)
   * @param deadline      Unix timestamp after which the request expires
   */
  async requestDeleverage(
    marketId: BigNumberish,
    repayAmount: BigNumberish,
    maxWithdraw: BigNumberish,
    deadline: BigNumberish
  ) {
    return this.presage.requestDeleverage(marketId, repayAmount, maxWithdraw, deadline);
  }

  /**
   * Cancels the caller's active leverage request for a market.
   */
  async cancelLeverageRequest(marketId: BigNumberish) {
    return this.presage.cancelLeverageRequest(marketId);
  }

  /**
   * Cancels the caller's active deleverage request for a market.
   */
  async cancelDeleverageRequest(marketId: BigNumberish) {
    return this.presage.cancelDeleverageRequest(marketId);
  }

  /**
   * Solver fills a borrower's leverage request.
   * The solver provides the missing CTF and receives USDT (minus origination fee).
   */
  async fillLeverage(borrower: string, marketId: BigNumberish) {
    return this.presage.fillLeverage(borrower, marketId);
  }

  /**
   * Solver fills a borrower's deleverage request.
   * The solver provides USDT to repay debt and receives CTF collateral.
   */
  async fillDeleverage(borrower: string, marketId: BigNumberish) {
    return this.presage.fillDeleverage(borrower, marketId);
  }

  /**
   * Fetches a borrower's active leverage request for a market.
   * Returns null if no active request exists.
   */
  async getLeverageRequest(borrower: string, marketId: BigNumberish) {
    const req = await this.presage.leverageRequests(borrower, marketId);
    if (BigInt(req.deadline) === 0n) return null;
    return {
      marginAmount: BigInt(req.marginAmount),
      supplyCollateralAmount: BigInt(req.supplyCollateralAmount),
      borrowAmountMax: BigInt(req.borrowAmountMax),
      deadline: BigInt(req.deadline),
      filled: req.filled as boolean,
    };
  }

  /**
   * Fetches a borrower's active deleverage request for a market.
   * Returns null if no active request exists.
   */
  async getDeleverageRequest(borrower: string, marketId: BigNumberish) {
    const req = await this.presage.deleverageRequests(borrower, marketId);
    if (BigInt(req.deadline) === 0n) return null;
    return {
      repayAmount: BigInt(req.repayAmount),
      withdrawCollateralAmountMax: BigInt(req.withdrawCollateralAmountMax),
      deadline: BigInt(req.deadline),
      filled: req.filled as boolean,
    };
  }

  // ──────── Settlement / Liquidation ────────

  /**
   * Liquidate an unhealthy position by providing loan tokens.
   * The liquidator repays debt and seizes collateral (as CTF) at a discount.
   * A liquidation fee is sent to the treasury.
   */
  async settleWithLoanToken(marketId: BigNumberish, borrower: string, repayAmount: BigNumberish) {
    return this.presage.settleWithLoanToken(marketId, borrower, repayAmount);
  }

  /**
   * Liquidate an unhealthy position using opposite-side CTF tokens.
   * The liquidator provides opposite CTF, which is merged with the borrower's
   * collateral CTF back into USDT. The USDT repays debt, and the liquidator
   * receives the profit minus liquidation fee.
   *
   * This requires no upfront USDT — only the opposite position tokens.
   */
  async settleWithMerge(marketId: BigNumberish, borrower: string, seizeAmount: BigNumberish) {
    return this.presage.settleWithMerge(marketId, borrower, seizeAmount);
  }

  // ──────── Leverage / Deleverage Helpers ────────

  private static readonly ORACLE_PRICE_SCALE = 10n ** 36n;
  private static readonly BPS_SCALE = 10000n;

  /**
   * Estimates the solver's profit for filling a leverage request.
   *
   * profit = (borrowAmount - originationFee) - (leveragedCTF * oraclePrice)
   *
   * @returns Object with profit (bigint, 18-dec USDT), leveragedAmount, ctfCost, usdtReceived
   */
  async estimateLeverageProfit(
    marketId: BigNumberish,
    marginAmount: BigNumberish,
    totalCollateral: BigNumberish,
    maxBorrow: BigNumberish
  ) {
    const market = await this.getMarket(marketId);
    const oraclePrice = await this._getOraclePriceRaw(market.morphoParams.oracle);
    const feeBps = BigInt(market.originationFeeBps);

    const leveragedAmount = BigInt(totalCollateral) - BigInt(marginAmount);
    const ctfCost = (leveragedAmount * oraclePrice) / PresageClient.ORACLE_PRICE_SCALE;
    const fee = (BigInt(maxBorrow) * feeBps) / PresageClient.BPS_SCALE;
    const usdtReceived = BigInt(maxBorrow) - fee;
    const profit = usdtReceived - ctfCost;

    return { profit, leveragedAmount, ctfCost, usdtReceived, fee };
  }

  /**
   * Estimates the solver's profit for filling a deleverage request.
   *
   * profit = (withdrawCTF * oraclePrice) - repayAmount
   *
   * @returns Object with profit (bigint, 18-dec USDT) and ctfValue
   */
  async estimateDeleverageProfit(
    marketId: BigNumberish,
    repayAmount: BigNumberish,
    withdrawCollateral: BigNumberish
  ) {
    const market = await this.getMarket(marketId);
    const oraclePrice = await this._getOraclePriceRaw(market.morphoParams.oracle);

    const ctfValue = (BigInt(withdrawCollateral) * oraclePrice) / PresageClient.ORACLE_PRICE_SCALE;
    const profit = ctfValue - BigInt(repayAmount);

    return { profit, ctfValue };
  }

  /**
   * Calculates the max borrow amount for a leverage request given market constraints.
   *
   * maxBorrow = totalCollateral * oraclePrice * LLTV / 1e36 / 1e18
   *
   * This is the theoretical max — the borrower should use a value slightly below
   * to leave room for health factor > 1.
   */
  async getMaxLeverageBorrow(marketId: BigNumberish, totalCollateral: BigNumberish): Promise<bigint> {
    const market = await this.getMarket(marketId);
    const oraclePrice = await this._getOraclePriceRaw(market.morphoParams.oracle);
    const lltv = BigInt(market.morphoParams.lltv);

    return (BigInt(totalCollateral) * oraclePrice * lltv) / PresageClient.ORACLE_PRICE_SCALE / (10n ** 18n);
  }

  /**
   * Returns the current LLTV decay factor for a market (1e18 = no decay, 0 = fully decayed).
   * Use this to check how close a market is to resolution.
   */
  async getDecayFactor(marketId: BigNumberish): Promise<bigint> {
    const { ctfPosition } = await this.getMarket(marketId);
    const hub = await this.getPriceHub();
    return BigInt(await hub.decayFactor(ctfPosition.positionId));
  }

  /**
   * Checks if a borrower has all required approvals for leverage.
   * Returns which approvals are missing.
   */
  async checkLeverageReadiness(marketId: BigNumberish, borrower: string) {
    const market = await this.getMarket(marketId);
    const runner = this.config.signer || this.config.provider;
    const ctf = new Contract(market.ctfPosition.ctf, CTF_ABI, runner);

    const [morphoAuthorized, ctfApproved] = await Promise.all([
      this.morpho.isAuthorized(borrower, this.config.presageAddress),
      ctf.isApprovedForAll(borrower, this.config.presageAddress),
    ]);

    return {
      morphoAuthorized: morphoAuthorized as boolean,
      ctfApproved: ctfApproved as boolean,
      ready: morphoAuthorized && ctfApproved,
    };
  }

  /**
   * Checks if a solver has all required approvals and balances for filling leverage.
   */
  async checkSolverReadiness(
    marketId: BigNumberish,
    solver: string,
    leveragedAmount: BigNumberish
  ) {
    const market = await this.getMarket(marketId);
    const runner = this.config.signer || this.config.provider;
    const ctf = new Contract(market.ctfPosition.ctf, CTF_ABI, runner);

    const [morphoAuthorized, ctfApproved, ctfBalance] = await Promise.all([
      this.morpho.isAuthorized(solver, this.config.presageAddress),
      ctf.isApprovedForAll(solver, this.config.presageAddress),
      ctf.balanceOf(solver, market.ctfPosition.positionId),
    ]);

    const hasEnoughCTF = BigInt(ctfBalance) >= BigInt(leveragedAmount);

    return {
      morphoAuthorized: morphoAuthorized as boolean,
      ctfApproved: ctfApproved as boolean,
      ctfBalance: BigInt(ctfBalance),
      hasEnoughCTF,
      ready: morphoAuthorized && ctfApproved && hasEnoughCTF,
    };
  }

  private async _getOraclePriceRaw(oracleAddress: string): Promise<bigint> {
    const runner = this.config.signer || this.config.provider;
    const oracle = new Contract(oracleAddress, ORACLE_ABI, runner);
    return BigInt(await oracle.price());
  }

  // ──────── Debt Helpers ────────

  /**
   * Helper to calculate the current full debt for a user in a specific market,
   * including a recommended buffer (default 1%) to account for interest accrual
   * between the time of calculation and transaction execution.
   */
  async getFullDebtWithBuffer(marketId: BigNumberish, user: string, bufferBps: number = 100) {
    const { morphoParams } = await this.getMarket(marketId);
    const mId = this.getMorphoMarketId(morphoParams);
    
    const [pos, mkt] = await Promise.all([
      this.morpho.position(mId, user),
      this.morpho.market(mId)
    ]);

    if (BigInt(mkt.totalBorrowShares) === 0n) return 0n;

    const debt = (BigInt(pos.borrowShares) * BigInt(mkt.totalBorrowAssets) + BigInt(mkt.totalBorrowShares) - 1n) / BigInt(mkt.totalBorrowShares);
    const buffer = (debt * BigInt(bufferBps)) / 10000n;
    return debt + buffer;
  }

  // ──────── Oracle & Prices ────────

  /**
   * Returns the PriceHub contract instance.
   */
  async getPriceHub(): Promise<Contract> {
    if (this._priceHub) return this._priceHub;
    const hubAddress = await this.presage.priceHub();
    const runner = this.config.signer || this.config.provider;
    this._priceHub = new Contract(hubAddress, PRICE_HUB_ABI, runner);
    return this._priceHub;
  }

  /**
   * Fetches the raw PricePoint (probability and timestamp) for a market from PriceHub.
   */
  async getPricePoint(marketId: BigNumberish) {
    const { ctfPosition } = await this.getMarket(marketId);
    const hub = await this.getPriceHub();
    return hub.prices(ctfPosition.positionId);
  }

  /**
   * Fetches the current price scaled for Morpho from PriceHub.
   */
  async getOraclePrice(marketId: BigNumberish) {
    const { ctfPosition } = await this.getMarket(marketId);
    const hub = await this.getPriceHub();
    return hub.morphoPrice(ctfPosition.positionId);
  }

  /**
   * Submits a price update proof to the PriceHub.
   */
  async updateOraclePrice(marketId: BigNumberish, proof: string) {
    const { ctfPosition } = await this.getMarket(marketId);
    const hub = await this.getPriceHub();
    return hub.submitPrice(ctfPosition.positionId, proof);
  }

  // ──────── Interest Rates ────────

  /**
   * Fetches the current market utilization (0..1e18).
   */
  async getUtilization(marketId: BigNumberish): Promise<bigint> {
    const { morphoParams } = await this.getMarket(marketId);
    const mId = this.getMorphoMarketId(morphoParams);
    const market = await this.morpho.market(mId);
    
    if (BigInt(market.totalSupplyAssets) === 0n) return 0n;
    return (BigInt(market.totalBorrowAssets) * BigInt(1e18)) / BigInt(market.totalSupplyAssets);
  }

  /**
   * Fetches the current Borrow APY for a market.
   */
  async getBorrowAPY(marketId: BigNumberish): Promise<number> {
    const { morphoParams } = await this.getMarket(marketId);
    const mId = this.getMorphoMarketId(morphoParams);
    const market = await this.morpho.market(mId);
    
    const runner = this.config.signer || this.config.provider;
    const irm = new Contract(morphoParams.irm, IRM_ABI, runner);
    
    const borrowRateWad = await irm.borrowRateView(morphoParams, market);
    const SECONDS_PER_YEAR = 31536000n;
    
    // APR = rate * seconds_per_year
    // APY = (1 + rate)^seconds_per_year - 1 (approx as APR for low rates, but let's be precise if possible)
    // Most UIs use APR * 100 for simplicity or standard APY calculation.
    return Number(borrowRateWad * SECONDS_PER_YEAR) / 1e18;
  }

  /**
   * Fetches the current Supply APY for a market.
   */
  async getSupplyAPY(marketId: BigNumberish): Promise<number> {
    const { morphoParams } = await this.getMarket(marketId);
    const mId = this.getMorphoMarketId(morphoParams);
    const market = await this.morpho.market(mId);
    
    const borrowAPY = await this.getBorrowAPY(marketId);
    const utilization = BigInt(market.totalSupplyAssets) > 0n 
      ? Number(BigInt(market.totalBorrowAssets) * BigInt(1e18) / BigInt(market.totalSupplyAssets)) / 1e18
      : 0;
    
    const fee = Number(market.fee) / 1e18;
    return borrowAPY * utilization * (1 - fee);
  }

  // ──────── Permissions (EOA Flow) ────────

  /**
   * Checks if the Presage Router is authorized on Morpho Blue for the user.
   */
  async isAuthorizedOnMorpho(user: string): Promise<boolean> {
    return this.morpho.isAuthorized(user, this.config.presageAddress);
  }

  /**
   * Approves the Presage Router to spend a specific amount of loan tokens (e.g. USDT).
   */
  async approveLoanToken(loanTokenAddress: string, amount: BigNumberish) {
    const runner = this.config.signer || this.config.provider;
    const token = new Contract(loanTokenAddress, ERC20_ABI, runner);
    return token.approve(this.config.presageAddress, amount);
  }

  /**
   * Approves the Presage Router to manage all CTF tokens.
   */
  async approveCTF(ctfAddress: string) {
    const runner = this.config.signer || this.config.provider;
    const ctf = new Contract(ctfAddress, ["function setApprovalForAll(address operator, bool approved) external"], runner);
    return ctf.setApprovalForAll(this.config.presageAddress, true);
  }

  /**
   * Authorizes the Presage Router on Morpho Blue. 
   * This is a one-time requirement for borrowing on behalf of the user.
   */
  async authorizePresageOnMorpho() {
    return this.morpho.setAuthorization(this.config.presageAddress, true);
  }

  // ──────── Position Tracking ────────

  /**
   * Calculates the Morpho Blue Market ID from market parameters.
   */
  getMorphoMarketId(morphoParams: any): string {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const encoded = abiCoder.encode(
      ["address", "address", "address", "address", "uint256"],
      [
        morphoParams.loanToken,
        morphoParams.collateralToken,
        morphoParams.oracle,
        morphoParams.irm,
        morphoParams.lltv,
      ]
    );
    return ethers.keccak256(encoded);
  }

  /**
   * Fetches detailed position data for a user in a specific market.
   * Returns assets (not just shares) for easier readability.
   */
  async getUserPosition(marketId: BigNumberish, user: string) {
    const { morphoParams } = await this.getMarket(marketId);
    const mId = this.getMorphoMarketId(morphoParams);

    const [pos, market] = await Promise.all([
      this.morpho.position(mId, user),
      this.morpho.market(mId)
    ]);

    // Conversion helpers (simplified)
    const supplyAssets = market.totalSupplyShares > 0
      ? (pos.supplyShares * market.totalSupplyAssets) / market.totalSupplyShares
      : 0n;
    
    const borrowAssets = market.totalBorrowShares > 0
      ? (BigInt(pos.borrowShares) * market.totalBorrowAssets) / market.totalBorrowShares
      : 0n;

    const healthFactor = await this.getHealthFactor(marketId, user);

    return {
      supplyAssets,
      borrowAssets,
      collateralAssets: pos.collateral,
      supplyShares: pos.supplyShares,
      borrowShares: pos.borrowShares,
      healthFactor
    };
  }

  // ──────── View ────────

  async getMarket(marketId: BigNumberish) {
    return this.presage.getMarket(marketId);
  }

  async getHealthFactor(marketId: BigNumberish, borrower: string) {
    return this.presage.healthFactor(marketId, borrower);
  }

  // ──────── Fees ────────

  async getDefaultFeeConfig() {
    const [treasury, defaultOriginationFeeBps, defaultLiquidationFeeBps] = await Promise.all([
      this.presage.treasury(),
      this.presage.defaultOriginationFeeBps(),
      this.presage.defaultLiquidationFeeBps(),
    ]);
    return { treasury, defaultOriginationFeeBps, defaultLiquidationFeeBps };
  }

  async getMarketFees(marketId: BigNumberish) {
    const { originationFeeBps, liquidationFeeBps } = await this.getMarket(marketId);
    return { originationFeeBps, liquidationFeeBps };
  }

  /**
   * Calculates the origination fee for a given borrow amount in a specific market.
   */
  async estimateOriginationFee(marketId: BigNumberish, amount: BigNumberish): Promise<bigint> {
    const { originationFeeBps } = await this.getMarket(marketId);
    return (BigInt(amount) * BigInt(originationFeeBps)) / 10000n;
  }

  // ──────── Safe Batching ────────

  /**
   * Generates a multiSend payload for a Gnosis Safe to perform a full borrow.
   * Includes: CTF Approval + Deposit Collateral + Borrow
   */
  async encodeFullBorrow(
    marketId: BigNumberish,
    ctfAddress: string,
    collateralAmount: BigNumberish,
    borrowAmount: BigNumberish
  ): Promise<string> {
    return this.batchHelper.encodeBorrow(
      marketId,
      ctfAddress,
      collateralAmount,
      borrowAmount
    );
  }

  /**
   * Generates a multiSend payload for a Gnosis Safe to supply USDT.
   * Includes: USDT Approval + Supply
   */
  async encodeFullSupply(
    marketId: BigNumberish,
    loanToken: string,
    amount: BigNumberish
  ): Promise<string> {
    return this.batchHelper.encodeSupply(marketId, loanToken, amount);
  }

  /**
   * Generates a multiSend payload for a Gnosis Safe to fully repay debt and release collateral.
   * Includes: USDT Approval + Repay + Release Collateral
   */
  async encodeFullRepayAndRelease(
    marketId: BigNumberish,
    loanToken: string,
    repayAmount: BigNumberish,
    releaseAmount: BigNumberish
  ): Promise<string> {
    return this.batchHelper.encodeRepayAndRelease(
      marketId,
      loanToken,
      repayAmount,
      releaseAmount
    );
  }
}

export * from "./abis";
