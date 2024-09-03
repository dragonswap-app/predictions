import type { HardhatUserConfig, NetworkUserConfig } from 'hardhat/types';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-web3';
import '@nomiclabs/hardhat-truffle5';
import '@nomicfoundation/hardhat-verify';
import 'hardhat-abi-exporter';
import 'hardhat-contract-sizer';
import 'solidity-coverage';
import 'dotenv/config';

const seiTestnet: NetworkUserConfig = {
  url: 'https://evm-rpc.arctic-1.seinetwork.io',
  chainId: 713715,
  accounts: [process.env.KEY_TESTNET],
};

const seiMainnet: NetworkUserConfig = {
  url: 'https://evm-rpc.sei-apis.com',
  chainId: 1329,
  accounts: [process.env.KEY_MAINNET],
};

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {},
    testnet: seiTestnet,
    mainnet: seiMainnet,
  },
  solidity: {
    version: '0.8.4',
    settings: {
      optimizer: {
        enabled: true,
        runs: 99999,
      },
    },
  },
  etherscan: {
    apiKey: {
      snowtrace: 'snowtrace', // apiKey is not required, just set a placeholder
    },
    customChains: [
      {
        network: 'snowtrace',
        chainId: 43113,
        urls: {
          apiURL:
            'https://api.routescan.io/v2/network/testnet/evm/43113/etherscan',
          browserURL: 'https://avalanche.testnet.routescan.io',
        },
      },
    ],
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  abiExporter: {
    path: './data/abi',
    clear: true,
    flat: false,
  },
};

export default config;
