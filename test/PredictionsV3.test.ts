import { ethers } from "hardhat";
import * as chai from "chai";
import { assert, expect } from "chai";
import { parseEther } from "ethers/lib/utils";
import { BigNumber } from "ethers";
import { solidity } from "ethereum-waffle";
import { time } from "@openzeppelin/test-helpers";

chai.use(solidity);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
// BLOCK_COUNT_MULTPLIER: Only for test, because testing trx causes block to increment which exceeds blockBuffer time checks
// Note that the higher this value is, the slower the test will run
const BLOCK_COUNT_MULTPLIER = 5;
const INITIAL_PRICE = 10000000000; // $100, 8 decimal places
const INTERVAL_SECONDS = 20 * BLOCK_COUNT_MULTPLIER; // 20 seconds * multiplier
const BUFFER_SECONDS = 5 * BLOCK_COUNT_MULTPLIER; // 5 seconds * multplier, round must lock/end within this buffer
const MIN_BET_AMOUNT = parseEther("1"); // 1 SEI
const UPDATE_ALLOWANCE = 30 * BLOCK_COUNT_MULTPLIER; // 30s * multiplier
const INITIAL_REWARD_RATE = 0.9; // 90%
const INITIAL_TREASURY_RATE = 0.1; // 10%
const SEI_PRICE_FEED_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

const TOTAL_INIT_SUPPLY = parseEther("10000000000");

// Enum: 0 = Bull, 1 = Bear
const Position = {
  Bull: 0,
  Bear: 1,
};

const assertBNArray = (arr1: any[], arr2: any | any[]) => {
  assert.equal(arr1.length, arr2.length);
  arr1.forEach((n1, index) => {
    assert.equal(
      n1.toString(),
      BigNumber.from(arr2[index]).toString(),
      `Mismatch at index ${index}`,
    );
  });
};

async function getCurrentTimestamp() {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp;
}

describe("PredictionsV3", () => {
  let operator,
    admin,
    owner,
    bullUser1,
    bullUser2,
    bullUser3,
    bearUser1,
    bearUser2,
    bearUser3,
    users;
  let currentEpoch: any;
  let oracle;
  let prediction: any;
  let mockERC20: any;

  async function nextEpoch() {
    await time.increaseTo((await time.latest()).toNumber() + INTERVAL_SECONDS); // Elapse 20 seconds
  }

  async function updateOraclePrice(price) {
    let currentTimestamp = await getCurrentTimestamp();

    const confidence = 10 * 100000;
    const exponent = -5;
    const emaPrice = price;
    const emaConfidence = 10 * 100000;

    const updateData = await oracle.createPriceFeedUpdateData(
      SEI_PRICE_FEED_ID,
      price,
      confidence,
      exponent,
      emaPrice,
      emaConfidence,
      currentTimestamp,
      currentTimestamp,
    );

    // Use the oracle to update the price feed
    const updateFee = await oracle.getUpdateFee([updateData]);
    await oracle.updatePriceFeeds([updateData], { value: updateFee });
  }

  // Initialize users
  before(async () => {
    [
      operator,
      admin,
      owner,
      bullUser1,
      bullUser2,
      bullUser3,
      bearUser1,
      bearUser2,
      bearUser3,
      ...users
    ] = await ethers.getSigners();
  });

  beforeEach(async () => {
    const mockERC20Factory = await ethers.getContractFactory("MockERC20");

    // Deploy MockERC20
    mockERC20 = await mockERC20Factory.deploy(
      "Mock ERC20",
      "ERC20",
      TOTAL_INIT_SUPPLY,
    );
    // mint erc20 for test accounts
    const MintAmount = parseEther("100"); // 100 erc20
    mockERC20.connect(bullUser1).mintTokens(MintAmount);
    mockERC20.connect(bullUser2).mintTokens(MintAmount);
    mockERC20.connect(bullUser3).mintTokens(MintAmount);
    mockERC20.connect(bearUser1).mintTokens(MintAmount);
    mockERC20.connect(bearUser2).mintTokens(MintAmount);
    mockERC20.connect(bearUser3).mintTokens(MintAmount);

    const oracleFactory = await ethers.getContractFactory("MockPyth");

    oracle = await oracleFactory.deploy(10, 1);

    await updateOraclePrice(INITIAL_PRICE);

    const predictionsContractFactory =
      await ethers.getContractFactory("PredictionsFactory");
    const predictionsFactory = await predictionsContractFactory.deploy(
      owner.address,
    );
    await predictionsFactory.deployed();

    const predictionV3ImplmentationFactory =
      await ethers.getContractFactory("PredictionV3");
    const predictionsV3Implementation =
      await predictionV3ImplmentationFactory.deploy();
    await predictionsV3Implementation.deployed();

    await predictionsFactory
      .connect(owner)
      .setImplementationPredictionV3(predictionsV3Implementation.address);

    const predictionV3CreationTx = await predictionsFactory
      .connect(owner)
      .deployPredictionV3(
        mockERC20.address,
        oracle.address,
        admin.address,
        operator.address,
        INTERVAL_SECONDS,
        BUFFER_SECONDS,
        MIN_BET_AMOUNT.toString(),
        UPDATE_ALLOWANCE,
        SEI_PRICE_FEED_ID,
        INITIAL_TREASURY_RATE * 10000,
      );

    const predictionV3TxReceipt = await predictionV3CreationTx.wait();

    prediction = await ethers.getContractAt(
      "PredictionV3",
      predictionV3TxReceipt.logs[0].address,
    );

    // approve erc20 amount for prediction contract
    const ApproveAmount = parseEther("10000000000000");
    mockERC20.connect(bullUser1).approve(prediction.address, ApproveAmount);
    mockERC20.connect(bullUser2).approve(prediction.address, ApproveAmount);
    mockERC20.connect(bullUser3).approve(prediction.address, ApproveAmount);
    mockERC20.connect(bearUser1).approve(prediction.address, ApproveAmount);
    mockERC20.connect(bearUser2).approve(prediction.address, ApproveAmount);
    mockERC20.connect(bearUser3).approve(prediction.address, ApproveAmount);
  });

  it("Initialize", async () => {
    assert.equal(await mockERC20.balanceOf(prediction.address), 0);
    assert.equal(await prediction.currentEpoch(), 0);
    assert.equal(await prediction.intervalSeconds(), INTERVAL_SECONDS);
    assert.equal(await prediction.pythOracle(), oracle.address);
    assert.equal(await prediction.adminAddress(), admin.address);
    assert.equal(await prediction.minBetAmount(), MIN_BET_AMOUNT.toString());
    assert.equal(await prediction.oracleUpdateAllowance(), UPDATE_ALLOWANCE);
    assert.equal(await prediction.priceFeedId(), SEI_PRICE_FEED_ID);
    assert.equal(await prediction.treasuryAmount(), 0);
    assert.equal(await prediction.genesisStartOnce(), false);
    assert.equal(await prediction.genesisLockOnce(), false);
    assert.equal(await prediction.paused(), false);
  });

  it("Should start genesis rounds (round 1, round 2, round 3)", async () => {
    // Manual block calculation
    let currentTimestamp = await getCurrentTimestamp();

    // Epoch 0
    assert.equal(
      (await ethers.provider.getBlock("latest")).timestamp,
      currentTimestamp,
    );
    assert.equal(await prediction.currentEpoch(), 0);

    // Epoch 1: Start genesis round 1
    await expect(await prediction.genesisStartRound())
      .to.emit(prediction, "StartRound")
      .withArgs(1);
    assert.equal(await prediction.currentEpoch(), 1);

    currentTimestamp++;

    // Start round 1
    assert.equal(await prediction.genesisStartOnce(), true);
    assert.equal(await prediction.genesisLockOnce(), false);
    assert.equal((await prediction.rounds(1)).startTimestamp, currentTimestamp);
    assert.equal(
      (await prediction.rounds(1)).lockTimestamp,
      currentTimestamp + INTERVAL_SECONDS,
    );
    assert.equal(
      (await prediction.rounds(1)).closeTimestamp,
      currentTimestamp + INTERVAL_SECONDS * 2,
    );
    assert.equal((await prediction.rounds(1)).epoch, 1);
    assert.equal((await prediction.rounds(1)).totalAmount, 0);

    // Elapse 20 blocks
    currentTimestamp += INTERVAL_SECONDS;
    await time.increaseTo(currentTimestamp);

    // Epoch 2: Lock genesis round 1 and starts round 2
    await expect(await prediction.connect(operator).genesisLockRound())
      .to.emit(prediction, "LockRound")
      .withArgs(1, INITIAL_PRICE)
      .to.emit(prediction, "StartRound")
      .withArgs(2);

    currentTimestamp++;

    assert.equal(await prediction.currentEpoch(), 2);

    // Lock round 1
    assert.equal(await prediction.genesisStartOnce(), true);
    assert.equal(await prediction.genesisLockOnce(), true);
    assert.equal((await prediction.rounds(1)).lockPrice, INITIAL_PRICE);

    // Start round 2
    assert.equal((await prediction.rounds(2)).startTimestamp, currentTimestamp);
    assert.equal(
      (await prediction.rounds(2)).lockTimestamp,
      currentTimestamp + INTERVAL_SECONDS,
    );
    assert.equal(
      (await prediction.rounds(2)).closeTimestamp,
      currentTimestamp + 2 * INTERVAL_SECONDS,
    );
    assert.equal((await prediction.rounds(2)).epoch, 2);
    assert.equal((await prediction.rounds(2)).totalAmount, 0);

    // Elapse 20 blocks
    currentTimestamp += INTERVAL_SECONDS;
    await time.increaseTo(currentTimestamp);

    // Epoch 3: End genesis round 1, locks round 2, starts round 3
    await updateOraclePrice(INITIAL_PRICE); // To update Oracle price

    await expect(await prediction.executeRound())
      .to.emit(prediction, "EndRound")
      .withArgs(1, INITIAL_PRICE)
      .to.emit(prediction, "LockRound")
      .withArgs(2, INITIAL_PRICE)
      .to.emit(prediction, "StartRound")
      .withArgs(3);

    currentTimestamp += 2; // Oracle update and execute round

    assert.equal(await prediction.currentEpoch(), 3);

    // End round 1
    assert.equal((await prediction.rounds(1)).closePrice, INITIAL_PRICE);

    // Lock round 2
    assert.equal((await prediction.rounds(2)).lockPrice, INITIAL_PRICE);
  });

  it("Should not start rounds before genesis start and lock round has triggered", async () => {
    await expect(prediction.genesisLockRound()).to.be.revertedWith(
      "Can only run after genesisStartRound is triggered",
    );
    await expect(prediction.executeRound()).to.be.revertedWith(
      "Can only run after genesisStartRound and genesisLockRound is triggered",
    );

    await prediction.genesisStartRound();
    await expect(prediction.executeRound()).to.be.revertedWith(
      "Can only run after genesisStartRound and genesisLockRound is triggered",
    );

    await nextEpoch();
    await prediction.genesisLockRound(); // Success

    await nextEpoch();
    await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
    await prediction.executeRound(); // Success
  });

  it("Should not lock round before lockTimestamp and end round before closeTimestamp", async () => {
    await prediction.genesisStartRound();
    await expect(
      prediction.genesisLockRound(),
      "Can only lock round after lockTimestamp",
    ).to.be.revertedWith("Can only lock round after lockTimestamp");
    await nextEpoch();
    await prediction.genesisLockRound();
    await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
    await expect(prediction.executeRound()).to.be.revertedWith(
      "Can only lock round after lockTimestamp",
    );

    await nextEpoch();
    await prediction.executeRound(); // Success
  });

  it("Should record oracle price", async () => {
    // Epoch 1
    await prediction.genesisStartRound();
    assert.equal((await prediction.rounds(1)).lockPrice, 0);
    assert.equal((await prediction.rounds(1)).closePrice, 0);

    // Epoch 2
    await nextEpoch();
    const price120 = 12000000000; // $120
    await updateOraclePrice(price120);
    await prediction.genesisLockRound(); // For round 1
    assert.equal((await prediction.rounds(1)).lockPrice, price120);
    assert.equal((await prediction.rounds(1)).closePrice, 0);
    assert.equal((await prediction.rounds(2)).lockPrice, 0);
    assert.equal((await prediction.rounds(2)).closePrice, 0);

    // Epoch 3
    await nextEpoch();
    const price130 = 13000000000; // $130
    await updateOraclePrice(price130);
    await prediction.executeRound();
    assert.equal((await prediction.rounds(1)).lockPrice, price120);
    assert.equal((await prediction.rounds(1)).closePrice, price130);
    assert.equal((await prediction.rounds(2)).lockPrice, price130);
    assert.equal((await prediction.rounds(2)).closePrice, 0);
    assert.equal((await prediction.rounds(3)).lockPrice, 0);
    assert.equal((await prediction.rounds(3)).closePrice, 0);

    // Epoch 4
    await nextEpoch();
    const price140 = 14000000000; // $140
    await updateOraclePrice(price140);
    await prediction.executeRound();
    assert.equal((await prediction.rounds(1)).lockPrice, price120);
    assert.equal((await prediction.rounds(1)).closePrice, price130);
    assert.equal((await prediction.rounds(2)).lockPrice, price130);
    assert.equal((await prediction.rounds(2)).closePrice, price140);
    assert.equal((await prediction.rounds(3)).lockPrice, price140);
    assert.equal((await prediction.rounds(3)).closePrice, 0);
    assert.equal((await prediction.rounds(4)).lockPrice, 0);
    assert.equal((await prediction.rounds(4)).closePrice, 0);
  });

  // it("Should reject oracle data if data is stale", async () => {
  //   await prediction.genesisStartRound();
  //   await nextEpoch();
  //   await prediction.genesisLockRound();

  //   await nextEpoch();
  //   await updateOraclePrice(INITIAL_PRICE); // To update Oracle price
  //   await prediction.executeRound();

  //   // Oracle not updated
  //   await nextEpoch();
  //   await expect(await prediction.executeRound()).to.be.reverted;
  // });

  it("Should record data and user bets", async () => {
    // Epoch 1
    await prediction.genesisStartRound();
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("1.1").toString()); // 1.1 ERC20
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("1.2").toString()); // 1.2 ERC20
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("1.4").toString()); // 1.4 ERC20

    let balance = await mockERC20.balanceOf(prediction.address);
    assert.equal(balance.toString(), parseEther("3.7").toString()); // 3.7 ERC20
    assert.equal(
      (await prediction.rounds(1)).totalAmount,
      parseEther("3.7").toString(),
    ); // 3.7 ERC20
    assert.equal(
      (await prediction.rounds(1)).bullAmount,
      parseEther("2.3").toString(),
    ); // 2.3 ERC20
    assert.equal(
      (await prediction.rounds(1)).bearAmount,
      parseEther("1.4").toString(),
    ); // 1.4 ERC20
    assert.equal(
      (await prediction.ledger(1, bullUser1.address)).position,
      Position.Bull,
    );
    assert.equal(
      (await prediction.ledger(1, bullUser1.address)).amount,
      parseEther("1.1").toString(),
    );
    assert.equal(
      (await prediction.ledger(1, bullUser2.address)).position,
      Position.Bull,
    );
    assert.equal(
      (await prediction.ledger(1, bullUser2.address)).amount,
      parseEther("1.2").toString(),
    );
    assert.equal(
      (await prediction.ledger(1, bearUser1.address)).position,
      Position.Bear,
    );
    assert.equal(
      (await prediction.ledger(1, bearUser1.address)).amount,
      parseEther("1.4").toString(),
    );
    assertBNArray(
      (await prediction.getUserRounds(bullUser1.address, 0, 1))[0],
      [1],
    );
    assertBNArray(
      (await prediction.getUserRounds(bullUser2.address, 0, 1))[0],
      [1],
    );
    assertBNArray(
      (await prediction.getUserRounds(bearUser1.address, 0, 1))[0],
      [1],
    );
    assert.equal(await prediction.getUserRoundsLength(bullUser1.address), 1);

    // Epoch 2
    await nextEpoch();
    await prediction.genesisLockRound(); // For round 1
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("2.1").toString()); // 2.1 ERC20
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("2.2").toString()); // 2.2 ERC20
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("2.4").toString()); // 2.4 ERC20

    let balance = await mockERC20.balanceOf(prediction.address);
    assert.equal(balance.toString(), parseEther("10.4").toString()); // 10.4 ERC20 (3.7+6.7)
    assert.equal(
      (await prediction.rounds(2)).totalAmount,
      parseEther("6.7").toString(),
    ); // 6.7 ERC20
    assert.equal(
      (await prediction.rounds(2)).bullAmount,
      parseEther("4.3").toString(),
    ); // 4.3 ERC20
    assert.equal(
      (await prediction.rounds(2)).bearAmount,
      parseEther("2.4").toString(),
    ); // 2.4 ERC20
    assert.equal(
      (await prediction.ledger(2, bullUser1.address)).position,
      Position.Bull,
    );
    assert.equal(
      (await prediction.ledger(2, bullUser1.address)).amount,
      parseEther("2.1").toString(),
    );
    assert.equal(
      (await prediction.ledger(2, bullUser2.address)).position,
      Position.Bull,
    );
    assert.equal(
      (await prediction.ledger(2, bullUser2.address)).amount,
      parseEther("2.2").toString(),
    );
    assert.equal(
      (await prediction.ledger(2, bearUser1.address)).position,
      Position.Bear,
    );
    assert.equal(
      (await prediction.ledger(2, bearUser1.address)).amount,
      parseEther("2.4").toString(),
    );
    assertBNArray(
      (await prediction.getUserRounds(bullUser1.address, 0, 2))[0],
      [1, 2],
    );
    assertBNArray(
      (await prediction.getUserRounds(bullUser2.address, 0, 2))[0],
      [1, 2],
    );
    assertBNArray(
      (await prediction.getUserRounds(bearUser1.address, 0, 2))[0],
      [1, 2],
    );
    assert.equal(await prediction.getUserRoundsLength(bullUser1.address), 2);

    // Epoch 3
    await nextEpoch();
    await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
    await prediction.executeRound();
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("3.1").toString()); // 3.1 ERC20
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("3.2").toString()); // 3.2 ERC20
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("3.4").toString()); // 4.3 ERC20

    let balance = await mockERC20.balanceOf(prediction.address);

    assert.equal(balance.toString(), parseEther("20.1").toString()); // 20.1 ERC20 (3.7+6.7+9.7)
    assert.equal(
      (await prediction.rounds(3)).totalAmount,
      parseEther("9.7").toString(),
    ); // 9.7 ERC20
    assert.equal(
      (await prediction.rounds(3)).bullAmount,
      parseEther("6.3").toString(),
    ); // 6.3 ERC20
    assert.equal(
      (await prediction.rounds(3)).bearAmount,
      parseEther("3.4").toString(),
    ); // 3.4 ERC20
    assert.equal(
      (await prediction.ledger(3, bullUser1.address)).position,
      Position.Bull,
    );
    assert.equal(
      (await prediction.ledger(3, bullUser1.address)).amount,
      parseEther("3.1").toString(),
    );
    assert.equal(
      (await prediction.ledger(3, bullUser2.address)).position,
      Position.Bull,
    );
    assert.equal(
      (await prediction.ledger(3, bullUser2.address)).amount,
      parseEther("3.2").toString(),
    );
    assert.equal(
      (await prediction.ledger(3, bearUser1.address)).position,
      Position.Bear,
    );
    assert.equal(
      (await prediction.ledger(3, bearUser1.address)).amount,
      parseEther("3.4").toString(),
    );
    assertBNArray(
      (await prediction.getUserRounds(bullUser1.address, 0, 3))[0],
      [1, 2, 3],
    );
    assertBNArray(
      (await prediction.getUserRounds(bullUser2.address, 0, 3))[0],
      [1, 2, 3],
    );
    assertBNArray(
      (await prediction.getUserRounds(bearUser1.address, 0, 3))[0],
      [1, 2, 3],
    );
    assert.equal(await prediction.getUserRoundsLength(bullUser1.address), 3);

    // Epoch 4
    await nextEpoch();
    await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
    await prediction.executeRound();
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("4.1").toString()); // 4.1 ERC20
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("4.2").toString()); // 4.2 ERC20
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("4.4").toString()); // 4.4 ERC20

    let balance = await mockERC20.balanceOf(prediction.address);
    assert.equal(balance.toString(), parseEther("32.8").toString()); // 32.8 ERC20 (3.7+6.7+9.7+12.7)
    assert.equal(
      (await prediction.rounds(4)).totalAmount,
      parseEther("12.7").toString(),
    ); // 12.7 ERC20
    assert.equal(
      (await prediction.rounds(4)).bullAmount,
      parseEther("8.3").toString(),
    ); // 8.3 ERC20
    assert.equal(
      (await prediction.rounds(4)).bearAmount,
      parseEther("4.4").toString(),
    ); // 4.4 ERC20
    assert.equal(
      (await prediction.ledger(4, bullUser1.address)).position,
      Position.Bull,
    );
    assert.equal(
      (await prediction.ledger(4, bullUser1.address)).amount,
      parseEther("4.1").toString(),
    );
    assert.equal(
      (await prediction.ledger(4, bullUser2.address)).position,
      Position.Bull,
    );
    assert.equal(
      (await prediction.ledger(4, bullUser2.address)).amount,
      parseEther("4.2").toString(),
    );
    assert.equal(
      (await prediction.ledger(4, bearUser1.address)).position,
      Position.Bear,
    );
    assert.equal(
      (await prediction.ledger(4, bearUser1.address)).amount,
      parseEther("4.4").toString(),
    );
    assertBNArray(
      (await prediction.getUserRounds(bullUser1.address, 0, 4))[0],
      [1, 2, 3, 4],
    );
    assertBNArray(
      (await prediction.getUserRounds(bullUser2.address, 0, 4))[0],
      [1, 2, 3, 4],
    );
    assertBNArray(
      (await prediction.getUserRounds(bearUser1.address, 0, 4))[0],
      [1, 2, 3, 4],
    );
    assert.equal(await prediction.getUserRoundsLength(bullUser1.address), 4);
  });

  it("Should not allow multiple bets", async () => {
    // Epoch 1
    await prediction.genesisStartRound();
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("1").toString()); // Success
    await expect(
      prediction
        .connect(bullUser1)
        .betBull(currentEpoch, parseEther("1").toString()),
    ).to.be.revertedWith("Can only bet once per round");
    await expect(
      prediction
        .connect(bullUser1)
        .betBear(currentEpoch, parseEther("1").toString()),
    ).to.be.revertedWith("Can only bet once per round");
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("1").toString()); // Success
    await expect(
      prediction
        .connect(bearUser1)
        .betBull(currentEpoch, parseEther("1").toString()),
    ).to.be.revertedWith("Can only bet once per round");
    await expect(
      prediction
        .connect(bearUser1)
        .betBear(currentEpoch, parseEther("1").toString()),
    ).to.be.revertedWith("Can only bet once per round");

    // Epoch 2
    await nextEpoch();
    await prediction.genesisLockRound(); // For round 1
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("1").toString()); // Success
    await expect(
      prediction
        .connect(bullUser1)
        .betBull(currentEpoch, parseEther("1").toString()),
    ).to.be.revertedWith("Can only bet once per round");
    await expect(
      prediction
        .connect(bullUser1)
        .betBear(currentEpoch, parseEther("1").toString()),
    ).to.be.revertedWith("Can only bet once per round");
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("1").toString()); // Success
    await expect(
      prediction
        .connect(bearUser1)
        .betBull(currentEpoch, parseEther("1").toString()),
    ).to.be.revertedWith("Can only bet once per round");
    await expect(
      prediction
        .connect(bearUser1)
        .betBear(currentEpoch, parseEther("1").toString()),
    ).to.be.revertedWith("Can only bet once per round");

    // Epoch 3
    await nextEpoch();
    await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
    await prediction.executeRound();
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("1").toString()); // Success
    await expect(
      prediction
        .connect(bullUser1)
        .betBull(currentEpoch, parseEther("1").toString()),
    ).to.be.revertedWith("Can only bet once per round");
    await expect(
      prediction
        .connect(bullUser1)
        .betBear(currentEpoch, parseEther("1").toString()),
    ).to.be.revertedWith("Can only bet once per round");
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("1").toString()); // Success
    await expect(
      prediction
        .connect(bearUser1)
        .betBull(currentEpoch, parseEther("1").toString()),
    ).to.be.revertedWith("Can only bet once per round");
    await expect(
      prediction
        .connect(bearUser1)
        .betBear(currentEpoch, parseEther("1").toString()),
    ).to.be.revertedWith("Can only bet once per round");
  });

  it("Should not allow bets lesser than minimum bet amount", async () => {
    // Epoch 1
    await prediction.genesisStartRound();
    currentEpoch = await prediction.currentEpoch();

    await expect(
      prediction
        .connect(bullUser1)
        .betBull(currentEpoch, parseEther("0.5").toString()),
    ).to.be.revertedWith("Bet amount must be greater than minBetAmount"); // 0.5 SEI
    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("1").toString()); // Success

    // Epoch 2
    await nextEpoch();
    await prediction.genesisLockRound(); // For round 1
    currentEpoch = await prediction.currentEpoch();

    await expect(
      prediction
        .connect(bullUser1)
        .betBull(currentEpoch, parseEther("0.5").toString()),
      "Bet amount must be greater than minBetAmount",
    ).to.be.revertedWith("Bet amount must be greater than minBetAmount"); // 0.5 SEI
    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("1").toString()); // Success

    // Epoch 3
    await nextEpoch();
    await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
    await prediction.executeRound();
    currentEpoch = await prediction.currentEpoch();

    await expect(
      prediction
        .connect(bullUser1)
        .betBull(currentEpoch, parseEther("0.5").toString()),
    ).to.be.revertedWith("Bet amount must be greater than minBetAmount"); // 0.5 SEI
    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("1").toString()); // Success
  });

  it("Should record rewards", async () => {
    // Epoch 1
    const price110 = 11000000000; // $110
    await updateOraclePrice(price110);
    await prediction.genesisStartRound();
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("1.1").toString()); // 1.1 SEI
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("1.2").toString()); // 1.2 SEI
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("1.4").toString()); // 1.4 SEI

    assert.equal((await prediction.rounds(1)).rewardBaseCalAmount, 0);
    assert.equal((await prediction.rounds(1)).rewardAmount, 0);
    assert.equal(await prediction.treasuryAmount(), 0);
    let balance = await mockERC20.balanceOf(prediction.address);
    assert.equal(balance.toString(), parseEther("3.7").toString());

    // Epoch 2
    await nextEpoch();
    const price120 = 12000000000; // $120
    await updateOraclePrice(price120);
    await prediction.genesisLockRound(); // For round 1
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("2.1").toString()); // 2.1 SEI
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("2.2").toString()); // 2.2 SEI
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("2.4").toString()); // 2.4 SEI

    assert.equal((await prediction.rounds(1)).rewardBaseCalAmount, 0);
    assert.equal((await prediction.rounds(1)).rewardAmount, 0);
    assert.equal((await prediction.rounds(2)).rewardBaseCalAmount, 0);
    assert.equal((await prediction.rounds(2)).rewardAmount, 0);
    assert.equal(await prediction.treasuryAmount(), 0);
    balance = await mockERC20.balanceOf(prediction.address);
    assert.equal(
      balance.toString(),
      parseEther("3.7").add(parseEther("6.7")).toString(),
    );

    // Epoch 3, Round 1 is Bull (130 > 120)
    await nextEpoch();
    const price130 = 13000000000; // $130
    await updateOraclePrice(price130);
    await prediction.executeRound();
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("3.1").toString()); // 3.1 SEI
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("3.2").toString()); // 3.2 SEI
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("3.4").toString()); // 3.4 SEI

    assert.equal(
      (await prediction.rounds(1)).rewardBaseCalAmount,
      parseEther("2.3").toString(),
    ); // 2.3 SEI, Bull total
    assert.equal(
      (await prediction.rounds(1)).rewardAmount,
      parseEther("3.7") * INITIAL_REWARD_RATE,
    ); // 3.33 SEI, Total * rewardRate
    assert.equal((await prediction.rounds(2)).rewardBaseCalAmount, 0);
    assert.equal((await prediction.rounds(2)).rewardAmount, 0);
    assert.equal(
      await prediction.treasuryAmount(),
      parseEther("3.7") * INITIAL_TREASURY_RATE,
    ); // 3.7 SEI, Total * treasuryRate
    balance = await mockERC20.balanceOf(prediction.address);
    assert.equal(
      balance.toString(),
      parseEther("3.7")
        .add(parseEther("6.7"))
        .add(parseEther("9.7"))
        .toString(),
    );

    // Epoch 4, Round 2 is Bear (100 < 130)
    await nextEpoch();
    const price100 = 10000000000; // $100
    await updateOraclePrice(price100);
    await prediction.executeRound();
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("4.1").toString()); // 4.1 SEI
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("4.2").toString()); // 4.2 SEI
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("4.4").toString()); // 4.4 SEI

    assert.equal(
      (await prediction.rounds(1)).rewardBaseCalAmount,
      parseEther("2.3").toString(),
    ); // 2.3 SEI, Bull total
    assert.equal(
      (await prediction.rounds(1)).rewardAmount,
      parseEther("3.7") * INITIAL_REWARD_RATE,
    ); // 3.33 SEI, Total * rewardRate
    assert.equal(
      (await prediction.rounds(2)).rewardBaseCalAmount,
      parseEther("2.4").toString(),
    ); // 2.4 SEI, Bear total
    assert.equal(
      (await prediction.rounds(2)).rewardAmount,
      parseEther("6.7") * INITIAL_REWARD_RATE,
    ); // 6.7 SEI, Total * rewardRate
    assert.equal(
      await prediction.treasuryAmount(),
      parseEther("3.7").add(parseEther("6.7")) * INITIAL_TREASURY_RATE,
    ); // 10.4, Accumulative treasury
    balance = await mockERC20.balanceOf(prediction.address);
    assert.equal(
      balance.toString(),
      parseEther("3.7")
        .add(parseEther("6.7"))
        .add(parseEther("9.7"))
        .add(parseEther("12.7"))
        .toString(),
    );
  });

  it("Should not lock round before lockTimestamp", async () => {
    await prediction.genesisStartRound();
    await nextEpoch();
    await prediction.genesisLockRound();
    await nextEpoch();
    await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
    await prediction.executeRound();

    await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
    await expect(prediction.executeRound()).to.be.revertedWith(
      "Can only lock round after lockTimestamp",
    );
    await nextEpoch();
    await prediction.executeRound(); // Success
  });

  it("Should claim rewards", async () => {
    // Epoch 1
    const price110 = 11000000000; // $110
    await updateOraclePrice(price110);
    await prediction.genesisStartRound();
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("1").toString()); // 1 SEI
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("2").toString()); // 2 SEI
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("4").toString()); // 4 SEI

    assert.equal(await prediction.claimable(1, bullUser1.address), false);
    assert.equal(await prediction.claimable(1, bullUser2.address), false);
    assert.equal(await prediction.claimable(1, bearUser1.address), false);
    await expect(prediction.connect(bullUser1).claim([1])).to.be.revertedWith(
      "Round has not ended",
    );
    await expect(prediction.connect(bullUser2).claim([1])).to.be.revertedWith(
      "Round has not ended",
    );
    await expect(prediction.connect(bearUser1).claim([1])).to.be.revertedWith(
      "Round has not ended",
    );
    await expect(prediction.connect(bullUser1).claim([2])).to.be.revertedWith(
      "Round has not started",
    );
    await expect(prediction.connect(bullUser2).claim([2])).to.be.revertedWith(
      "Round has not started",
    );
    await expect(prediction.connect(bearUser1).claim([2])).to.be.revertedWith(
      "Round has not started",
    );

    // Epoch 2
    await nextEpoch();
    const price120 = 12000000000; // $120
    await updateOraclePrice(price120);
    await prediction.genesisLockRound(); // For round 1
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("21").toString()); // 21 SEI
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("22").toString()); // 22 SEI
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("24").toString()); // 24 SEI

    assert.equal(await prediction.claimable(1, bullUser1.address), false);
    assert.equal(await prediction.claimable(1, bullUser2.address), false);
    assert.equal(await prediction.claimable(1, bearUser1.address), false);
    assert.equal(await prediction.claimable(2, bullUser1.address), false);
    assert.equal(await prediction.claimable(2, bullUser2.address), false);
    assert.equal(await prediction.claimable(2, bearUser1.address), false);
    await expect(prediction.connect(bullUser1).claim([1])).to.be.revertedWith(
      "Round has not ended",
    );
    await expect(prediction.connect(bullUser2).claim([1])).to.be.revertedWith(
      "Round has not ended",
    );
    await expect(prediction.connect(bearUser1).claim([1])).to.be.revertedWith(
      "Round has not ended",
    );
    await expect(prediction.connect(bullUser1).claim([2])).to.be.revertedWith(
      "Round has not ended",
    );
    await expect(prediction.connect(bullUser2).claim([2])).to.be.revertedWith(
      "Round has not ended",
    );
    await expect(prediction.connect(bearUser1).claim([2])).to.be.revertedWith(
      "Round has not ended",
    );

    // Epoch 3, Round 1 is Bull (130 > 120)
    await nextEpoch();
    const price130 = 13000000000; // $130
    await updateOraclePrice(price130);
    await prediction.executeRound();

    assert.equal(await prediction.claimable(1, bullUser1.address), true);
    assert.equal(await prediction.claimable(1, bullUser2.address), true);
    assert.equal(await prediction.claimable(1, bearUser1.address), false);
    assert.equal(await prediction.claimable(2, bullUser1.address), false);
    assert.equal(await prediction.claimable(2, bullUser2.address), false);
    assert.equal(await prediction.claimable(2, bearUser1.address), false);

    // Claim for Round 1: Total rewards = 3.7, Bull = 2.3, Bear = 1.4
    await expect(await prediction.connect(bullUser1).claim([1]))
      .to.emit(prediction, "Claim")
      .withArgs(bullUser1.address, 1, parseEther("2.1").toString()); // Success

    await expect(await prediction.connect(bullUser2).claim([1]))
      .to.emit(prediction, "Claim")
      .withArgs(bullUser2.address, 1, parseEther("4.2").toString()); // Success

    await expect(prediction.connect(bearUser1).claim([1])).to.be.revertedWith(
      "Not eligible for claim",
    );
    await expect(prediction.connect(bullUser1).claim([2])).to.be.revertedWith(
      "Round has not ended",
    );
    await expect(prediction.connect(bullUser2).claim([2])).to.be.revertedWith(
      "Round has not ended",
    );
    await expect(prediction.connect(bearUser1).claim([2])).to.be.revertedWith(
      "Round has not ended",
    );

    // Epoch 4, Round 2 is Bear (100 < 130)
    await nextEpoch();
    const price100 = 10000000000; // $100
    await updateOraclePrice(price100);
    await prediction.executeRound();

    assert.equal(await prediction.claimable(1, bullUser1.address), false); // User has claimed
    assert.equal(await prediction.claimable(1, bullUser2.address), false); // User has claimed
    assert.equal(await prediction.claimable(1, bearUser1.address), false);
    assert.equal(await prediction.claimable(2, bullUser1.address), false);
    assert.equal(await prediction.claimable(2, bullUser2.address), false);
    assert.equal(await prediction.claimable(2, bearUser1.address), true);

    // Claim for Round 2: Total rewards = 67, Bull = 43, Bear = 24
    await expect(await prediction.connect(bearUser1).claim([2]))
      .to.emit(prediction, "Claim")
      .withArgs(bearUser1.address, 2, parseEther("60.3").toString()); // Success

    await expect(prediction.connect(bullUser1).claim([1])).to.be.revertedWith(
      "Not eligible for claim",
    );
    await expect(prediction.connect(bullUser2).claim([1])).to.be.revertedWith(
      "Not eligible for claim",
    );
    await expect(prediction.connect(bearUser1).claim([1])).to.be.revertedWith(
      "Not eligible for claim",
    );
    await expect(prediction.connect(bullUser1).claim([2])).to.be.revertedWith(
      "Not eligible for claim",
    );
    await expect(prediction.connect(bullUser2).claim([2])).to.be.revertedWith(
      "Not eligible for claim",
    );
    await expect(prediction.connect(bearUser1).claim([2])).to.be.revertedWith(
      "Not eligible for claim",
    );
  });

  it("Should multi claim rewards", async () => {
    // Epoch 1
    const price110 = 11000000000; // $110
    await updateOraclePrice(price110);
    await prediction.genesisStartRound();
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("1").toString()); // 1 SEI
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("2").toString()); // 2 SEI
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("4").toString()); // 4 SEI

    assert.equal(await prediction.claimable(1, bullUser1.address), false);
    assert.equal(await prediction.claimable(1, bullUser2.address), false);
    assert.equal(await prediction.claimable(1, bearUser1.address), false);

    // Epoch 2
    await nextEpoch();
    const price120 = 12000000000; // $120
    await updateOraclePrice(price120);
    await prediction.genesisLockRound(); // For round 1
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("21").toString()); // 21 SEI
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("22").toString()); // 22 SEI
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("24").toString()); // 24 SEI

    // Epoch 3, Round 1 is Bull (130 > 120)
    await nextEpoch();
    const price130 = 13000000000; // $130
    await updateOraclePrice(price130);
    await prediction.executeRound();

    assert.equal(await prediction.claimable(1, bullUser1.address), true);
    assert.equal(await prediction.claimable(1, bullUser2.address), true);
    assert.equal(await prediction.claimable(1, bearUser1.address), false);
    assert.equal(await prediction.claimable(2, bullUser1.address), false);
    assert.equal(await prediction.claimable(2, bullUser2.address), false);
    assert.equal(await prediction.claimable(2, bearUser1.address), false);

    // Epoch 4, Round 2 is Bull (140 > 130)
    await nextEpoch();
    const price140 = 14000000000; // $140
    await updateOraclePrice(price140);
    await prediction.executeRound();

    assert.equal(await prediction.claimable(1, bullUser1.address), true);
    assert.equal(await prediction.claimable(1, bullUser2.address), true);
    assert.equal(await prediction.claimable(1, bearUser1.address), false);
    assert.equal(await prediction.claimable(2, bullUser1.address), true);
    assert.equal(await prediction.claimable(2, bullUser2.address), true);
    assert.equal(await prediction.claimable(2, bearUser1.address), false);

    await expect(
      prediction.connect(bullUser1).claim([2, 2]),
    ).to.be.revertedWith("Not eligible for claim");
    await expect(
      prediction.connect(bullUser1).claim([1, 1]),
    ).to.be.revertedWith("Not eligible for claim");

    await expect(await prediction.connect(bullUser1).claim([1, 2]))
      .to.emit(prediction, "Claim")
      .withArgs(bullUser1.address, 1, parseEther("2.1").toString()); // Success

    await expect(await prediction.connect(bullUser2).claim([1, 2]))
      .to.emit(prediction, "Claim")
      .withArgs(bullUser2.address, 1, parseEther("4.2").toString()); // Success

    await expect(
      prediction.connect(bullUser1).claim([1, 2]),
    ).to.be.revertedWith("Not eligible for claim");
    await expect(
      prediction.connect(bullUser1).claim([2, 1]),
    ).to.be.revertedWith("Not eligible for claim");
    await expect(
      prediction.connect(bullUser2).claim([1, 2]),
    ).to.be.revertedWith("Not eligible for claim");
    await expect(
      prediction.connect(bullUser2).claim([2, 1]),
    ).to.be.revertedWith("Not eligible for claim");
    await expect(prediction.connect(bearUser1).claim([1])).to.be.revertedWith(
      "Not eligible for claim",
    );
    await expect(prediction.connect(bearUser1).claim([2])).to.be.revertedWith(
      "Not eligible for claim",
    );
  });

  it("Should record house wins", async () => {
    // Epoch 1
    const price110 = 11000000000; // $110
    await updateOraclePrice(price110);
    await prediction.genesisStartRound();
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("1").toString()); // 1 SEI
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("2").toString()); // 2 SEI
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("4").toString()); // 4 SEI

    // Epoch 2
    await nextEpoch();
    await updateOraclePrice(price110);
    await prediction.genesisLockRound(); // For round 1

    // Epoch 3, Round 1 is Same (110 == 110), House wins
    await nextEpoch();
    await updateOraclePrice(price110);
    await prediction.executeRound();

    await expect(prediction.connect(bullUser1).claim([1])).to.be.revertedWith(
      "Not eligible for claim",
    );
    await expect(prediction.connect(bullUser2).claim([1])).to.be.revertedWith(
      "Not eligible for claim",
    );
    await expect(prediction.connect(bearUser1).claim([1])).to.be.revertedWith(
      "Not eligible for claim",
    );
    assert.equal(
      (await prediction.treasuryAmount()).toString(),
      parseEther("7").toString(),
    ); // 7 = 1+2+4
  });

  it("Should claim treasury rewards", async () => {
    let predictionCurrentSEI = parseEther("0");
    let balance = await mockERC20.balanceOf(prediction.address);
    assert.equal(balance.toString, parseEther("0").toString);

    // Epoch 1
    const price110 = 11000000000; // $110
    await updateOraclePrice(price110);
    await prediction.genesisStartRound();
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("1").toString()); // 1 SEI
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("2").toString()); // 2 SEI
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("4").toString()); // 4 SEI
    predictionCurrentSEI = predictionCurrentSEI.add(parseEther("7"));

    assert.equal(await prediction.treasuryAmount(), 0);
    balance = await mockERC20.balanceOf(prediction.address);
    assert.equal(balance.toString(), predictionCurrentSEI.toString());

    // Epoch 2
    await nextEpoch();
    const price120 = 12000000000; // $120
    await updateOraclePrice(price120);
    await prediction.genesisLockRound(); // For round 1
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("21").toString()); // 21 SEI
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("22").toString()); // 22 SEI
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("24").toString()); // 24 SEI
    predictionCurrentSEI = predictionCurrentSEI.add(parseEther("67"));

    assert.equal(await prediction.treasuryAmount(), 0);
    balance = await mockERC20.balanceOf(prediction.address);
    assert.equal(balance.toString(), predictionCurrentSEI.toString());

    // Epoch 3, Round 1 is Bull (130 > 120)
    await nextEpoch();
    const price130 = 13000000000; // $130
    await updateOraclePrice(price130);
    await prediction.executeRound();
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("31").toString()); // 31 SEI
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("32").toString()); // 32 SEI
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("34").toString()); // 34 SEI
    predictionCurrentSEI = predictionCurrentSEI.add(parseEther("97"));

    // Admin claim for Round 1
    balance = await mockERC20.balanceOf(prediction.address);
    assert.equal(balance.toString(), predictionCurrentSEI.toString());
    assert.equal(
      (await prediction.treasuryAmount()).toString(),
      parseEther("0.7").toString(),
    ); // 0.7 = 7 * 0.1

    await prediction.connect(admin).claimTreasury(); // Success

    assert.equal(await prediction.treasuryAmount(), 0); // Empty
    predictionCurrentSEI = predictionCurrentSEI.sub(parseEther("0.7"));
    balance = await mockERC20.balanceOf(prediction.address);
    assert.equal(balance.toString(), predictionCurrentSEI.toString());

    // Epoch 4
    await nextEpoch();
    const price140 = 14000000000; // $140
    await updateOraclePrice(price140); // Prevent house from winning
    await prediction.executeRound();
    assert.equal(
      (await prediction.treasuryAmount()).toString(),
      parseEther("6.7").toString(),
    ); // 6.7 = (21+22+24) * 0.1

    // Epoch 5
    await nextEpoch();
    const price150 = 15000000000; // $150
    await updateOraclePrice(price150); // Prevent house from winning
    await prediction.executeRound();

    // Admin claim for Round 1 and 2
    assert.equal(
      (await prediction.treasuryAmount()).toString(),
      parseEther("6.7").add(parseEther("9.7")).toString(),
    ); // 9.7 = (31+32+34) * 0.1

    await prediction.connect(admin).claimTreasury(); // Success

    assert.equal(await prediction.treasuryAmount(), 0); // Empty
    predictionCurrentSEI = predictionCurrentSEI.sub(parseEther("16.4"));
    balance = await mockERC20.balanceOf(prediction.address);
    assert.equal(balance.toString(), predictionCurrentSEI.toString());
  });

  it("Admin/Owner function work as expected", async () => {
    await prediction.connect(admin).pause();
    await prediction.connect(admin).setBufferAndIntervalSeconds("50", "100");

    await expect(
      prediction.connect(admin).setBufferAndIntervalSeconds("100", "99"),
    ).to.be.revertedWith("bufferSeconds must be inferior to intervalSeconds");

    await expect(
      prediction.connect(admin).setBufferAndIntervalSeconds("100", "100"),
    ).to.be.revertedWith("bufferSeconds must be inferior to intervalSeconds");

    await prediction.connect(admin).setMinBetAmount("50");

    await expect(
      prediction.connect(admin).setMinBetAmount("0"),
    ).to.be.revertedWith("Must be superior to 0");

    await prediction.connect(admin).setOperator(admin.address);

    await expect(
      prediction.connect(admin).setOperator(ZERO_ADDRESS),
    ).to.be.revertedWith("Cannot be zero address");

    await prediction
      .connect(admin)
      .setOracleAndPriceFeedId(oracle.address, SEI_PRICE_FEED_ID);

    await expect(
      prediction
        .connect(admin)
        .setOracleAndPriceFeedId(ZERO_ADDRESS, SEI_PRICE_FEED_ID),
    ).to.be.revertedWith("Cannot be zero address");

    await prediction.connect(admin).setOracleUpdateAllowance("30");

    await prediction.connect(admin).setTreasuryFee("300");

    await expect(
      prediction.connect(admin).setTreasuryFee("3000"),
    ).to.be.revertedWith("Treasury fee too high");

    await prediction.connect(owner).setAdmin(owner.address);

    await expect(
      prediction.connect(owner).setAdmin(ZERO_ADDRESS),
    ).to.be.revertedWith("Cannot be zero address");
  });

  it("Should reject operator functions when not operator", async () => {
    await expect(
      prediction.connect(admin).genesisLockRound(),
    ).to.be.revertedWith("Not operator");
    await expect(
      prediction.connect(admin).genesisStartRound(),
    ).to.be.revertedWith("Not operator");
    await expect(prediction.connect(admin).executeRound()).to.be.revertedWith(
      "Not operator",
    );
  });

  it("Should reject admin/owner functions when not admin/owner", async () => {
    await expect(
      prediction.connect(bullUser1).claimTreasury(),
    ).to.be.revertedWith("Not admin");
    await expect(prediction.connect(bullUser1).pause()).to.be.revertedWith(
      "Not operator/admin",
    );
    await prediction.connect(admin).pause();
    await expect(prediction.connect(bullUser1).unpause()).to.be.revertedWith(
      "Not operator/admin",
    );
    await expect(
      prediction.connect(bullUser1).setBufferAndIntervalSeconds("50", "100"),
    ).to.be.revertedWith("Not admin");
    await expect(
      prediction.connect(bullUser1).setMinBetAmount("0"),
    ).to.be.revertedWith("Not admin");
    await expect(
      prediction.connect(bullUser1).setOperator(bearUser1.address),
    ).to.be.revertedWith("Not admin");
    await expect(
      prediction
        .connect(bullUser1)
        .setOracleAndPriceFeedId(bearUser1.address, SEI_PRICE_FEED_ID),
    ).to.be.revertedWith("Not admin");
    await expect(
      prediction.connect(bullUser1).setOracleUpdateAllowance("0"),
    ).to.be.revertedWith("Not admin");
    await expect(
      prediction.connect(bullUser1).setTreasuryFee("100"),
    ).to.be.revertedWith("Not admin");
    await expect(prediction.connect(bullUser1).unpause()).to.be.revertedWith(
      "Not operator/admin",
    );
    await prediction.connect(admin).unpause();
  });

  it("Should reject admin/owner functions when not paused", async () => {
    await expect(
      prediction.connect(admin).setBufferAndIntervalSeconds("50", "100"),
    ).to.be.reverted;
    await expect(prediction.connect(admin).setMinBetAmount("0")).to.be.reverted;
    await expect(
      prediction
        .connect(admin)
        .setOracleAndPriceFeedId(bearUser1.address, SEI_PRICE_FEED_ID),
    ).to.be.reverted;
    await expect(prediction.connect(admin).setOracleUpdateAllowance("0")).to.be
      .reverted;
    await expect(prediction.connect(admin).setTreasuryFee("100")).to.be
      .reverted;
    await expect(prediction.connect(admin).unpause()).to.be.reverted;
  });

  it("Should refund rewards", async () => {
    // Epoch 1
    const price110 = 11000000000; // $110
    await updateOraclePrice(price110);
    await prediction.genesisStartRound();
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("1").toString()); // 1 SEI
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("2").toString()); // 2 SEI
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("4").toString()); // 4 SEI

    assert.equal(await prediction.refundable(1, bullUser1.address), false);
    assert.equal(await prediction.refundable(1, bullUser2.address), false);
    assert.equal(await prediction.refundable(1, bearUser1.address), false);
    assert.equal(await prediction.treasuryAmount(), 0);
    let balance = await mockERC20.balanceOf(prediction.address);
    assert.equal(balance.toString(), parseEther("7").toString());

    // Epoch 2
    await nextEpoch();
    await prediction.genesisLockRound();
    currentEpoch = await prediction.currentEpoch();

    assert.equal(await prediction.refundable(1, bullUser1.address), false);
    assert.equal(await prediction.refundable(1, bullUser2.address), false);
    assert.equal(await prediction.refundable(1, bearUser1.address), false);

    // Epoch 3 (missed)
    await nextEpoch();

    // Epoch 4
    await nextEpoch();
    await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
    await expect(prediction.executeRound()).to.be.revertedWith(
      "Can only lock round within bufferSeconds",
    );

    // Refund for Round 1

    assert.equal(await prediction.refundable(1, bullUser1.address), true);
    assert.equal(await prediction.refundable(1, bullUser2.address), true);
    assert.equal(await prediction.refundable(1, bearUser1.address), true);

    await prediction.connect(bullUser1).claim([1]); // Success

    await prediction.connect(bullUser2).claim([1]); // Success

    await prediction.connect(bearUser1).claim([1]); // Success

    await expect(prediction.connect(bullUser1).claim([1])).to.be.revertedWith(
      "Not eligible for refund",
    );
    await expect(prediction.connect(bullUser2).claim([1])).to.be.revertedWith(
      "Not eligible for refund",
    );
    await expect(prediction.connect(bearUser1).claim([1])).to.be.revertedWith(
      "Not eligible for refund",
    );

    // Treasury amount should be empty
    assert.equal(await prediction.treasuryAmount(), 0);
    balance = await mockERC20.balanceOf(prediction.address);
    assert.equal(balance.toString(), parseEther("0").toString());
  });

  it("Rejections for bet bulls/bears work as expected", async () => {
    // Epoch 0
    await expect(
      prediction.connect(bullUser1).betBull("0", parseEther("1").toString()),
    ).to.be.revertedWith("Round not bettable");
    await expect(
      prediction.connect(bullUser1).betBear("0", parseEther("1").toString()),
    ).to.be.revertedWith("Round not bettable");
    await expect(
      prediction.connect(bullUser1).betBull("1", parseEther("1").toString()),
    ).to.be.revertedWith("Bet is too early/late");
    await expect(
      prediction.connect(bullUser1).betBear("1", parseEther("1").toString()),
    ).to.be.revertedWith("Bet is too early/late");

    // Epoch 1
    const price110 = 11000000000; // $110
    await updateOraclePrice(price110);
    await prediction.genesisStartRound();
    currentEpoch = await prediction.currentEpoch();
    await expect(
      prediction.connect(bullUser1).betBull("2", parseEther("1").toString()),
    ).to.be.revertedWith("Bet is too early/late");
    await expect(
      prediction.connect(bullUser1).betBear("2", parseEther("1").toString()),
    ).to.be.revertedWith("Bet is too early/late");

    // Bets must be higher (or equal) than minBetAmount
    await expect(
      prediction
        .connect(bullUser1)
        .betBear("1", parseEther("0.999999").toString()),
    ).to.be.revertedWith("Bet amount must be greater than minBetAmount");
    await expect(
      prediction
        .connect(bullUser1)
        .betBull("1", parseEther("0.999999").toString()),
    ).to.be.revertedWith("Bet amount must be greater than minBetAmount");
  });

  it("Rejections for genesis start and lock rounds work as expected", async () => {
    await expect(prediction.executeRound()).to.be.revertedWith(
      "Can only run after genesisStartRound and genesisLockRound is triggered",
    );

    // Epoch 1
    await prediction.genesisStartRound();
    await expect(prediction.genesisStartRound()).to.be.revertedWith(
      "Can only run genesisStartRound once",
    );
    await expect(prediction.genesisLockRound()).to.be.revertedWith(
      "Can only lock round after lockTimestamp",
    );

    // // Advance to next epoch
    await nextEpoch();
    await nextEpoch();
    await updateOraclePrice(INITIAL_PRICE);

    await expect(prediction.genesisLockRound()).to.be.revertedWith(
      "Can only lock round within bufferSeconds",
    );

    await expect(prediction.executeRound()).to.be.revertedWith(
      "Can only run after genesisStartRound and genesisLockRound is triggered",
    );

    // Cannot restart genesis round
    await expect(prediction.genesisStartRound()).to.be.revertedWith(
      "Can only run genesisStartRound once",
    );

    // Admin needs to pause, then unpause
    await prediction.connect(admin).pause();
    await prediction.connect(admin).unpause();

    // Prediction restart
    await prediction.genesisStartRound();

    await nextEpoch();

    // Lock the round
    await prediction.genesisLockRound();
    await nextEpoch();
    await expect(prediction.genesisLockRound()).to.be.revertedWith(
      "Can only run genesisLockRound once",
    );

    await nextEpoch();
    await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
    await expect(prediction.executeRound()).to.be.revertedWith(
      "Can only lock round within bufferSeconds",
    );
  });

  it("Should prevent betting when paused", async () => {
    await prediction.genesisStartRound();
    await nextEpoch();
    await prediction.genesisLockRound();
    await nextEpoch();
    await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
    await prediction.executeRound();

    let tx = await prediction.connect(admin).pause();
    // expectEvent(tx, "Pause", { epoch: new BN(3) });
    await expect(
      prediction
        .connect(bullUser1)
        .betBull(currentEpoch, parseEther("1").toString()),
    ).to.be.reverted;
    await expect(
      prediction
        .connect(bearUser1)
        .betBear(currentEpoch, parseEther("1").toString()),
    ).to.be.reverted;
    await expect(prediction.connect(bullUser1).claim([1])).to.be.revertedWith(
      "Not eligible for claim",
    ); // Success
  });

  it("Should prevent round operations when paused", async () => {
    await prediction.genesisStartRound();
    await nextEpoch();
    await updateOraclePrice(INITIAL_PRICE);
    await prediction.genesisLockRound();
    await nextEpoch();
    await updateOraclePrice(INITIAL_PRICE);
    await prediction.executeRound();

    let tx = await prediction.connect(admin).pause();
    // expectEvent(tx, "Pause", { epoch: new BN(3) });
    await expect(prediction.executeRound()).to.be.reverted;
    await expect(prediction.genesisStartRound()).to.be.reverted;
    await expect(prediction.genesisLockRound()).to.be.reverted;

    // Unpause and resume
    await nextEpoch(); // Goes to next epoch block number, but doesn't increase currentEpoch
    tx = await prediction.connect(admin).unpause();
    // expectEvent(tx, "Unpause", { epoch: new BN(3) }); // Although nextEpoch is called, currentEpoch doesn't change
    await prediction.genesisStartRound(); // Success
    await nextEpoch();
    await updateOraclePrice(INITIAL_PRICE);
    await prediction.genesisLockRound(); // Success
    await nextEpoch();
    await updateOraclePrice(INITIAL_PRICE);
    await prediction.executeRound(); // Success
  });

  it("Should paginate user rounds", async () => {
    await prediction.genesisStartRound();
    let currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("1").toString());
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("1").toString());
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("1").toString());

    await nextEpoch();
    await updateOraclePrice(INITIAL_PRICE);
    await prediction.genesisLockRound();
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("1").toString());
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("1").toString());
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("1").toString());

    await nextEpoch();
    await updateOraclePrice(INITIAL_PRICE);
    await prediction.executeRound();
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("1").toString());
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("1").toString());
    await prediction
      .connect(bearUser1)
      .betBear(currentEpoch, parseEther("1").toString());

    await nextEpoch();
    await updateOraclePrice(INITIAL_PRICE);
    await prediction.executeRound();
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("1").toString());
    await prediction
      .connect(bullUser2)
      .betBull(currentEpoch, parseEther("1").toString());

    await nextEpoch();
    await updateOraclePrice(INITIAL_PRICE);
    await prediction.executeRound();
    currentEpoch = await prediction.currentEpoch();

    await prediction
      .connect(bullUser1)
      .betBull(currentEpoch, parseEther("1").toString());

    // Get by page size of 2
    const pageSize = 2;

    assertBNArray(
      (await prediction.getUserRounds(bullUser1.address, 0, 5))[0],
      [1, 2, 3, 4, 5],
    );

    let result = await prediction.getUserRounds(bullUser1.address, 0, pageSize);
    let epochData = result[0];
    let positionData = result[1];
    let cursor = result[2];

    assertBNArray(epochData, [1, 2]);

    // Convert all elements in positionData to strings before comparison
    assert.includeOrderedMembers(
      positionData[0].map((item) => item.toString()),
      ["0", "1000000000000000000", "false"],
    );
    assert.includeOrderedMembers(
      positionData[1].map((item) => item.toString()),
      ["0", "1000000000000000000", "false"],
    );
    assert.equal(cursor, 2);

    result = await prediction.getUserRounds(
      bullUser1.address,
      cursor,
      pageSize,
    );
    epochData = result[0];
    positionData = result[1];
    cursor = result[2];
    assertBNArray(epochData, [3, 4]);

    assert.includeOrderedMembers(
      positionData[0].map((item) => item.toString()),
      ["0", "1000000000000000000", "false"],
    );
    assert.includeOrderedMembers(
      positionData[1].map((item) => item.toString()),
      ["0", "1000000000000000000", "false"],
    );
    assert.equal(cursor, 4);

    result = await prediction.getUserRounds(
      bullUser1.address,
      cursor,
      pageSize,
    );
    epochData = result[0];
    positionData = result[1];
    cursor = result[2];
    assertBNArray(epochData, [5]);

    assert.includeOrderedMembers(
      positionData[0].map((item) => item.toString()),
      ["0", "1000000000000000000", "false"],
    );
    assert.equal(cursor, 5);

    result = await prediction.getUserRounds(
      bullUser1.address,
      cursor,
      pageSize,
    );
    epochData = result[0];
    positionData = result[1];
    cursor = result[2];
    assertBNArray(epochData, []);
    assert.isEmpty(positionData);
    assert.equal(cursor, 5);

    assertBNArray(
      (await prediction.getUserRounds(bullUser2.address, 0, 4))[0],
      [1, 2, 3, 4],
    );
    result = await prediction.getUserRounds(bullUser2.address, 0, pageSize);
    epochData = result[0];
    positionData = result[1];
    cursor = result[2];
    assertBNArray(epochData, [1, 2]);

    assert.includeOrderedMembers(
      positionData[0].map((item) => item.toString()),
      ["0", "1000000000000000000", "false"],
    );
    assert.includeOrderedMembers(
      positionData[1].map((item) => item.toString()),
      ["0", "1000000000000000000", "false"],
    );
    assert.equal(cursor, 2);

    result = await prediction.getUserRounds(
      bullUser2.address,
      cursor,
      pageSize,
    );
    epochData = result[0];
    positionData = result[1];
    cursor = result[2];
    assertBNArray(epochData, [3, 4]);

    assert.includeOrderedMembers(
      positionData[0].map((item) => item.toString()),
      ["0", "1000000000000000000", "false"],
    );
    assert.includeOrderedMembers(
      positionData[1].map((item) => item.toString()),
      ["0", "1000000000000000000", "false"],
    );
    assert.equal(cursor, 4);

    result = await prediction.getUserRounds(
      bullUser2.address,
      cursor,
      pageSize,
    );
    epochData = result[0];
    positionData = result[1];
    cursor = result[2];
    assertBNArray(epochData, []);
    assert.isEmpty(positionData);
    assert.equal(cursor, 4);

    assertBNArray(
      (await prediction.getUserRounds(bearUser1.address, 0, 3))[0],
      [1, 2, 3],
    );
    result = await prediction.getUserRounds(bearUser1.address, 0, pageSize);
    epochData = result[0];
    positionData = result[1];
    cursor = result[2];
    assertBNArray(epochData, [1, 2]);

    assert.includeOrderedMembers(
      positionData[0].map((item) => item.toString()),
      ["1", "1000000000000000000", "false"],
    );
    assert.includeOrderedMembers(
      positionData[1].map((item) => item.toString()),
      ["1", "1000000000000000000", "false"],
    );
    assert.equal(cursor, 2);

    result = await prediction.getUserRounds(
      bearUser1.address,
      cursor,
      pageSize,
    );
    epochData = result[0];
    positionData = result[1];
    cursor = result[2];
    assertBNArray(epochData, [3]);

    assert.includeOrderedMembers(
      positionData[0].map((item) => item.toString()),
      ["1", "1000000000000000000", "false"],
    );
    assert.equal(cursor, 3);

    result = await prediction.getUserRounds(
      bearUser1.address,
      cursor,
      pageSize,
    );
    epochData = result[0];
    positionData = result[1];
    cursor = result[2];
    assertBNArray(epochData, []);
    assert.isEmpty(positionData);
    assert.equal(cursor, 3);
  });
});
