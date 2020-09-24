pragma solidity 0.6.12;

import '../ChefMao.sol';

contract MockChefMao is ChefMao {
	uint256 public blockNumber = 0;
	uint256 public timestamp = 0;

	uint256 public _priceCumulative;
	uint32 public _blockTimestamp;
	uint256 public _twap;

	constructor(
		IYuanYangPot _masterPot,
		address _uniswapPair,
		address _gov,
		uint256 _targetPrice,
		bool _isToken0
	) public ChefMao(_masterPot, _uniswapPair, _gov, _targetPrice, _isToken0) {}

	function setPriceCumulative(uint256 __priceCumulative) public {
		_priceCumulative = __priceCumulative;
	}

	function setBlockTimestamp(uint32 __blockTimestamp) public {
		_blockTimestamp = __blockTimestamp;
	}

	function setTwap(uint256 __twap) public {
		_twap = __twap;
	}

	function getCurrentTwap()
		public
		override
		view
		returns (
			uint256 priceCumulative,
			uint32 blockTimestamp,
			uint256 twap
		)
	{
		return (_priceCumulative, _blockTimestamp, _twap);
	}

	function setBlockNumber(uint256 bn) public {
		blockNumber = bn;
	}

	function getBlockNumber() public override view returns (uint256) {
		return blockNumber;
	}

	function setTimestamp(uint256 ts) public {
		timestamp = ts;
	}

	function getNow() public override view returns (uint256) {
		return timestamp;
	}
}
