// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TrustRegistry} from "../src/TrustRegistry.sol";
import {PropheyMarket} from "../src/PropheyMarket.sol";
import {VerifierBadge} from "../src/VerifierBadge.sol";
import {MockRugToken} from "../src/MockRugToken.sol";

/// @notice Deploys the full Polymad stack to Monad testnet.
///
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url https://testnet-rpc.monad.xyz \
///     --account polymad-deployer --broadcast
///
/// Env (all optional, default to the deployer address):
///   RESOLVER   — keeper wallet allowed to call PropheyMarket.resolve
///   MINTER     — backend wallet allowed to mint VerifierBadge
///   BADGE_URI  — base URI for badge metadata
///   DEPLOY_MOCK — "true" to also deploy the demo rug token
contract Deploy is Script {
    function run() external {
        address deployer = msg.sender;
        address resolver = vm.envOr("RESOLVER", deployer);
        address minter = vm.envOr("MINTER", deployer);
        string memory badgeURI = vm.envOr("BADGE_URI", string("https://polymad.local/api/badge/"));
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
