import { ethers, network, run } from "hardhat";
import { saveJson, jsons } from "./utils";

async function main() {
  const myWallet = await ethers.getSigner();
  const myWalletAddress = await myWallet.getAddress();

  const predictionsFactory =
    await ethers.getContractFactory("PredictionsFactory");
  const predictionFactory = await predictionsFactory.deploy(myWalletAddress);
  await predictionFactory.deployed();
  console.log(`PredictionsFactory address: ${predictionFactory.address}`);

  saveJson(
    jsons.addresses,
    network.name,
    "PredictionsFactory",
    predictionFactory.address,
  );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
