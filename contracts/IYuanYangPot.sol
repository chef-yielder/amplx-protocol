// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

/**
 * @dev Interface of the YuanYangPot.
 */
interface IYuanYangPot {
	/**
	 * @dev Hotpot Base created per block
	 */
	function hotpotBasePerBlock() external view returns (uint256);

	/**
	 * @dev The Hotpot Base Token
	 */
	function hotpotBaseTotalSupply() external view returns (uint256);

	/**
	 * @dev The block number when Hotpot mining starts.
	 */
	function startBlock() external view returns (uint256);
	
	/**
	 * @dev Update reward vairables for all pools.
	 */
	function massUpdatePools() external;

	/**
	 * @dev Update the Hotpot Base distribution speed.
	 */
	function setHotpotBasePerBlock(uint256 _hotpotBasePerBlock) external;

	/**
	 * @dev Update the distributio share of RED soups; WHITE share = 100% - RED share
	 */
	function setRedPotShare(uint256 _redPotShare) external;

	/**
	 * @dev Update if HotPot is in Circuit Breaker mode. Reward claims are suspended during CB
	 */
	function setCircuitBreaker(bool _isInCircuitBreaker) external;

	/**
	 * @dev Add a new lp to the pool.
	 * XXX DO NOT add the same LP token more than once. Rewards will be messed up if you do.
	 */
	function addPool(
		uint256 _allocPoint,
		IERC20 _lpToken,
		bool _isRed,
		bool _withUpdate
	) external;

	/**
	 * @dev Update the given pool's Hotpot allocation point.
	 */
	function setPool(
		uint256 _pid,
		uint256 _allocPoint,
		bool _withUpdate
	) external;

	/**
	 * @dev Update the tip rate on reward distribution.
	 */
	function setTipRate(uint256 _tipRate) external;

	/**
	 * @dev Transfers ownership of the pot to a new account (`newOwner`).
	 */
	function transferPotOwnership(address newOwner) external;
}
