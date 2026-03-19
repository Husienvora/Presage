import { expect } from "chai";
import { parseEther, MaxUint256, keccak256, toUtf8Bytes, ZeroAddress } from "ethers";

// Set required env vars before importing strategy (config.ts needs them)
process.env.RPC_URL = process.env.RPC_URL || "http://localhost:8545";
process.env.PRIVATE_KEY = process.env.PRIVATE_KEY || "0x" + "ab".repeat(32);
process.env.VAULT_ADDRESS = process.env.VAULT_ADDRESS || ZeroAddress;
process.env.PRESAGE_ADDRESS = process.env.PRESAGE_ADDRESS || ZeroAddress;
process.env.PRICE_HUB_ADDRESS = process.env.PRICE_HUB_ADDRESS || ZeroAddress;

import {
  MarketState,
  AllocationTarget,
  computeTargets,
  buildReallocatePayload,
  shouldReallocate,
} from "../allocator/src/strategy";

const WAD = 10n ** 18n;

function makeMarket(overrides: Partial<MarketState> & { tag?: string } = {}): MarketState {
  const { tag, ...rest } = overrides;
  return {
    morphoMarketId: keccak256(toUtf8Bytes(tag || "default")),
    marketParams: {
      loanToken: ZeroAddress,
      collateralToken: "0x0000000000000000000000000000000000000001",
      oracle: "0x0000000000000000000000000000000000000002",
      irm: "0x0000000000000000000000000000000000000003",
      lltv: WAD * 77n / 100n,
    },
    totalSupplyAssets: parseEther("1000"),
    totalBorrowAssets: parseEther("500"),
    vaultSupplyAssets: parseEther("800"),
    vaultSupplyShares: parseEther("800"),
    cap: parseEther("10000"),
    enabled: true,
    hoursToDecayOnset: 720,
    ...rest,
  };
}

describe("Allocator Strategy — computeTargets", function () {

  it("should return empty array for empty market list", function () {
    const targets = computeTargets([], parseEther("10000"));
    expect(targets).to.deep.equal([]);
  });

  it("should allocate proportionally to utilization", function () {
    const m1 = makeMarket({
      tag: "m1",
      totalSupplyAssets: parseEther("1000"),
      totalBorrowAssets: parseEther("800"),  // 80% utilization
    });
    const m2 = makeMarket({
      tag: "m2",
      totalSupplyAssets: parseEther("1000"),
      totalBorrowAssets: parseEther("200"),  // 20% utilization
    });

    const totalVault = parseEther("10000");
    const targets = computeTargets([m1, m2], totalVault);

    expect(targets.length).to.equal(2);

    // Higher utilization market gets more allocation
    expect(targets[0].targetSupply).to.be.gt(targets[1].targetSupply);

    // Both should be > 0
    expect(targets[0].targetSupply).to.be.gt(0n);
    expect(targets[1].targetSupply).to.be.gt(0n);

    // Total should approximately equal deployable (95% of total)
    const totalTarget = targets[0].targetSupply + targets[1].targetSupply;
    const deployable = totalVault * 95n / 100n;
    expect(totalTarget).to.be.gte(deployable - parseEther("1"));
    expect(totalTarget).to.be.lte(deployable + parseEther("1"));
  });

  it("should set target=0 for markets with cap=0 (force withdrawal)", function () {
    const m1 = makeMarket({ tag: "active", cap: parseEther("10000") });
    const m2 = makeMarket({ tag: "removed", cap: 0n, vaultSupplyAssets: parseEther("500") });

    const targets = computeTargets([m1, m2], parseEther("5000"));

    const removedTarget = targets.find(t => t.targetSupply === 0n && t.currentSupply === parseEther("500"));
    expect(removedTarget).to.not.be.undefined;
  });

  it("should set target=0 for markets approaching decay", function () {
    const m1 = makeMarket({ tag: "safe", hoursToDecayOnset: 720 });
    const m2 = makeMarket({
      tag: "decaying",
      hoursToDecayOnset: 24,  // < 48h default pullback threshold
      vaultSupplyAssets: parseEther("1000"),
    });

    const targets = computeTargets([m1, m2], parseEther("5000"));

    const decayingTarget = targets.find(t => t.currentSupply === parseEther("1000"));
    expect(decayingTarget).to.not.be.undefined;
    expect(decayingTarget!.targetSupply).to.equal(0n);
  });

  it("should skip disabled markets entirely", function () {
    const m1 = makeMarket({ tag: "enabled" });
    const m2 = makeMarket({ tag: "disabled", enabled: false });

    const targets = computeTargets([m1, m2], parseEther("5000"));
    expect(targets.length).to.equal(1);
  });

  it("should cap allocation at market cap", function () {
    const smallCap = parseEther("100");
    const m1 = makeMarket({
      tag: "capped",
      cap: smallCap,
      totalBorrowAssets: parseEther("900"),
    });

    const targets = computeTargets([m1], parseEther("10000"));
    expect(targets[0].targetSupply).to.equal(smallCap);
  });

  it("should respect idle buffer percentage", function () {
    const m1 = makeMarket({ tag: "single" });
    const totalVault = parseEther("10000");
    const targets = computeTargets([m1], totalVault);

    const deployable = totalVault * 95n / 100n;
    expect(targets[0].targetSupply).to.be.lte(deployable);
  });

  it("should give idle markets a minimum allocation", function () {
    const m1 = makeMarket({
      tag: "busy",
      totalBorrowAssets: parseEther("800"),
    });
    const m2 = makeMarket({
      tag: "idle",
      totalBorrowAssets: 0n,
    });

    const targets = computeTargets([m1, m2], parseEther("10000"));
    expect(targets[1].targetSupply).to.be.gt(0n);
  });

  it("should handle zero total vault assets", function () {
    const m1 = makeMarket({ tag: "m1" });
    const targets = computeTargets([m1], 0n);
    expect(targets[0].targetSupply).to.equal(0n);
  });

  it("should handle very large TVL without precision loss (BigInt safety)", function () {
    // 1 billion USDT = 1e27 in wei, well beyond Number.MAX_SAFE_INTEGER (9e15)
    // Use unconstrained caps so we can verify total allocation sums correctly
    const billion = parseEther("1000000000");
    const hugeCap = billion * 100n; // Cap won't constrain

    const m1 = makeMarket({
      tag: "big1",
      cap: hugeCap,
      totalSupplyAssets: billion,
      totalBorrowAssets: billion / 2n,  // 50% util
    });
    const m2 = makeMarket({
      tag: "big2",
      cap: hugeCap,
      totalSupplyAssets: billion,
      totalBorrowAssets: billion / 2n,  // 50% util (equal so we know exact split)
    });

    const totalVault = billion * 2n;
    const targets = computeTargets([m1, m2], totalVault);

    expect(targets[0].targetSupply).to.be.gt(0n);
    expect(targets[1].targetSupply).to.be.gt(0n);

    // Equal utilization → equal split of deployable
    const deployable = totalVault * 95n / 100n;
    const halfDeployable = deployable / 2n;
    // Each target should be ~half of deployable (allow 1 wei rounding)
    expect(targets[0].targetSupply).to.be.gte(halfDeployable - 1n);
    expect(targets[0].targetSupply).to.be.lte(halfDeployable + 1n);

    // Total should equal deployable exactly (or within 1 wei)
    const totalTarget = targets[0].targetSupply + targets[1].targetSupply;
    expect(totalTarget).to.be.gte(deployable - 1n);
    expect(totalTarget).to.be.lte(deployable + 1n);
  });
});

describe("Allocator Strategy — buildReallocatePayload", function () {

  it("should produce withdrawals before supplies", function () {
    const targets: AllocationTarget[] = [
      {
        morphoMarketId: "w",
        marketParams: makeMarket().marketParams,
        currentSupply: parseEther("1000"),
        targetSupply: parseEther("500"),
      },
      {
        morphoMarketId: "s",
        marketParams: makeMarket().marketParams,
        currentSupply: parseEther("200"),
        targetSupply: parseEther("700"),
      },
    ];

    const payload = buildReallocatePayload(targets);
    expect(payload.length).to.equal(2);
    expect(payload[0].assets).to.equal(parseEther("500"));
    expect(payload[1].assets).to.equal(MaxUint256);
  });

  it("should set last supply entry to MaxUint256", function () {
    const targets: AllocationTarget[] = [
      {
        morphoMarketId: "s1",
        marketParams: makeMarket().marketParams,
        currentSupply: 0n,
        targetSupply: parseEther("500"),
      },
      {
        morphoMarketId: "s2",
        marketParams: makeMarket().marketParams,
        currentSupply: 0n,
        targetSupply: parseEther("300"),
      },
    ];

    const payload = buildReallocatePayload(targets);
    expect(payload.length).to.equal(2);
    expect(payload[payload.length - 1].assets).to.equal(MaxUint256);
    expect(payload[0].assets).to.equal(parseEther("500"));
  });

  it("should produce empty payload when no changes needed", function () {
    const targets: AllocationTarget[] = [
      {
        morphoMarketId: "same",
        marketParams: makeMarket().marketParams,
        currentSupply: parseEther("500"),
        targetSupply: parseEther("500"),
      },
    ];

    const payload = buildReallocatePayload(targets);
    expect(payload.length).to.equal(0);
  });

  it("should handle full withdrawal (target=0)", function () {
    const targets: AllocationTarget[] = [
      {
        morphoMarketId: "drain",
        marketParams: makeMarket().marketParams,
        currentSupply: parseEther("1000"),
        targetSupply: 0n,
      },
      {
        morphoMarketId: "receive",
        marketParams: makeMarket().marketParams,
        currentSupply: 0n,
        targetSupply: parseEther("1000"),
      },
    ];

    const payload = buildReallocatePayload(targets);
    expect(payload.length).to.equal(2);
    expect(payload[0].assets).to.equal(0n);
    expect(payload[1].assets).to.equal(MaxUint256);
  });
});

describe("Allocator Strategy — shouldReallocate", function () {

  it("should return false when delta is below threshold", function () {
    const targets: AllocationTarget[] = [
      {
        morphoMarketId: "tiny",
        marketParams: makeMarket().marketParams,
        currentSupply: parseEther("1000"),
        targetSupply: parseEther("1005"),
      },
    ];
    expect(shouldReallocate(targets)).to.be.false;
  });

  it("should return true when delta exceeds threshold", function () {
    const targets: AllocationTarget[] = [
      {
        morphoMarketId: "big",
        marketParams: makeMarket().marketParams,
        currentSupply: parseEther("1000"),
        targetSupply: parseEther("1050"),
      },
    ];
    expect(shouldReallocate(targets)).to.be.true;
  });

  it("should sum deltas across all markets", function () {
    const targets: AllocationTarget[] = [
      {
        morphoMarketId: "m1",
        marketParams: makeMarket().marketParams,
        currentSupply: parseEther("1000"),
        targetSupply: parseEther("1004"),
      },
      {
        morphoMarketId: "m2",
        marketParams: makeMarket().marketParams,
        currentSupply: parseEther("1000"),
        targetSupply: parseEther("994"),
      },
    ];
    // Total delta = 4 + 6 = 10 (at threshold)
    expect(shouldReallocate(targets)).to.be.true;
  });

  it("should handle empty targets", function () {
    expect(shouldReallocate([])).to.be.false;
  });
});

describe("Allocator Strategy — edge cases", function () {

  it("should handle all markets decaying simultaneously", function () {
    const m1 = makeMarket({ tag: "d1", hoursToDecayOnset: 10 });
    const m2 = makeMarket({ tag: "d2", hoursToDecayOnset: 5 });

    const targets = computeTargets([m1, m2], parseEther("5000"));
    for (const t of targets) {
      expect(t.targetSupply).to.equal(0n);
    }
  });

  it("should handle mixed cap=0 and decaying markets", function () {
    const active = makeMarket({ tag: "active", hoursToDecayOnset: 720 });
    const capped = makeMarket({ tag: "capped", cap: 0n, vaultSupplyAssets: parseEther("500") });
    const decaying = makeMarket({ tag: "decaying", hoursToDecayOnset: 1 });

    const targets = computeTargets([active, capped, decaying], parseEther("5000"));

    expect(targets.length).to.equal(3);
    expect(targets[0].targetSupply).to.be.gt(0n);
    expect(targets[1].targetSupply).to.equal(0n);
    expect(targets[2].targetSupply).to.equal(0n);
  });

  it("cap=0 market generates withdrawal in reallocate payload", function () {
    const m1 = makeMarket({ tag: "drain-me", cap: 0n, vaultSupplyAssets: parseEther("500") });
    const m2 = makeMarket({ tag: "receive", cap: parseEther("10000"), hoursToDecayOnset: 720 });

    const targets = computeTargets([m1, m2], parseEther("5000"));

    const drainTarget = targets.find(t => t.currentSupply === parseEther("500"))!;
    expect(drainTarget).to.not.be.undefined;
    expect(drainTarget.targetSupply).to.equal(0n);

    const payload = buildReallocatePayload(targets);
    expect(payload.length).to.be.gt(0);
    expect(shouldReallocate(targets)).to.be.true;
  });

  it("single market gets 95% of vault (idle buffer)", function () {
    const m1 = makeMarket({ tag: "solo" });
    const totalVault = parseEther("1000");
    const targets = computeTargets([m1], totalVault);

    expect(targets.length).to.equal(1);
    expect(targets[0].targetSupply).to.equal(totalVault * 95n / 100n);
  });
});
