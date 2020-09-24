module.exports = {
  // Uncommenting the defaults below
  // provides for an easier quick-start with Ganache.
  // You can also follow this format for other networks;
  // see <http://truffleframework.com/docs/advanced/configuration>
  // for more details on how to specify configuration options!
  //
  networks: {
    development: {
      host: 'localhost',
			port: 8545,
			network_id: '*', // Match any network id,
			gas: 8000000
    },
    test: {
      host: 'localhost',
			port: 8545,
			network_id: '*', // Match any network id,
			gas: 8000000
    },
    coverage: {
			host: 'localhost',
			network_id: '*',
			port: 8555,
			gas: 0xfffffffffff,
			gasPrice: 0x01
		}
  },
  plugins: ["solidity-coverage"],
  compilers: {
    solc: {
      version: "0.6.12",
    },
  },
};
