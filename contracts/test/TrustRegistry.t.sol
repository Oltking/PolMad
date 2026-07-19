// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TrustRegistry} from "../src/TrustRegistry.sol";

contract TrustRegistryTest is Test {
    TrustRegistry registry;

    address backend = makeAddr("backend");
    address randomUser = makeAddr("randomUser");
    address target = makeAddr("target");

    function setUp() public {
        registry = new TrustRegistry();
    }

    function test_attest_storesAndReturnsLatest() public {
        bytes32 hash = keccak256("report-v1");
        vm.prank(backend);
        uint256 id = registry.attest(1, target, 82, hash);

        assertEq(id, 1);
        TrustRegistry.Attestation memory a = registry.getLatest(1, target);
        assertEq(a.chainId, 1);
        assertEq(a.target, target);
        assertEq(a.riskScore, 82);
        assertEq(a.reportHash, hash);
        assertEq(a.attester, backend);
        assertEq(a.timestamp, block.timestamp);
    }

    function test_getLatest_returnsMostRecentOfMany() public {
        vm.prank(backend);
        registry.attest(1, target, 30, keccak256("a"));
        vm.warp(block.timestamp + 1 days);
        vm.prank(backend);
        registry.attest(1, target, 91, keccak256("b"));

        assertEq(registry.getLatest(1, target).riskScore, 91);
        assertEq(registry.historyLength(1, target), 2);
        assertEq(registry.getHistory(1, target)[0].riskScore, 30);
    }

    /// History is per (chain, target) — same address on two chains is two different
    /// contracts, and conflating them would be a real safety bug.
    function test_historyIsScopedPerChain() public {
        vm.startPrank(backend);
        registry.attest(1, target, 10, keccak256("eth"));
        registry.attest(8453, target, 95, keccak256("base"));
        vm.stopPrank();

        assertEq(registry.getLatest(1, target).riskScore, 10);
        assertEq(registry.getLatest(8453, target).riskScore, 95);
        assertEq(registry.historyLength(1, target), 1);
    }

    /// Permissionless on purpose: consumers filter by attester.
    function test_anyoneCanAttest() public {
        vm.prank(randomUser);
        registry.attest(1, target, 50, keccak256("x"));
        assertEq(registry.getLatest(1, target).attester, randomUser);
    }

    function test_rejectsScoreAbove100() public {
        vm.expectRevert(abi.encodeWithSelector(TrustRegistry.InvalidScore.selector, uint8(101)));
        registry.attest(1, target, 101, keccak256("x"));
    }

    function test_rejectsZeroTarget() public {
        vm.expectRevert(TrustRegistry.InvalidTarget.selector);
        registry.attest(1, address(0), 50, keccak256("x"));
    }

    function test_getLatest_revertsWhenNone() public {
        vm.expectRevert(TrustRegistry.NoAttestation.selector);
        registry.getLatest(1, target);
    }
}
