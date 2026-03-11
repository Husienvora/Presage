// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Minimal struct definitions matching the Reclaim Protocol singleton contract.
///      Inlined to avoid Solidity version conflicts with the npm package.

interface IProofVerifier {
    function verify(bytes calldata proof) external view returns (uint256 timestamp, uint256 positionId, uint256 price);
}

/// @dev Mirrors Claims.CompleteClaimData from Reclaim
struct CompleteClaimData {
    bytes32 identifier;
    address owner;
    uint32 timestampS;
    uint32 epoch;
}

/// @dev Mirrors Claims.ClaimInfo from Reclaim
struct ClaimInfo {
    string provider;
    string parameters;
    string context;
}

/// @dev Mirrors Claims.SignedClaim from Reclaim
struct SignedClaim {
    CompleteClaimData claim;
    bytes[] signatures;
}

/// @dev Mirrors Reclaim.Proof from Reclaim
struct ReclaimProof {
    ClaimInfo claimInfo;
    SignedClaim signedClaim;
}

/// @dev Interface for calling verifyProof on the deployed Reclaim singleton
interface IReclaim {
    // The Reclaim singleton defines its own Proof struct, but the ABI encoding
    // is identical to our local ReclaimProof when using abi.encode/decode.
    function verifyProof(ReclaimProof memory proof) external view;
}

/// @title ReclaimVerifier
/// @notice Verifies zkTLS proofs from Reclaim Protocol and extracts predict.fun price data.
///         Each instance is bound to a specific provider + CTF position.
contract ReclaimVerifier is IProofVerifier {
    address public immutable reclaimAddress;
    uint256 public immutable positionId;
    string public expectedProvider;
    string public priceField; // JSON key to extract, e.g. "lastPrice"

    /// @param _reclaimAddress Address of the deployed Reclaim singleton on this chain.
    /// @param _positionId     The CTF position ID this verifier maps to.
    /// @param _provider       Expected provider string (must match proof's claimInfo.provider).
    /// @param _priceField     The JSON field name in the proof context holding the price value.
    constructor(
        address _reclaimAddress,
        uint256 _positionId,
        string memory _provider,
        string memory _priceField
    ) {
        reclaimAddress = _reclaimAddress;
        positionId = _positionId;
        expectedProvider = _provider;
        priceField = _priceField;
    }

    /// @notice Verifies a Reclaim proof and extracts price data.
    /// @param proof The ABI-encoded ReclaimProof struct.
    function verify(bytes calldata proof) external view override returns (uint256 timestamp, uint256 _positionId, uint256 price) {
        ReclaimProof memory reclaimProof = abi.decode(proof, (ReclaimProof));

        // 1. Verify proof signatures and witnesses via Reclaim singleton
        IReclaim(reclaimAddress).verifyProof(reclaimProof);

        // 2. Validate provider matches expected source
        require(
            keccak256(bytes(reclaimProof.claimInfo.provider)) == keccak256(bytes(expectedProvider)),
            "ReclaimVerifier: wrong provider"
        );

        // 3. Extract timestamp from the signed claim
        timestamp = reclaimProof.signedClaim.claim.timestampS;

        // 4. Extract price from the context field
        //    Context JSON looks like: {"extractedParameters":{"lastPrice":"0.65"}, ...}
        string memory target = string(abi.encodePacked('"', priceField, '":"'));
        string memory priceStr = _extractField(reclaimProof.claimInfo.context, target);
        require(bytes(priceStr).length > 0, "ReclaimVerifier: price not found in proof");
        price = _parseDecimalToWad(priceStr);
        require(price <= 1e18, "ReclaimVerifier: price > 1");

        // 5. Return the stored positionId for this verifier instance
        _positionId = positionId;

        return (timestamp, _positionId, price);
    }

    // ──────── Internal helpers ────────

    /// @dev Extracts a quoted field value from a JSON-like string.
    ///      Searches for `target` (e.g. `"lastPrice":"`) and returns the value up to the closing quote.
    ///      Equivalent to Claims.extractFieldFromContext in the Reclaim SDK.
    function _extractField(string memory data, string memory target) internal pure returns (string memory) {
        bytes memory d = bytes(data);
        bytes memory t = bytes(target);

        if (d.length < t.length) return "";

        // Find the target substring
        uint256 start;
        bool found;
        for (uint256 i; i <= d.length - t.length; i++) {
            bool isMatch = true;
            for (uint256 j; j < t.length && isMatch; j++) {
                if (d[i + j] != t[j]) isMatch = false;
            }
            if (isMatch) {
                start = i + t.length;
                found = true;
                break;
            }
        }
        if (!found) return "";

        // Find the closing quote (unescaped)
        uint256 end = start;
        while (end < d.length && !(d[end] == '"' && (end == 0 || d[end - 1] != '\\'))) {
            end++;
        }
        if (end <= start) return "";

        // Extract substring
        bytes memory result = new bytes(end - start);
        for (uint256 i = start; i < end; i++) {
            result[i - start] = d[i];
        }
        return string(result);
    }

    /// @notice Parses a decimal string (e.g. "0.65", "1", "0.123") into 18-decimal WAD.
    function _parseDecimalToWad(string memory s) internal pure returns (uint256) {
        bytes memory b = bytes(s);
        require(b.length > 0, "ReclaimVerifier: empty string");

        uint256 wholePart;
        uint256 fracPart;
        uint256 fracDigits;
        bool pastDot;

        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == 0x2e) { // "."
                require(!pastDot, "ReclaimVerifier: double dot");
                pastDot = true;
                continue;
            }
            require(c >= 0x30 && c <= 0x39, "ReclaimVerifier: not a digit");
            uint8 digit = uint8(c) - 48;
            if (!pastDot) {
                wholePart = wholePart * 10 + digit;
            } else {
                fracPart = fracPart * 10 + digit;
                fracDigits++;
            }
        }

        uint256 wad = wholePart * 1e18;
        if (fracDigits > 0) {
            wad += (fracPart * 1e18) / (10 ** fracDigits);
        }
        return wad;
    }
}
