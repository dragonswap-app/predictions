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

    const newAllowance = 120; // Set the new allowance value (in seconds)

    for (const address of predictionV2Addresses) {
      const predictionV2 = await ethers.getContractAt("PredictionV2", address);

      console.log(
        `Setting new oracle update allowance for contract at ${address}...`,
      );
      const tx = await predictionV2.setOracleUpdateAllowance(newAllowance);
      console.log(`Transaction hash: ${tx.hash}`);
      await tx.wait();
      console.log(
        `New oracle update allowance set to ${newAllowance} seconds for contract at ${address}`,
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
