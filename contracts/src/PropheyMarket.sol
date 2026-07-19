// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PropheyMarket
/// @notice Parimutuel prediction market on whether a given contract will exhibit
///         rug-like behaviour within a fixed window. Stakes are in native MON.
///
///         Payout model: winners get their own stake back plus a pro-rata share of the
///         losing side's pool. No house fee, no AMM, no price curve — the "odds" the UI
///         shows are simply the pool split, which keeps the contract small enough for a
///         reader to audit in one sitting.
///
///         Resolution is NOT decided here. A trusted off-chain keeper watches the target
///         contract on its native chain (which is usually not Monad) for the three
///         deterministic rug triggers and calls `resolve`. That centralisation is a known
///         limitation of this build and is documented in the README rather than hidden:
///         the escape hatch below (`voidCall`) bounds the damage if the keeper disappears.
contract PropheyMarket is Ownable, ReentrancyGuard {
    struct Call {
        uint256 chainId; // chain the target contract lives on
        address target; // contract being bet on
        address creator;
        uint256 windowEnd; // no stakes accepted at/after this timestamp
        uint256 totalSafeStake;
        uint256 totalRugStake;
        bool resolved;
        bool outcomeIsRug; // only meaningful when resolved == true
        bool voided; // keeper failed to resolve in time; everyone refunded
    }

    /// @notice Minimum stake, to keep dust positions from bloating claim loops.
    uint256 public constant MIN_STAKE = 0.01 ether;
    uint256 public constant MIN_WINDOW = 1 hours;
    uint256 public constant MAX_WINDOW = 30 days;

    /// @notice After this much time past `windowEnd` with no resolution, anyone may void
    ///         the call and every staker can withdraw exactly what they put in. This is
    ///         the user's protection against a dead or censoring keeper.
    uint256 public constant RESOLVE_GRACE = 7 days;

    address public resolver;

    uint256 public callCount;
    mapping(uint256 => Call) private _calls;

    /// @dev callId => wallet => stake on that side.
    mapping(uint256 => mapping(address => uint256)) public safeStakeOf;
    mapping(uint256 => mapping(address => uint256)) public rugStakeOf;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event CallCreated(
        uint256 indexed callId, uint256 indexed chainId, address indexed target, address creator, uint256 windowEnd
    );
    /// @dev Pool totals are emitted post-trade so the indexer can reconstruct what
    ///      fraction of the pool agreed with a staker at the moment they staked —
    ///      that is the input to the contrarian-weighted Caller Score and the
    ///      AGAINST_THE_CROWD badge.
    event Staked(
        uint256 indexed callId,
        address indexed wallet,
        bool betRug,
        uint256 amount,
        uint256 totalSafeStake,
        uint256 totalRugStake
    );
    event Resolved(uint256 indexed callId, bool outcomeIsRug, address resolvedBy);
    event Voided(uint256 indexed callId);
    event Claimed(uint256 indexed callId, address indexed wallet, uint256 payout);
    event ResolverUpdated(address indexed previousResolver, address indexed newResolver);

    error NotResolver();
    error UnknownCall();
    error InvalidTarget();
    error InvalidWindow();
    error StakeTooSmall();
    error WindowClosed();
    error WindowStillOpen();
    error AlreadySettled();
    error NotSettled();
    error AlreadyClaimed();
    error NothingToClaim();
    error GracePeriodActive();
    error TransferFailed();
    error ZeroAddress();

    modifier onlyResolver() {
        if (msg.sender != resolver) revert NotResolver();
        _;
    }

    modifier callExists(uint256 callId) {
        if (callId == 0 || callId > callCount) revert UnknownCall();
        _;
    }

    constructor(address initialOwner, address initialResolver) Ownable(initialOwner) {
        if (initialResolver == address(0)) revert ZeroAddress();
        resolver = initialResolver;
        emit ResolverUpdated(address(0), initialResolver);
    }

    /// @notice Rotate the keeper key. Owner-only; the owner cannot touch escrowed funds.
    function setResolver(address newResolver) external onlyOwner {
        if (newResolver == address(0)) revert ZeroAddress();
        emit ResolverUpdated(resolver, newResolver);
        resolver = newResolver;
    }

    /// @notice Open a new Call on a target contract. Permissionless.
    /// @dev Duplicate calls on the same target are allowed on purpose — different windows
    ///      are different questions, and de-duping on-chain would need a target=>active
    ///      index that the UI can build off events for free.
    function createCall(uint256 chainId, address target, uint256 windowSeconds) external returns (uint256 callId) {
        if (target == address(0)) revert InvalidTarget();
        if (windowSeconds < MIN_WINDOW || windowSeconds > MAX_WINDOW) revert InvalidWindow();

        callId = ++callCount;
        Call storage c = _calls[callId];
        c.chainId = chainId;
        c.target = target;
        c.creator = msg.sender;
        c.windowEnd = block.timestamp + windowSeconds;

        emit CallCreated(callId, chainId, target, msg.sender, c.windowEnd);
    }

    /// @notice Stake MON on SAFE or RUG. A wallet may stake repeatedly, and may hold
    ///         positions on both sides (hedging is allowed; it just cannot be profitable).
    function stake(uint256 callId, bool betRug) external payable callExists(callId) {
        Call storage c = _calls[callId];
        if (msg.value < MIN_STAKE) revert StakeTooSmall();
        if (c.resolved || c.voided) revert AlreadySettled();
        if (block.timestamp >= c.windowEnd) revert WindowClosed();

        if (betRug) {
            c.totalRugStake += msg.value;
            rugStakeOf[callId][msg.sender] += msg.value;
        } else {
            c.totalSafeStake += msg.value;
            safeStakeOf[callId][msg.sender] += msg.value;
        }

        emit Staked(callId, msg.sender, betRug, msg.value, c.totalSafeStake, c.totalRugStake);
    }

    /// @notice Keeper reports the outcome.
    /// @dev A RUG can be reported the moment a trigger fires, even mid-window — the rug
    ///      already happened, so waiting would only let people pile onto a known answer.
    ///      SAFE can only be reported once the window has actually elapsed.
    function resolve(uint256 callId, bool rugOccurred) external onlyResolver callExists(callId) {
        Call storage c = _calls[callId];
        if (c.resolved || c.voided) revert AlreadySettled();
        if (!rugOccurred && block.timestamp < c.windowEnd) revert WindowStillOpen();

        c.resolved = true;
        c.outcomeIsRug = rugOccurred;

        emit Resolved(callId, rugOccurred, msg.sender);
    }

    /// @notice Escape hatch: if the keeper never resolved a call within the grace period,
    ///         anyone may void it and all stakers reclaim exactly their own stake.
    function voidCall(uint256 callId) external callExists(callId) {
        Call storage c = _calls[callId];
        if (c.resolved || c.voided) revert AlreadySettled();
        if (block.timestamp < c.windowEnd + RESOLVE_GRACE) revert GracePeriodActive();

        c.voided = true;
        emit Voided(callId);
    }

    /// @notice Withdraw winnings (or a refund, for a voided/one-sided call).
    function claim(uint256 callId) external nonReentrant callExists(callId) {
        Call storage c = _calls[callId];
        if (!c.resolved && !c.voided) revert NotSettled();
        if (claimed[callId][msg.sender]) revert AlreadyClaimed();

        uint256 payout = _payoutOf(c, callId, msg.sender);
        if (payout == 0) revert NothingToClaim();

        claimed[callId][msg.sender] = true;

        (bool ok,) = msg.sender.call{value: payout}("");
        if (!ok) revert TransferFailed();

        emit Claimed(callId, msg.sender, payout);
    }

    /// @notice What `claim` would pay this wallet right now. 0 if they lost, already
    ///         claimed, or the call is unsettled — the UI reads this directly.
    function payoutOf(uint256 callId, address wallet) external view callExists(callId) returns (uint256) {
        Call storage c = _calls[callId];
        if (!c.resolved && !c.voided) return 0;
        if (claimed[callId][wallet]) return 0;
        return _payoutOf(c, callId, wallet);
    }

    function _payoutOf(Call storage c, uint256 callId, address wallet) private view returns (uint256) {
        uint256 onSafe = safeStakeOf[callId][wallet];
        uint256 onRug = rugStakeOf[callId][wallet];

        // Voided: pure refund of everything the wallet put in, both sides.
        if (c.voided) return onSafe + onRug;

        uint256 winningPool = c.outcomeIsRug ? c.totalRugStake : c.totalSafeStake;
        uint256 losingPool = c.outcomeIsRug ? c.totalSafeStake : c.totalRugStake;

        // Nobody took the winning side: the losing side is refunded rather than burned.
        // Without this the whole pool would be stranded in the contract forever.
        if (winningPool == 0) return onSafe + onRug;

        uint256 winningStake = c.outcomeIsRug ? onRug : onSafe;
        if (winningStake == 0) return 0;

        // stake back + pro-rata share of the losing pool. Integer division leaves at most
        // (number of winners) wei behind, which is intentionally not worth reclaiming.
        return winningStake + (winningStake * losingPool) / winningPool;
    }

    function getCall(uint256 callId) external view callExists(callId) returns (Call memory) {
        return _calls[callId];
    }

    /// @notice Convenience read for the UI: a wallet's position on both sides.
    function positionOf(uint256 callId, address wallet)
        external
        view
        callExists(callId)
        returns (uint256 onSafe, uint256 onRug, bool hasClaimed)
    {
        return (safeStakeOf[callId][wallet], rugStakeOf[callId][wallet], claimed[callId][wallet]);
    }
}
