// Comprehensive ABIs for playground — covers all contract interactions

export const PRESAGE_ABI = [
  "function openMarket(tuple(address ctf, bytes32 parentCollectionId, bytes32 conditionId, uint256 positionId, uint256 oppositePositionId) ctfPos, address loanToken, uint256 lltv, uint256 resolutionAt, uint256 decayDuration, uint256 decayCooldown) external returns (uint256)",
  "function supply(uint256 marketId, uint256 amount) external",
  "function withdraw(uint256 marketId, uint256 amount) external",
  "function depositCollateral(uint256 marketId, uint256 amount) external",
  "function releaseCollateral(uint256 marketId, uint256 amount) external",
  "function borrow(uint256 marketId, uint256 amount) external",
  "function repay(uint256 marketId, uint256 amount) external",
  "function settleWithLoanToken(uint256 marketId, address borrower, uint256 repayAmount) external",
  "function settleWithMerge(uint256 marketId, address borrower, uint256 seizeAmount) external",
  "function triggerAccrual(uint256 marketId) external",
  "function getMarket(uint256 marketId) external view returns (tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) morphoParams, tuple(address ctf, bytes32 parentCollectionId, bytes32 conditionId, uint256 positionId, uint256 oppositePositionId) ctfPosition, uint256 resolutionAt, uint256 originationFeeBps, uint256 liquidationFeeBps)",
  "function healthFactor(uint256 marketId, address borrower) external view returns (uint256)",
  "function nextMarketId() external view returns (uint256)",
  "function priceHub() external view returns (address)",
  "function treasury() external view returns (address)",
  "function owner() external view returns (address)",
  "function setTreasury(address treasury_) external",
  "function requestLeverage(uint256 marketId, uint256 marginAmount, uint256 supplyCollateralAmount, uint256 borrowAmountMax, uint256 deadline) external",
  "function fillLeverage(address borrower, uint256 marketId) external",
  "function requestDeleverage(uint256 marketId, uint256 repayAmount, uint256 withdrawCollateralAmountMax, uint256 deadline) external",
  "function fillDeleverage(address borrower, uint256 marketId) external",
  "function cancelLeverageRequest(uint256 marketId) external",
  "function cancelDeleverageRequest(uint256 marketId) external",
  "function leverageRequests(address borrower, uint256 marketId) external view returns (uint256 marginAmount, uint256 supplyCollateralAmount, uint256 borrowAmountMax, uint256 deadline, bool filled)",
  "function deleverageRequests(address borrower, uint256 marketId) external view returns (uint256 repayAmount, uint256 withdrawCollateralAmountMax, uint256 deadline, bool filled)",
  "event MarketOpened(uint256 indexed marketId, address loanToken, address collateralToken, address oracle, uint256 lltv)",
];

export const PRICE_HUB_ABI = [
  "function seedPrice(uint256 positionId, uint256 probability) external",
  "function prices(uint256 positionId) external view returns (uint256 price, uint256 updatedAt)",
  "function morphoPrice(uint256 positionId) external view returns (uint256)",
  "function configs(uint256 positionId) external view returns (uint256 positionId, uint256 resolutionAt, uint256 decayDuration, uint256 decayCooldown, uint8 loanDecimals, uint8 collateralDecimals)",
  "function decayFactor(uint256 positionId) external view returns (uint256)",
  "function setDefaultAdapter(address adapter) external",
  "function setStaleness(uint256 s) external",
  "function maxStaleness() external view returns (uint256)",
];

export const MORPHO_ABI = [
  "function position(bytes32 id, address user) external view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32 id) external view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function setAuthorization(address authorized, bool authorizedStatus) external",
  "function isAuthorized(address authorizer, address authorized) external view returns (bool)",
  "function idToMarketParams(bytes32 id) external view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
  "function accrueInterest(tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams) external",
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function transfer(address to, uint256 amount) external returns (bool)",
];

export const CTF_ABI = [
  "function balanceOf(address account, uint256 id) external view returns (uint256)",
  "function setApprovalForAll(address operator, bool approved) external",
  "function isApprovedForAll(address account, address operator) external view returns (bool)",
  "function mint(address to, uint256 id, uint256 amount) external",
];

export const VAULT_ABI = [
  // ERC-4626
  "function deposit(uint256 assets, address receiver) external returns (uint256 shares)",
  "function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares)",
  "function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets)",
  "function totalAssets() external view returns (uint256)",
  "function convertToShares(uint256 assets) external view returns (uint256)",
  "function convertToAssets(uint256 shares) external view returns (uint256)",
  "function maxWithdraw(address owner) external view returns (uint256)",
  "function asset() external view returns (address)",
  // ERC-20
  "function balanceOf(address account) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  // MetaMorpho
  "function MORPHO() external view returns (address)",
  "function curator() external view returns (address)",
  "function isAllocator(address) external view returns (bool)",
  "function fee() external view returns (uint96)",
  "function feeRecipient() external view returns (address)",
  "function timelock() external view returns (uint256)",
  "function owner() external view returns (address)",
  "function supplyQueue(uint256) external view returns (bytes32)",
  "function supplyQueueLength() external view returns (uint256)",
  "function withdrawQueue(uint256) external view returns (bytes32)",
  "function withdrawQueueLength() external view returns (uint256)",
  "function config(bytes32 id) external view returns (uint184 cap, bool enabled, uint64 removableAt)",
  "function pendingCap(bytes32 id) external view returns (uint192 value, uint64 validAt)",
  // Curator ops
  "function submitCap(tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 newSupplyCap) external",
  "function acceptCap(tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams) external",
  // Allocator ops
  "function reallocate(tuple(tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets)[] allocations) external",
  "function setSupplyQueue(bytes32[] newSupplyQueue) external",
  "function updateWithdrawQueue(uint256[] indexes) external",
  // Owner ops
  "function setCurator(address newCurator) external",
  "function setIsAllocator(address newAllocator, bool newIsAllocator) external",
  "function setFee(uint256 newFee) external",
  "function setFeeRecipient(address newFeeRecipient) external",
];

export const VAULT_FACTORY_ABI = [
  "function createMetaMorpho(address initialOwner, uint256 initialTimelock, address asset, string name, string symbol, bytes32 salt) external returns (address)",
  "function isMetaMorpho(address) external view returns (bool)",
  "event CreateMetaMorpho(address indexed metaMorpho, address indexed caller, address initialOwner, uint256 initialTimelock, address indexed asset, string name, string symbol, bytes32 salt)",
];
