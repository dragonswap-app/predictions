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

    const newBufferSeconds = 60;
    const newIntervalSeconds = 300;

    for (const address of predictionV2Addresses) {
      const predictionV2 = await ethers.getContractAt("PredictionV2", address);

      console.log(
        `Setting new buffer and interval seconds for contract at ${address}...`,
      );
      const tx = await predictionV2.setBufferAndIntervalSeconds(
        newBufferSeconds,
        newIntervalSeconds,
      );
      console.log(`Transaction hash: ${tx.hash}`);
      await tx.wait();
      console.log(
        `New buffer seconds set to ${newBufferSeconds} and interval seconds set to ${newIntervalSeconds} for contract at ${address}`,
      );
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
