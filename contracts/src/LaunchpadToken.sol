// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title LaunchpadToken
/// @notice A token that CANNOT rug, by construction rather than by promise.
///
///         Polymad exists to warn people about contracts with owner backdoors. It
///         would be indefensible to ship a launcher that produces them. So this
///         contract deliberately has no privileged surface at all:
///
///           - no owner, no admin, no roles                → nothing to seize
///           - supply minted once in the constructor       → cannot be inflated
///           - no mint / burnFrom / pause / blacklist      → transfers can't be blocked
///           - no upgradeability, no proxy, no delegatecall → code cannot change
///
///         The entire supply goes to the creator at deploy time. Whatever they do
///         with it afterwards (lock it, LP it, dump it) is visible on-chain and is
///         exactly the kind of thing Polymad's market layer is for pricing.
///
///         What this does NOT protect against, stated plainly so nobody mistakes
///         "no backdoor" for "safe": the creator still holds tokens and can sell
///         them, can decline to add liquidity, or can pull liquidity they added.
///         Those are ordinary market risks, not contract backdoors, and no token
///         contract can prevent them.
contract LaunchpadToken is ERC20 {
    /// @notice Who deployed this token. Informational only — carries no power.
    address public immutable creator;

    /// @notice Off-chain metadata (logo, description). Immutable: a mutable URI
    ///         would let someone launch as one project and re-skin as another.
    string public metadataURI;

    uint8 private immutable _decimals;

    error ZeroSupply();
    error ZeroCreator();

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 initialSupply,
        address creator_,
        string memory metadataURI_
    ) ERC20(name_, symbol_) {
        if (initialSupply == 0) revert ZeroSupply();
        if (creator_ == address(0)) revert ZeroCreator();

        creator = creator_;
        metadataURI = metadataURI_;
        _decimals = decimals_;

        // The one and only mint. There is no code path that reaches _mint again.
        _mint(creator_, initialSupply);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}
