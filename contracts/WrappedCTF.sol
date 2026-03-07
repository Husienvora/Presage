// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {ICTF} from "./interfaces/ICTF.sol";

/// @title WrappedCTF
/// @notice Permissionless 1:1 ERC20 wrapper around a specific CTF ERC1155 position.
///         Anyone can wrap/unwrap. No admin, no owner, fully immutable.
///         Deployed via WrapperFactory as EIP-1167 clones.
/// @dev    Invariant: totalSupply() == CTF.balanceOf(address(this), POSITION_ID) always.
contract WrappedCTF is ERC20, ERC1155Holder {
    ICTF public ctf;
    uint256 public positionId;
    uint8 internal _dec;
    bool internal _initialized;

    constructor() ERC20("Presage wCTF", "pwCTF") {}

    /// @notice One-time initializer (called by factory after clone deploy).
    function initialize(ICTF ctf_, uint256 positionId_, uint8 decimals_) external {
        require(!_initialized, "already init");
        _initialized = true;
        ctf = ctf_;
        positionId = positionId_;
        _dec = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    /// @notice Lock ERC1155 CTF tokens and mint equivalent ERC20 tokens.
    function wrap(uint256 amount) external {
        ctf.safeTransferFrom(msg.sender, address(this), positionId, amount, "");
        _mint(msg.sender, amount);
    }

    /// @notice Burn ERC20 tokens and return the underlying ERC1155 CTF tokens.
    function unwrap(uint256 amount) external {
        _burn(msg.sender, amount);
        ctf.safeTransferFrom(address(this), msg.sender, positionId, amount, "");
    }

    /// @notice Flash-unwrap: burn wCTF, transfer CTF out, then call back for atomic operations.
    function flashUnwrap(uint256 amount, address receiver, address callback, bytes calldata data) external {
        _burn(msg.sender, amount);
        ctf.safeTransferFrom(address(this), receiver, positionId, amount, "");
        if (callback != address(0)) {
            IFlashUnwrapCallback(callback).onFlashUnwrap(msg.sender, amount, data);
        }
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}

interface IFlashUnwrapCallback {
    function onFlashUnwrap(address initiator, uint256 amount, bytes calldata data) external;
}
