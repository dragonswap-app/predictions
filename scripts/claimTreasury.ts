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
      "0x308577457b3471eb9daca52e0edccd6d031f4d58",
      "0x0f8550cdda73f47434412215180d85a1bc94eac8",
      "0x6dd0d611b5e6d80e27fe9687487fe36f12270839"
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
