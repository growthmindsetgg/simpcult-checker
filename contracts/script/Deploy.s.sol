// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SimpDAO} from "../src/SimpDAO.sol";

/// Usage (Monad mainnet):
///   NFT=0xd883... OWNER=0xYourMultisigOrWallet \
///   forge script script/Deploy.s.sol --rpc-url https://rpc.monad.xyz --broadcast --private-key $PK --verify \
///     --verifier sourcify   (or --verifier etherscan --verifier-url https://api.monadscan.com/api --etherscan-api-key $KEY)
contract Deploy is Script {
    function run() external {
        address nft = vm.envAddress("NFT");
        address owner = vm.envOr("OWNER", msg.sender);
        uint256 threshold = vm.envOr("THRESHOLD", uint256(1)); // NFTs to propose
        uint256 quorum = vm.envOr("QUORUM", uint256(20)); // total votes needed (421 supply → ~5%)
        uint256 delay = vm.envOr("DELAY", uint256(0));
        uint256 period = vm.envOr("PERIOD", uint256(3 days));
        uint256 cooldown = vm.envOr("COOLDOWN", uint256(1 days));

        vm.startBroadcast();
        SimpDAO dao = new SimpDAO(nft, owner, threshold, quorum, delay, period, cooldown);
        vm.stopBroadcast();

        console.log("SimpDAO deployed at", address(dao));
        console.log("set NEXT_PUBLIC_DAO_ADDRESS to that value");
    }
}
