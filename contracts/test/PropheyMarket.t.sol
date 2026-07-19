// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PropheyMarket} from "../src/PropheyMarket.sol";

contract PropheyMarketTest is Test {
    PropheyMarket market;

    address owner = makeAddr("owner");
    address resolver = makeAddr("resolver");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    uint256 constant CHAIN_ID = 1;
    address target = makeAddr("target");
    uint256 constant WINDOW = 72 hours;

    function setUp() public {
        market = new PropheyMarket(owner, resolver);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    function _newCall() internal returns (uint256) {
        vm.prank(alice);
        return market.createCall(CHAIN_ID, target, WINDOW);
    }

    function test_createCall_setsFields() public {
        uint256 id = _newCall();
        PropheyMarket.Call memory c = market.getCall(id);
        assertEq(id, 1);
        assertEq(c.chainId, CHAIN_ID);
        assertEq(c.target, target);
        assertEq(c.creator, alice);
        assertEq(c.windowEnd, block.timestamp + WINDOW);
        assertFalse(c.resolved);
    }

    function test_createCall_rejectsBadWindow() public {
        vm.expectRevert(PropheyMarket.InvalidWindow.selector);
        market.createCall(CHAIN_ID, target, 1 minutes);
        vm.expectRevert(PropheyMarket.InvalidWindow.selector);
        market.createCall(CHAIN_ID, target, 60 days);
    }

    function test_stake_accumulatesBothSides() public {
        uint256 id = _newCall();
        vm.prank(alice);
        market.stake{value: 3 ether}(id, false);
        vm.prank(bob);
        market.stake{value: 1 ether}(id, true);

        PropheyMarket.Call memory c = market.getCall(id);
        assertEq(c.totalSafeStake, 3 ether);
        assertEq(c.totalRugStake, 1 ether);
        assertEq(market.safeStakeOf(id, alice), 3 ether);
        assertEq(market.rugStakeOf(id, bob), 1 ether);
    }

    function test_stake_rejectsDustAndClosedWindow() public {
        uint256 id = _newCall();
        vm.prank(alice);
        vm.expectRevert(PropheyMarket.StakeTooSmall.selector);
        market.stake{value: 0.001 ether}(id, true);

        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        vm.expectRevert(PropheyMarket.WindowClosed.selector);
        market.stake{value: 1 ether}(id, true);
    }

    /// The core money path: RUG side wins, splits the SAFE pool pro-rata.
    function test_resolveRug_paysWinnersProRata() public {
        uint256 id = _newCall();
        vm.prank(alice);
        market.stake{value: 6 ether}(id, false); // SAFE, loses
        vm.prank(bob);
        market.stake{value: 3 ether}(id, true); // RUG, 3/4 of winning pool
        vm.prank(carol);
        market.stake{value: 1 ether}(id, true); // RUG, 1/4 of winning pool

        // A rug can be reported mid-window — it already happened.
        vm.prank(resolver);
        market.resolve(id, true);

        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        market.claim(id);
        assertEq(bob.balance - bobBefore, 3 ether + 4.5 ether);

        uint256 carolBefore = carol.balance;
        vm.prank(carol);
        market.claim(id);
        assertEq(carol.balance - carolBefore, 1 ether + 1.5 ether);

        // Loser gets nothing and the pool is fully drained.
        vm.prank(alice);
        vm.expectRevert(PropheyMarket.NothingToClaim.selector);
        market.claim(id);
        assertEq(address(market).balance, 0);
    }

    function test_resolveSafe_requiresWindowElapsed() public {
        uint256 id = _newCall();
        vm.prank(resolver);
        vm.expectRevert(PropheyMarket.WindowStillOpen.selector);
        market.resolve(id, false);

        vm.warp(block.timestamp + WINDOW);
        vm.prank(resolver);
        market.resolve(id, false);
        assertTrue(market.getCall(id).resolved);
    }

    function test_resolve_onlyResolver() public {
        uint256 id = _newCall();
        vm.prank(alice);
        vm.expectRevert(PropheyMarket.NotResolver.selector);
        market.resolve(id, true);
    }

    function test_claim_isOncePerWallet() public {
        uint256 id = _newCall();
        vm.prank(alice);
        market.stake{value: 1 ether}(id, false);
        vm.prank(bob);
        market.stake{value: 1 ether}(id, true);
        vm.prank(resolver);
        market.resolve(id, true);

        vm.prank(bob);
        market.claim(id);
        vm.prank(bob);
        vm.expectRevert(PropheyMarket.AlreadyClaimed.selector);
        market.claim(id);
    }

    /// One-sided pool: nobody took the winning side, so the losers are refunded
    /// rather than having their stake stranded in the contract forever.
    function test_noWinners_refundsLosingSide() public {
        uint256 id = _newCall();
        vm.prank(alice);
        market.stake{value: 2 ether}(id, false);

        vm.prank(resolver);
        market.resolve(id, true); // RUG wins, but nobody bet RUG

        uint256 before = alice.balance;
        vm.prank(alice);
        market.claim(id);
        assertEq(alice.balance - before, 2 ether);
        assertEq(address(market).balance, 0);
    }

    /// Hedging both sides is allowed but never profitable — you can only ever get
    /// back your winning leg plus its share, which the losing leg funded.
    function test_hedgedPosition_paysOnlyWinningLeg() public {
        uint256 id = _newCall();
        vm.prank(alice);
        market.stake{value: 1 ether}(id, false);
        vm.prank(alice);
        market.stake{value: 1 ether}(id, true);
        vm.prank(bob);
        market.stake{value: 1 ether}(id, true);

        vm.prank(resolver);
        market.resolve(id, true);

        // alice wins 1 of 2 ether on the RUG side => 1 + half of the 1 ether SAFE pool.
        assertEq(market.payoutOf(id, alice), 1 ether + 0.5 ether);
        assertEq(market.payoutOf(id, bob), 1 ether + 0.5 ether);
    }

    function test_voidCall_refundsEveryoneAfterGrace() public {
        uint256 id = _newCall();
        vm.prank(alice);
        market.stake{value: 2 ether}(id, false);
        vm.prank(bob);
        market.stake{value: 1 ether}(id, true);

        vm.expectRevert(PropheyMarket.GracePeriodActive.selector);
        market.voidCall(id);

        vm.warp(block.timestamp + WINDOW + market.RESOLVE_GRACE());
        market.voidCall(id); // permissionless

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        market.claim(id);
        assertEq(alice.balance - aliceBefore, 2 ether);

        vm.prank(bob);
        market.claim(id);
        assertEq(address(market).balance, 0);
    }

    function test_voidCall_blockedOnceResolved() public {
        uint256 id = _newCall();
        vm.prank(resolver);
        market.resolve(id, true);
        vm.warp(block.timestamp + WINDOW + market.RESOLVE_GRACE());
        vm.expectRevert(PropheyMarket.AlreadySettled.selector);
        market.voidCall(id);
    }

    function test_setResolver_onlyOwner() public {
        address newResolver = makeAddr("newResolver");
        vm.prank(alice);
        vm.expectRevert();
        market.setResolver(newResolver);

        vm.prank(owner);
        market.setResolver(newResolver);
        assertEq(market.resolver(), newResolver);
    }

    /// The contract must never pay out more than it escrowed, whatever the split.
    function testFuzz_payoutsNeverExceedPool(uint96 safeAmt, uint96 rugAmt, bool rugWins) public {
        safeAmt = uint96(bound(safeAmt, 0.01 ether, 50 ether));
        rugAmt = uint96(bound(rugAmt, 0.01 ether, 50 ether));

        uint256 id = _newCall();
        vm.prank(alice);
        market.stake{value: safeAmt}(id, false);
        vm.prank(bob);
        market.stake{value: rugAmt}(id, true);

        vm.warp(block.timestamp + WINDOW);
        vm.prank(resolver);
        market.resolve(id, rugWins);

        uint256 total = market.payoutOf(id, alice) + market.payoutOf(id, bob);
        assertLe(total, uint256(safeAmt) + uint256(rugAmt));
    }
}
