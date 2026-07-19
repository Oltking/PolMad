// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VerifierBadge} from "../src/VerifierBadge.sol";

contract VerifierBadgeTest is Test {
    VerifierBadge badge;

    address owner = makeAddr("owner");
    address minter = makeAddr("minter");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    // Cached locally on purpose: calling the public getters inline would consume the
    // preceding vm.prank / vm.expectRevert, which applies to the very next call.
    uint256 constant FIRST_CORRECT_CALL = 0;
    uint256 constant FIVE_CALL_STREAK = 1;
    uint256 constant TOP_10_WEEKLY = 3;

    function setUp() public {
        badge = new VerifierBadge(owner, minter, "https://polymad.xyz/badge/");
    }

    function test_mintBadge_assignsTypeAndOwnership() public {
        vm.prank(minter);
        uint256 id = badge.mintBadge(alice, FIRST_CORRECT_CALL);

        assertEq(badge.ownerOf(id), alice);
        assertEq(badge.badgeTypeOf(id), FIRST_CORRECT_CALL);
        assertEq(badge.badgesOf(alice).length, 1);
        assertEq(badge.tokenURI(id), "https://polymad.xyz/badge/0.json");
    }

    function test_mintBadge_onlyMinter() public {
        vm.prank(alice);
        vm.expectRevert(VerifierBadge.NotMinter.selector);
        badge.mintBadge(alice, 0);
    }

    function test_mintBadge_rejectsDuplicateType() public {
        vm.startPrank(minter);
        badge.mintBadge(alice, FIVE_CALL_STREAK);
        vm.expectRevert(abi.encodeWithSelector(VerifierBadge.AlreadyHolds.selector, FIVE_CALL_STREAK));
        badge.mintBadge(alice, FIVE_CALL_STREAK);
        vm.stopPrank();
    }

    /// Weekly badges are earnable again every week, unlike the one-shot milestones.
    function test_topTenWeekly_isRepeatable() public {
        vm.startPrank(minter);
        badge.mintBadge(alice, TOP_10_WEEKLY);
        badge.mintBadge(alice, TOP_10_WEEKLY);
        vm.stopPrank();
        assertEq(badge.badgesOf(alice).length, 2);
    }

    function test_mintBadge_rejectsUnknownType() public {
        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(VerifierBadge.UnknownBadgeType.selector, uint256(4)));
        badge.mintBadge(alice, 4);
    }

    /// Reputation you can buy is not reputation.
    function test_badgesAreSoulbound() public {
        vm.prank(minter);
        uint256 id = badge.mintBadge(alice, 0);

        vm.prank(alice);
        vm.expectRevert(VerifierBadge.Soulbound.selector);
        badge.transferFrom(alice, bob, id);
    }

    function test_setMinter_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        badge.setMinter(bob);

        vm.prank(owner);
        badge.setMinter(bob);
        vm.prank(bob);
        badge.mintBadge(alice, 0);
    }
}
