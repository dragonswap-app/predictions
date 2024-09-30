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
      "0x37591deA45d29EcDeac205e80D8dCbf8D87D9C6A",
      // Add more prediction addresses here
    ];

    const newTreasuryFee = 300; // Fees calculation (e.g. 200 = 2%, 150 = 1.50%), 1000 = 10% being max settable fee value

    for (const address of predictionV2Addresses) {
      const predictionV2 = await ethers.getContractAt("PredictionV2", address);

      // Pausing contract
      const pauseTx = await predictionV2.pause();
      await pauseTx.wait();
      console.log(`Paused contract at ${address}`);

      console.log(`Setting new treasury fee for contract at ${address}...`);
      const tx = await predictionV2.setTreasuryFee(newTreasuryFee);
      console.log(`Transaction hash: ${tx.hash}`);
      await tx.wait();

      const feeOnContract = await predictionV2.treasuryFee();

      console.log("New treasury fee set to: ", feeOnContract.toString());

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
