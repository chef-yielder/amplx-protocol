// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import './HotpotBaseToken.sol';
import './IYuanYangPot.sol';

contract YuanYangPot is IYuanYangPot, Ownable {
	using SafeMath for uint256;
	using SafeERC20 for IERC20;

	// Info of each user.
	struct UserInfo {
		uint256 amount; // How many LP tokens the user has provided.
		uint256 rewardOffset; // Reward offset. See explanation below.
		uint256 reward; // Reward accrued.
		//
		// We do some fancy math here. Basically, any point in time, the amount of tokens
		// entitled to a user but is pending to be distributed is:
		//
		//   pending reward = (user.amount * pool.accHotpotBasePerShare) - user.rewardOffset
		//
		// Whenever a user deposits or withdraws LP tokens to a pool. Here's what happens:
		//   1. The pool's `accHotpotBasePerShare` (and `lastRewardBlock`) gets updated.
		//   2. User's `amount` gets updated.
		//   3. User's `rewardOffset` gets updated.
	}

	// Info of each pool.
	struct PoolInfo {
		IERC20 lpToken; // Address of LP token contract.
		uint256 allocPoint; // How many allocation points assigned to this pool. Hotpot to distribute per block.
		bool isRed; // If the pool is in Red soup, otherwise in White soup.
		uint256 lastRewardBlock; // Last block number that Hotpot Base distribution occurs.
		uint256 accHotpotBasePerShare; // Accumulated Hotpot Base per share, times 1e12. See below.
	}

	// The Hotpot Base Token
	HotpotBaseToken public hotpotBase;
	// Dev address.
	address public devAddr;
	// Hotpot Base created per block.
	uint256 private _hotpotBasePerBlock;
	// Share of Hotpot Base production by Red Soup, times 1e12.
	uint256 public redPotShare = 5e11;
	// Tip rate for frontend providers, times 1e12.
	uint256 public tipRate;
	// Determine if the HGB rewards can be collected.
	bool public inCircuitBreaker = false;

	// Info of each pool.
	PoolInfo[] public poolInfo;
	// Info of each user that stakes LP tokens.
	mapping(uint256 => mapping(address => UserInfo)) public userInfo;
	// Total allocation points. Must be the sum of all allocation points in RED soup.
	uint256 public totalRedAllocPoint = 0;
	// Total allocation points. Must be the sum of all allocation points in WHITE soup.
	uint256 public totalWhiteAllocPoint = 0;
	// The block number when Hotpot mining starts.
	uint256 private _startBlock;

	event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
	event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
	event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
	event ClaimReward(
		address indexed user,
		uint256 indexed pid,
		address indexed waiter,
		uint256 amount
	);

	constructor(
		HotpotBaseToken _hotpotBase,
		address _devAddr,
		uint256 __hotpotBasePerBlock,
		uint256 __startBlock,
		uint256 _tipRate
	) public {
		hotpotBase = _hotpotBase;
		devAddr = _devAddr;
		_hotpotBasePerBlock = __hotpotBasePerBlock;
		_startBlock = __startBlock;
		tipRate = _tipRate;
	}

	function hotpotBasePerBlock() external override view returns (uint256) {
		return _hotpotBasePerBlock;
	}

	function hotpotBaseTotalSupply() external override view returns (uint256) {
		return hotpotBase.totalSupply();
	}

	function startBlock() external override view returns (uint256) {
		return _startBlock;
	}

	function poolLength() external view returns (uint256) {
		return poolInfo.length;
	}

	// Add a new lp to the pool.
	// XXX DO NOT add the same LP token more than once. Rewards will be messed up if you do.
	function addPool(
		uint256 _allocPoint,
		IERC20 _lpToken,
		bool _isRed,
		bool _withUpdate
	) public override onlyOwner {
		if (_withUpdate) {
			massUpdatePools();
		}
		uint256 blockNumber = getBlockNumber();
		uint256 lastRewardBlock = blockNumber > _startBlock ? blockNumber : _startBlock;
		if (_isRed) {
			totalRedAllocPoint = totalRedAllocPoint.add(_allocPoint);
		} else {
			totalWhiteAllocPoint = totalWhiteAllocPoint.add(_allocPoint);
		}
		poolInfo.push(
			PoolInfo({
				lpToken: _lpToken,
				allocPoint: _allocPoint,
				isRed: _isRed,
				lastRewardBlock: lastRewardBlock,
				accHotpotBasePerShare: 0
			})
		);
	}

	// Update the given pool's Hotpot allocation point.
	function setPool(
		uint256 _pid,
		uint256 _allocPoint,
		bool _withUpdate
	) public override onlyOwner {
		if (_withUpdate) {
			massUpdatePools();
		}

		if (_pid >= poolInfo.length) return;

		if (poolInfo[_pid].isRed) {
			totalRedAllocPoint = totalRedAllocPoint.sub(poolInfo[_pid].allocPoint).add(_allocPoint);
		} else {
			totalWhiteAllocPoint = totalWhiteAllocPoint.sub(poolInfo[_pid].allocPoint).add(
				_allocPoint
			);
		}
		poolInfo[_pid].allocPoint = _allocPoint;
	}

	// Update if Hotpot is in Circuit Breaker mode. Reward claims are suspended during CB - see getReward()
	function setCircuitBreaker(bool _inCircuitBreaker) public override onlyOwner {
		inCircuitBreaker = _inCircuitBreaker;
	}

	// Update the Hotpot Base distribution speed.
	function setHotpotBasePerBlock(uint256 __hotpotBasePerBlock) public override onlyOwner {
		_hotpotBasePerBlock = __hotpotBasePerBlock;
	}

	// Update the tip rate on reward distribution - see getReward().
	function setTipRate(uint256 _tipRate) public override onlyOwner {
		require(_tipRate < 1e12, 'tipRate: too high');
		tipRate = _tipRate;
	}

	// Update the distributio share of RED soups; WHITE share = 100% - RED share
	function setRedPotShare(uint256 _redPotShare) public override onlyOwner {
		require(_redPotShare < 1e12, 'redPotShare: too high');
		redPotShare = _redPotShare;
	}

	// Return reward Hotpot Base amount over the given _from to _to block for pool _pid.
	function getPoolHotpotBaseReward(
		uint256 _from,
		uint256 _to,
		uint256 _pid
	) public view returns (uint256) {
		PoolInfo storage pool = poolInfo[_pid];
		uint256 totalHotpotBaseReward = _to.sub(_from).mul(_hotpotBasePerBlock);
		if (pool.isRed) {
			return
				totalHotpotBaseReward
					.mul(pool.allocPoint)
					.mul(redPotShare)
					.div(totalRedAllocPoint)
					.div(1e12);
		} else {
			return
				totalHotpotBaseReward
					.mul(pool.allocPoint)
					.mul(uint256(1e12).sub(redPotShare))
					.div(totalWhiteAllocPoint)
					.div(1e12);
		}
	}

	// View function to see earned Hotpot Base on frontend.
	function earned(uint256 _pid, address _user) public view returns (uint256) {
		PoolInfo storage pool = poolInfo[_pid];
		UserInfo storage user = userInfo[_pid][_user];
		uint256 accHotpotBasePerShare = pool.accHotpotBasePerShare;
		uint256 lpSupply = pool.lpToken.balanceOf(address(this));
		uint256 blockNumber = getBlockNumber();
		if (blockNumber > pool.lastRewardBlock && lpSupply != 0) {
			uint256 hotpotBaseReward = getPoolHotpotBaseReward(
				pool.lastRewardBlock,
				blockNumber,
				_pid
			);
			accHotpotBasePerShare = accHotpotBasePerShare.add(
				hotpotBaseReward.mul(1e12).div(lpSupply)
			);
		}
		return
			user.amount.mul(accHotpotBasePerShare).div(1e12).add(user.reward).sub(user.rewardOffset);
	}

	// Update reward vairables for all pools. Be careful of gas spending!
	function massUpdatePools() public override {
		uint256 length = poolInfo.length;
		for (uint256 pid = 0; pid < length; ++pid) {
			updatePool(pid);
		}
	}

	// Update reward variables of given pool. New Hotpot Base will be minted.
	function updatePool(uint256 _pid) public {
		PoolInfo storage pool = poolInfo[_pid];
		uint256 blockNumber = getBlockNumber();
		if (blockNumber <= pool.lastRewardBlock) {
			return;
		}
		uint256 lpSupply = pool.lpToken.balanceOf(address(this));
		if (lpSupply == 0) {
			pool.lastRewardBlock = blockNumber;
			return;
		}
		uint256 hotpotBaseReward = getPoolHotpotBaseReward(pool.lastRewardBlock, blockNumber, _pid);
		pool.accHotpotBasePerShare = pool.accHotpotBasePerShare.add(
			hotpotBaseReward.mul(1e12).div(lpSupply)
		);
		pool.lastRewardBlock = blockNumber;
	}

	// Deposit LP tokens to YuanYangPot to earn Hotpot Base.
	function deposit(uint256 _pid, uint256 _amount) public {
		address sender = msg.sender;
		PoolInfo storage pool = poolInfo[_pid];
		UserInfo storage user = userInfo[_pid][sender];
		updatePool(_pid);
		if (user.amount > 0) {
			user.reward = earned(_pid, sender);
		}
		pool.lpToken.safeTransferFrom(sender, address(this), _amount);
		user.amount = user.amount.add(_amount);
		user.rewardOffset = user.amount.mul(pool.accHotpotBasePerShare).div(1e12);
		emit Deposit(sender, _pid, _amount);
	}

	// Withdraw LP tokens from YuanYangPot.
	function withdraw(uint256 _pid, uint256 _amount) public {
		address sender = msg.sender;
		PoolInfo storage pool = poolInfo[_pid];
		UserInfo storage user = userInfo[_pid][sender];
		require(user.amount >= _amount, 'withdraw: not good');
		updatePool(_pid);
		user.reward = earned(_pid, sender);
		user.amount = user.amount.sub(_amount);
		user.rewardOffset = user.amount.mul(pool.accHotpotBasePerShare).div(1e12);
		pool.lpToken.safeTransfer(sender, _amount);
		emit Withdraw(sender, _pid, _amount);
	}

	// Claim earned rewards from YuanYangPot.
	function claimReward(uint256 _pid, address _tipTo) public {
		address sender = msg.sender;
		require(!inCircuitBreaker, 'claimReward: halted during Circuit Breaker');
		PoolInfo storage pool = poolInfo[_pid];
		UserInfo storage user = userInfo[_pid][sender];
		updatePool(_pid);
		uint256 pending = earned(_pid, sender);
		user.rewardOffset = user.amount.mul(pool.accHotpotBasePerShare).div(1e12);
		user.reward = 0;
		hotpotBase.mint(devAddr, pending.div(10)); // minted on top of pending
		hotpotBase.mint(_tipTo, pending.mul(tipRate).div(1e12)); // minted on top of pending
		hotpotBase.mint(sender, pending);
		emit ClaimReward(sender, _pid, _tipTo, pending);
	}

	// Withdraw without caring about rewards. EMERGENCY ONLY.
	function emergencyWithdraw(uint256 _pid) public {
		address sender = msg.sender;
		PoolInfo storage pool = poolInfo[_pid];
		UserInfo storage user = userInfo[_pid][sender];
		uint256 amount = user.amount;
		user.rewardOffset = 0;
		user.reward = 0;
		user.amount = 0;
		pool.lpToken.safeTransfer(sender, amount);
		emit EmergencyWithdraw(sender, _pid, amount);
	}

	// Update dev address by the previous dev.
	function dev(address _devAddr) public {
		require(msg.sender == devAddr, 'dev: wut?');
		devAddr = _devAddr;
	}

	function transferPotOwnership(address newOwner) public override {
		transferOwnership(newOwner);
	}

	function getBlockNumber() public virtual view returns (uint256) {
		return block.number;
	}
}
