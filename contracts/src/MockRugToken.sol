// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockRugToken
/// @notice DEMO ONLY. A deliberately unsafe ERC-20 with the exact backdoors Polymad
///         scores against, so the resolution flow can be triggered live on stage
///         instead of waiting for a real rug to happen during a 3-minute demo.
///
///         Do not deploy this to mainnet, and do not treat it as an example of good
///         practice — every "feature" here is the thing the Trust Report warns about:
///           - owner can mint unlimited supply  -> rug trigger #2
///           - owner can pause all transfers    -> rug trigger #3
///           - owner can blacklist any holder   -> rug trigger #3
contract MockRugToken is ERC20, Ownable {
    bool public paused;
    mapping(address => bool) public blacklisted;

    event Paused(bool paused);
    event Blacklisted(address indexed wallet, bool blacklisted);

    error TransfersPaused();
    error WalletBlacklisted(address wallet);

    constructor(address initialOwner, uint256 initialSupply)
        ERC20("Definitely Not A Rug", "SAFU")
        Ownable(initialOwner)
    {
        _mint(initialOwner, initialSupply);
    }

    /// @notice Unlimited owner mint — the supply-inflation backdoor.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Global transfer kill switch.
    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit Paused(paused_);
    }

    /// @notice Per-wallet sell block.
    function setBlacklisted(address wallet, bool blacklisted_) external onlyOwner {
        blacklisted[wallet] = blacklisted_;
        emit Blacklisted(wallet, blacklisted_);
    }

    function _update(address from, address to, uint256 value) internal override {
        // Minting stays possible while paused — that is exactly how these contracts
        // behave in the wild: holders are frozen, the owner is not.
        if (from != address(0)) {
            if (paused) revert TransfersPaused();
            if (blacklisted[from]) revert WalletBlacklisted(from);
        }
        super._update(from, to, value);
    }
}
