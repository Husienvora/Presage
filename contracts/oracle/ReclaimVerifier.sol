// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Minimal struct definitions matching the Reclaim Protocol singleton contract.

interface IProofVerifier {
    function verify(bytes calldata proof) external view returns (uint256 timestamp, uint256 positionId, uint256 price);
}

struct CompleteClaimData {
    bytes32 identifier;
    address owner;
    uint32 timestampS;
    uint32 epoch;
}

struct ClaimInfo {
    string provider;
    string parameters;
    string context;
}

struct SignedClaim {
    CompleteClaimData claim;
    bytes[] signatures;
}

struct ReclaimProof {
    ClaimInfo claimInfo;
    SignedClaim signedClaim;
}

interface IReclaim {
    function verifyProof(ReclaimProof memory proof) external view;
}

/// @title ReclaimVerifier
/// @notice Platform-agnostic zkTLS verifier for prediction market price proofs.
///         Verifies Reclaim Protocol proofs, validates the source URL against a whitelist
///         of approved endpoints, and maps the market identifier to a CTF positionId.
///
///         Supports any prediction market platform (predict.fun, OPINION, Polymarket, etc.)
///         as long as the proof microservice uses zk-fetch with a standardized regex that
///         captures a named group called "price".
///
///         zk-fetch proof context format:
///           {"extractedParameters":{"price":"0.65"}, ...}
///
///         zk-fetch proof parameters format (contains the URL):
///           {"url":"https://api.predict.fun/v1/markets/900/orderbook", ...}
contract ReclaimVerifier is IProofVerifier, Ownable {
    IReclaim public immutable reclaim;

    /// @notice Approved endpoint prefixes. A proof's URL must start with one of these.
    ///         e.g. "https://api.predict.fun/v1/markets/"
    ///         e.g. "https://openapi.opinion.trade/openapi/price?token_id="
    mapping(uint256 index => string) public endpoints;
    uint256 public endpointCount;

    /// @notice Maps a source key to a CTF positionId.
    ///         Key = keccak256(endpointPrefix, marketIdentifier)
    ///         e.g. keccak256("https://api.predict.fun/v1/markets/", "900")
    mapping(bytes32 => uint256) public positionIds;

    event EndpointAdded(uint256 indexed index, string endpoint);
    event EndpointRemoved(uint256 indexed index);
    event PositionMapped(bytes32 indexed key, uint256 positionId);

    constructor(address reclaim_) Ownable(msg.sender) {
        require(reclaim_ != address(0), "zero reclaim");
        reclaim = IReclaim(reclaim_);
    }

    // ══════════════ ADMIN ══════════════

    function addEndpoint(string calldata endpoint) external onlyOwner returns (uint256 index) {
        index = endpointCount++;
        endpoints[index] = endpoint;
        emit EndpointAdded(index, endpoint);
    }

    function removeEndpoint(uint256 index) external onlyOwner {
        require(bytes(endpoints[index]).length > 0, "no endpoint");
        delete endpoints[index];
        emit EndpointRemoved(index);
    }

    /// @notice Map a (endpoint, marketId) pair to a CTF positionId.
    /// @param endpoint  The approved endpoint prefix (must match an entry in endpoints[]).
    /// @param marketId  The market identifier as it appears in the URL (e.g. "900").
    /// @param _positionId The CTF positionId this market resolves to.
    function mapPosition(string calldata endpoint, string calldata marketId, uint256 _positionId) external onlyOwner {
        bytes32 key = keccak256(abi.encodePacked(endpoint, marketId));
        positionIds[key] = _positionId;
        emit PositionMapped(key, _positionId);
    }

    // ══════════════ VERIFICATION ══════════════

    function verify(bytes calldata proof) external view override returns (uint256 timestamp, uint256 positionId, uint256 price) {
        ReclaimProof memory p = abi.decode(proof, (ReclaimProof));

        // 1. Verify proof via Reclaim singleton (checks witness signatures + epoch)
        reclaim.verifyProof(p);

        // 2. Extract timestamp
        timestamp = p.signedClaim.claim.timestampS;

        // 3. Extract URL from parameters and validate against approved endpoints
        string memory url = _extractField(p.claimInfo.parameters, '"url":"');
        require(bytes(url).length > 0, "no url in proof");

        (string memory matchedEndpoint, string memory marketId) = _matchEndpoint(url);
        require(bytes(matchedEndpoint).length > 0, "unapproved endpoint");

        // 4. Resolve positionId from (endpoint, marketId) mapping
        bytes32 key = keccak256(abi.encodePacked(matchedEndpoint, marketId));
        positionId = positionIds[key];
        require(positionId != 0, "unmapped market");

        // 5. Extract price from context: {"extractedParameters":{"price":"0.65"}, ...}
        string memory priceStr = _extractField(p.claimInfo.context, '"price":"');
        require(bytes(priceStr).length > 0, "no price in proof");
        price = _parseDecimalToWad(priceStr);
        require(price <= 1e18, "price > 1");
    }

    // ══════════════ INTERNALS ══════════════

    /// @dev Checks url against all approved endpoints. Returns the matched endpoint prefix
    ///      and the remaining path segment (marketId) between the prefix and the next '/'.
    function _matchEndpoint(string memory url) internal view returns (string memory endpoint, string memory marketId) {
        bytes memory urlBytes = bytes(url);

        for (uint256 i; i < endpointCount; i++) {
            bytes memory ep = bytes(endpoints[i]);
            if (ep.length == 0 || urlBytes.length <= ep.length) continue;

            bool match_ = true;
            for (uint256 j; j < ep.length; j++) {
                if (urlBytes[j] != ep[j]) { match_ = false; break; }
            }
            if (!match_) continue;

            // Extract the market identifier: everything after the prefix up to '/' or '?' or '"' or end
            uint256 start = ep.length;
            uint256 end = start;
            while (end < urlBytes.length && urlBytes[end] != '/' && urlBytes[end] != '?' && urlBytes[end] != '"' && urlBytes[end] != '&') {
                end++;
            }
            if (end > start) {
                bytes memory id = new bytes(end - start);
                for (uint256 k; k < end - start; k++) id[k] = urlBytes[start + k];
                return (endpoints[i], string(id));
            }
        }
    }

    /// @dev Extracts a quoted value after a target needle in a JSON-like string.
    function _extractField(string memory data, string memory target) internal pure returns (string memory) {
        bytes memory d = bytes(data);
        bytes memory t = bytes(target);
        if (d.length < t.length) return "";

        uint256 start;
        bool found;
        for (uint256 i; i <= d.length - t.length; i++) {
            bool isMatch = true;
            for (uint256 j; j < t.length && isMatch; j++) {
                if (d[i + j] != t[j]) isMatch = false;
            }
            if (isMatch) { start = i + t.length; found = true; break; }
        }
        if (!found) return "";

        uint256 end = start;
        while (end < d.length && d[end] != '"') end++;
        if (end <= start) return "";

        bytes memory result = new bytes(end - start);
        for (uint256 i = start; i < end; i++) result[i - start] = d[i];
        return string(result);
    }

    /// @dev Parses a decimal string (e.g. "0.65") into 18-decimal WAD.
    function _parseDecimalToWad(string memory s) internal pure returns (uint256) {
        bytes memory b = bytes(s);
        require(b.length > 0, "empty");

        uint256 wholePart;
        uint256 fracPart;
        uint256 fracDigits;
        bool pastDot;

        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == 0x2e) { require(!pastDot, "double dot"); pastDot = true; continue; }
            require(c >= 0x30 && c <= 0x39, "NaN");
            uint8 digit = uint8(c) - 48;
            if (!pastDot) wholePart = wholePart * 10 + digit;
            else { fracPart = fracPart * 10 + digit; fracDigits++; }
        }

        uint256 wad = wholePart * 1e18;
        if (fracDigits > 0) wad += (fracPart * 1e18) / (10 ** fracDigits);
        return wad;
    }
}
