// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockSafe {
    event SubTxResult(uint256 index, bool success, bytes returnData);

    function executeBatch(address, bytes calldata transactions) external {
        uint256 i = 0;
        uint256 count = 0;
        while (i < transactions.length) {
            address to;
            uint256 value;
            uint256 dataLen;
            
            assembly {
                to := shr(96, calldataload(add(transactions.offset, add(i, 1))))
                value := calldataload(add(transactions.offset, add(i, 21)))
                dataLen := calldataload(add(transactions.offset, add(i, 53)))
            }
            
            bytes memory data = transactions[i + 85 : i + 85 + dataLen];
            
            (bool success, bytes memory res) = to.call{value: value}(data);
            emit SubTxResult(count, success, res);
            
            if (!success) {
                // Try to decode error reason
                if (res.length > 0) {
                    assembly {
                        let returndata_size := mload(res)
                        revert(add(32, res), returndata_size)
                    }
                } else {
                    revert("Sub-transaction failed without reason");
                }
            }
            
            i += 85 + dataLen;
            count++;
        }
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xf23a6e61;
    }
}
