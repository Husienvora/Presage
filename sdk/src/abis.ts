export const PRESAGE_ABI = [
  // Core
  "function depositCollateral(uint256 marketId, uint256 amount) external",
  "function releaseCollateral(uint256 marketId, uint256 amount) external",
  "function borrow(uint256 marketId, uint256 amount) external",
  "function repay(uint256 marketId, uint256 amount) external",
  "function supply(uint256 marketId, uint256 amount) external",
  "function withdraw(uint256 marketId, uint256 amount) external",
  // Leverage / Deleverage
  "function requestLeverage(uint256 marketId, uint256 marginAmount, uint256 supplyCollateralAmount, uint256 borrowAmountMax, uint256 deadline) external",
  "function fillLeverage(address borrower, uint256 marketId) external",
  "function cancelLeverageRequest(uint256 marketId) external",
  "function requestDeleverage(uint256 marketId, uint256 repayAmount, uint256 withdrawCollateralAmountMax, uint256 deadline) external",
  "function fillDeleverage(address borrower, uint256 marketId) external",
  "function cancelDeleverageRequest(uint256 marketId) external",
  "function leverageRequests(address borrower, uint256 marketId) external view returns (uint256 marginAmount, uint256 supplyCollateralAmount, uint256 borrowAmountMax, uint256 deadline, bool filled)",
  "function deleverageRequests(address borrower, uint256 marketId) external view returns (uint256 repayAmount, uint256 withdrawCollateralAmountMax, uint256 deadline, bool filled)",
  // Settlement / Liquidation
  "function settleWithLoanToken(uint256 marketId, address borrower, uint256 repayAmount) external",
  "function settleWithMerge(uint256 marketId, address borrower, uint256 seizeAmount) external",
  // Events
  "event LeverageRequested(address indexed borrower, uint256 indexed marketId, uint256 marginAmount, uint256 supplyCollateralAmount, uint256 borrowAmountMax, uint256 deadline)",
  "event LeverageFilled(address indexed borrower, uint256 indexed marketId, address indexed solver, uint256 borrowAmount)",
  "event LeverageCancelled(address indexed borrower, uint256 indexed marketId)",
  "event DeleverageRequested(address indexed borrower, uint256 indexed marketId, uint256 repayAmount, uint256 withdrawCollateralAmountMax, uint256 deadline)",
  "event DeleverageFilled(address indexed borrower, uint256 indexed marketId, address indexed solver, uint256 withdrawAmount)",
  "event DeleverageCancelled(address indexed borrower, uint256 indexed marketId)",
  "event SettledWithLoanToken(uint256 indexed marketId, address indexed borrower, address liquidator, uint256 repayAmount, uint256 seized)",
  "event SettledWithMerge(uint256 indexed marketId, address indexed borrower, address liquidator, uint256 merged, uint256 profit)",
  // Views
  "function getMarket(uint256 marketId) external view returns (tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) morphoParams, tuple(address ctf, bytes32 parentCollectionId, bytes32 conditionId, uint256 positionId, uint256 oppositePositionId) ctfPosition, uint256 resolutionAt, uint256 originationFeeBps, uint256 liquidationFeeBps)",
  "function healthFactor(uint256 marketId, address borrower) external view returns (uint256)",
  "function priceHub() external view returns (address)",
  "function treasury() external view returns (address)",
  "function defaultOriginationFeeBps() external view returns (uint256)",
  "function defaultLiquidationFeeBps() external view returns (uint256)",
  "function BPS() external view returns (uint256)"
];

export const PRICE_HUB_ABI = [
  "function prices(uint256 positionId) external view returns (uint256 price, uint256 updatedAt)",
  "function morphoPrice(uint256 positionId) external view returns (uint256)",
  "function submitPrice(uint256 positionId, bytes calldata proof) external",
  "function configs(uint256 positionId) external view returns (uint256 positionId, uint256 resolutionAt, uint256 decayDuration, uint256 decayCooldown, uint8 loanDecimals, uint8 collateralDecimals)",
  "function decayFactor(uint256 positionId) external view returns (uint256)"
];

export const IRM_ABI = [
  "function borrowRateView(tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, tuple(uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee) market) external view returns (uint256)"
];

export const SAFE_BATCH_HELPER_ABI = [
  "function encodeBorrow(uint256 marketId, address ctf, uint256 collateralAmount, uint256 borrowAmount) external view returns (bytes memory)",
  "function encodeRepayAndRelease(uint256 marketId, address loanToken, uint256 repayAmount, uint256 releaseAmount) external view returns (bytes memory)",
  "function encodeSupply(uint256 marketId, address loanToken, uint256 amount) external view returns (bytes memory)",
  "function encodeWithdraw(uint256 marketId, uint256 amount) external view returns (bytes memory)"
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)"
];

export const WRAPPER_FACTORY_ABI = [
  "function getWrapper(uint256 positionId) external view returns (address)",
  "function predictAddress(address ctf, uint256 positionId) external view returns (address)",
  "function create(address ctf, uint256 positionId, uint8 decimals) external returns (address)"
];

export const MORPHO_ABI = [
  "function position(bytes32 id, address user) external view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32 id) external view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function setAuthorization(address authorized, bool authorizedStatus) external",
  "function isAuthorized(address authorizer, address authorized) external view returns (bool)"
];

export const CTF_ABI = [
  "function balanceOf(address account, uint256 id) external view returns (uint256)",
  "function setApprovalForAll(address operator, bool approved) external",
  "function isApprovedForAll(address account, address operator) external view returns (bool)"
];

export const ORACLE_ABI = [
  "function price() external view returns (uint256)"
];

