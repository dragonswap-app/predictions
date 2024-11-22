import { parseEther } from "ethers/lib/utils";
import { ethers, network, run } from "hardhat";

const main = async () => {
  // Get network data from Hardhat config (see hardhat.config.ts).
  const networkName = network.name;

  // Check if the network is supported.
  if (networkName === "testnet" || networkName === "mainnet") {
    console.log(`Deploying to ${networkName} network...`);

    // Compile contracts.
    await run("compile");
    console.log("Compiled contracts...");

    const predictionV2Addresses = [
      "0x5B31c97EB5FD1C13BC01a0f6Fd5D0bbF0170dA9B",
      // Add more prediction addresses here
    ];

    const newMinBetAmount = parseEther("0.1"); // Set the new minimum bet amount (e.g., 0.1 SEI)

    for (const address of predictionV2Addresses) {
      const predictionV2 = await ethers.getContractAt("PredictionV2", address);

      // Pausing contract
      const pauseTx = await predictionV2.pause();
      await pauseTx.wait();
      console.log(`Paused contract at ${address}`);

      console.log(
        `Setting new minimum bet amount for contract at ${address}...`,
      );
      const tx = await predictionV2.setMinBetAmount(newMinBetAmount);
      console.log(`Transaction hash: ${tx.hash}`);
      await tx.wait();
      console.log(
        `New minimum bet amount set to ${ethers.utils.formatEther(newMinBetAmount)} SEI for contract at ${address}`,
      );

      // Unpausing contract
      const unpauseTx = await predictionV2.unpause();
      await unpauseTx.wait();
      console.log(`Unpaused contract at ${address}`);

      console.log("---");
    }
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
