export const PRESAGE_ABI = [
  // Leverage
  "event LeverageRequested(address indexed borrower, uint256 indexed marketId, uint256 marginAmount, uint256 supplyCollateralAmount, uint256 borrowAmountMax, uint256 deadline)",
  "event LeverageFilled(address indexed borrower, uint256 indexed marketId, address indexed solver, uint256 borrowAmount)",
  "event LeverageCancelled(address indexed borrower, uint256 indexed marketId)",
  "event DeleverageRequested(address indexed borrower, uint256 indexed marketId, uint256 repayAmount, uint256 withdrawCollateralAmountMax, uint256 deadline)",
  "event DeleverageFilled(address indexed borrower, uint256 indexed marketId, address indexed solver, uint256 withdrawAmount)",
  "event DeleverageCancelled(address indexed borrower, uint256 indexed marketId)",
  "function fillLeverage(address borrower, uint256 marketId) external",
  "function fillDeleverage(address borrower, uint256 marketId) external",
  "function leverageRequests(address borrower, uint256 marketId) external view returns (uint256 marginAmount, uint256 supplyCollateralAmount, uint256 borrowAmountMax, uint256 deadline, bool filled)",
  "function deleverageRequests(address borrower, uint256 marketId) external view returns (uint256 repayAmount, uint256 withdrawCollateralAmountMax, uint256 deadline, bool filled)",
  // Market info
  "function getMarket(uint256 marketId) external view returns (tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) morphoParams, tuple(address ctf, bytes32 parentCollectionId, bytes32 conditionId, uint256 positionId, uint256 oppositePositionId) ctfPosition, uint256 resolutionAt, uint256 originationFeeBps, uint256 liquidationFeeBps)",
  "function healthFactor(uint256 marketId, address borrower) external view returns (uint256)",
  "function BPS() external view returns (uint256)",
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

export const CTF_ABI = [
  "function balanceOf(address account, uint256 id) external view returns (uint256)",
  "function setApprovalForAll(address operator, bool approved) external",
  "function isApprovedForAll(address account, address operator) external view returns (bool)",
];

export const MORPHO_ABI = [
  "function setAuthorization(address authorized, bool authorizedStatus) external",
  "function isAuthorized(address authorizer, address authorized) external view returns (bool)",
];

export const ORACLE_ABI = [
  "function price() external view returns (uint256)",
];
