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

    for (const address of predictionV2Addresses) {
      const predictionV2 = await ethers.getContractAt("PredictionV2", address);

      // Treasury amount before claiming
      const currentTreasuryAmt = await predictionV2.treasuryAmount();
      console.log(
        `Treasury Amount to Claim: ${ethers.utils.formatEther(currentTreasuryAmt.toString())} SEI`,
      );

      // Claim fees
      const claimTreasuryFeesTx = await predictionV2.claimTreasury();
      await claimTreasuryFeesTx.wait();
      console.log(`Claimed treasury fees for PredictionV2 at ${address}`);
      const newTreasuryAmt = await predictionV2.treasuryAmount();
      console.log(
        `New Treasury Amount: ${ethers.utils.formatEther(newTreasuryAmt.toString())} SEI`,
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
