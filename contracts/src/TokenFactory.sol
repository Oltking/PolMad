// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LaunchpadToken} from "./LaunchpadToken.sol";

interface ITrustRegistry {
    function attest(uint256 chainId, address target, uint8 riskScore, bytes32 reportHash)
        external
        returns (uint256);
}

/// @title TokenFactory
/// @notice Deploys backdoor-free tokens and attests to that fact on-chain.
///
///         The factory is the guarantee. Because it is the only deployer of
///         LaunchpadToken and LaunchpadToken has no privileged functions, anyone
///         can verify a token came from here and know — without reading its code —
///         that it has no mint, no pause, no blacklist, and no owner.
///
///         Every launch writes an attestation to TrustRegistry recording a risk
///         score of 0 for *contract backdoor risk specifically*. Read that number
///         narrowly: it means "this bytecode has no owner-controlled backdoors",
///         not "this project is trustworthy". A token with no backdoors can still
///         be a bad investment, and the creator can still sell everything they own.
contract TokenFactory {
    struct Launch {
        address token;
        address creator;
        string name;
        string symbol;
        uint256 supply;
        uint256 timestamp;
    }

    ITrustRegistry public immutable trustRegistry;

    Launch[] private _launches;
    mapping(address => uint256[]) private _byCreator;
    mapping(address => bool) public isLaunchpadToken;

    event TokenLaunched(
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        uint256 supply,
        string metadataURI
    );

    error EmptyName();
    error EmptySymbol();
    error ZeroSupply();
    error DecimalsTooLarge(uint8 decimals);

    constructor(address trustRegistry_) {
        // Registry is optional: a zero address simply disables auto-attestation
        // rather than making launches impossible.
        trustRegistry = ITrustRegistry(trustRegistry_);
    }

    /// @notice Deploy a new backdoor-free token. Permissionless and free (gas only).
    /// @param name_ Token name, e.g. "Example Token"
    /// @param symbol_ Ticker, e.g. "EXA"
    /// @param decimals_ Almost always 18
    /// @param initialSupply Total supply in base units, minted entirely to msg.sender
    /// @param metadataURI Off-chain JSON (logo, links). Immutable once set.
    function createToken(
        string calldata name_,
        string calldata symbol_,
        uint8 decimals_,
        uint256 initialSupply,
        string calldata metadataURI
    ) external returns (address token) {
        if (bytes(name_).length == 0) revert EmptyName();
        if (bytes(symbol_).length == 0) revert EmptySymbol();
        if (initialSupply == 0) revert ZeroSupply();
        // Above 18 decimals, common tooling and price maths start to break.
        if (decimals_ > 18) revert DecimalsTooLarge(decimals_);

        token = address(
            new LaunchpadToken(name_, symbol_, decimals_, initialSupply, msg.sender, metadataURI)
        );

        isLaunchpadToken[token] = true;
        _byCreator[msg.sender].push(_launches.length);
        _launches.push(
            Launch({
                token: token,
                creator: msg.sender,
                name: name_,
                symbol: symbol_,
                supply: initialSupply,
                timestamp: block.timestamp
            })
        );

        emit TokenLaunched(token, msg.sender, name_, symbol_, initialSupply, metadataURI);

        // Attest that this token has no owner-controlled backdoors. Wrapped in
        // try/catch because a failing registry must never block a launch — the
        // attestation is a bonus, not a dependency.
        if (address(trustRegistry) != address(0)) {
            try trustRegistry.attest(block.chainid, token, 0, keccak256(abi.encodePacked("polmad-launchpad-v1", token))) {
                // attested
            } catch {
                // Registry unavailable; the launch itself is unaffected.
            }
        }
    }

    function launchCount() external view returns (uint256) {
        return _launches.length;
    }

    /// @notice Most recent launches first, paginated.
    function recentLaunches(uint256 offset, uint256 limit) external view returns (Launch[] memory out) {
        uint256 total = _launches.length;
        if (offset >= total) return new Launch[](0);

        uint256 remaining = total - offset;
        uint256 n = remaining < limit ? remaining : limit;
        out = new Launch[](n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = _launches[total - 1 - offset - i];
        }
    }

    function launchesOf(address creator) external view returns (Launch[] memory out) {
        uint256[] storage ids = _byCreator[creator];
        out = new Launch[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            out[i] = _launches[ids[i]];
        }
    }

    function launchAt(uint256 index) external view returns (Launch memory) {
        return _launches[index];
    }
}
