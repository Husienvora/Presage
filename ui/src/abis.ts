// Extended ABIs for the testing UI — includes admin functions not in the SDK

export const PRESAGE_ABI = [
  // Core operations
  "function depositCollateral(uint256 marketId, uint256 amount) external",
  "function releaseCollateral(uint256 marketId, uint256 amount) external",
  "function borrow(uint256 marketId, uint256 amount) external",
  "function repay(uint256 marketId, uint256 amount) external",
  "function supply(uint256 marketId, uint256 amount) external",
  "function withdraw(uint256 marketId, uint256 amount) external",
  // Admin
  "function openMarket(tuple(address ctf, bytes32 parentCollectionId, bytes32 conditionId, uint256 positionId, uint256 oppositePositionId) ctfPos, address loanToken, uint256 lltv, uint256 resolutionAt, uint256 decayDuration, uint256 decayCooldown) external returns (uint256)",
  "function nextMarketId() external view returns (uint256)",
  "function owner() external view returns (address)",
  "function triggerAccrual(uint256 marketId) external",
  // View
  "function getMarket(uint256 marketId) external view returns (tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) morphoParams, tuple(address ctf, bytes32 parentCollectionId, bytes32 conditionId, uint256 positionId, uint256 oppositePositionId) ctfPosition, uint256 resolutionAt, uint256 originationFeeBps, uint256 liquidationFeeBps)",
  "function healthFactor(uint256 marketId, address borrower) external view returns (uint256)",
  // Fee admin
  "function setTreasury(address treasury_) external",
  "function setDefaultOriginationFee(uint256 feeBps) external",
  "function setDefaultLiquidationFee(uint256 feeBps) external",
  "function setMarketFees(uint256 marketId, uint256 originationFeeBps_, uint256 liquidationFeeBps_) external",
  // Fee view
  "function treasury() external view returns (address)",
  "function defaultOriginationFeeBps() external view returns (uint256)",
  "function defaultLiquidationFeeBps() external view returns (uint256)",
  "function BPS() external view returns (uint256)",
  // Events
  "event MarketOpened(uint256 indexed marketId, address indexed loanToken, address indexed wrapper, uint256 positionId, uint256 resolutionAt)",
  "event Supplied(uint256 indexed marketId, address indexed lender, uint256 amount)",
  "event Withdrawn(uint256 indexed marketId, address indexed lender, uint256 amount)",
  "event CollateralDeposited(uint256 indexed marketId, address indexed borrower, uint256 amount)",
  "event CollateralReleased(uint256 indexed marketId, address indexed borrower, uint256 amount)",
  "event LoanTaken(uint256 indexed marketId, address indexed borrower, uint256 amount)",
  "event LoanRepaid(uint256 indexed marketId, address indexed borrower, uint256 amount)",
  "event TreasurySet(address indexed treasury)",
  "event DefaultOriginationFeeSet(uint256 feeBps)",
  "event DefaultLiquidationFeeSet(uint256 feeBps)",
  "event MarketFeesSet(uint256 indexed marketId, uint256 originationFeeBps, uint256 liquidationFeeBps)",
  "event OriginationFeeCollected(uint256 indexed marketId, address indexed borrower, uint256 fee)",
  "event LiquidationFeeCollected(uint256 indexed marketId, uint256 fee)",
];

export const PRICEHUB_ABI = [
  "function seedPrice(uint256 positionId, uint256 probability) external",
  "function setDefaultAdapter(address adapter) external",
  "function setAdapter(uint256 positionId, address adapter) external",
  "function setStaleness(uint256 s) external",
  "function spawnOracle(uint256 positionId, uint256 resolutionAt, uint256 decayDuration, uint256 decayCooldown, uint8 loanDecimals, uint8 collateralDecimals) external returns (address)",
  "function prices(uint256 positionId) external view returns (uint256 price, uint256 updatedAt)",
  "function oracles(uint256 positionId) external view returns (address)",
  "function configs(uint256 positionId) external view returns (uint256 positionId, uint256 resolutionAt, uint256 decayDuration, uint256 decayCooldown, uint8 loanDecimals, uint8 collateralDecimals)",
  "function decayFactor(uint256 positionId) external view returns (uint256)",
  "function maxStaleness() external view returns (uint256)",
  "function owner() external view returns (address)",
  "function defaultAdapter() external view returns (address)",
];

export const MORPHO_ABI = [
  "function position(bytes32 id, address user) external view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32 id) external view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function setAuthorization(address authorized, bool authorizedStatus) external",
  "function isAuthorized(address authorizer, address authorized) external view returns (bool)",
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
  "function totalSupply() external view returns (uint256)",
];

export const CTF_ABI = [
  "function balanceOf(address account, uint256 id) external view returns (uint256)",
  "function setApprovalForAll(address operator, bool approved) external",
  "function isApprovedForAll(address account, address operator) external view returns (bool)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data) external",
];

export const WRAPPER_FACTORY_ABI = [
  "function getWrapper(uint256 positionId) external view returns (address)",
  "function predictAddress(address ctf, uint256 positionId) external view returns (address)",
  "function create(address ctf, uint256 positionId, uint8 decimals) external returns (address)",
  "function implementation() external view returns (address)",
];
