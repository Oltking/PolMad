// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TrustRegistry} from "../src/TrustRegistry.sol";
import {PropheyMarket} from "../src/PropheyMarket.sol";
import {VerifierBadge} from "../src/VerifierBadge.sol";
import {MockRugToken} from "../src/MockRugToken.sol";

/// @notice Deploys the full PolMad stack to Monad testnet.
///
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url https://testnet-rpc.monad.xyz \
///     --account polmad-deployer --broadcast
///
/// Env (all optional, default to the deployer address):
///   RESOLVER   — keeper wallet allowed to call PropheyMarket.resolve
///   MINTER     — backend wallet allowed to mint VerifierBadge
///   BADGE_URI  — base URI for badge metadata
///   DEPLOY_MOCK — "true" to also deploy the demo rug token
contract Deploy is Script {
    /// Foundry's default sender. If `--sender` is omitted, `msg.sender` inside a
    /// script silently becomes this address even though a keystore account signs and
    /// pays — which bakes an address nobody controls into every constructor.
    /// Deployments that hit this look completely successful and are entirely useless,
    /// so we refuse to broadcast rather than let it through.
    address constant FOUNDRY_DEFAULT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    function run() external {
        address deployer = msg.sender;
        require(
            deployer != FOUNDRY_DEFAULT_SENDER,
            "Refusing to deploy: msg.sender is Foundry's default sender. Pass --sender <your address> so ownership is assigned to a key you control."
        );

        address resolver = vm.envOr("RESOLVER", deployer);
        address minter = vm.envOr("MINTER", deployer);
        string memory badgeURI = vm.envOr("BADGE_URI", string("https://polmad.local/api/badge/"));
        bool deployMock = vm.envOr("DEPLOY_MOCK", false);

        vm.startBroadcast();

        TrustRegistry registry = new TrustRegistry();
        PropheyMarket market = new PropheyMarket(deployer, resolver);
        VerifierBadge badge = new VerifierBadge(deployer, minter, badgeURI);

        address mock = address(0);
        if (deployMock) {
            // Demo-only token with the owner-mint backdoor, per spec §6.
            mock = address(new MockRugToken(deployer, 1_000_000 ether));
        }

        vm.stopBroadcast();

        console.log("deployer        ", deployer);
        console.log("resolver        ", resolver);
        console.log("minter          ", minter);
        console.log("TrustRegistry   ", address(registry));
        console.log("PropheyMarket   ", address(market));
        console.log("VerifierBadge   ", address(badge));
        console.log("MockRugToken    ", mock);
    }
}
