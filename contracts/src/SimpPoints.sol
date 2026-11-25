// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SimpPoints — soulbound season XP for the Simp Cult (Monad)
/// @notice One ERC-1155 id per season (id = season number). Balances can only
///         be minted by settlement and can never move: every transfer and
///         approval path reverts. Wallets and explorers still read it as a
///         normal ERC-1155 (balanceOf / uri / TransferSingle on mint).
///
///         Settlement (per season, by a minter):
///           a) merkle: `setSeasonRoot(season, root, total)` once, then each
///              holder calls `claim(season, amount, proof)` (or anyone claims
///              on their behalf via `claimFor` — XP always lands on `account`).
///           b) batch: `settleBatch(season, accounts, amounts)` mints directly.
///         Both paths share one `claimed` flag per (season, account), so an
///         account can never be settled twice, and every mint is checked
///         against the season cap fixed on first settlement.
///
///         Leaf = keccak256(bytes.concat(keccak256(abi.encode(account, season, amount)))).
///         Pairs are hashed sorted (OpenZeppelin MerkleProof compatible).
///         Self-contained: no external imports.
contract SimpPoints {
    // ───────────────────────────── errors ─────────────────────────────
    error Soulbound();
    error NotOwner();
    error NotMinter();
    error ZeroAddress();
    error BadSeason();
    error RootAlreadySet();
    error NoRoot();
    error AlreadyClaimed();
    error InvalidProof();
    error CapExceeded();
    error CapAlreadySet();
    error CapMismatch();
    error LengthMismatch();
    error ZeroAmount();

    // ───────────────────────────── events ─────────────────────────────
    // ERC-1155
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values);
    event ApprovalForAll(address indexed account, address indexed operator, bool approved);
    event URI(string value, uint256 indexed id);
    // admin
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MinterSet(address indexed minter, bool allowed);
    event SeasonCapSet(uint256 indexed season, uint256 cap);
    event SeasonRootSet(uint256 indexed season, bytes32 root, uint256 total);
    event Settled(uint256 indexed season, address indexed account, uint256 amount);

    // ───────────────────────────── metadata ─────────────────────────────
    string public constant name = "Simp Cult XP";
    string public constant symbol = "SIMPXP";

    // ───────────────────────────── storage ─────────────────────────────
    address public owner;
    mapping(address => bool) public isMinter;

    string private _uri;

    /// balance[season][account]
    mapping(uint256 => mapping(address => uint256)) private _balances;
    /// total XP per account across all seasons
    mapping(address => uint256) public xpOf;
    /// minted per season
    mapping(uint256 => uint256) public totalSupply;
    /// max mintable per season (fixed once set; 0 = not set yet)
    mapping(uint256 => uint256) public seasonCap;
    /// merkle root per season (set once)
    mapping(uint256 => bytes32) public seasonRoot;
    /// settled flag per season per account (shared by claim + batch)
    mapping(uint256 => mapping(address => bool)) public claimed;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyMinter() {
        if (!isMinter[msg.sender]) revert NotMinter();
        _;
    }

    constructor(address owner_, address minter_, string memory uri_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
        if (minter_ != address(0)) {
            isMinter[minter_] = true;
            emit MinterSet(minter_, true);
        }
        _uri = uri_;
    }

    // ───────────────────────────── admin ─────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setMinter(address minter, bool allowed) external onlyOwner {
        if (minter == address(0)) revert ZeroAddress();
        isMinter[minter] = allowed;
        emit MinterSet(minter, allowed);
    }

    function setURI(string calldata uri_) external onlyOwner {
        _uri = uri_;
        emit URI(uri_, 0);
    }

    // ───────────────────────────── settlement ─────────────────────────────

    /// @notice Publish a season's merkle root and its total (becomes the cap). Once only.
    function setSeasonRoot(uint256 season, bytes32 root, uint256 total) external onlyMinter {
        if (season == 0) revert BadSeason();
        if (root == bytes32(0)) revert NoRoot();
        if (seasonRoot[season] != bytes32(0)) revert RootAlreadySet();
        if (total == 0) revert ZeroAmount();
        seasonRoot[season] = root;
        _fixCap(season, total);
        emit SeasonRootSet(season, root, total);
    }

    /// @notice Fix a season's cap ahead of a batch settlement. Once only.
    function setSeasonCap(uint256 season, uint256 cap) external onlyMinter {
        if (season == 0) revert BadSeason();
        if (cap == 0) revert ZeroAmount();
        if (seasonCap[season] != 0) revert CapAlreadySet();
        _fixCap(season, cap);
    }

    /// @notice Claim your own season XP with a merkle proof.
    function claim(uint256 season, uint256 amount, bytes32[] calldata proof) external {
        _claim(msg.sender, season, amount, proof);
    }

    /// @notice Relay a claim for `account` (gasless for the holder). XP still goes to `account`.
    function claimFor(address account, uint256 season, uint256 amount, bytes32[] calldata proof) external {
        _claim(account, season, amount, proof);
    }

    /// @notice Mint season XP directly. The season cap must be fixed first.
    function settleBatch(uint256 season, address[] calldata accounts, uint256[] calldata amounts) external onlyMinter {
        if (season == 0) revert BadSeason();
        if (accounts.length != amounts.length) revert LengthMismatch();
        for (uint256 i = 0; i < accounts.length; i++) {
            _settle(accounts[i], season, amounts[i]);
        }
    }

    function _claim(address account, uint256 season, uint256 amount, bytes32[] calldata proof) internal {
        bytes32 root = seasonRoot[season];
        if (root == bytes32(0)) revert NoRoot();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, season, amount))));
        if (!_verify(proof, root, leaf)) revert InvalidProof();
        _settle(account, season, amount);
    }

    function _settle(address account, uint256 season, uint256 amount) internal {
        if (account == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (claimed[season][account]) revert AlreadyClaimed();
        uint256 cap = seasonCap[season];
        if (cap == 0 || totalSupply[season] + amount > cap) revert CapExceeded();
        claimed[season][account] = true;
        totalSupply[season] += amount;
        _balances[season][account] += amount;
        xpOf[account] += amount;
        emit TransferSingle(msg.sender, address(0), account, season, amount);
        emit Settled(season, account, amount);
    }

    function _fixCap(uint256 season, uint256 cap) internal {
        if (seasonCap[season] == 0) {
            seasonCap[season] = cap;
            emit SeasonCapSet(season, cap);
        } else if (seasonCap[season] != cap) {
            // a batch cap was fixed earlier; the root's total must match it
            revert CapMismatch();
        }
    }

    function _verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 h = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            h = h < p ? keccak256(abi.encodePacked(h, p)) : keccak256(abi.encodePacked(p, h));
        }
        return h == root;
    }

    // ───────────────────────────── ERC-1155 views ─────────────────────────────

    function balanceOf(address account, uint256 id) external view returns (uint256) {
        if (account == address(0)) revert ZeroAddress();
        return _balances[id][account];
    }

    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids) external view returns (uint256[] memory out) {
        if (accounts.length != ids.length) revert LengthMismatch();
        out = new uint256[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) {
            out[i] = _balances[ids[i]][accounts[i]];
        }
    }

    function uri(uint256) external view returns (string memory) {
        return _uri;
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC-165
            interfaceId == 0xd9b67a26 || // ERC-1155
            interfaceId == 0x0e89341c; // ERC-1155 metadata URI
    }

    // ───────────────────────────── soulbound ─────────────────────────────

    function setApprovalForAll(address, bool) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256, uint256, bytes calldata) external pure {
        revert Soulbound();
    }

    function safeBatchTransferFrom(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
    {
        revert Soulbound();
    }
}
