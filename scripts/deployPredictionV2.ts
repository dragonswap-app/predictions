import { parseEther } from "ethers/lib/utils";
import { ethers, network, run } from "hardhat";
import config from "../config";
import { saveJson, getJson, jsons } from "./utils";

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
        await ethers.getContractFactory("PredictionsV2");
      const predictionsV2 = await predictionV2ImplFactory.deploy();
      await predictionsV2.deployed();
      console.log(
        `PredictionV2 implementation address: ${predictionsV2.address}`,
      );

      saveJson(
        jsons.addresses,
        network.name,
        "PredictionsV2Implementation",
        predictionsV2.address,
      );

      await predictionsFactory.setImplementationPredictionV2(
        predictionsV2.address,
      );
      console.log("PredictionsV2 implementation set on factory");
    }

    const predictionsV2Tx = await predictionsFactory.deployPredictionV2(
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

    const predictionsV2TxReceipt = await predictionsV2Tx.wait();

    const predictionsV2 = await ethers.getContractAt(
      "PredictionsV2",
      predictionsV2TxReceipt.logs[0].address,
    );

    console.log("PredictionsV2 address: ", predictionsV2.address);

    saveJson(
      jsons.addresses,
      network.name,
      "PredictionsV2",
      predictionsV2.address,
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
