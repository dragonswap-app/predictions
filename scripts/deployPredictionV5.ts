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

    const minBetAmount = parseEther(
      config.MinBetAmount[networkName].toString(),
    ).toString();
    const treasuryFee = config.Treasury[networkName];
    const round = config.Round[networkName];

    const predictionsFactoryAddress = getJson(jsons.addresses)[network.name][
      "PredictionsFactory"
    ];

    const predictionsFactory = await ethers.getContractAt(
      "PredictionsFactory",
      predictionsFactoryAddress,
    );

    if ((await predictionsFactory.implPredictionV5()) === zeroAddress) {
      const predictionV5ImplFactory =
        await ethers.getContractFactory("PredictionsV5");
      const predictionsV5 = await predictionV5ImplFactory.deploy();
      await predictionsV5.deployed();
      console.log(
        `PredictionV5 implementation address: ${predictionsV5.address}`,
      );

      saveJson(
        jsons.addresses,
        network.name,
        "PredictionsV5Implementation",
        predictionsV5.address,
      );

      await predictionsFactory.setImplementationPredictionV5(
        predictionsV5.address,
      );
      console.log("PredictionsV5 implementation set on factory");
    }

    await wait();

    const predictionsV5Tx = await predictionsFactory.deployPredictionV5(
      adminAddress,
      operatorAddress,
      minBetAmount,
      treasuryFee,
      round,
    );

    const predictionsV5TxReceipt = await predictionsV5Tx.wait();

    const predictionsV5 = await ethers.getContractAt(
      "PredictionsV5",
      predictionsV5TxReceipt.logs[0].address,
    );

    console.log("PredictionsV5 address: ", predictionsV5.address);

    saveJson(
      jsons.addresses,
      network.name,
      "PredictionsV5",
      predictionsV5.address,
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
