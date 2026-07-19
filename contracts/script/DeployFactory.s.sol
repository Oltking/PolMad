// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TokenFactory} from "../src/TokenFactory.sol";

/// Deploys the launchpad factory, wired to an existing TrustRegistry so every
/// launch attests on-chain that it has no owner backdoors.
///
///   TRUST_REGISTRY=0x... forge script script/DeployFactory.s.sol:DeployFactory \
///     --rpc-url <rpc> --account polmad-deployer \
///     --sender <your address> --broadcast
contract DeployFactory is Script {
    address constant FOUNDRY_DEFAULT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    function run() external {
        require(
            msg.sender != FOUNDRY_DEFAULT_SENDER,
            "Refusing to deploy: pass --sender <your address> so ownership is assigned to a key you control."
        );

        // Optional: a zero registry simply disables auto-attestation.
        address registry = vm.envOr("TRUST_REGISTRY", address(0));

        vm.startBroadcast();
        TokenFactory factory = new TokenFactory(registry);
        vm.stopBroadcast();

        console.log("deployer     ", msg.sender);
        console.log("TrustRegistry", registry);
        console.log("TokenFactory ", address(factory));
    }
}
