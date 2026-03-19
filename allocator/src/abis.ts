export const VAULT_ABI = [
  "function withdrawQueue(uint256) external view returns (bytes32)",
  "function withdrawQueueLength() external view returns (uint256)",
  "function supplyQueue(uint256) external view returns (bytes32)",
  "function supplyQueueLength() external view returns (uint256)",
  "function config(bytes32 id) external view returns (uint184 cap, bool enabled, uint64 removableAt)",
  "function totalAssets() external view returns (uint256)",
  "function reallocate(tuple(tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets)[] allocations) external",
  "function setSupplyQueue(bytes32[] newSupplyQueue) external",
  "function asset() external view returns (address)",
  "function owner() external view returns (address)",
];

export const MORPHO_ABI = [
  "function market(bytes32 id) external view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function position(bytes32 id, address user) external view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function idToMarketParams(bytes32 id) external view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
];

export const PRESAGE_ABI = [
  "function getMarket(uint256 marketId) external view returns (tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) morphoParams, tuple(address ctf, bytes32 parentCollectionId, bytes32 conditionId, uint256 positionId, uint256 oppositePositionId) ctfPosition, uint256 resolutionAt, uint256 originationFeeBps, uint256 liquidationFeeBps)",
];

export const PRICE_HUB_ABI = [
  "function configs(uint256 positionId) external view returns (uint256 positionId, uint256 resolutionAt, uint256 decayDuration, uint256 decayCooldown, uint8 loanDecimals, uint8 collateralDecimals)",
  "function decayFactor(uint256 positionId) external view returns (uint256)",
];
