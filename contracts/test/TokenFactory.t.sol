// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TokenFactory} from "../src/TokenFactory.sol";
import {LaunchpadToken} from "../src/LaunchpadToken.sol";
import {TrustRegistry} from "../src/TrustRegistry.sol";

contract TokenFactoryTest is Test {
    TokenFactory factory;
    TrustRegistry registry;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        registry = new TrustRegistry();
        factory = new TokenFactory(address(registry));
    }

    function _launch(address who) internal returns (LaunchpadToken) {
        vm.prank(who);
        return LaunchpadToken(factory.createToken("Example Token", "EXA", 18, 1_000_000 ether, "ipfs://meta"));
    }

    function test_createToken_mintsEntireSupplyToCreator() public {
        LaunchpadToken t = _launch(alice);

        assertEq(t.name(), "Example Token");
        assertEq(t.symbol(), "EXA");
        assertEq(t.decimals(), 18);
        assertEq(t.totalSupply(), 1_000_000 ether);
        assertEq(t.balanceOf(alice), 1_000_000 ether);
        assertEq(t.creator(), alice);
        assertEq(t.metadataURI(), "ipfs://meta");
    }

    /// The central safety claim of the launchpad: a launched token exposes no
    /// function that could inflate supply or block transfers. If this test ever
    /// fails, the "cannot rug by construction" promise is broken.
    function test_launchedToken_hasNoBackdoorSelectors() public {
        LaunchpadToken t = _launch(alice);
        address token = address(t);

        string[10] memory forbidden = [
            "mint(address,uint256)",
            "mint(uint256)",
            "burnFrom(address,uint256)",
            "pause()",
            "unpause()",
            "setPaused(bool)",
            "blacklist(address)",
            "setBlacklisted(address,bool)",
            "owner()",
            "transferOwnership(address)"
        ];

        for (uint256 i = 0; i < forbidden.length; i++) {
            (bool ok,) = token.call(abi.encodeWithSignature(forbidden[i]));
            assertFalse(ok, string.concat("token must not expose ", forbidden[i]));
        }
    }

    /// Supply is fixed forever — the property that makes the SUPPLY_INFLATION rug
    /// trigger structurally impossible for these tokens.
    function test_supplyIsImmutable() public {
        LaunchpadToken t = _launch(alice);
        uint256 before = t.totalSupply();

        vm.prank(alice);
        t.transfer(bob, 1 ether);

        assertEq(t.totalSupply(), before);
    }

    function test_transfersCannotBeBlocked() public {
        LaunchpadToken t = _launch(alice);

        vm.prank(alice);
        t.transfer(bob, 100 ether);
        assertEq(t.balanceOf(bob), 100 ether);

        // Nobody — not even the creator — can stop bob moving on.
        vm.prank(bob);
        t.transfer(alice, 100 ether);
        assertEq(t.balanceOf(bob), 0);
    }

    function test_launchWritesAttestation() public {
        LaunchpadToken t = _launch(alice);

        TrustRegistry.Attestation memory a = registry.getLatest(block.chainid, address(t));
        assertEq(a.target, address(t));
        assertEq(a.riskScore, 0);
        assertEq(a.attester, address(factory));
    }

    /// A launch must succeed even if the registry is broken or absent — the
    /// attestation is a bonus, never a dependency.
    function test_launchSucceedsWithoutRegistry() public {
        TokenFactory bare = new TokenFactory(address(0));
        vm.prank(alice);
        address token = bare.createToken("No Registry", "NRG", 18, 1 ether, "");
        assertEq(LaunchpadToken(token).totalSupply(), 1 ether);
    }

    function test_registryRecordsAndIndexes() public {
        _launch(alice);
        _launch(bob);
        _launch(alice);

        assertEq(factory.launchCount(), 3);
        assertEq(factory.launchesOf(alice).length, 2);
        assertEq(factory.launchesOf(bob).length, 1);

        TokenFactory.Launch[] memory recent = factory.recentLaunches(0, 2);
        assertEq(recent.length, 2);
        // Newest first.
        assertEq(recent[0].creator, alice);
        assertEq(recent[1].creator, bob);
    }

    function test_recentLaunches_handlesOutOfRange() public {
        _launch(alice);
        assertEq(factory.recentLaunches(5, 10).length, 0);
        assertEq(factory.recentLaunches(0, 100).length, 1);
    }

    function test_isLaunchpadToken_flagsOnlyOurTokens() public {
        LaunchpadToken t = _launch(alice);
        assertTrue(factory.isLaunchpadToken(address(t)));
        assertFalse(factory.isLaunchpadToken(makeAddr("random")));
    }

    function test_rejectsInvalidInput() public {
        vm.startPrank(alice);
        vm.expectRevert(TokenFactory.EmptyName.selector);
        factory.createToken("", "EXA", 18, 1 ether, "");

        vm.expectRevert(TokenFactory.EmptySymbol.selector);
        factory.createToken("Example", "", 18, 1 ether, "");

        vm.expectRevert(TokenFactory.ZeroSupply.selector);
        factory.createToken("Example", "EXA", 18, 0, "");

        vm.expectRevert(abi.encodeWithSelector(TokenFactory.DecimalsTooLarge.selector, uint8(19)));
        factory.createToken("Example", "EXA", 19, 1 ether, "");
        vm.stopPrank();
    }

    function testFuzz_supplyAlwaysLandsWithCreator(uint256 supply, uint8 decimals) public {
        supply = bound(supply, 1, type(uint128).max);
        decimals = uint8(bound(decimals, 0, 18));

        vm.prank(bob);
        address token = factory.createToken("Fuzz", "FZZ", decimals, supply, "");

        assertEq(LaunchpadToken(token).balanceOf(bob), supply);
        assertEq(LaunchpadToken(token).totalSupply(), supply);
    }
}
