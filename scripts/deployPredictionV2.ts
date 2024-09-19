import { parseEther } from "ethers/lib/utils";
import { ethers, network, run } from "hardhat";
import config from "../config";
import { saveJson, getJson, jsons, sleep } from "./utils";

const wait = async () => {
  await sleep(3000);
};

const main = async () => {
  // Get network data from Hardhat config (see hardhat.config.ts).
  const networkName = network.name;

  // Check if the network is supported.
  if (networkName === "testnet" || networkName === "mainnet") {
    console.log(`Deploying to ${networkName} network...`);

    const zeroAddress = ethers.constants.AddressZero;
    const adminAddress = config.Address.Admin[networkName];
    const operatorAddress = config.Address.Operator[networkName];

    // Check if the addresses in the config are set.
    if (adminAddress === zeroAddress || operatorAddress === zeroAddress) {
      throw new Error("Missing addresses (Pyth Oracle and/or Admin/Operator)");
    }

    // Compile contracts.
    await run("compile");
    console.log("Compiled contracts...");

    const oracleAddress = config.Address.PythOracle[networkName];
    const interval = config.Block.Interval[networkName];
    const buffer = config.Block.Buffer[networkName];
    const minBetAmount = parseEther(
      config.MinBetAmount[networkName].toString(),
    ).toString();
    const oracleUpdateAllowance = config.OracleUpdateAllowance[networkName];
    const priceFeedId = config.PriceFeedId[networkName];
    const treasury = config.Treasury[networkName];

    const predictionsFactoryAddress = getJson(jsons.addresses)[network.name][
      "PredictionsFactory"
    ];

    const predictionsFactory = await ethers.getContractAt(
      "PredictionsFactory",
      predictionsFactoryAddress,
    );

    if ((await predictionsFactory.implPredictionV2()) === zeroAddress) {
      const predictionV2ImplFactory =
        await ethers.getContractFactory("PredictionV2");
      const predictionV2 = await predictionV2ImplFactory.deploy();
      await predictionV2.deployed();
      console.log(
        `PredictionV2 implementation address: ${predictionV2.address}`,
      );

      saveJson(
        jsons.addresses,
        network.name,
        "PredictionV2Implementation",
        predictionV2.address,
      );

      await predictionsFactory.setImplementationPredictionV2(
        predictionV2.address,
      );
      console.log("PredictionV2 implementation set on factory");
    }

    await wait();

    const predictionV2Tx = await predictionsFactory.deployPredictionV2(
      oracleAddress,
      adminAddress,
      operatorAddress,
      interval,
      buffer,
      minBetAmount,
      oracleUpdateAllowance,
      priceFeedId,
      treasury,
    );

    const predictionV2TxReceipt = await predictionV2Tx.wait();

    const predictionV2 = await ethers.getContractAt(
      "PredictionV2",
      predictionV2TxReceipt.logs[0].address,
    );

    console.log("PredictionsV2 address: ", predictionV2.address);

    saveJson(
      jsons.addresses,
      network.name,
      "PredictionsV2",
      predictionV2.address,
    );
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
