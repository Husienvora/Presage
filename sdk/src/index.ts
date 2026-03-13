import { ethers, Contract, Signer, Provider, BigNumberish } from "ethers";
import { PRESAGE_ABI, SAFE_BATCH_HELPER_ABI, ERC20_ABI, WRAPPER_FACTORY_ABI, MORPHO_ABI, PRICE_HUB_ABI, IRM_ABI } from "./abis";

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
