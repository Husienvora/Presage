// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ICTF} from "./interfaces/ICTF.sol";

/// @title SafeBatchHelper
/// @notice Utility to encode Safe-compatible multiSend payloads for common Presage workflows.
///         Does NOT hold funds or execute transactions — purely a calldata encoder.
///         The encoded payload is passed to Safe's multiSend for atomic execution.
contract SafeBatchHelper {
    address public immutable presage;
    address public immutable morpho;

    constructor(address presage_, address morpho_) {
        presage = presage_;
        morpho = morpho_;
    }

    /// @notice Encode the full borrow flow: deposit collateral + borrow stablecoins.
    /// @return encoded The multiSend-compatible encoded operations.
    function encodeBorrow(
        uint256 marketId,
        address ctf,
        uint256 collateralAmount,
        uint256 borrowAmount
    ) external view returns (bytes memory encoded) {
        bytes[] memory calls = new bytes[](4);

        // 1. Approve Presage to pull CTF ERC1155
        calls[0] = _encodeTx(
            ctf,
            abi.encodeWithSignature("setApprovalForAll(address,bool)", presage, true)
        );

        // 2. Authorize Presage on Morpho Blue (Required for router to manage Safe's position)
        calls[1] = _encodeTx(
            morpho,
            abi.encodeWithSignature("setAuthorization(address,bool)", presage, true)
        );

        // 3. Deposit collateral via Presage
        calls[2] = _encodeTx(
            presage,
            abi.encodeWithSignature("depositCollateral(uint256,uint256)", marketId, collateralAmount)
        );

        // 4. Borrow
        calls[3] = _encodeTx(
            presage,
            abi.encodeWithSignature("borrow(uint256,uint256)", marketId, borrowAmount)
        );

        encoded = _packMultiSend(calls);
    }

    /// @notice Encode full repay + release collateral flow.
    function encodeRepayAndRelease(
        uint256 marketId,
        address loanToken,
        uint256 repayAmount,
        uint256 releaseAmount
    ) external view returns (bytes memory encoded) {
        bytes[] memory calls = new bytes[](3);

        // 1. Approve Presage to pull loan tokens
        calls[0] = _encodeTx(
            loanToken,
            abi.encodeWithSignature("approve(address,uint256)", presage, repayAmount)
        );

        // 2. Repay
        calls[1] = _encodeTx(
            presage,
            abi.encodeWithSignature("repay(uint256,uint256)", marketId, repayAmount)
        );

        // 3. Release collateral
        calls[2] = _encodeTx(
            presage,
            abi.encodeWithSignature("releaseCollateral(uint256,uint256)", marketId, releaseAmount)
        );

        encoded = _packMultiSend(calls);
    }

    /// @notice Encode full supply flow: approve loan token + supply to market.
    function encodeSupply(
        uint256 marketId,
        address loanToken,
        uint256 amount
    ) external view returns (bytes memory encoded) {
        bytes[] memory calls = new bytes[](2);

        // 1. Approve Presage to pull loan tokens
        calls[0] = _encodeTx(
            loanToken,
            abi.encodeWithSignature("approve(address,uint256)", presage, amount)
        );

        // 2. Supply
        calls[1] = _encodeTx(
            presage,
            abi.encodeWithSignature("supply(uint256,uint256)", marketId, amount)
        );

        encoded = _packMultiSend(calls);
    }

    /// @notice Encode withdraw flow.
    function encodeWithdraw(
        uint256 marketId,
        uint256 amount
    ) external view returns (bytes memory encoded) {
        bytes[] memory calls = new bytes[](1);

        // 1. Withdraw
        calls[0] = _encodeTx(
            presage,
            abi.encodeWithSignature("withdraw(uint256,uint256)", marketId, amount)
        );

        encoded = _packMultiSend(calls);
    }

    // ──────── MultiSend Encoding ────────

    /// @dev Encode a single CALL transaction for Safe multiSend format.
    ///      Format: operation (uint8) + to (address) + value (uint256) + dataLength (uint256) + data
    function _encodeTx(address to, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodePacked(
            uint8(0),        // operation = CALL
            to,
            uint256(0),      // value = 0
            uint256(data.length),
            data
        );
    }

    /// @dev Pack multiple encoded transactions into Safe multiSend format.
    function _packMultiSend(bytes[] memory txs) internal pure returns (bytes memory packed) {
        for (uint256 i; i < txs.length; i++) {
            packed = abi.encodePacked(packed, txs[i]);
        }
    }
}
