// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title TrustRegistry
/// @notice Append-only store of risk attestations about contracts on any EVM chain.
///         EAS-inspired but deliberately minimal: one schema, no revocation, no fees.
///         Attestations are permanent commitments — the full AI report lives off-chain
///         and only its keccak256 hash is committed here, so anyone can prove that a
///         report shown in the UI is the exact one that was attested to.
contract TrustRegistry {
    struct Attestation {
        uint256 chainId; // chain the target contract lives on (may not be Monad)
        address target; // contract being attested about
        uint8 riskScore; // 0-100, higher = riskier
        bytes32 reportHash; // keccak256 of the full report JSON, stored off-chain
        address attester; // who made this attestation
        uint256 timestamp;
    }

    /// @dev attestationId => attestation. Ids start at 1; 0 means "none".
    mapping(uint256 => Attestation) private _attestations;

    /// @dev chainId => target => attestationIds, oldest first.
    mapping(uint256 => mapping(address => uint256[])) private _history;

    uint256 public attestationCount;

    event Attested(
        uint256 indexed attestationId,
        uint256 indexed chainId,
        address indexed target,
        address attester,
        uint8 riskScore,
        bytes32 reportHash
    );

    error InvalidScore(uint8 riskScore);
    error InvalidTarget();
    error NoAttestation();

    /// @notice Record a risk attestation. Permissionless by design: anyone may attest,
    ///         and consumers decide which attesters they trust (the app surfaces its own
    ///         backend signer). Making this ownable would make the registry useless to
    ///         other Monad apps, which is the point of a shared registry.
    function attest(uint256 chainId, address target, uint8 riskScore, bytes32 reportHash)
        external
        returns (uint256 attestationId)
    {
        if (riskScore > 100) revert InvalidScore(riskScore);
        if (target == address(0)) revert InvalidTarget();

        attestationId = ++attestationCount;
        _attestations[attestationId] = Attestation({
            chainId: chainId,
            target: target,
            riskScore: riskScore,
            reportHash: reportHash,
            attester: msg.sender,
            timestamp: block.timestamp
        });
        _history[chainId][target].push(attestationId);

        emit Attested(attestationId, chainId, target, msg.sender, riskScore, reportHash);
    }

    /// @notice Most recent attestation for a target. Reverts if none exists.
    function getLatest(uint256 chainId, address target) external view returns (Attestation memory) {
        uint256[] storage ids = _history[chainId][target];
        if (ids.length == 0) revert NoAttestation();
        return _attestations[ids[ids.length - 1]];
    }

    /// @notice Full attestation history for a target, oldest first.
    /// @dev Unbounded — view-only, intended for off-chain reads. The indexer should
    ///      prefer the `Attested` event stream for anything hot-path.
    function getHistory(uint256 chainId, address target) external view returns (Attestation[] memory out) {
        uint256[] storage ids = _history[chainId][target];
        out = new Attestation[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            out[i] = _attestations[ids[i]];
        }
    }

    function getAttestation(uint256 attestationId) external view returns (Attestation memory) {
        if (attestationId == 0 || attestationId > attestationCount) revert NoAttestation();
        return _attestations[attestationId];
    }

    function historyLength(uint256 chainId, address target) external view returns (uint256) {
        return _history[chainId][target].length;
    }
}
