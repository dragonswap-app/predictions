import type { HardhatUserConfig, NetworkUserConfig } from "hardhat/types";
require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-web3");
require("@openzeppelin/hardhat-upgrades");
require("solidity-coverage");
require("hardhat-contract-sizer");
import "dotenv/config";


const seiTestnet: NetworkUserConfig = {
  url: "https://evm-rpc.arctic-1.seinetwork.io",
  chainId: 713715,
  accounts: process.env.KEY_TESTNET ? [process.env.KEY_TESTNET] : [],
};

const seiMainnet: NetworkUserConfig = {
  url: "https://evm-rpc.sei-apis.com",
  chainId: 1329,
  accounts: process.env.KEY_MAINNET ? [process.env.KEY_MAINNET] : [],
};

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {},
    testnet: seiTestnet,
    mainnet: seiMainnet,
  },
  solidity: {
    version: "0.8.20",
    settings: {
      viaIR: true,
      evmVersion: "paris",
      optimizer: {
        enabled: true,
        runs: 99999,
      },
    },
  },
  etherscan: {
    apiKey: {
      sei_atlantic_1: "53104e04-ae07-46a8-b3d5-77b8cb31d777",
    },
    customChains: [
      {
        network: "sei_atlantic_1",
        chainId: 1328,
        urls: {
          apiURL: "https://seitrace.com/atlantic-2/api",
          browserURL: "https://seitrace.com",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  abiExporter: {
    path: "./data/abi",
    clear: true,
    flat: false,
  },
};

export default config;
