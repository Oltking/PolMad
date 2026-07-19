// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title VerifierBadge
/// @notice POAP-style non-transferable ERC-721 badges for accuracy milestones.
///         Milestones are computed off-chain from PropheyMarket events (the contract
///         has no view of a wallet's history across calls), then minted by the backend.
///
///         Badges are soulbound: a reputation token you can buy is not a reputation
///         token. Minting is the only transfer permitted.
contract VerifierBadge is ERC721, Ownable {
    uint256 public constant FIRST_CORRECT_CALL = 0;
    uint256 public constant FIVE_CALL_STREAK = 1;
    uint256 public constant AGAINST_THE_CROWD = 2;
    uint256 public constant TOP_10_WEEKLY = 3;
    uint256 public constant BADGE_TYPE_COUNT = 4;

    address public minter;
    string private _baseTokenURI;

    uint256 public totalMinted;

    /// @dev tokenId => badge type.
    mapping(uint256 => uint256) public badgeTypeOf;
    /// @dev wallet => badge type => already held. TOP_10_WEEKLY is repeatable, so it is
    ///      exempt from the uniqueness check below.
    mapping(address => mapping(uint256 => bool)) public hasBadge;
    mapping(address => uint256[]) private _owned;

    event BadgeMinted(address indexed to, uint256 indexed tokenId, uint256 indexed badgeType);
    event MinterUpdated(address indexed previousMinter, address indexed newMinter);
    event BaseURIUpdated(string baseURI);

    error NotMinter();
    error UnknownBadgeType(uint256 badgeType);
    error AlreadyHolds(uint256 badgeType);
    error Soulbound();
    error ZeroAddress();

    modifier onlyMinter() {
        if (msg.sender != minter) revert NotMinter();
        _;
    }

    constructor(address initialOwner, address initialMinter, string memory baseURI_)
        ERC721("Polymad Verifier Badge", "PVB")
        Ownable(initialOwner)
    {
        if (initialMinter == address(0)) revert ZeroAddress();
        minter = initialMinter;
        _baseTokenURI = baseURI_;
        emit MinterUpdated(address(0), initialMinter);
    }

    function setMinter(address newMinter) external onlyOwner {
        if (newMinter == address(0)) revert ZeroAddress();
        emit MinterUpdated(minter, newMinter);
        minter = newMinter;
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        _baseTokenURI = baseURI_;
        emit BaseURIUpdated(baseURI_);
    }

    /// @notice Mint a milestone badge. Idempotent per (wallet, type) except for
    ///         TOP_10_WEEKLY, which can legitimately be earned week after week.
    function mintBadge(address to, uint256 badgeType) external onlyMinter returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();
        if (badgeType >= BADGE_TYPE_COUNT) revert UnknownBadgeType(badgeType);
        if (badgeType != TOP_10_WEEKLY && hasBadge[to][badgeType]) revert AlreadyHolds(badgeType);

        tokenId = ++totalMinted;
        badgeTypeOf[tokenId] = badgeType;
        hasBadge[to][badgeType] = true;
        _owned[to].push(tokenId);

        _safeMint(to, tokenId);
        emit BadgeMinted(to, tokenId, badgeType);
    }

    function badgesOf(address wallet) external view returns (uint256[] memory) {
        return _owned[wallet];
    }

    /// @dev Metadata is per badge type, not per token — every FIVE_CALL_STREAK badge
    ///      looks the same, so the URI keys off the type.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(_baseTokenURI, Strings.toString(badgeTypeOf[tokenId]), ".json");
    }

    /// @dev Soulbound: allow mint (from == 0), block every wallet-to-wallet move.
    ///      Burning is not offered — you do not get to delete a bad record, and there
    ///      is no bad record here anyway.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }
}
