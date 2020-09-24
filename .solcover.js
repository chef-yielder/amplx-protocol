module.exports = {
	norpc: true,
	skipFiles: [
		'Timelock.sol',
		'mocks/MockChefMao.sol',
		'mocks/MockERC20.sol',
		'mocks/MockUniswapV2Pair.sol',
		'mocks/MockYuanYangPot.sol',
	],
	compileCommand: 'truffle compile --network coverage',
	testCommand: 'truffle test --network coverage'
};