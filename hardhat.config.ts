import type { HardhatUserConfig, NetworkUserConfig } from "hardhat/types";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-web3";
import "@nomiclabs/hardhat-truffle5";
import "@nomicfoundation/hardhat-verify";
import "hardhat-abi-exporter";
import "hardhat-contract-sizer";
import "solidity-coverage";
import "dotenv/config";

const seiTestnet: NetworkUserConfig = {
  url: "https://evm-rpc.arctic-1.seinetwork.io",
  chainId: 713715,
  accounts: [process.env.KEY_TESTNET],
};

const seiMainnet: NetworkUserConfig = {
  url: "https://evm-rpc.sei-apis.com",
  chainId: 1329,
  accounts: [process.env.KEY_MAINNET],
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
