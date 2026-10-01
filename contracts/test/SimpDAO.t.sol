// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {SimpDAO} from "../src/SimpDAO.sol";

contract MockSimp is ERC721 {
    constructor() ERC721("Monad Simp Cult", "SIMP") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

contract SimpDAOTest is Test {
    MockSimp nft;
    SimpDAO dao;

    address owner = address(0xA11CE);
    address alice = address(0xA1);
    address bob = address(0xB0B);
    address carol = address(0xCA);

    uint256[] aliceTokens = [1, 2, 3];
    uint256[] bobTokens = [10];

    function setUp() public {
        nft = new MockSimp();
        for (uint256 i = 0; i < aliceTokens.length; i++) nft.mint(alice, aliceTokens[i]);
        nft.mint(bob, 10);
        // threshold 1, quorum 3, no delay, 3 day period, 1 hour cooldown
        dao = new SimpDAO(address(nft), owner, 1, 3, 0, 3 days, 1 hours);
    }

    function _propose(address who) internal returns (uint256) {
        vm.prank(who);
        return dao.propose("buy a monad billboard", "spend treasury on lore");
    }

    function test_nonHolderCannotPropose() public {
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(SimpDAO.NotEnoughNFTs.selector, 0, 1));
        dao.propose("x", "y");
    }

    function test_proposeAndVote() public {
        uint256 id = _propose(alice);
        assertEq(dao.proposalCount(), 1);
        assertEq(uint256(dao.state(id)), uint256(SimpDAO.State.Active));

        vm.prank(alice);
        dao.castVote(id, SimpDAO.Support.For, aliceTokens);
        vm.prank(bob);
        dao.castVote(id, SimpDAO.Support.Against, bobTokens);

        SimpDAO.Proposal memory p = dao.getProposal(id);
        assertEq(p.forVotes, 3);
        assertEq(p.againstVotes, 1);
        assertEq(dao.receipt(id, alice), uint8(SimpDAO.Support.For) + 1);

        vm.warp(block.timestamp + 3 days + 1);
        assertEq(uint256(dao.state(id)), uint256(SimpDAO.State.Succeeded));
    }

    function test_tokenCannotVoteTwice_evenAfterTransfer() public {
        uint256 id = _propose(alice);
        uint256[] memory one = new uint256[](1);
        one[0] = 1;

        vm.prank(alice);
        dao.castVote(id, SimpDAO.Support.For, one);

        // alice sends token 1 to carol; carol tries to vote with it
        vm.prank(alice);
        nft.transferFrom(alice, carol, 1);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(SimpDAO.AlreadyVoted.selector, 1));
        dao.castVote(id, SimpDAO.Support.Against, one);
    }

    function test_cannotVoteWithSomeoneElsesToken() public {
        uint256 id = _propose(alice);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(SimpDAO.NotTokenOwner.selector, 1));
        dao.castVote(id, SimpDAO.Support.For, aliceTokens);
    }

    function test_quorumDefeats() public {
        uint256 id = _propose(bob);
        vm.prank(bob);
        dao.castVote(id, SimpDAO.Support.For, bobTokens); // 1 vote < quorum 3
        vm.warp(block.timestamp + 3 days + 1);
        assertEq(uint256(dao.state(id)), uint256(SimpDAO.State.Defeated));
    }

    function test_voteAfterEndReverts() public {
        uint256 id = _propose(alice);
        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(alice);
        vm.expectRevert(SimpDAO.NotActive.selector);
        dao.castVote(id, SimpDAO.Support.For, aliceTokens);
    }

    function test_cancelByProposerAndOwnerOnly() public {
        uint256 id = _propose(alice);
        vm.prank(bob);
        vm.expectRevert(SimpDAO.NotAuthorized.selector);
        dao.cancel(id);

        vm.prank(owner);
        dao.cancel(id);
        assertEq(uint256(dao.state(id)), uint256(SimpDAO.State.Canceled));
    }

    function test_cooldown() public {
        _propose(alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SimpDAO.Cooldown.selector, block.timestamp + 1 hours));
        dao.propose("again", "");
        vm.warp(block.timestamp + 1 hours);
        _propose(alice);
        assertEq(dao.proposalCount(), 2);
    }

    function test_mustKeepSameChoiceAcrossTxs() public {
        uint256 id = _propose(alice);
        uint256[] memory t1 = new uint256[](1);
        t1[0] = 1;
        uint256[] memory t2 = new uint256[](1);
        t2[0] = 2;
        vm.prank(alice);
        dao.castVote(id, SimpDAO.Support.For, t1);
        vm.prank(alice);
        vm.expectRevert(SimpDAO.BadInput.selector);
        dao.castVote(id, SimpDAO.Support.Against, t2);
        vm.prank(alice);
        dao.castVote(id, SimpDAO.Support.For, t2);
        assertEq(dao.getProposal(id).forVotes, 2);
    }

    function test_votingDelayPending() public {
        vm.prank(owner);
        dao.setConfig(1, 3, 1 hours, 3 days, 0);
        uint256 id = _propose(alice);
        assertEq(uint256(dao.state(id)), uint256(SimpDAO.State.Pending));
        vm.prank(alice);
        vm.expectRevert(SimpDAO.NotActive.selector);
        dao.castVote(id, SimpDAO.Support.For, aliceTokens);
        vm.warp(block.timestamp + 1 hours);
        assertEq(uint256(dao.state(id)), uint256(SimpDAO.State.Active));
    }

    function test_pagination() public {
        vm.prank(owner);
        dao.setConfig(1, 3, 0, 3 days, 0);
        for (uint256 i = 0; i < 5; i++) _propose(alice);
        SimpDAO.Proposal[] memory page = dao.getProposals(3, 10);
        assertEq(page.length, 2);
        assertEq(dao.getProposals(9, 10).length, 0);
    }

    function test_onlyOwnerSetsConfig() public {
        vm.prank(alice);
        vm.expectRevert();
        dao.setConfig(1, 1, 0, 1 days, 0);
    }
}
