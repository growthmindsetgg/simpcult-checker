// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SimpPoints} from "../src/SimpPoints.sol";

/// Minimal cheatcode surface so the suite runs without forge-std installed.
interface Vm {
    function prank(address) external;
    function expectRevert(bytes4) external;
}

contract SimpPointsTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    SimpPoints xp;

    address owner = address(0xA11CE);
    address minter = address(0x5E77);

    // fixed vector produced by src/lib/points/merkle.ts (season 1):
    //   0x..00A1 -> 1000, 0x..0B0B -> 2500, 0x..00CA -> 777
    address alice = address(0xA1);
    address bob = address(0xB0B);
    address carol = address(0xCA);
    bytes32 constant ROOT = 0x9769316440f22cb171f13d82c4ea28c19c9a7afeba912f62c111eac05035065b;
    bytes32 constant LEAF_ALICE = 0x7f1f4fc735465584e4241c95e529962a628b7a33260b9c9515641e4f7b467cb0;
    bytes32 constant LEAF_BOB = 0xfe5ae71bff8a799c9b3aa7336d881f6b8fe90342333a32f96ab45994c8b46ecd;
    bytes32 constant LEAF_CAROL = 0x8ca69134e34e2008cc573b6f9b12f889d36af100eb9ec0aefeaf53adbd073eea;
    bytes32 constant H_AC = 0x2eb385020c58b14e4c7f0eb82a1194e785c7c4da75db3659f156378e59832352;
    uint256 constant TOTAL = 1000 + 2500 + 777;

    function setUp() public {
        xp = new SimpPoints(owner, minter, "ipfs://simp-xp/{id}.json");
    }

    // ───────────── helpers ─────────────
    function eq(uint256 a, uint256 b, string memory what) internal pure {
        require(a == b, what);
    }

    function proofAlice() internal pure returns (bytes32[] memory p) {
        p = new bytes32[](2);
        p[0] = LEAF_CAROL;
        p[1] = LEAF_BOB;
    }

    function proofBob() internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = H_AC;
    }

    function proofCarol() internal pure returns (bytes32[] memory p) {
        p = new bytes32[](2);
        p[0] = LEAF_ALICE;
        p[1] = LEAF_BOB;
    }

    function publishRoot() internal {
        vm.prank(owner);
        xp.setSeasonRoot(1, ROOT, TOTAL);
    }

    function setCap(uint256 season, uint256 cap) internal {
        vm.prank(owner);
        xp.setSeasonCap(season, cap);
    }

    // ───────────── leaf encoding matches the TS server ─────────────
    function test_LeafEncodingMatchesServer() public pure {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(address(0xA1), uint256(1), uint256(1000)))));
        require(leaf == LEAF_ALICE, "leaf");
        bytes32 ac = LEAF_ALICE < LEAF_CAROL
            ? keccak256(abi.encodePacked(LEAF_ALICE, LEAF_CAROL))
            : keccak256(abi.encodePacked(LEAF_CAROL, LEAF_ALICE));
        require(ac == H_AC, "pair");
    }

    // ───────────── merkle claims ─────────────
    function test_ClaimAllThree() public {
        publishRoot();
        vm.prank(alice);
        xp.claim(1, 1000, proofAlice());
        vm.prank(bob);
        xp.claim(1, 2500, proofBob());
        vm.prank(carol);
        xp.claim(1, 777, proofCarol());

        eq(xp.balanceOf(alice, 1), 1000, "alice bal");
        eq(xp.balanceOf(bob, 1), 2500, "bob bal");
        eq(xp.balanceOf(carol, 1), 777, "carol bal");
        eq(xp.xpOf(bob), 2500, "bob xp");
        eq(xp.totalSupply(1), TOTAL, "supply");
        eq(xp.seasonCap(1), TOTAL, "cap");
        require(xp.claimed(1, alice), "claimed flag");
    }

    function test_ClaimForRelaysToAccount() public {
        publishRoot();
        vm.prank(address(0xBEEF));
        xp.claimFor(bob, 1, 2500, proofBob());
        eq(xp.balanceOf(bob, 1), 2500, "bob bal");
        eq(xp.balanceOf(address(0xBEEF), 1), 0, "relayer bal");
    }

    function test_RevertWhen_DoubleClaim() public {
        publishRoot();
        vm.prank(alice);
        xp.claim(1, 1000, proofAlice());
        vm.prank(alice);
        vm.expectRevert(SimpPoints.AlreadyClaimed.selector);
        xp.claim(1, 1000, proofAlice());
    }

    function test_RevertWhen_WrongAmount() public {
        publishRoot();
        vm.prank(alice);
        vm.expectRevert(SimpPoints.InvalidProof.selector);
        xp.claim(1, 1001, proofAlice());
    }

    function test_RevertWhen_ClaimingSomeoneElsesLeaf() public {
        publishRoot();
        vm.prank(carol);
        vm.expectRevert(SimpPoints.InvalidProof.selector);
        xp.claim(1, 1000, proofAlice());
    }

    function test_RevertWhen_NoRoot() public {
        vm.prank(alice);
        vm.expectRevert(SimpPoints.NoRoot.selector);
        xp.claim(1, 1000, proofAlice());
    }

    function test_RevertWhen_RootResetAfterAClaim() public {
        publishRoot();
        vm.prank(alice);
        xp.claim(1, 1000, proofAlice());
        vm.prank(owner);
        vm.expectRevert(SimpPoints.RootAlreadySet.selector);
        xp.setSeasonRoot(1, bytes32(uint256(1)), TOTAL);
        require(xp.seasonRoot(1) == ROOT, "root kept");
    }

    function test_OwnerResetsRootBeforeAnyClaim() public {
        // a wrong root + total goes out first
        vm.prank(owner);
        xp.setSeasonRoot(1, bytes32(uint256(1)), 999);
        eq(xp.seasonCap(1), 999, "first cap");
        // nothing claimed yet -> the owner can replace both
        publishRoot();
        require(xp.seasonRoot(1) == ROOT, "root replaced");
        eq(xp.seasonCap(1), TOTAL, "cap follows the new total");
        vm.prank(alice);
        xp.claim(1, 1000, proofAlice());
        eq(xp.balanceOf(alice, 1), 1000, "claims against the new root");
    }

    function test_RevertWhen_SeasonZero() public {
        vm.prank(owner);
        vm.expectRevert(SimpPoints.BadSeason.selector);
        xp.setSeasonRoot(0, ROOT, TOTAL);
    }

    function test_RevertWhen_NonOwnerPublishesRoot() public {
        vm.prank(alice);
        vm.expectRevert(SimpPoints.NotOwner.selector);
        xp.setSeasonRoot(1, ROOT, TOTAL);
    }

    function test_RevertWhen_MinterPublishesRootOrCap() public {
        vm.prank(minter);
        vm.expectRevert(SimpPoints.NotOwner.selector);
        xp.setSeasonRoot(1, ROOT, TOTAL);
        vm.prank(minter);
        vm.expectRevert(SimpPoints.NotOwner.selector);
        xp.setSeasonCap(1, TOTAL);
        // and the minter can't reset an existing root either
        publishRoot();
        vm.prank(minter);
        vm.expectRevert(SimpPoints.NotOwner.selector);
        xp.setSeasonRoot(1, bytes32(uint256(1)), TOTAL);
    }

    // ───────────── per-season maximum ─────────────
    function test_MaxSeasonCapHalves() public view {
        eq(xp.maxSeasonCap(0), 0, "s0");
        eq(xp.maxSeasonCap(1), 500_000_000, "s1");
        eq(xp.maxSeasonCap(2), 250_000_000, "s2");
        eq(xp.maxSeasonCap(3), 125_000_000, "s3");
        eq(xp.maxSeasonCap(29), 1, "s29");
        eq(xp.maxSeasonCap(30), 0, "s30");
        eq(xp.maxSeasonCap(300), 0, "s300");
        uint256 sum;
        for (uint256 s = 1; s <= 64; s++) {
            sum += xp.maxSeasonCap(s);
        }
        require(sum <= 1_000_000_000, "all seasons fit in the supply");
    }

    function test_RootAtSeasonMaxAllowed() public {
        vm.prank(owner);
        xp.setSeasonRoot(1, ROOT, 500_000_000);
        eq(xp.seasonCap(1), 500_000_000, "cap");
    }

    function test_RevertWhen_RootAboveSeasonMax() public {
        vm.prank(owner);
        vm.expectRevert(SimpPoints.CapAboveSeasonMax.selector);
        xp.setSeasonRoot(1, ROOT, 500_000_001);
        vm.prank(owner);
        vm.expectRevert(SimpPoints.CapAboveSeasonMax.selector);
        xp.setSeasonRoot(2, ROOT, 250_000_001);
    }

    function test_RevertWhen_CapAboveSeasonMax() public {
        vm.prank(owner);
        vm.expectRevert(SimpPoints.CapAboveSeasonMax.selector);
        xp.setSeasonCap(2, 250_000_001);
        vm.prank(owner);
        vm.expectRevert(SimpPoints.CapAboveSeasonMax.selector);
        xp.setSeasonCap(30, 1);
        setCap(2, 250_000_000);
        eq(xp.seasonCap(2), 250_000_000, "cap at max");
    }

    function test_RevertWhen_RootResetAboveSeasonMax() public {
        publishRoot();
        vm.prank(owner);
        vm.expectRevert(SimpPoints.CapAboveSeasonMax.selector);
        xp.setSeasonRoot(1, ROOT, 500_000_001);
        eq(xp.seasonCap(1), TOTAL, "old cap kept");
    }

    function test_RevertWhen_BatchAfterRoot() public {
        publishRoot();
        (address[] memory a, uint256[] memory v) = batch();
        vm.prank(minter);
        vm.expectRevert(SimpPoints.BatchClosed.selector);
        xp.settleBatch(1, a, v);
        eq(xp.totalSupply(1), 0, "nothing minted");
    }

    // ───────────── batch settlement ─────────────
    function batch() internal view returns (address[] memory a, uint256[] memory v) {
        a = new address[](2);
        v = new uint256[](2);
        a[0] = alice;
        a[1] = bob;
        v[0] = 1000;
        v[1] = 2500;
    }

    function test_SettleBatch() public {
        (address[] memory a, uint256[] memory v) = batch();
        setCap(2, 3500);
        vm.prank(minter);
        xp.settleBatch(2, a, v);
        eq(xp.balanceOf(alice, 2), 1000, "alice s2");
        eq(xp.totalSupply(2), 3500, "s2 supply");
        eq(xp.xpOf(alice), 1000, "alice xp");
    }

    function test_RevertWhen_BatchWithoutCap() public {
        (address[] memory a, uint256[] memory v) = batch();
        vm.prank(minter);
        vm.expectRevert(SimpPoints.CapExceeded.selector);
        xp.settleBatch(2, a, v);
    }

    function test_RevertWhen_BatchOverCap() public {
        (address[] memory a, uint256[] memory v) = batch();
        setCap(2, 3499);
        vm.prank(minter);
        vm.expectRevert(SimpPoints.CapExceeded.selector);
        xp.settleBatch(2, a, v);
    }

    function test_RevertWhen_BatchTwice() public {
        (address[] memory a, uint256[] memory v) = batch();
        setCap(2, 10_000);
        vm.prank(minter);
        xp.settleBatch(2, a, v);
        vm.prank(minter);
        vm.expectRevert(SimpPoints.AlreadyClaimed.selector);
        xp.settleBatch(2, a, v);
    }

    function test_RevertWhen_BatchLengthMismatch() public {
        address[] memory a = new address[](1);
        uint256[] memory v = new uint256[](2);
        vm.prank(minter);
        vm.expectRevert(SimpPoints.LengthMismatch.selector);
        xp.settleBatch(2, a, v);
    }

    function test_RevertWhen_NonMinterBatches() public {
        (address[] memory a, uint256[] memory v) = batch();
        vm.prank(alice);
        vm.expectRevert(SimpPoints.NotMinter.selector);
        xp.settleBatch(2, a, v);
    }

    function test_BatchThenClaimBlocked() public {
        // a minter batch-settles alice, then the root lands: her claim must fail
        address[] memory a = new address[](1);
        uint256[] memory v = new uint256[](1);
        a[0] = alice;
        v[0] = 1000;
        setCap(1, TOTAL);
        vm.prank(minter);
        xp.settleBatch(1, a, v);
        publishRoot(); // same total as the fixed cap -> allowed
        vm.prank(alice);
        vm.expectRevert(SimpPoints.AlreadyClaimed.selector);
        xp.claim(1, 1000, proofAlice());
        eq(xp.totalSupply(1), 1000, "no double mint");
    }

    function test_RevertWhen_RootTotalMismatchesCap() public {
        setCap(1, 100);
        vm.prank(owner);
        vm.expectRevert(SimpPoints.CapMismatch.selector);
        xp.setSeasonRoot(1, ROOT, TOTAL);
    }

    function test_RevertWhen_CapSetTwice() public {
        setCap(3, 100);
        vm.prank(owner);
        vm.expectRevert(SimpPoints.CapAlreadySet.selector);
        xp.setSeasonCap(3, 200);
    }

    // ───────────── soulbound ─────────────
    function test_RevertWhen_Transfer() public {
        publishRoot();
        vm.prank(alice);
        xp.claim(1, 1000, proofAlice());
        vm.prank(alice);
        vm.expectRevert(SimpPoints.Soulbound.selector);
        xp.safeTransferFrom(alice, bob, 1, 1, "");
    }

    function test_RevertWhen_BatchTransfer() public {
        uint256[] memory ids = new uint256[](1);
        uint256[] memory vals = new uint256[](1);
        vm.prank(alice);
        vm.expectRevert(SimpPoints.Soulbound.selector);
        xp.safeBatchTransferFrom(alice, bob, ids, vals, "");
    }

    function test_RevertWhen_Approve() public {
        vm.prank(alice);
        vm.expectRevert(SimpPoints.Soulbound.selector);
        xp.setApprovalForAll(bob, true);
        require(!xp.isApprovedForAll(alice, bob), "approved");
    }

    // ───────────── admin ─────────────
    function test_OwnerManagesMinters() public {
        vm.prank(owner);
        xp.setMinter(alice, true);
        require(xp.isMinter(alice), "minter");
        setCap(2, 3500);
        (address[] memory a, uint256[] memory v) = batch();
        vm.prank(alice);
        xp.settleBatch(2, a, v);
        eq(xp.totalSupply(2), 3500, "minter batched");
        vm.prank(owner);
        xp.setMinter(alice, false);
        require(!xp.isMinter(alice), "revoked");
    }

    function test_RevertWhen_NonOwnerSetsMinter() public {
        vm.prank(minter);
        vm.expectRevert(SimpPoints.NotOwner.selector);
        xp.setMinter(alice, true);
    }

    function test_TransferOwnership() public {
        vm.prank(owner);
        xp.transferOwnership(bob);
        require(xp.owner() == bob, "owner");
        vm.prank(owner);
        vm.expectRevert(SimpPoints.NotOwner.selector);
        xp.setURI("x");
    }

    function test_Interfaces() public view {
        require(xp.supportsInterface(0xd9b67a26), "1155");
        require(xp.supportsInterface(0x0e89341c), "uri");
        require(xp.supportsInterface(0x01ffc9a7), "165");
        require(!xp.supportsInterface(0xffffffff), "bogus");
    }
}
