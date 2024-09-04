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

    if ((await predictionsFactory.implPredictionV4()) === zeroAddress) {
      const predictionV4ImplFactory =
        await ethers.getContractFactory("PredictionsV4");
      const predictionsV4 = await predictionV4ImplFactory.deploy();
      await predictionsV4.deployed();
      console.log(
        `PredictionV4 implementation address: ${predictionsV4.address}`,
      );

      saveJson(
        jsons.addresses,
        network.name,
        "PredictionsV4Implementation",
        predictionsV4.address,
      );

      await predictionsFactory.setImplementationPredictionV4(
        predictionsV4.address,
      );
      console.log("PredictionsV4 implementation set on factory");
    }

    await wait();

    const predictionsV4Tx = await predictionsFactory.deployPredictionV4(
      adminAddress,
      operatorAddress,
      minBetAmount,
      treasuryFee,
      round,
    );

    const predictionsV4TxReceipt = await predictionsV4Tx.wait();

    const predictionsV4 = await ethers.getContractAt(
      "PredictionsV4",
      predictionsV4TxReceipt.logs[0].address,
    );

    console.log("PredictionsV4 address: ", predictionsV4.address);

    saveJson(
      jsons.addresses,
      network.name,
      "PredictionsV4",
      predictionsV4.address,
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
