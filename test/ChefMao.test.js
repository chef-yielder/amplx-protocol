const { expectRevert } = require('@openzeppelin/test-helpers');
const HotpotBaseToken = artifacts.require('HotpotBaseToken');
const MockERC20 = artifacts.require('MockERC20');
const MockUniswapV2Pair = artifacts.require('MockUniswapV2Pair');
const MockYuanYangPot = artifacts.require('MockYuanYangPot');
const ChefMao = artifacts.require('ChefMao');
const MockChefMao = artifacts.require('MockChefMao');

contract('ChefMao', ([alice, bob, charlie, dave]) => {
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
		this.uniswapPair = await MockUniswapV2Pair.new({ from: dave });
		this.chefMao = await MockChefMao.new(
			this.yuanyang.address,
			this.uniswapPair.address,
			alice,
			'1000000000000000000',
			true,
			{
				from: alice
			}
		);
		await this.yuanyang.transferPotOwnership(this.chefMao.address, { from: alice });
	};

	describe('constructor', () => {
		before(init);
		it('should have correct yuanyang pot', async () =>
			assert.equal((await this.chefMao.masterPot()).valueOf(), this.yuanyang.address));

		it('should have correct farmHotpotBasePerBlock', async () => {
			assert.equal(
				(await this.chefMao.farmHotpotBasePerBlock()).valueOf().toString(),
				(await this.yuanyang.hotpotBasePerBlock()).valueOf().toString()
			);
		});

		it('should have correct uniswap pair', async () =>
			assert.equal((await this.chefMao.uniswapPair()).valueOf(), this.uniswapPair.address));

		it('should have correct gov', async () =>
			assert.equal((await this.chefMao.gov()).valueOf(), alice));

		it('should have correct targetPrice', async () =>
			assert.equal((await this.chefMao.targetPrice()).valueOf(), '1000000000000000000'));

		it('should have correct isToken0', async () =>
			assert.equal((await this.chefMao.isToken0()).valueOf(), true));
	});

	describe('setPendingGov and acceptGov', () => {
		before(init);

		it('should only allow gov to set pending gov', async () => {
			await expectRevert(
				this.chefMao.setPendingGov(bob, { from: bob }),
				'onlyGov: caller is not gov'
			);

			const tx = await this.chefMao.setPendingGov(bob, { from: alice });
			assert.equal((await this.chefMao.pendingGov()).valueOf(), bob);
			assert.equal(tx.logs.length, 1);
			const log = tx.logs[0];
			assert.equal(log.event, 'NewPendingGov');
			assert.equal(log.args.oldPendingGov, '0x0000000000000000000000000000000000000000');
			assert.equal(log.args.newPendingGov, bob);
		});

		it('should only allow pending gov accept gov', async () => {
			await expectRevert(this.chefMao.acceptGov({ from: charlie }), 'acceptGov: !pending');

			const tx = await this.chefMao.acceptGov({ from: bob });
			assert.equal((await this.chefMao.gov()).valueOf(), bob);
			assert.equal(
				(await this.chefMao.pendingGov()).valueOf(),
				'0x0000000000000000000000000000000000000000'
			);
			assert.equal(tx.logs.length, 1);
			const log = tx.logs[0];
			assert.equal(log.event, 'NewGov');
			assert.equal(log.args.oldGov, alice);
			assert.equal(log.args.newGov, bob);
		});
	});

	describe('initTwap, activateRebasing, inRebaseWindow and rebase', () => {
		before(init);
		it('should not activate rebasing before twap init', async () => {
			await expectRevert(
				this.chefMao.activateRebasing(),
				'activateRebasing: twap wasnt intitiated, call init_twap()'
			);
		});

		it('should only init for gov', async () => {
			await expectRevert(this.chefMao.initTwap({ from: bob }), 'onlyGov: caller is not gov');
		});

		it('should not init for 0 price', async () => {
			await expectRevert(this.chefMao.initTwap({ from: alice }), 'initTwap: no trades');
		});

		it('should init once', async () => {
			await this.uniswapPair.setPrice0CumulativeLast('1000000000000000000');
			await this.uniswapPair.setPrice1CumulativeLast('1');
			await this.chefMao.initTwap({ from: alice });
			assert.equal((await this.chefMao.blockTimestampLast()).valueOf() > 0, true);
			assert.equal(
				(await this.chefMao.priceCumulativeLast()).valueOf(),
				'1000000000000000000'
			);
			assert.equal(
				(await this.chefMao.blockTimestampLast()).valueOf().toString(),
				(await this.chefMao.timeOfTwapInit()).valueOf().toString()
			);

			await expectRevert(this.chefMao.initTwap(), 'initTwap: already activated');
		});

		it('should not activate rebasing before rebase delay', async () => {
			await expectRevert(this.chefMao.activateRebasing(), 'activateRebasing: !end_delay');
		});

		it('should not be in rebase window before activating rebasing', async () => {
			await expectRevert(
				this.chefMao.inRebaseWindow(),
				'inRebaseWindow: rebasing not active'
			);
		});

		it('should activate rebasing after rebase delay', async () => {
			const timeOfTwapInit = Number((await this.chefMao.timeOfTwapInit()).valueOf());
			const rebaseDelay = Number((await this.chefMao.rebaseDelay()).valueOf());
			await this.chefMao.setTimestamp((timeOfTwapInit + rebaseDelay).toString());
			await this.chefMao.activateRebasing();
			assert.equal((await this.chefMao.rebasingActive()).valueOf(), true);
		});

		it('should not be in rebase window too early', async () => {
			await this.chefMao.setTimestamp('0');
			await expectRevert(this.chefMao.inRebaseWindow(), 'inRebaseWindow: too early');
		});

		it('should be inRebaseWindow', async () => {
			await this.chefMao.setTimestamp('28800');
			assert.equal((await this.chefMao.inRebaseWindow()).valueOf(), true);
		});

		it('should not be in rebase window too late', async () => {
			await this.chefMao.setTimestamp('36000');
			await expectRevert(this.chefMao.inRebaseWindow(), 'inRebaseWindow: too late');
		});

		it('should not rebase if it is already triggered', async () => {
			await this.chefMao.setTimestamp('28800');
			await expectRevert(this.chefMao.rebase(), 'rebase: Rebase already triggered');
		});

		it('should rebase for within deviation threshold', async () => {
			await this.chefMao.setBlockNumber('200');
			await this.chefMao.setTimestamp('115201');
			await this.chefMao.setPriceCumulative('1010000000000000000');
			await this.chefMao.setBlockTimestamp('115201');
			await this.chefMao.setTwap('1000000000000000000');
			assert.equal((await this.chefMao.epoch()).valueOf(), '0');
			assert.equal((await this.chefMao.lastRebaseTimestamp()).valueOf(), '0');
			assert.equal((await this.chefMao.targetPrice()).valueOf(), '1000000000000000000');
			assert.equal(
				(await this.chefMao.priceCumulativeLast()).valueOf(),
				'1000000000000000000'
			);
			assert.equal(
				(await this.chefMao.farmHotpotBasePerBlock()).valueOf(),
				'100000000000000000000'
			);
			assert.equal((await this.chefMao.halvingCounter()).valueOf(), '0');
			assert.equal((await this.chefMao.upwardCounter()).valueOf(), '0');
			assert.equal((await this.chefMao.downwardCounter()).valueOf(), '0');
			assert.equal(
				(await this.yuanyang.hotpotBasePerBlock()).valueOf(),
				'100000000000000000000'
			);
			assert.equal((await this.yuanyang.inCircuitBreaker()).valueOf(), false);
			await this.chefMao.rebase();
			assert.equal((await this.chefMao.epoch()).valueOf(), '1');
			assert.equal((await this.chefMao.lastRebaseTimestamp()).valueOf(), '115200');
			assert.equal((await this.chefMao.targetPrice()).valueOf(), '1000000000000000000');
			assert.equal(
				(await this.chefMao.priceCumulativeLast()).valueOf(),
				'1010000000000000000'
			);
			assert.equal((await this.chefMao.blockTimestampLast()).valueOf(), '115201');
			assert.equal(
				(await this.chefMao.farmHotpotBasePerBlock()).valueOf(),
				'100000000000000000000'
			);
			assert.equal((await this.chefMao.halvingCounter()).valueOf(), '0');
			assert.equal(
				(await this.yuanyang.hotpotBasePerBlock()).valueOf(),
				'100000000000000000000'
			);
			assert.equal((await this.yuanyang.inCircuitBreaker()).valueOf(), false);
			assert.equal((await this.chefMao.upwardCounter()).valueOf(), '0');
			assert.equal((await this.chefMao.downwardCounter()).valueOf(), '0');
		});

		it('should rebase for above deviation threshold', async () => {
			await this.chefMao.setBlockNumber('300');
			await this.chefMao.setTimestamp('201601');
			await this.chefMao.setPriceCumulative('1050000000000000000');
			await this.chefMao.setBlockTimestamp('201601');
			await this.chefMao.setTwap('1050000000000000000');
			await this.chefMao.rebase();
			assert.equal((await this.chefMao.epoch()).valueOf(), '2');
			assert.equal((await this.chefMao.lastRebaseTimestamp()).valueOf(), '201600');
			assert.equal((await this.chefMao.targetPrice()).valueOf(), '1000000000000000000');
			assert.equal(
				(await this.chefMao.priceCumulativeLast()).valueOf(),
				'1050000000000000000'
			);
			assert.equal((await this.chefMao.blockTimestampLast()).valueOf(), '201601');
			assert.equal(
				(await this.chefMao.farmHotpotBasePerBlock()).valueOf(),
				'100000000000000000000'
			);
			assert.equal((await this.chefMao.halvingCounter()).valueOf(), '0');
			assert.equal(
				(await this.yuanyang.hotpotBasePerBlock()).valueOf(),
				'105000000000000000000'
			);
			assert.equal((await this.yuanyang.inCircuitBreaker()).valueOf(), false);
			assert.equal((await this.chefMao.upwardCounter()).valueOf(), '1');
			assert.equal((await this.chefMao.downwardCounter()).valueOf(), '0');
		});

		it('should rebase for below deviation threshold', async () => {
			await this.chefMao.setBlockNumber('300');
			await this.chefMao.setTimestamp('288001');
			await this.chefMao.setPriceCumulative('950000000000000000');
			await this.chefMao.setBlockTimestamp('288001');
			await this.chefMao.setTwap('950000000000000000');
			await this.chefMao.rebase();
			assert.equal((await this.chefMao.epoch()).valueOf(), '3');
			assert.equal((await this.chefMao.lastRebaseTimestamp()).valueOf(), '288000');
			assert.equal((await this.chefMao.targetPrice()).valueOf(), '1000000000000000000');
			assert.equal(
				(await this.chefMao.priceCumulativeLast()).valueOf(),
				'950000000000000000'
			);
			assert.equal((await this.chefMao.blockTimestampLast()).valueOf(), '288001');
			assert.equal(
				(await this.chefMao.farmHotpotBasePerBlock()).valueOf(),
				'100000000000000000000'
			);
			assert.equal((await this.chefMao.halvingCounter()).valueOf(), '0');
			assert.equal(
				(await this.yuanyang.hotpotBasePerBlock()).valueOf(),
				'105263157894736842105'
			);
			assert.equal((await this.yuanyang.inCircuitBreaker()).valueOf(), true);
			assert.equal((await this.chefMao.upwardCounter()).valueOf(), '0');
			assert.equal((await this.chefMao.downwardCounter()).valueOf(), '1');
		});

		it('should rebase for below deviation threshold again and adjust target price', async () => {
			await this.chefMao.setBlockNumber('400');
			await this.chefMao.setTimestamp('374401');
			await this.chefMao.setPriceCumulative('950000000000000000');
			await this.chefMao.setBlockTimestamp('374401');
			await this.chefMao.setTwap('950000000000000000');
			await this.chefMao.rebase();
			assert.equal((await this.chefMao.epoch()).valueOf(), '4');
			assert.equal((await this.chefMao.lastRebaseTimestamp()).valueOf(), '374400');
			assert.equal((await this.chefMao.targetPrice()).valueOf(), '950000000000000000');
			assert.equal(
				(await this.chefMao.priceCumulativeLast()).valueOf(),
				'950000000000000000'
			);
			assert.equal((await this.chefMao.blockTimestampLast()).valueOf(), '374401');
			assert.equal(
				(await this.chefMao.farmHotpotBasePerBlock()).valueOf(),
				'100000000000000000000'
			);
			assert.equal((await this.chefMao.halvingCounter()).valueOf(), '0');
			assert.equal(
				(await this.yuanyang.hotpotBasePerBlock()).valueOf(),
				'105263157894736842105'
			);
			assert.equal((await this.yuanyang.inCircuitBreaker()).valueOf(), true);
			assert.equal((await this.chefMao.upwardCounter()).valueOf(), '0');
			assert.equal((await this.chefMao.downwardCounter()).valueOf(), '2');
		});

		it('should rebase for above deviation threshold after downward', async () => {
			await this.chefMao.setBlockNumber('500');
			await this.chefMao.setTimestamp('460801');
			await this.chefMao.setPriceCumulative('1000000000000000000');
			await this.chefMao.setBlockTimestamp('460801');
			await this.chefMao.setTwap('1000000000000000000');
			await this.chefMao.rebase();
			assert.equal((await this.chefMao.epoch()).valueOf(), '5');
			assert.equal((await this.chefMao.lastRebaseTimestamp()).valueOf(), '460800');
			assert.equal(
				(await this.chefMao.targetPrice()).valueOf().toString(),
				'950000000000000000'
			);
			assert.equal(
				(await this.chefMao.priceCumulativeLast()).valueOf(),
				'1000000000000000000'
			);
			assert.equal((await this.chefMao.blockTimestampLast()).valueOf(), '460801');
			assert.equal(
				(await this.chefMao.farmHotpotBasePerBlock()).valueOf(),
				'100000000000000000000'
			);
			assert.equal((await this.chefMao.halvingCounter()).valueOf(), '0');
			assert.equal(
				(await this.yuanyang.hotpotBasePerBlock()).valueOf(),
				'105263157894736842105'
			);
			assert.equal((await this.yuanyang.inCircuitBreaker()).valueOf(), false);
			assert.equal((await this.chefMao.upwardCounter()).valueOf(), '1');
			assert.equal((await this.chefMao.downwardCounter()).valueOf(), '0');
		});

		it('should rebase for above deviation threshold again and adjust target price', async () => {
			await this.chefMao.setBlockNumber('600');
			await this.chefMao.setTimestamp('547201');
			await this.chefMao.setPriceCumulative('1000000000000000000');
			await this.chefMao.setBlockTimestamp('547201');
			await this.chefMao.setTwap('1000000000000000000');
			await this.chefMao.rebase();
			assert.equal((await this.chefMao.epoch()).valueOf(), '6');
			assert.equal((await this.chefMao.lastRebaseTimestamp()).valueOf(), '547200');
			assert.equal((await this.chefMao.targetPrice()).valueOf(), '997500000000000000');
			assert.equal(
				(await this.chefMao.priceCumulativeLast()).valueOf(),
				'1000000000000000000'
			);
			assert.equal((await this.chefMao.blockTimestampLast()).valueOf(), '547201');
			assert.equal(
				(await this.chefMao.farmHotpotBasePerBlock()).valueOf(),
				'100000000000000000000'
			);
			assert.equal((await this.chefMao.halvingCounter()).valueOf(), '0');
			assert.equal(
				(await this.yuanyang.hotpotBasePerBlock()).valueOf(),
				'105263157894736842105'
			);
			assert.equal((await this.yuanyang.inCircuitBreaker()).valueOf(), false);
			assert.equal((await this.chefMao.upwardCounter()).valueOf(), '2');
			assert.equal((await this.chefMao.downwardCounter()).valueOf(), '0');
		});

		it('should rebase for within deviation threshold', async () => {
			await this.chefMao.setBlockNumber('700');
			await this.chefMao.setTimestamp('633601');
			await this.chefMao.setPriceCumulative('1000000000000000000');
			await this.chefMao.setBlockTimestamp('633601');
			await this.chefMao.setTwap('1000000000000000000');
			await this.chefMao.rebase();
			assert.equal((await this.chefMao.epoch()).valueOf(), '7');
			assert.equal((await this.chefMao.lastRebaseTimestamp()).valueOf(), '633600');
			assert.equal((await this.chefMao.targetPrice()).valueOf(), '997500000000000000');
			assert.equal(
				(await this.chefMao.priceCumulativeLast()).valueOf(),
				'1000000000000000000'
			);
			assert.equal((await this.chefMao.blockTimestampLast()).valueOf(), '633601');
			assert.equal(
				(await this.chefMao.farmHotpotBasePerBlock()).valueOf(),
				'100000000000000000000'
			);
			assert.equal((await this.chefMao.halvingCounter()).valueOf(), '0');
			assert.equal(
				(await this.yuanyang.hotpotBasePerBlock()).valueOf().toString(),
				'100250626566416040100'
			);
			assert.equal((await this.yuanyang.inCircuitBreaker()).valueOf(), false);
			assert.equal((await this.chefMao.upwardCounter()).valueOf(), '0');
			assert.equal((await this.chefMao.downwardCounter()).valueOf(), '0');
		});
	});

	describe('getNewHotpotBasePerBlock', () => {
		before(init);
		it('should be get new hotpot base per block correctly before halving', async () => {
			await this.chefMao.setBlockNumber('110');
			const result = (
				await this.chefMao.getNewHotpotBasePerBlock('1050000000000000000')
			).valueOf();
			assert.equal(result.newHotpotBasePerBlock.toString(), '105000000000000000000');
			assert.equal(result.newFarmHotpotBasePerBlock.toString(), '100000000000000000000');
			assert.equal(result.newHalvingCounter, '0');
		});

		it('should be get new hotpot base per block correctly after halving', async () => {
			await this.chefMao.setBlockNumber('88988');
			const result = (
				await this.chefMao.getNewHotpotBasePerBlock('950000000000000000')
			).valueOf();
			assert.equal(result.newHotpotBasePerBlock.toString(), '52631578947368421052');
			assert.equal(result.newFarmHotpotBasePerBlock.toString(), '50000000000000000000');
			assert.equal(result.newHalvingCounter, '1');
		});
	});

	describe('getNewRedShare', () => {
		before(init);
		it('should be get new red share correctly', async () => {
			assert.equal(
				(await this.chefMao.getNewRedShare('1050000000000000000')).valueOf().toString(),
				'487804878048'
			);
			assert.equal(
				(await this.chefMao.getNewRedShare('950000000000000000')).valueOf().toString(),
				'512820512820'
			);
		});
	});

	describe('withinDeviationThreshold', () => {
		before(init);
		it('should be outside deviation threshold for 1.05', async () => {
			assert.equal(
				(await this.chefMao.withinDeviationThreshold('1050000000000000000')).valueOf(),
				false
			);
		});

		it('should be within deviation threshold for 1.049', async () => {
			assert.equal(
				(await this.chefMao.withinDeviationThreshold('1049000000000000000')).valueOf(),
				true
			);
		});

		it('should be outside deviation threshold for 0.95', async () => {
			assert.equal(
				(await this.chefMao.withinDeviationThreshold('950000000000000000')).valueOf(),
				false
			);
		});

		it('should be within deviation threshold for 0.951', async () => {
			assert.equal(
				(await this.chefMao.withinDeviationThreshold('951000000000000000')).valueOf(),
				true
			);
		});
	});

	describe('set DeviationThreshold, DeviationMovement, RetargetThreshold, TargetStock2Flow and RebaseTimingParameters', () => {
		before(init);
		it('should only allow gov to set valid deivation threshold', async () => {
			await expectRevert(
				this.chefMao.setDeviationThreshold('1', { from: bob }),
				'onlyGov: caller is not gov'
			);
			await expectRevert(
				this.chefMao.setDeviationThreshold('0', { from: alice }),
				'deviationThreshold: too low'
			);

			assert.equal((await this.chefMao.deviationThreshold()).valueOf(), '50000000000000000');
			const tx = await this.chefMao.setDeviationThreshold('1', { from: alice });
			assert.equal((await this.chefMao.deviationThreshold()).valueOf(), '1');
			const log = tx.logs[0];
			assert.equal(log.event, 'NewDeviationThreshold');
			assert.equal(log.args.oldDeviationThreshold, '50000000000000000');
			assert.equal(log.args.newDeviationThreshold, '1');
		});

		it('should only allow gov to set valid deviation movement', async () => {
			await expectRevert(
				this.chefMao.setDeviationMovement('1', { from: bob }),
				'onlyGov: caller is not gov'
			);
			await expectRevert(
				this.chefMao.setDeviationMovement('0', { from: alice }),
				'deviationMovement: too low'
			);

			assert.equal((await this.chefMao.deviationMovement()).valueOf(), '50000000000000000');
			const tx = await this.chefMao.setDeviationMovement('1', { from: alice });
			assert.equal((await this.chefMao.deviationMovement()).valueOf(), '1');
			const log = tx.logs[0];
			assert.equal(log.event, 'NewDeviationMovement');
			assert.equal(log.args.oldDeviationMovement, '50000000000000000');
			assert.equal(log.args.newDeviationMovement, '1');
		});

		it('should only allow gov to set valid retarge threshold', async () => {
			await expectRevert(
				this.chefMao.setRetargetThreshold('1', { from: bob }),
				'onlyGov: caller is not gov'
			);
			await expectRevert(
				this.chefMao.setRetargetThreshold('0', { from: alice }),
				'retargetThreshold: too low'
			);

			assert.equal((await this.chefMao.retargetThreshold()).valueOf(), '2');
			await this.chefMao.setRetargetThreshold('1', { from: alice });
			assert.equal((await this.chefMao.retargetThreshold()).valueOf(), '1');
		});

		it('should only allow gov to set valid target Stock2Flow', async () => {
			await expectRevert(
				this.chefMao.setTargetStock2Flow('1', { from: bob }),
				'onlyGov: caller is not gov'
			);
			await expectRevert(
				this.chefMao.setTargetStock2Flow('0', { from: alice }),
				'targetStock2Flow: too low'
			);

			assert.equal((await this.chefMao.targetStock2Flow()).valueOf(), '10');
			await this.chefMao.setTargetStock2Flow('1', { from: alice });
			assert.equal((await this.chefMao.targetStock2Flow()).valueOf(), '1');
		});

		it('should only allow gov to set valid rebase timing parameters', async () => {
			await expectRevert(
				this.chefMao.setRebaseTimingParameters('1000', '100', '2000', { from: bob }),
				'onlyGov: caller is not gov'
			);
			await expectRevert(
				this.chefMao.setRebaseTimingParameters('0', '100', '2000', { from: alice }),
				'minRebaseTimeIntervalSec: too low'
			);
			await expectRevert(
				this.chefMao.setRebaseTimingParameters('1000', '1000', '2000', { from: alice }),
				'rebaseWindowOffsetSec: too high'
			);

			assert.equal((await this.chefMao.minRebaseTimeIntervalSec()).valueOf(), '86400');
			assert.equal((await this.chefMao.rebaseWindowOffsetSec()).valueOf(), '28800');
			assert.equal((await this.chefMao.rebaseWindowLengthSec()).valueOf(), '3600');
			this.chefMao.setRebaseTimingParameters('1000', '100', '2000', { from: alice }),
				assert.equal((await this.chefMao.minRebaseTimeIntervalSec()).valueOf(), '1000');
			assert.equal((await this.chefMao.rebaseWindowOffsetSec()).valueOf(), '100');
			assert.equal((await this.chefMao.rebaseWindowLengthSec()).valueOf(), '2000');
		});
	});

	describe('passthrough functions', () => {
		before(init);

		it('should only allow gov to add pool', async () => {
			await expectRevert(
				this.chefMao.addPool('1000', this.redLP.address, true, false, { from: bob }),
				'onlyGov: caller is not gov'
			);

			await this.chefMao.addPool('1000', this.redLP.address, true, false, { from: alice });
			assert.equal((await this.yuanyang.poolLength()).valueOf(), '1');
			assert.equal((await this.yuanyang.totalRedAllocPoint()).valueOf(), '1000');
			const poolInfo = await this.yuanyang.poolInfo(0).valueOf();
			assert.equal(poolInfo.lpToken, this.redLP.address);
			assert.equal(poolInfo.allocPoint, '1000');
			assert.equal(poolInfo.isRed, true);
			assert.equal(poolInfo.lastRewardBlock, '100');
			assert.equal(poolInfo.accHotpotBasePerShare, '0');
		});

		it('should only allow gov to set pool', async () => {
			await expectRevert(
				this.chefMao.setPool('0', '2000', true, { from: bob }),
				'onlyGov: caller is not gov'
			);

			await this.chefMao.setPool('0', '2000', false, { from: alice });
			assert.equal((await this.yuanyang.poolLength()).valueOf(), '1');
			assert.equal((await this.yuanyang.totalRedAllocPoint()).valueOf(), '2000');
			const poolInfo = await this.yuanyang.poolInfo(0).valueOf();
			assert.equal(poolInfo.lpToken, this.redLP.address);
			assert.equal(poolInfo.allocPoint, '2000');
			assert.equal(poolInfo.isRed, true);
			assert.equal(poolInfo.lastRewardBlock, '100');
			assert.equal(poolInfo.accHotpotBasePerShare, '0');
		});

		it('should only allow gov to set tip rate', async () => {
			await expectRevert(
				this.chefMao.setTipRate('0', { from: bob }),
				'onlyGov: caller is not gov'
			);

			assert.equal((await this.yuanyang.tipRate()).valueOf(), '10000000000');
			await this.chefMao.setTipRate('0', { from: alice });
			assert.equal((await this.yuanyang.tipRate()).valueOf(), '0');
		});

		it('should only allow gov to transfer pot ownership', async () => {
			await expectRevert(
				this.chefMao.transferPotOwnership(bob, { from: bob }),
				'onlyGov: caller is not gov'
			);
			await this.chefMao.transferPotOwnership(bob, { from: alice });
			assert.equal((await this.yuanyang.owner()).valueOf(), bob);
		});
	});

	describe('getCurrentTwap', () => {
		before(init);
		it('should return numbers', async () => {
			const chefMao = await ChefMao.new(
				this.yuanyang.address,
				this.uniswapPair.address,
				alice,
				'1000000000000000000',
				true,
				{
					from: alice
				}
			);
			const result = (await chefMao.getCurrentTwap()).valueOf();
			assert.equal(result.priceCumulative, '0');
			assert.equal(Number(result.blockTimestamp) > 0, true);
			assert.equal(result.twap, '0');
		});
	});

	describe('getNow', () => {
		before(init);
		it('should return a positive number', async () => {
			const chefMao = await ChefMao.new(
				this.yuanyang.address,
				this.uniswapPair.address,
				alice,
				'1000000000000000000',
				true,
				{
					from: alice
				}
			);
			assert.equal(Number((await chefMao.getNow()).valueOf()) > 0, true);
		});
	});

	describe('getBlockNumber', () => {
		before(init);
		it('should return a positive number', async () => {
			const chefMao = await ChefMao.new(
				this.yuanyang.address,
				this.uniswapPair.address,
				alice,
				'1000000000000000000',
				true,
				{
					from: alice
				}
			);
			assert.equal(Number((await chefMao.getBlockNumber()).valueOf()) > 0, true);
		});
	});
});
