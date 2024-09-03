import { parseEther } from 'ethers/lib/utils';
import { ethers, network, run } from 'hardhat';
import config from '../config';
import { saveJson } from './utils';

const main = async () => {
  // Get network data from Hardhat config (see hardhat.config.ts).
  const networkName = network.name;

  // Check if the network is supported.
  if (networkName === 'testnet' || networkName === 'mainnet') {
    console.log(`Deploying to ${networkName} network...`);

    const zeroAddress = ethers.constants.AddressZero;
    const adminAddress = config.Address.Admin[networkName];
    const operatorAddress = config.Address.Operator[networkName];

    // Check if the addresses in the config are set.
    if (adminAddress === zeroAddress || operatorAddress === zeroAddress) {
      throw new Error(
        'Missing addresses (Pyth Oracle and/or Admin/Operator)'
      );
    }

    // Compile contracts.
    await run('compile');
    console.log('Compiled contracts...');

    const oracleAddress = config.Address.PythOracle[networkName];
    const interval = config.Block.Interval[networkName];
    const buffer = config.Block.Buffer[networkName];
    const betAmount = parseEther(
      config.BetAmount[networkName].toString()
    ).toString();
    const oracleUpdateAllowance = config.OracleUpdateAllowance[networkName];
    const priceFeedId = config.PriceFeedId[networkName];
    const treasury = config.Treasury[networkName];

    // Deploy contracts.
    const PredictionsV2Factory = await ethers.getContractFactory(
      'PredictionsV2'
    );
    const predictionsV2 = await PredictionsV2Factory.deploy(
      oracleAddress,
      adminAddress,
      operatorAddress,
      interval,
      buffer,
      betAmount,
      oracleUpdateAllowance,
      priceFeedId,
      treasury
    );

    // Wait for the contract to be deployed before exiting the script.
    await predictionsV2.deployed();
    console.log(`Deployed to ${predictionsV2.address}`);

    saveJson(
      'addresses.json',
      networkName,
      'PredictionsV2',
      predictionsV2.address
    );

    // wait for 5 block transactions to ensure deployment before verifying
    await predictionsV2.deployTransaction.wait(5);

    // // verify (source: https://hardhat.org/hardhat-runner/plugins/nomiclabs-hardhat-etherscan#using-programmatically)
    // await run("verify:verify", {
    //   address: predictionsV2.address,
    //   contract: "contracts/PredictionsV2.sol:PredictionsV2", // Filename.sol:ClassName
    //   constructorArguments: [adminAddress, operatorAddress, interval, buffer, betAmount, treasury],
    // });
  } else {
    console.log(`Deploying to ${networkName} network is not supported...`);
  }
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
