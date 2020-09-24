pragma solidity 0.6.12;

contract MockUniswapV2Pair {
	constructor() public {}

    uint public price0CumulativeLast;
    uint public price1CumulativeLast;
    uint112 private reserve0;           
    uint112 private reserve1;           
    uint32  private blockTimestampLast; 

    function getReserves() public view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast) {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
        _blockTimestampLast = uint32(block.timestamp % 2 ** 32);
    }

    function setPrice0CumulativeLast(uint256 _price0CumulativeLast) public {
        price0CumulativeLast = _price0CumulativeLast;
    }

    function setPrice1CumulativeLast(uint256 _price1CumulativeLast) public {
        price1CumulativeLast = _price1CumulativeLast;
    }

    function setBlockTimestampLast(uint32 _blockTimestampLast) public {
        blockTimestampLast = _blockTimestampLast;
    }
}
