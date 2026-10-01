// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title SimpDAO — on-chain governance for Simp Cult NFT holders (Monad)
/// @notice One NFT = one vote. Votes are cast per tokenId so a token can never
///         vote twice on the same proposal, even if it changes hands mid-vote.
///         Fully on-chain: proposals, votes and tallies live here. No admin can
///         alter a tally; the owner can only tune parameters and cancel spam.
contract SimpDAO is Ownable {
    // ───────────────────────────── types ─────────────────────────────
    enum Support {
        Against,
        For,
        Abstain
    }

    enum State {
        Pending,
        Active,
        Canceled,
        Defeated,
        Succeeded
    }

    struct Proposal {
        address proposer;
        uint64 start; // voting opens (unix)
        uint64 end; // voting closes (unix)
        uint32 forVotes;
        uint32 againstVotes;
        uint32 abstainVotes;
        bool canceled;
        string title;
        string description; // markdown / plain text, or an ipfs:// pointer
    }

    // ───────────────────────────── storage ───────────────────────────
    IERC721 public immutable nft;

    /// @dev NFTs a wallet must hold to open a proposal
    uint256 public proposalThreshold;
    /// @dev minimum total votes (for+against+abstain) for a result to count
    uint256 public quorum;
    /// @dev seconds between creation and voting start
    uint256 public votingDelay;
    /// @dev seconds voting stays open
    uint256 public votingPeriod;
    /// @dev per-wallet cooldown between proposals (anti-spam)
    uint256 public proposalCooldown;

    Proposal[] private _proposals;
    /// proposalId => tokenId => voted
    mapping(uint256 => mapping(uint256 => bool)) public tokenVoted;
    /// proposalId => voter => support chosen (+1 so 0 means "did not vote")
    mapping(uint256 => mapping(address => uint8)) private _receipt;
    /// proposer => last proposal timestamp
    mapping(address => uint256) public lastProposalAt;

    uint256 public constant MAX_TITLE = 120;
    uint256 public constant MAX_DESCRIPTION = 4000;

    // ───────────────────────────── events ────────────────────────────
    event ProposalCreated(uint256 indexed id, address indexed proposer, string title, uint64 start, uint64 end);
    event VoteCast(address indexed voter, uint256 indexed id, Support support, uint256 weight, uint256[] tokenIds);
    event ProposalCanceled(uint256 indexed id, address indexed by);
    event ConfigUpdated(uint256 threshold, uint256 quorum, uint256 delay, uint256 period, uint256 cooldown);

    // ───────────────────────────── errors ────────────────────────────
    error NotEnoughNFTs(uint256 have, uint256 need);
    error Cooldown(uint256 until);
    error BadInput();
    error NotActive();
    error NotTokenOwner(uint256 tokenId);
    error AlreadyVoted(uint256 tokenId);
    error NoVotes();
    error NotAuthorized();
    error VotingEnded();
    error NoSuchProposal();

    constructor(
        address nft_,
        address owner_,
        uint256 threshold_,
        uint256 quorum_,
        uint256 delay_,
        uint256 period_,
        uint256 cooldown_
    ) Ownable(owner_) {
        if (nft_ == address(0) || period_ == 0) revert BadInput();
        nft = IERC721(nft_);
        proposalThreshold = threshold_;
        quorum = quorum_;
        votingDelay = delay_;
        votingPeriod = period_;
        proposalCooldown = cooldown_;
        emit ConfigUpdated(threshold_, quorum_, delay_, period_, cooldown_);
    }

    // ───────────────────────────── write ─────────────────────────────

    /// @notice Open a proposal. Caller must hold >= proposalThreshold NFTs.
    function propose(string calldata title, string calldata description) external returns (uint256 id) {
        uint256 bal = nft.balanceOf(msg.sender);
        if (bal < proposalThreshold) revert NotEnoughNFTs(bal, proposalThreshold);
        if (bytes(title).length == 0 || bytes(title).length > MAX_TITLE) revert BadInput();
        if (bytes(description).length > MAX_DESCRIPTION) revert BadInput();
        uint256 last = lastProposalAt[msg.sender];
        if (last != 0) {
            uint256 until = last + proposalCooldown;
            if (block.timestamp < until) revert Cooldown(until);
        }

        uint64 start = uint64(block.timestamp + votingDelay);
        uint64 end = uint64(start + votingPeriod);

        id = _proposals.length;
        _proposals.push(
            Proposal({
                proposer: msg.sender,
                start: start,
                end: end,
                forVotes: 0,
                againstVotes: 0,
                abstainVotes: 0,
                canceled: false,
                title: title,
                description: description
            })
        );
        lastProposalAt[msg.sender] = block.timestamp;
        emit ProposalCreated(id, msg.sender, title, start, end);
    }

    /// @notice Vote with the NFTs you own. Pass the tokenIds; each counts once per proposal.
    function castVote(uint256 id, Support support, uint256[] calldata tokenIds) external {
        if (id >= _proposals.length) revert NoSuchProposal();
        Proposal storage p = _proposals[id];
        if (state(id) != State.Active) revert NotActive();
        if (tokenIds.length == 0) revert NoVotes();

        uint256 weight;
        for (uint256 i = 0; i < tokenIds.length; ++i) {
            uint256 t = tokenIds[i];
            if (nft.ownerOf(t) != msg.sender) revert NotTokenOwner(t);
            if (tokenVoted[id][t]) revert AlreadyVoted(t);
            tokenVoted[id][t] = true;
            unchecked {
                ++weight;
            }
        }

        // a wallet may vote in several txs (e.g. after acquiring more tokens)
        // but must keep the same choice
        uint8 prev = _receipt[id][msg.sender];
        if (prev != 0 && prev != uint8(support) + 1) revert BadInput();
        _receipt[id][msg.sender] = uint8(support) + 1;

        if (support == Support.For) p.forVotes += uint32(weight);
        else if (support == Support.Against) p.againstVotes += uint32(weight);
        else p.abstainVotes += uint32(weight);

        emit VoteCast(msg.sender, id, support, weight, tokenIds);
    }

    /// @notice Proposer or owner can cancel before voting ends (spam / mistakes).
    function cancel(uint256 id) external {
        if (id >= _proposals.length) revert NoSuchProposal();
        Proposal storage p = _proposals[id];
        if (msg.sender != p.proposer && msg.sender != owner()) revert NotAuthorized();
        if (block.timestamp >= p.end || p.canceled) revert VotingEnded();
        p.canceled = true;
        emit ProposalCanceled(id, msg.sender);
    }

    // ───────────────────────────── admin ─────────────────────────────
    function setConfig(uint256 threshold_, uint256 quorum_, uint256 delay_, uint256 period_, uint256 cooldown_)
        external
        onlyOwner
    {
        if (period_ == 0) revert BadInput();
        proposalThreshold = threshold_;
        quorum = quorum_;
        votingDelay = delay_;
        votingPeriod = period_;
        proposalCooldown = cooldown_;
        emit ConfigUpdated(threshold_, quorum_, delay_, period_, cooldown_);
    }

    // ───────────────────────────── read ──────────────────────────────
    function proposalCount() external view returns (uint256) {
        return _proposals.length;
    }

    function getProposal(uint256 id) external view returns (Proposal memory) {
        if (id >= _proposals.length) revert NoSuchProposal();
        return _proposals[id];
    }

    /// @notice Paginated read for the frontend (newest first is done client-side).
    function getProposals(uint256 offset, uint256 limit) external view returns (Proposal[] memory out) {
        uint256 n = _proposals.length;
        if (offset >= n) return out;
        uint256 endIdx = offset + limit > n ? n : offset + limit;
        out = new Proposal[](endIdx - offset);
        for (uint256 i = offset; i < endIdx; ++i) {
            out[i - offset] = _proposals[i];
        }
    }

    function state(uint256 id) public view returns (State) {
        if (id >= _proposals.length) revert NoSuchProposal();
        Proposal storage p = _proposals[id];
        if (p.canceled) return State.Canceled;
        if (block.timestamp < p.start) return State.Pending;
        if (block.timestamp < p.end) return State.Active;
        uint256 total = uint256(p.forVotes) + p.againstVotes + p.abstainVotes;
        if (total < quorum) return State.Defeated;
        return p.forVotes > p.againstVotes ? State.Succeeded : State.Defeated;
    }

    /// @return support+1 (0 = not voted, 1 = against, 2 = for, 3 = abstain)
    function receipt(uint256 id, address voter) external view returns (uint8) {
        return _receipt[id][voter];
    }

    /// @notice Which of the given tokenIds are still unused on a proposal.
    function unusedTokens(uint256 id, uint256[] calldata tokenIds) external view returns (bool[] memory free) {
        free = new bool[](tokenIds.length);
        for (uint256 i = 0; i < tokenIds.length; ++i) {
            free[i] = !tokenVoted[id][tokenIds[i]];
        }
    }
}
