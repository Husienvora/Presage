import { ethers, Contract, Signer, Provider, BigNumberish } from "ethers";
import { PRESAGE_ABI, SAFE_BATCH_HELPER_ABI, ERC20_ABI, WRAPPER_FACTORY_ABI } from "./abis";

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

  // ──────── Safe Batching ────────

  /**
   * Generates a multiSend payload for a Gnosis Safe to perform a full borrow.
   * Includes: CTF Approval + Deposit Collateral + Borrow
   */
  async encodeFullBorrow(
    marketId: BigNumberish,
    ctfAddress: string,
    positionId: BigNumberish,
    collateralAmount: BigNumberish,
    borrowAmount: BigNumberish
  ): Promise<string> {
    return this.batchHelper.encodeBorrow(
      marketId,
      ctfAddress,
      positionId,
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
}

export * from "./abis";
