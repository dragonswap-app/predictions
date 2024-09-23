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

    // Compile contracts.
    await run("compile");
    console.log("Compiled contracts...");

    const predictionV2 = await ethers.getContractAt(
      "PredictionV2",
      "0x5B31c97EB5FD1C13BC01a0f6Fd5D0bbF0170dA9B", // PredictionV2 address
    );

    console.log(await predictionV2.treasuryAmount());

    // // Claim fees
    // const claimTreasuryFeesTx = await predictionV2.claimTreasury();
    // await claimTreasuryFeesTx.wait();

    // console.log(await predictionV2.treasuryAmount());
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
