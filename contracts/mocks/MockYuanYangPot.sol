pragma solidity 0.6.12;

import '../YuanYangPot.sol';

contract MockYuanYangPot is YuanYangPot {
	uint256 public blockNumber = 0;

	constructor(
		HotpotBaseToken _hotpotBase,
		address _devAddr,
		uint256 _hotpotBasePerBlock,
		uint256 _startBlock,
		uint256 _tipRate
	) public YuanYangPot(_hotpotBase, _devAddr, _hotpotBasePerBlock, _startBlock, _tipRate) {}

	function setBlockNumber(uint256 bn) public {
		blockNumber = bn;
	}

	function getBlockNumber() public override view returns (uint256) {
		return blockNumber;
	}

	function setUserInfo(
		uint256 pid,
		address userAddr,
		uint256 amount,
		uint256 rewardOffset,
		uint256 reward
	) public {
		userInfo[pid][userAddr] = UserInfo({
			amount: amount,
			rewardOffset: rewardOffset,
			reward: reward
		});
	}
}
