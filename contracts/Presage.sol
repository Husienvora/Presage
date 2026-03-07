// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IMorpho} from "./vendor/morpho/IMorpho.sol";
import {MarketParams, Market, Position, Id} from "./vendor/morpho/Types.sol";
import {IOracle} from "./vendor/morpho/IOracle.sol";
import {MarketParamsLib, SharesMathLib, MathLib, UtilsLib, WAD, ORACLE_PRICE_SCALE, MAX_LIQUIDATION_INCENTIVE_FACTOR, LIQUIDATION_CURSOR} from "./vendor/morpho/Libraries.sol";

import {ICTF} from "./interfaces/ICTF.sol";
import {WrappedCTF, IFlashUnwrapCallback} from "./WrappedCTF.sol";
import {WrapperFactory} from "./WrapperFactory.sol";
import {PriceHub} from "./PriceHub.sol";

/// @title Presage
/// @notice Orchestrates CTF-collateralized lending on Morpho Blue.
contract Presage is ERC1155Holder, IFlashUnwrapCallback, Ownable {
    using SafeERC20 for IERC20;
    using SafeERC20 for WrappedCTF;
    using MarketParamsLib for MarketParams;
    using SharesMathLib for uint256;
    using SharesMathLib for uint128;
    using MathLib for uint256;

    // ──────── Immutables ────────

    IMorpho public immutable morpho;
    WrapperFactory public immutable factory;
    PriceHub public immutable priceHub;
    address public immutable irm;

    // ──────── Types ────────

    struct CTFPosition {
        ICTF ctf;
        bytes32 parentCollectionId;
        bytes32 conditionId;
        uint256 positionId;
        uint256 oppositePositionId;
    }

    struct LendingMarket {
        MarketParams morphoParams;
        CTFPosition ctfPosition;
        uint256 resolutionAt;
    }

    // ──────── State ────────

    uint256 public nextMarketId = 1;
    mapping(uint256 => LendingMarket) internal _markets;

    // ──────── Events ────────

    event MarketOpened(uint256 indexed marketId, address indexed loanToken, address indexed wrapper, uint256 positionId, uint256 resolutionAt);
    event Supplied(uint256 indexed marketId, address indexed lender, uint256 amount);
    event Withdrawn(uint256 indexed marketId, address indexed lender, uint256 amount);
    event CollateralDeposited(uint256 indexed marketId, address indexed borrower, uint256 amount);
    event CollateralReleased(uint256 indexed marketId, address indexed borrower, uint256 amount);
    event LoanTaken(uint256 indexed marketId, address indexed borrower, uint256 amount);
    event LoanRepaid(uint256 indexed marketId, address indexed borrower, uint256 amount);
    event SettledWithLoanToken(uint256 indexed marketId, address indexed borrower, address liquidator, uint256 repaid, uint256 seized);
    event SettledWithMerge(uint256 indexed marketId, address indexed borrower, address liquidator, uint256 merged, uint256 profit);

    constructor(IMorpho morpho_, WrapperFactory factory_, PriceHub priceHub_, address irm_) Ownable(msg.sender) {
        morpho = morpho_;
        factory = factory_;
        priceHub = priceHub_;
        irm = irm_;
    }

    // ═══════════════ MARKET CREATION ═══════════════

    function openMarket(
        CTFPosition calldata ctfPos,
        address loanToken,
        uint256 lltv,
        uint256 resolutionAt,
        uint256 decayDuration,
        uint256 decayCooldown
    ) external onlyOwner returns (uint256 marketId) {
        uint8 loanDec = IERC20Metadata(loanToken).decimals();

        address wrapper = factory.getWrapper(ctfPos.positionId);
        if (wrapper == address(0)) {
            wrapper = factory.create(ctfPos.ctf, ctfPos.positionId, loanDec);
        }

        address oracle = priceHub.oracles(ctfPos.positionId);
        if (oracle == address(0)) {
            oracle = priceHub.spawnOracle(ctfPos.positionId, resolutionAt, decayDuration, decayCooldown, loanDec, loanDec);
        }

        MarketParams memory mp = MarketParams({
            loanToken: loanToken,
            collateralToken: wrapper,
            oracle: oracle,
            irm: irm,
            lltv: lltv
        });

        morpho.createMarket(mp);

        marketId = nextMarketId++;
        _markets[marketId] = LendingMarket({ morphoParams: mp, ctfPosition: ctfPos, resolutionAt: resolutionAt });

        emit MarketOpened(marketId, loanToken, wrapper, ctfPos.positionId, resolutionAt);
    }

    // ═══════════════ SUPPLY / WITHDRAW ═══════════════

    function supply(uint256 marketId, uint256 amount) external {
        MarketParams memory mp = _markets[marketId].morphoParams;
        IERC20 loan = IERC20(mp.loanToken);
        loan.safeTransferFrom(msg.sender, address(this), amount);
        loan.forceApprove(address(morpho), amount);
        morpho.supply(mp, amount, 0, msg.sender, "");
        loan.forceApprove(address(morpho), 0);
        emit Supplied(marketId, msg.sender, amount);
    }

    function withdraw(uint256 marketId, uint256 amount) external {
        morpho.withdraw(_markets[marketId].morphoParams, amount, 0, msg.sender, msg.sender);
        emit Withdrawn(marketId, msg.sender, amount);
    }

    // ═══════════════ COLLATERAL ═══════════════

    function depositCollateral(uint256 marketId, uint256 amount) external {
        LendingMarket memory m = _markets[marketId];
        WrappedCTF wrapper = WrappedCTF(m.morphoParams.collateralToken);

        m.ctfPosition.ctf.safeTransferFrom(msg.sender, address(this), m.ctfPosition.positionId, amount, "");
        m.ctfPosition.ctf.setApprovalForAll(address(wrapper), true);
        wrapper.wrap(amount);
        m.ctfPosition.ctf.setApprovalForAll(address(wrapper), false);
        wrapper.forceApprove(address(morpho), amount);
        morpho.supplyCollateral(m.morphoParams, amount, msg.sender, "");
        wrapper.forceApprove(address(morpho), 0);

        emit CollateralDeposited(marketId, msg.sender, amount);
    }

    function releaseCollateral(uint256 marketId, uint256 amount) external {
        LendingMarket memory m = _markets[marketId];
        WrappedCTF wrapper = WrappedCTF(m.morphoParams.collateralToken);

        morpho.withdrawCollateral(m.morphoParams, amount, msg.sender, address(this));
        wrapper.unwrap(amount);
        m.ctfPosition.ctf.safeTransferFrom(address(this), msg.sender, m.ctfPosition.positionId, amount, "");

        emit CollateralReleased(marketId, msg.sender, amount);
    }

    // ═══════════════ BORROW / REPAY ═══════════════

    function borrow(uint256 marketId, uint256 amount) external {
        morpho.borrow(_markets[marketId].morphoParams, amount, 0, msg.sender, msg.sender);
        emit LoanTaken(marketId, msg.sender, amount);
    }

    function repay(uint256 marketId, uint256 amount) external {
        MarketParams memory mp = _markets[marketId].morphoParams;
        IERC20 loan = IERC20(mp.loanToken);
        Id mid = mp.id();

        (uint256 supplyShares_, uint128 borrowShares_, ) = morpho.position(mid, msg.sender);
        (uint128 totalSupplyAssets_, , uint128 totalBorrowAssets_, uint128 totalBorrowShares_, , ) = morpho.market(mid);

        uint256 owed = uint256(borrowShares_).toAssetsUp(totalBorrowAssets_, totalBorrowShares_);

        uint256 assets;
        uint256 shares;

        if (amount >= owed) {
            shares = borrowShares_;
            assets = 0; // Morpho: if shares > 0, assets can be 0 to repay full share amount
            loan.safeTransferFrom(msg.sender, address(this), owed);
            loan.forceApprove(address(morpho), owed);
        } else {
            assets = amount;
            shares = 0;
            loan.safeTransferFrom(msg.sender, address(this), amount);
            loan.forceApprove(address(morpho), amount);
        }

        morpho.repay(mp, assets, shares, msg.sender, "");
        loan.forceApprove(address(morpho), 0);
        emit LoanRepaid(marketId, msg.sender, amount);
    }

    // ═══════════════ LIQUIDATION ═══════════════

    function settleWithLoanToken(uint256 marketId, address borrower, uint256 repayAmount) external {
        LendingMarket memory m = _markets[marketId];
        WrappedCTF wrapper = WrappedCTF(m.morphoParams.collateralToken);
        IERC20 loan = IERC20(m.morphoParams.loanToken);

        (,,uint128 totalBorrowAssets, uint128 totalBorrowShares,,) = morpho.market(m.morphoParams.id());
        uint256 repayShares = repayAmount.toSharesDown(totalBorrowAssets, totalBorrowShares);

        loan.safeTransferFrom(msg.sender, address(this), repayAmount);
        loan.forceApprove(address(morpho), repayAmount);
        (uint256 seized, ) = morpho.liquidate(m.morphoParams, borrower, 0, repayShares, "");
        loan.forceApprove(address(morpho), 0);

        wrapper.unwrap(seized);
        m.ctfPosition.ctf.safeTransferFrom(address(this), msg.sender, m.ctfPosition.positionId, seized, "");

        emit SettledWithLoanToken(marketId, borrower, msg.sender, repayAmount, seized);
    }

    function settleWithMerge(uint256 marketId, address borrower, uint256 seizeAmount) external {
        LendingMarket memory m = _markets[marketId];
        WrappedCTF wrapper = WrappedCTF(m.morphoParams.collateralToken);

        m.ctfPosition.ctf.safeTransferFrom(msg.sender, address(this), m.ctfPosition.oppositePositionId, seizeAmount, "");

        bytes memory cbData = abi.encode(marketId, borrower, msg.sender);
        wrapper.flashUnwrap(seizeAmount, address(this), address(this), cbData);
    }

    function onFlashUnwrap(address, uint256 amount, bytes calldata data) external override {
        (uint256 marketId, address borrower, address liquidator) = abi.decode(data, (uint256, address, address));

        LendingMarket memory m = _markets[marketId];
        require(msg.sender == m.morphoParams.collateralToken, "bad caller");

        IERC20 loan = IERC20(m.morphoParams.loanToken);

        {
            uint256[] memory partition = new uint256[](2);
            partition[0] = 1;
            partition[1] = 2;
            m.ctfPosition.ctf.mergePositions(loan, m.ctfPosition.parentCollectionId, m.ctfPosition.conditionId, partition, amount);
        }

        uint256 repayAmount = _quoteRepay(m, amount);
        loan.forceApprove(address(morpho), repayAmount);
        (uint256 seized, ) = morpho.liquidate(m.morphoParams, borrower, amount, 0, "");
        loan.forceApprove(address(morpho), 0);
        require(seized == amount, "seize mismatch");

        uint256 profit = amount - repayAmount;
        loan.safeTransfer(liquidator, profit);

        emit SettledWithMerge(marketId, borrower, liquidator, amount, profit);
    }

    // ═══════════════ VIEW ═══════════════

    function getMarket(uint256 marketId) external view returns (
        MarketParams memory morphoParams,
        CTFPosition memory ctfPosition,
        uint256 resolutionAt
    ) {
        LendingMarket memory m = _markets[marketId];
        return (m.morphoParams, m.ctfPosition, m.resolutionAt);
    }

    function healthFactor(uint256 marketId, address borrower) external view returns (uint256) {
        MarketParams memory mp = _markets[marketId].morphoParams;
        Id mid = mp.id();

        (,,uint128 totalBorrowAssets, uint128 totalBorrowShares,,) = morpho.market(mid);
        (, uint128 borrowShares, uint128 collateral) = morpho.position(mid, borrower);

        if (borrowShares == 0) return type(uint256).max;

        uint256 borrowed = (uint256(borrowShares) * totalBorrowAssets) / totalBorrowShares;
        if (borrowed == 0) return type(uint256).max;

        uint256 collateralValue = (uint256(collateral) * IOracle(mp.oracle).price()) / ORACLE_PRICE_SCALE;
        return (collateralValue * mp.lltv) / borrowed;
    }

    function triggerAccrual(uint256 marketId) external {
        morpho.accrueInterest(_markets[marketId].morphoParams);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    // ──────── Internal ────────

    function _quoteRepay(LendingMarket memory m, uint256 seizeAmount) internal view returns (uint256) {
        (,,uint128 totalBorrowAssets, uint128 totalBorrowShares,,) = morpho.market(m.morphoParams.id());
        uint256 oraclePrice = IOracle(m.morphoParams.oracle).price();
        uint256 seizedQuoted = seizeAmount.mulDivUp(oraclePrice, ORACLE_PRICE_SCALE);
        uint256 lif = UtilsLib.min(MAX_LIQUIDATION_INCENTIVE_FACTOR, WAD.wDivDown(WAD - LIQUIDATION_CURSOR.wMulDown(WAD - m.morphoParams.lltv)));
        uint256 repayShares = seizedQuoted.wDivUp(lif).toSharesUp(totalBorrowAssets, totalBorrowShares);
        return repayShares.toAssetsUp(totalBorrowAssets, totalBorrowShares);
    }
}
