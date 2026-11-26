// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SimpPoints} from "../src/SimpPoints.sol";

interface Vm {
    function envAddress(string calldata) external view returns (address);
    function envOr(string calldata, address) external view returns (address);
    function envOr(string calldata, string calldata) external view returns (string memory);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// Deploys the soulbound season XP token. NOT deployed yet — run only with the owner's OK.
///
///   OWNER=0xMultisig MINTER=0xSettlementSigner URI="https://simpcult.xyz/xp/{id}.json" \
///   forge script script/SimpPoints.s.sol:DeploySimpPoints --rpc-url https://rpc.monad.xyz --broadcast --private-key $PK
///
/// After deploy, per season: freeze the season in /portal/admin, copy root + total, then
/// FROM THE OWNER (setSeasonRoot / setSeasonCap are owner-only; the minter can only settleBatch):
///   cast send <XP> "setSeasonRoot(uint256,bytes32,uint256)" <season> <root> <total>
contract DeploySimpPoints {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (SimpPoints xp) {
        address owner = vm.envAddress("OWNER");
        address minter = vm.envOr("MINTER", owner);
        string memory uri = vm.envOr("URI", string(""));

        vm.startBroadcast();
        xp = new SimpPoints(owner, minter, uri);
        vm.stopBroadcast();
    }
}
