// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {VerifierBadge} from "../src/VerifierBadge.sol";

/// Redeploys VerifierBadge only.
///
/// The original was deployed before the PolMad rename, so its on-chain NFT name
/// still reads "Polymad Verifier Badge" — visible in every wallet, and immutable.
/// No badges were ever minted, so nothing is lost by replacing it.
///
///   MINTER=<backend wallet> forge script script/DeployBadge.s.sol:DeployBadge \
///     --rpc-url https://testnet-rpc.monad.xyz \
///     --account polmad-deployer --sender <your address> --broadcast
contract DeployBadge is Script {
    address constant FOUNDRY_DEFAULT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    function run() external {
        require(
            msg.sender != FOUNDRY_DEFAULT_SENDER,
            "Refusing to deploy: pass --sender <your address> so ownership is assigned to a key you control."
        );

        address minter = vm.envOr("MINTER", msg.sender);
        string memory badgeURI = vm.envOr("BADGE_URI", string("https://polmad.local/api/badge/"));

        vm.startBroadcast();
        VerifierBadge badge = new VerifierBadge(msg.sender, minter, badgeURI);
        vm.stopBroadcast();

        console.log("deployer     ", msg.sender);
        console.log("minter       ", minter);
        console.log("VerifierBadge", address(badge));
    }
}
