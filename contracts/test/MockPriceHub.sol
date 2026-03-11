// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Mock PriceHub that just records calls for testing.
contract MockPriceHub {
    struct Recorded {
        uint256 positionId;
        uint256 probability;
        uint256 timestamp;
    }

    Recorded public lastRecorded;
    uint256 public recordCount;

    function recordPrice(uint256 positionId, uint256 probability, uint256 timestamp) external {
        lastRecorded = Recorded(positionId, probability, timestamp);
        recordCount++;
    }
}
