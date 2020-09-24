const { expectRevert } = require('@openzeppelin/test-helpers');
const HotpotBaseToken = artifacts.require('HotpotBaseToken');

contract('HotpotBaseToken', ([alice, bob, charlie]) => {
	const init = async () => {
		this.hotpot = await HotpotBaseToken.new('HotpotBaseToken', 'POT', { from: alice });
	};

	describe('constructor', () => {
		before(init);

		it('should have correct name', async () =>
			assert.equal((await this.hotpot.name()).valueOf(), 'HotpotBaseToken'));

		it('should have correct symbol', async () =>
			assert.equal((await this.hotpot.symbol()).valueOf(), 'POT'));

		it('should have correct decimal', async () =>
			assert.equal((await this.hotpot.decimals()).valueOf(), '18'));
	});

	describe('mint', () => {
		before(init);

		it('should only allow owner to mint token', async () => {
			await this.hotpot.mint(alice, '100', { from: alice });
			await this.hotpot.mint(bob, '1000', { from: alice });
			await expectRevert(
				this.hotpot.mint(charlie, '1000', { from: bob }),
				'Ownable: caller is not the owner'
			);
			const totalSupply = await this.hotpot.totalSupply();
			const aliceBal = await this.hotpot.balanceOf(alice);
			const bobBal = await this.hotpot.balanceOf(bob);
			const carolBal = await this.hotpot.balanceOf(charlie);
			assert.equal(totalSupply.valueOf(), '1100');
			assert.equal(aliceBal.valueOf(), '100');
			assert.equal(bobBal.valueOf(), '1000');
			assert.equal(carolBal.valueOf(), '0');
		});
	});
});
