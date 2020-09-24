const { expectRevert } = require('@openzeppelin/test-helpers');
const HotpotBaseToken = artifacts.require('HotpotBaseToken');
const MockERC20 = artifacts.require('MockERC20');
const YuanYangPot = artifacts.require('YuanYangPot');
const MockYuanYangPot = artifacts.require('MockYuanYangPot');

contract('YuanYangPot', ([alice, bob, charlie, dave]) => {
	const init = async () => {
		this.hotpotBase = await HotpotBaseToken.new('HotpotBaseToken', 'POT', { from: alice });
		this.yuanyang = await MockYuanYangPot.new(
			this.hotpotBase.address,
			bob,
			'100000000000000000000',
			'100',
			'10000000000',
			{ from: alice }
		);
		await this.hotpotBase.transferOwnership(this.yuanyang.address, { from: alice });
		this.redLP = await MockERC20.new('RedLPToken', 'RLP', '10000000000', { from: charlie });
		this.whiteLP = await MockERC20.new('WhiteLPToken', 'WLP', '10000000000', { from: charlie });
	};

	describe('constructor', () => {
		before(init);
		it('should have correct hotpotBase', async () => {
			assert.equal((await this.yuanyang.hotpotBase()).valueOf(), this.hotpotBase.address);
			assert.equal(
				(await this.yuanyang.hotpotBaseTotalSupply()).valueOf().toString(),
				(await this.hotpotBase.totalSupply()).valueOf().toString()
			);
		});

		it('should have correct devAddr', async () =>
			assert.equal((await this.yuanyang.devAddr()).valueOf(), bob));

		it('should have correct hotpotBasePerBlock', async () =>
			assert.equal(
				(await this.yuanyang.hotpotBasePerBlock()).valueOf(),
				'100000000000000000000'
			));

		it('should have correct startBlock', async () =>
			assert.equal((await this.yuanyang.startBlock()).valueOf(), '100'));

		it('should have correct tipRate', async () =>
			assert.equal((await this.yuanyang.tipRate()).valueOf(), '10000000000'));
	});

	describe('add and set pool', () => {
		before(init);
		it('should only allow owner to add pool', async () => {
			await expectRevert(
				this.yuanyang.addPool('1000', this.redLP.address, true, true, { from: bob }),
				'Ownable: caller is not the owner'
			);
		});

		it('should only allow owner to set pool', async () => {
			await expectRevert(
				this.yuanyang.setPool('0', '2000', true, { from: bob }),
				'Ownable: caller is not the owner'
			);
		});

		it('should not update pool for invalid pid', async () => {
			await this.yuanyang.setPool('0', '2000', true, { from: alice });
			assert.equal((await this.yuanyang.poolLength()).valueOf(), '0');
			assert.equal((await this.yuanyang.totalRedAllocPoint()).valueOf(), '0');
			assert.equal((await this.yuanyang.totalWhiteAllocPoint()).valueOf(), '0');
		});

		it('should add to red correctly with update block number before start block', async () => {
			await this.yuanyang.addPool('1000', this.redLP.address, true, true, { from: alice });
			assert.equal((await this.yuanyang.poolLength()).valueOf(), '1');
			assert.equal((await this.yuanyang.totalRedAllocPoint()).valueOf(), '1000');
			assert.equal((await this.yuanyang.totalWhiteAllocPoint()).valueOf(), '0');
			const poolInfo = await this.yuanyang.poolInfo(0).valueOf();
			assert.equal(poolInfo.lpToken, this.redLP.address);
			assert.equal(poolInfo.allocPoint, '1000');
			assert.equal(poolInfo.isRed, true);
			assert.equal(poolInfo.lastRewardBlock, '100');
			assert.equal(poolInfo.accHotpotBasePerShare, '0');
		});

		it('should add to white correctly without update', async () => {
			await this.yuanyang.setBlockNumber('200');
			await this.yuanyang.addPool('1000', this.whiteLP.address, false, false, {
				from: alice
			});
			assert.equal((await this.yuanyang.poolLength()).valueOf(), '2');
			assert.equal((await this.yuanyang.totalRedAllocPoint()).valueOf(), '1000');
			assert.equal((await this.yuanyang.totalWhiteAllocPoint()).valueOf(), '1000');
			const poolInfo = await this.yuanyang.poolInfo(1).valueOf();
			assert.equal(poolInfo.lpToken, this.whiteLP.address);
			assert.equal(poolInfo.allocPoint, '1000');
			assert.equal(poolInfo.isRed, false);
			assert.equal(poolInfo.lastRewardBlock, '200');
			assert.equal(poolInfo.accHotpotBasePerShare, '0');
		});

		it('should set red pool correctly', async () => {
			await this.yuanyang.setPool('0', '2000', false, { from: alice });
			assert.equal((await this.yuanyang.poolLength()).valueOf(), '2');
			assert.equal((await this.yuanyang.totalRedAllocPoint()).valueOf(), '2000');
			assert.equal((await this.yuanyang.totalWhiteAllocPoint()).valueOf(), '1000');
			const poolInfo = await this.yuanyang.poolInfo(0).valueOf();
			assert.equal(poolInfo.lpToken, this.redLP.address);
			assert.equal(poolInfo.allocPoint, '2000');
			assert.equal(poolInfo.isRed, true);
			assert.equal(poolInfo.lastRewardBlock, '100');
			assert.equal(poolInfo.accHotpotBasePerShare, '0');
		});

		it('should set white pool correctly', async () => {
			await this.yuanyang.setPool('1', '2000', false, { from: alice });
			assert.equal((await this.yuanyang.poolLength()).valueOf(), '2');
			assert.equal((await this.yuanyang.totalRedAllocPoint()).valueOf(), '2000');
			assert.equal((await this.yuanyang.totalWhiteAllocPoint()).valueOf(), '2000');
			const poolInfo = await this.yuanyang.poolInfo(1).valueOf();
			assert.equal(poolInfo.lpToken, this.whiteLP.address);
			assert.equal(poolInfo.allocPoint, '2000');
			assert.equal(poolInfo.isRed, false);
			assert.equal(poolInfo.lastRewardBlock, '200');
			assert.equal(poolInfo.accHotpotBasePerShare, '0');
		});
	});

	describe('set CircuitBreaker, HotpotBasePerBlock, TipRate and RedPotShare', () => {
		before(init);
		it('should only allow owner to set circuit breaker', async () => {
			await expectRevert(
				this.yuanyang.setCircuitBreaker(true, { from: bob }),
				'Ownable: caller is not the owner'
			);

			assert.equal((await this.yuanyang.inCircuitBreaker()).valueOf(), false);
			await this.yuanyang.setCircuitBreaker(true, { from: alice });
			assert.equal((await this.yuanyang.inCircuitBreaker()).valueOf(), true);
		});

		it('should only allow owner to set hotpot base per block', async () => {
			await expectRevert(
				this.yuanyang.setHotpotBasePerBlock('0', { from: bob }),
				'Ownable: caller is not the owner'
			);

			assert.equal(
				(await this.yuanyang.hotpotBasePerBlock()).valueOf(),
				'100000000000000000000'
			);
			await this.yuanyang.setHotpotBasePerBlock('0', { from: alice });
			assert.equal((await this.yuanyang.hotpotBasePerBlock()).valueOf(), '0');
		});

		it('should only allow owner to set valid tip rate', async () => {
			await expectRevert(
				this.yuanyang.setTipRate('0', { from: bob }),
				'Ownable: caller is not the owner'
			);
			await expectRevert(
				this.yuanyang.setTipRate('1000000000001', { from: alice }),
				'tipRate: too high'
			);

			assert.equal((await this.yuanyang.tipRate()).valueOf(), '10000000000');
			await this.yuanyang.setTipRate('0', { from: alice });
			assert.equal((await this.yuanyang.tipRate()).valueOf(), '0');
		});

		it('should only allow owner to set valid red pot share', async () => {
			await expectRevert(
				this.yuanyang.setRedPotShare('0', { from: bob }),
				'Ownable: caller is not the owner'
			);
			await expectRevert(
				this.yuanyang.setRedPotShare('1000000000001', { from: alice }),
				'redPotShare: too high'
			);

			assert.equal((await this.yuanyang.redPotShare()).valueOf(), '500000000000');
			await this.yuanyang.setRedPotShare('0', { from: alice });
			assert.equal((await this.yuanyang.redPotShare()).valueOf(), '0');
		});
	});

	describe('getPoolHotpotBaseReward', () => {
		before(init);

		it('should calculate red pool reward', async () => {
			await this.yuanyang.addPool('1000', this.redLP.address, true, false, { from: alice });
			assert.equal(
				(await this.yuanyang.getPoolHotpotBaseReward('0', '10', '0')).valueOf(),
				'500000000000000000000'
			);
		});

		it('should calculate white pool reward', async () => {
			await this.yuanyang.addPool('1000', this.whiteLP.address, false, false, {
				from: alice
			});
			assert.equal(
				(await this.yuanyang.getPoolHotpotBaseReward('0', '10', '1')).valueOf(),
				'500000000000000000000'
			);
		});
	});

	describe('earned', () => {
		before(async () => {
			await init();
			await this.yuanyang.addPool('1000', this.redLP.address, true, false, { from: alice });
			await this.yuanyang.setUserInfo('0', dave, '1000', '0', '0');
		});

		it('should calculate earned reward when block number is before pool lastRewardBlock', async () => {
			await this.yuanyang.setBlockNumber('99');
			assert.equal((await this.yuanyang.earned('0', dave)).valueOf(), '0');
		});

		it('should calculate earned reward when block number is after pool lastRewardBlock but no lp supply', async () => {
			await this.yuanyang.setBlockNumber('110');
			assert.equal((await this.yuanyang.earned('0', dave)).valueOf(), '0');
		});

		it('should calculate earned reward', async () => {
			await this.yuanyang.setBlockNumber('110');
			await this.redLP.transfer(this.yuanyang.address, '1000', { from: charlie });
			assert.equal(
				(await this.yuanyang.earned('0', dave)).valueOf(),
				'500000000000000000000'
			);
		});
	});

	describe('earned: with 2 pools', () => {
		before(async () => {
			await init();
			await this.yuanyang.addPool('1000', this.redLP.address, true, false, { from: alice });
			await this.yuanyang.addPool('2000', this.whiteLP.address, false, false, {
				from: alice
			});
			await this.yuanyang.setUserInfo('0', dave, '1000', '0', '0');
			await this.yuanyang.setUserInfo('1', dave, '1000', '0', '0');
			await this.redLP.transfer(this.yuanyang.address, '1000', { from: charlie });
			// Dave only counts 1/5 of pool #1
			await this.whiteLP.transfer(this.yuanyang.address, '5000', { from: charlie });
		});

		it('should calculate earned reward when block number is before pool lastRewardBlock', async () => {
			await this.yuanyang.setBlockNumber('99');
			assert.equal((await this.yuanyang.earned('0', dave)).valueOf(), '0');
			assert.equal((await this.yuanyang.earned('1', dave)).valueOf(), '0');
		});

		it('should calculate earned reward: pools to earn 50/50 despite allocPoints', async () => {
			await this.yuanyang.setBlockNumber('110');
			assert.equal(
				(await this.yuanyang.earned('0', dave)).valueOf(),
				'500000000000000000000'
			);
			assert.equal(
				(await this.yuanyang.earned('1', dave)).valueOf(),
				'100000000000000000000'
			);
		});
	});

	describe('massUpdatePools', () => {
		before(init);

		it('should update pools', async () => {
			await this.yuanyang.addPool('1000', this.redLP.address, true, false, { from: alice });
			await this.yuanyang.setBlockNumber('110');
			await this.yuanyang.massUpdatePools();
			const poolInfo = await this.yuanyang.poolInfo(0).valueOf();
			assert.equal(poolInfo.lastRewardBlock, '110');
		});
	});

	describe('updatePool', () => {
		before(async () => {
			await init();
			await this.yuanyang.addPool('1000', this.redLP.address, true, false, { from: alice });
		});

		it('should do nothing if block number is before last reward block', async () => {
			let poolInfo = await this.yuanyang.poolInfo(0).valueOf();
			const lastRewardBlockBeforeUpdate = poolInfo.lastRewardBlock;
			const accHotpotBasePerShareBeforeUpdate = poolInfo.accHotpotBasePerShare;
			await this.yuanyang.updatePool(0);
			poolInfo = await this.yuanyang.poolInfo(0).valueOf();
			assert.equal(
				poolInfo.lastRewardBlock.toString(),
				lastRewardBlockBeforeUpdate.toString()
			);
			assert.equal(
				poolInfo.accHotpotBasePerShare.toString(),
				accHotpotBasePerShareBeforeUpdate.toString()
			);
		});

		it('should only update lastRewardBlock if there is no lp supply', async () => {
			let poolInfo = await this.yuanyang.poolInfo(0).valueOf();
			const lastRewardBlockBeforeUpdate = poolInfo.lastRewardBlock;
			const accHotpotBasePerShareBeforeUpdate = poolInfo.accHotpotBasePerShare;
			await this.yuanyang.setBlockNumber('200');
			await this.yuanyang.updatePool(0);
			poolInfo = await this.yuanyang.poolInfo(0).valueOf();
			assert.equal(poolInfo.lastRewardBlock.toString(), '200');
			assert.equal(
				poolInfo.accHotpotBasePerShare.toString(),
				accHotpotBasePerShareBeforeUpdate.toString()
			);
		});

		it('should update lastRewardBlock and accHotpotBasePerShare', async () => {
			await this.redLP.transfer(this.yuanyang.address, '1000', { from: charlie });
			let poolInfo = await this.yuanyang.poolInfo(0).valueOf();
			await this.yuanyang.setBlockNumber('210');
			await this.yuanyang.updatePool(0);
			poolInfo = await this.yuanyang.poolInfo(0).valueOf();
			assert.equal(poolInfo.lastRewardBlock.toString(), '210');
			assert.equal(
				poolInfo.accHotpotBasePerShare.toString(),
				'500000000000000000000000000000'
			);
		});
	});

	describe('deposit, withdraw and claimReward', () => {
		before(async () => {
			await init();
			await this.yuanyang.addPool('1000', this.redLP.address, true, false, { from: alice });
			await this.redLP.approve(this.yuanyang.address, '1000000000000000', { from: charlie });
			await this.yuanyang.setBlockNumber('200');
		});

		it('should deposit for new address', async () => {
			const tx = await this.yuanyang.deposit('0', '1000', { from: charlie });
			assert.equal(tx.logs.length, 1);
			const log = tx.logs[0];
			assert.equal(log.event, 'Deposit');
			assert.equal(log.args.user, charlie);
			assert.equal(log.args.pid, '0');
			assert.equal(log.args.amount, '1000');
			const userInfo = await this.yuanyang.userInfo(0, charlie).valueOf();
			assert.equal((await this.redLP.balanceOf(this.yuanyang.address)).valueOf(), '1000');
			assert.equal(userInfo.amount, '1000');
			assert.equal(userInfo.reward, '0');
			assert.equal(userInfo.rewardOffset, '0');
		});

		it('should deposit for existing address', async () => {
			await this.yuanyang.setBlockNumber('210');
			await this.yuanyang.deposit('0', '1000', { from: charlie });
			const userInfo = await this.yuanyang.userInfo(0, charlie).valueOf();
			assert.equal((await this.redLP.balanceOf(this.yuanyang.address)).valueOf(), '2000');
			assert.equal(userInfo.amount, '2000');
			assert.equal(userInfo.reward, '500000000000000000000');
			assert.equal(userInfo.rewardOffset.toString(), '1000000000000000000000');
		});

		it('should not allow withdraw more than user amount', async () => {
			await expectRevert(
				this.yuanyang.withdraw(0, '2001', { from: charlie }),
				'withdraw: not good'
			);
		});

		it('should withdraw', async () => {
			await this.yuanyang.setBlockNumber('220');
			const tx = await this.yuanyang.withdraw('0', '1000', { from: charlie });
			assert.equal(tx.logs.length, 1);
			const log = tx.logs[0];
			assert.equal(log.event, 'Withdraw');
			assert.equal(log.args.user, charlie);
			assert.equal(log.args.pid, '0');
			assert.equal(log.args.amount, '1000');
			const userInfo = await this.yuanyang.userInfo(0, charlie).valueOf();
			assert.equal((await this.redLP.balanceOf(this.yuanyang.address)).valueOf(), '1000');
			assert.equal(userInfo.amount, '1000');
			assert.equal(userInfo.reward, '1000000000000000000000');
			assert.equal(userInfo.rewardOffset, '750000000000000000000');
		});

		it('should not claim reward in circuit breaker', async () => {
			await this.yuanyang.setCircuitBreaker(true);
			await expectRevert(
				this.yuanyang.claimReward('0', dave, { from: charlie }),
				'claimReward: halted during Circuit Breaker'
			);
		});

		it('should claim reward outside circuit breaker', async () => {
			await this.yuanyang.setCircuitBreaker(false);
			const tx = await this.yuanyang.claimReward('0', dave, { from: charlie });
			assert.equal(tx.logs.length, 1);
			const log = tx.logs[0];
			assert.equal(log.event, 'ClaimReward');
			assert.equal(log.args.user, charlie);
			assert.equal(log.args.pid, '0');
			assert.equal(log.args.waiter, dave);
			assert.equal(log.args.amount, '1000000000000000000000');
			assert.equal((await this.hotpotBase.balanceOf(bob)).valueOf(), '100000000000000000000');
			assert.equal((await this.hotpotBase.balanceOf(dave)).valueOf(), '10000000000000000000');
			assert.equal(
				(await this.hotpotBase.balanceOf(charlie)).valueOf(),
				'1000000000000000000000'
			);
			const userInfo = await this.yuanyang.userInfo(0, charlie).valueOf();
			assert.equal((await this.redLP.balanceOf(this.yuanyang.address)).valueOf(), '1000');
			assert.equal(userInfo.amount, '1000');
			assert.equal(userInfo.reward, '0');
			assert.equal(userInfo.rewardOffset, '750000000000000000000');
		});
	});

	describe('emergencyWithdraw', () => {
		before(async () => {
			await init();
			await this.yuanyang.addPool('1000', this.redLP.address, true, false, { from: alice });
			await this.yuanyang.setUserInfo('0', dave, '1000', '0', '0');
		});

		it('should withdraw lp token and reset rewards', async () => {
			await this.redLP.transfer(this.yuanyang.address, '1000', { from: charlie });
			const tx = await this.yuanyang.emergencyWithdraw(0, { from: dave });
			assert.equal(tx.logs.length, 1);
			const log = tx.logs[0];
			assert.equal(log.event, 'EmergencyWithdraw');
			assert.equal(log.args.user, dave);
			assert.equal(log.args.pid, '0');
			assert.equal(log.args.amount, '1000');
			const userInfo = await this.yuanyang.userInfo(0, dave).valueOf();
			assert.equal(userInfo.amount, '0');
			assert.equal(userInfo.rewardOffset, '0');
			assert.equal(userInfo.reward, '0');
		});
	});

	describe('dev', () => {
		before(init);
		it('should only allow dev to transfer dev', async () => {
			await expectRevert(this.yuanyang.dev(alice, { from: alice }), 'dev: wut?');
			await this.yuanyang.dev(alice, { from: bob });
			assert.equal((await this.yuanyang.devAddr()).valueOf(), alice);
		});
	});

	describe('transferPotOwnership', () => {
		before(init);
		it('should only allow owner to transfer pot ownership', async () => {
			await expectRevert(
				this.yuanyang.transferPotOwnership(bob, { from: bob }),
				'Ownable: caller is not the owner'
			);
			await this.yuanyang.transferPotOwnership(bob, { from: alice });
			assert.equal((await this.yuanyang.owner()).valueOf(), bob);
		});
	});

	describe('getBlockNumber', () => {
		before(init);
		it('should return a positive number', async () => {
			const yuanyang = await YuanYangPot.new(
				this.hotpotBase.address,
				bob,
				'100000000000000000000',
				'100',
				'10000000000',
				{ from: alice }
			);
			assert.equal(Number((await yuanyang.getBlockNumber()).valueOf()) > 0, true);
		});
	});
});
