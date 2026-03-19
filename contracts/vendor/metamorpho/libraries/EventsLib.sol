// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {Id} from "../morpho-blue/interfaces/IMorpho.sol";

import {PendingAddress} from "./PendingLib.sol";

/// @title EventsLib
/// @author Morpho Labs
library EventsLib {
    event SubmitTimelock(uint256 newTimelock);
    event SetTimelock(address indexed caller, uint256 newTimelock);
    event SetSkimRecipient(address indexed newSkimRecipient);
    event SetFee(address indexed caller, uint256 newFee);
    event SetFeeRecipient(address indexed newFeeRecipient);
    event SubmitGuardian(address indexed newGuardian);
    event SetGuardian(address indexed caller, address indexed guardian);
    event SubmitCap(address indexed caller, Id indexed id, uint256 cap);
    event SetCap(address indexed caller, Id indexed id, uint256 cap);
    event UpdateLastTotalAssets(uint256 updatedTotalAssets);
    event SubmitMarketRemoval(address indexed caller, Id indexed id);
    event SetCurator(address indexed newCurator);
    event SetIsAllocator(address indexed allocator, bool isAllocator);
    event RevokePendingTimelock(address indexed caller);
    event RevokePendingCap(address indexed caller, Id indexed id);
    event RevokePendingGuardian(address indexed caller);
    event RevokePendingMarketRemoval(address indexed caller, Id indexed id);
    event SetSupplyQueue(address indexed caller, Id[] newSupplyQueue);
    event SetWithdrawQueue(address indexed caller, Id[] newWithdrawQueue);
    event ReallocateSupply(address indexed caller, Id indexed id, uint256 suppliedAssets, uint256 suppliedShares);
    event ReallocateWithdraw(address indexed caller, Id indexed id, uint256 withdrawnAssets, uint256 withdrawnShares);
    event AccrueInterest(uint256 newTotalAssets, uint256 feeShares);
    event Skim(address indexed caller, address indexed token, uint256 amount);
    event CreateMetaMorpho(
        address indexed metaMorpho,
        address indexed caller,
        address initialOwner,
        uint256 initialTimelock,
        address indexed asset,
        string name,
        string symbol,
        bytes32 salt
    );
}
