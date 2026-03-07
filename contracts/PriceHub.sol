// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IOracle} from "./vendor/morpho/IOracle.sol";
import {IPriceAdapter} from "./interfaces/IPriceAdapter.sol";

/// @title PriceHub
/// @notice Central price registry. Spawns Morpho-compatible oracle stubs. Supports
///         pluggable price adapters and time-based LLTV decay.
contract PriceHub is Ownable {

    struct MarketConfig {
        uint256 positionId;
        uint256 resolutionAt;
        uint256 decayDuration;
        uint256 decayCooldown;
        uint8 loanDecimals;
        uint8 collateralDecimals;
    }

    struct PricePoint {
        uint256 price;     // 18-decimal probability (0..1e18)
        uint256 updatedAt;
    }

    IPriceAdapter public defaultAdapter;
    mapping(uint256 => IPriceAdapter) public adapters;
    mapping(uint256 => PricePoint) public prices;
    uint256 public maxStaleness;
    mapping(uint256 => address) public oracles;
    mapping(uint256 => MarketConfig) public configs;

    event PriceUpdated(uint256 indexed positionId, uint256 price, uint256 timestamp);
    event OracleSpawned(uint256 indexed positionId, address oracle);
    event AdapterSet(uint256 indexed positionId, address adapter);

    constructor(uint256 maxStaleness_) Ownable(msg.sender) {
        maxStaleness = maxStaleness_;
    }

    // ──────── Admin ────────

    function setDefaultAdapter(IPriceAdapter adapter) external onlyOwner {
        defaultAdapter = adapter;
    }

    function setAdapter(uint256 positionId, IPriceAdapter adapter) external onlyOwner {
        adapters[positionId] = adapter;
        emit AdapterSet(positionId, address(adapter));
    }

    function setStaleness(uint256 s) external onlyOwner {
        maxStaleness = s;
    }

    // ──────── Oracle Spawning ────────

    function spawnOracle(
        uint256 positionId,
        uint256 resolutionAt,
        uint256 decayDuration,
        uint256 decayCooldown,
        uint8 loanDecimals,
        uint8 collateralDecimals
    ) external returns (address oracle) {
        require(oracles[positionId] == address(0), "oracle exists");

        configs[positionId] = MarketConfig({
            positionId: positionId,
            resolutionAt: resolutionAt,
            decayDuration: decayDuration,
            decayCooldown: decayCooldown,
            loanDecimals: loanDecimals,
            collateralDecimals: collateralDecimals
        });

        oracle = address(new MorphoOracleStub(positionId, address(this)));
        oracles[positionId] = oracle;
        emit OracleSpawned(positionId, oracle);
    }

    // ──────── Price Submission ────────

    function submitPrice(uint256 positionId, bytes calldata proof) external {
        IPriceAdapter adapter = _adapterFor(positionId);
        adapter.submitPrice(positionId, proof);
    }

    /// @notice Called by adapters to record a validated price.
    function recordPrice(uint256 positionId, uint256 probability, uint256 timestamp) external {
        require(msg.sender == address(_adapterFor(positionId)), "unauthorized");
        require(probability <= 1e18, "price > 1");
        require(timestamp >= prices[positionId].updatedAt, "stale");
        prices[positionId] = PricePoint(probability, timestamp);
        emit PriceUpdated(positionId, probability, timestamp);
    }

    // ──────── Morpho Price Read ────────

    function morphoPrice(uint256 positionId) external view returns (uint256) {
        PricePoint memory pp = prices[positionId];
        require(block.timestamp - pp.updatedAt <= maxStaleness, "stale price");

        MarketConfig memory cfg = configs[positionId];
        uint256 decay = _decayFactor(cfg);

        // Morpho: price * 10^(36 + loanDec - collateralDec)
        // probability is 18-dec → multiply by 10^(18 + loanDec - collateralDec) to get 36-dec
        uint256 scaledPrice = pp.price * (10 ** (18 + cfg.loanDecimals - cfg.collateralDecimals));
        return (scaledPrice * decay) / 1e18;
    }

    /// @notice Convenience: seed a price directly (for testing / initial setup).
    function seedPrice(uint256 positionId, uint256 probability) external onlyOwner {
        require(probability <= 1e18, "price > 1");
        prices[positionId] = PricePoint(probability, block.timestamp);
        emit PriceUpdated(positionId, probability, block.timestamp);
    }

    // ──────── View ────────

    function decayFactor(uint256 positionId) external view returns (uint256) {
        return _decayFactor(configs[positionId]);
    }

    function _decayFactor(MarketConfig memory cfg) internal view returns (uint256) {
        if (cfg.resolutionAt == 0 || cfg.decayDuration == 0) return 1e18;
        uint256 end = cfg.resolutionAt - cfg.decayCooldown;
        uint256 start = end - cfg.decayDuration;
        if (block.timestamp < start) return 1e18;
        if (block.timestamp >= end) return 0;
        return ((end - block.timestamp) * 1e18) / cfg.decayDuration;
    }

    function _adapterFor(uint256 positionId) internal view returns (IPriceAdapter) {
        IPriceAdapter a = adapters[positionId];
        if (address(a) != address(0)) return a;
        require(address(defaultAdapter) != address(0), "no adapter");
        return defaultAdapter;
    }
}

/// @title MorphoOracleStub
/// @notice Lightweight IOracle that delegates to PriceHub.
contract MorphoOracleStub is IOracle {
    uint256 public immutable positionId;
    PriceHub public immutable hub;

    constructor(uint256 positionId_, address hub_) {
        positionId = positionId_;
        hub = PriceHub(hub_);
    }

    function price() external view override returns (uint256) {
        return hub.morphoPrice(positionId);
    }
}
