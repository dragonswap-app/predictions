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

    const token = config.Address.Token[networkName];
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

    if ((await predictionsFactory.implPredictionV3()) === zeroAddress) {
      const predictionV3ImplFactory =
        await ethers.getContractFactory("PredictionsV3");
      const predictionsV3 = await predictionV3ImplFactory.deploy();
      await predictionsV3.deployed();
      console.log(
        `PredictionV3 implementation address: ${predictionsV3.address}`,
      );

      saveJson(
        jsons.addresses,
        network.name,
        "PredictionsV3Implementation",
        predictionsV3.address,
      );

      await predictionsFactory.setImplementationPredictionV3(
        predictionsV3.address,
      );
      console.log("PredictionsV3 implementation set on factory");
    }

    const predictionsV3Tx = await predictionsFactory.deployPredictionV3(
      token,
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

    const predictionsV3TxReceipt = await predictionsV3Tx.wait();

    const predictionsV3 = await ethers.getContractAt(
      "PredictionsV3",
      predictionsV3TxReceipt.logs[0].address,
    );

    console.log("PredictionsV3 address: ", predictionsV3.address);

    saveJson(
      jsons.addresses,
      network.name,
      "PredictionsV3",
      predictionsV3.address,
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
