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
const INTERVAL_SECONDS = 20 * BLOCK_COUNT_MULTPLIER; // 20 seconds * multiplier
const MIN_BET_AMOUNT = parseEther("1"); // 1 ERC20
const INITIAL_TREASURY_RATE = 0.1; // 10%

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

describe("PredictionsV5", () => {
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
  let currentRound: any;
  let oracle;
  let prediction: any;
  let mockERC20: any;

  async function nextEpoch() {
    await time.increaseTo((await time.latest()).toNumber() + INTERVAL_SECONDS); // Elapse 20 seconds
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

    const predictionsContractFactory =
      await ethers.getContractFactory("PredictionsFactory");
    const predictionsFactory = await predictionsContractFactory.deploy(
      owner.address,
    );
    await predictionsFactory.deployed();

    const predictionV5ImplmentationFactory =
      await ethers.getContractFactory("PredictionV5");
    const predictionsV5Implementation =
      await predictionV5ImplmentationFactory.deploy();
    await predictionsV5Implementation.deployed();

    await predictionsFactory
      .connect(owner)
      .setImplementationPredictionV5(predictionsV5Implementation.address);

    const predictionV5CreationTx = await predictionsFactory
      .connect(owner)
      .deployPredictionV5(
        mockERC20.address,
        admin.address,
        operator.address,
        MIN_BET_AMOUNT.toString(),
        INITIAL_TREASURY_RATE * 10000,
      );

    const predictionV5TxReceipt = await predictionV5CreationTx.wait();

    prediction = await ethers.getContractAt(
      "PredictionV5",
      predictionV5TxReceipt.logs[0].address,
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
    assert.equal(await prediction.currentRound(), 0);
    assert.equal(await prediction.adminAddress(), admin.address);
    assert.equal(await prediction.minBetAmount(), MIN_BET_AMOUNT.toString());
    assert.equal(await prediction.treasuryAmount(), 0);
  });

  it("Should start round and close round)", async () => {
    // Manual block calculation
    let currentTimestamp = await getCurrentTimestamp();

    assert.equal(await prediction.currentRound(), 0);

    // Start round
    await expect(await prediction.startNewRound(currentTimestamp + 10))
      .to.emit(prediction, "StartRound")
      .withArgs(1);
    assert.equal(await prediction.currentRound(), 1);
    assert.equal(
      (await prediction.rounds(1)).startTimestamp,
      currentTimestamp + 10,
    );

    // Elapse 20 blocks
    currentTimestamp += INTERVAL_SECONDS;
    await time.increaseTo(currentTimestamp);

    // Get the current round number
    const currentRound = await prediction.currentRound();

    // Decide on the outcome (Up or Down)
    const outcome = 0; // 0 for Up, 1 for Down

    // Close round
    expect(await prediction.closeRound(currentRound, outcome))
      .to.emit(prediction, "EndRound")
      .withArgs(currentRound, outcome);
    assert.equal(
      (await prediction.rounds(currentRound)).closeTimestamp,
      currentTimestamp + 1,
    );
    assert.equal((await prediction.rounds(currentRound)).totalAmount, 0);
  });

  it("Should record data and user bets", async () => {
    // Manual block calculation
    let currentTimestamp = await getCurrentTimestamp();

    // Start round
    await prediction.startNewRound(currentTimestamp + 10);
    currentRound = await prediction.currentRound();

    // Elapse 20 blocks
    currentTimestamp += INTERVAL_SECONDS;
    await time.increaseTo(currentTimestamp);

    await prediction
      .connect(bullUser1)
      .betBull(currentRound, parseEther("1.1").toString()); // 1.1 ERC20
    await prediction
      .connect(bullUser2)
      .betBull(currentRound, parseEther("1.2").toString()); // 1.2 ERC20
    await prediction
      .connect(bearUser1)
      .betBear(currentRound, parseEther("1.4").toString()); // 1.4 ERC20

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
  });

  it("Should not allow multiple bets", async () => {
    // Manual block calculation
    let currentTimestamp = await getCurrentTimestamp();

    // Start round
    await prediction.startNewRound(currentTimestamp + 10);
    currentRound = await prediction.currentRound();

    // Elapse 20 blocks
    currentTimestamp += INTERVAL_SECONDS;
    await time.increaseTo(currentTimestamp);

    await prediction
      .connect(bullUser1)
      .betBull(currentRound, parseEther("1").toString()); // Success
    await expect(
      prediction
        .connect(bullUser1)
        .betBull(currentRound, parseEther("1").toString()),
    ).to.be.revertedWith("Can only bet once per round");
    await expect(
      prediction
        .connect(bullUser1)
        .betBear(currentRound, parseEther("1").toString()),
    ).to.be.revertedWith("Can only bet once per round");
    await prediction
      .connect(bearUser1)
      .betBear(currentRound, parseEther("1").toString()); // Success
    await expect(
      prediction
        .connect(bearUser1)
        .betBull(currentRound, parseEther("1").toString()),
    ).to.be.revertedWith("Can only bet once per round");
    await expect(
      prediction
        .connect(bearUser1)
        .betBear(currentRound, parseEther("1").toString()),
    ).to.be.revertedWith("Can only bet once per round");
  });

  it("Should not allow bets lesser than minimum bet amount", async () => {
    // Manual block calculation
    let currentTimestamp = await getCurrentTimestamp();

    // Start round
    await prediction.startNewRound(currentTimestamp + 10);
    currentRound = await prediction.currentRound();

    // Elapse 20 blocks
    currentTimestamp += INTERVAL_SECONDS;
    await time.increaseTo(currentTimestamp);

    await expect(
      prediction
        .connect(bullUser1)
        .betBull(currentRound, parseEther("0.5").toString()),
    ).to.be.revertedWith("Bet amount must be greater than minBetAmount"); // 0.5 ERC20
    await prediction
      .connect(bullUser1)
      .betBull(currentRound, parseEther("1").toString()); // Success
  });

  it("Should record rewards", async () => {
    // Manual block calculation
    let currentTimestamp = await getCurrentTimestamp();

    // Start round
    await prediction.startNewRound(currentTimestamp + 10);
    currentRound = await prediction.currentRound();

    // Elapse 20 blocks
    currentTimestamp += INTERVAL_SECONDS;
    await time.increaseTo(currentTimestamp);

    await prediction
      .connect(bullUser1)
      .betBull(currentRound, parseEther("1.1").toString()); // 1.1 ERC20
    await prediction
      .connect(bullUser2)
      .betBull(currentRound, parseEther("1.2").toString()); // 1.2 ERC20
    await prediction
      .connect(bearUser1)
      .betBear(currentRound, parseEther("1.4").toString()); // 1.4 ERC20

    assert.equal((await prediction.rounds(1)).rewardBaseCalAmount, 0);
    assert.equal((await prediction.rounds(1)).rewardAmount, 0);
    assert.equal(await prediction.treasuryAmount(), 0);
    let balance = await mockERC20.balanceOf(prediction.address);
    assert.equal(balance.toString(), parseEther("3.7").toString());
  });

  it("Should fail to claim rewards due to round not ended", async () => {
    // Manual block calculation
    let currentTimestamp = await getCurrentTimestamp();

    // Start round
    await prediction.startNewRound(currentTimestamp + 10);
    currentRound = await prediction.currentRound();

    // Elapse 20 blocks
    currentTimestamp += INTERVAL_SECONDS;
    await time.increaseTo(currentTimestamp);

    await prediction
      .connect(bullUser1)
      .betBull(currentRound, parseEther("1").toString()); // 1 ERC20
    await prediction
      .connect(bullUser2)
      .betBull(currentRound, parseEther("2").toString()); // 2 ERC20
    await prediction
      .connect(bearUser1)
      .betBear(currentRound, parseEther("4").toString()); // 4 ERC20

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
  });

  it("Should claim rewards", async () => {
    // Manual block calculation
    let currentTimestamp = await getCurrentTimestamp();

    // Start round
    await prediction.startNewRound(currentTimestamp + 10);
    currentRound = await prediction.currentRound();

    // Elapse 20 blocks
    currentTimestamp += INTERVAL_SECONDS;
    await time.increaseTo(currentTimestamp);

    await prediction
      .connect(bullUser1)
      .betBull(currentRound, parseEther("1").toString()); // 1 ERC20
    await prediction
      .connect(bullUser2)
      .betBull(currentRound, parseEther("2").toString()); // 2 ERC20
    await prediction
      .connect(bearUser1)
      .betBear(currentRound, parseEther("4").toString()); // 4 ERC20

    await prediction.closeRound(currentRound, 0);

    // Claim: Total rewards = 3.7, Bull = 2.3, Bear = 1.4
    await expect(await prediction.connect(bullUser1).claim([1]))
      .to.emit(prediction, "Claim")
      .withArgs(bullUser1.address, 1, parseEther("2.1").toString()); // Success

    await expect(await prediction.connect(bullUser2).claim([1]))
      .to.emit(prediction, "Claim")
      .withArgs(bullUser2.address, 1, parseEther("4.2").toString()); // Success

    await expect(prediction.connect(bearUser1).claim([1])).to.be.revertedWith(
      "Not eligible for claim",
    );
  });

  it("Should claim treasury rewards", async () => {
    // Manual block calculation
    let currentTimestamp = await getCurrentTimestamp();

    // Start round
    await prediction.startNewRound(currentTimestamp + 10);
    currentRound = await prediction.currentRound();

    // Elapse 20 blocks
    currentTimestamp += INTERVAL_SECONDS;
    await time.increaseTo(currentTimestamp);

    await prediction
      .connect(bullUser1)
      .betBull(currentRound, parseEther("1").toString()); // 1 ERC20
    await prediction
      .connect(bullUser2)
      .betBull(currentRound, parseEther("2").toString()); // 2 ERC20
    await prediction
      .connect(bearUser1)
      .betBear(currentRound, parseEther("4").toString()); // 4 ERC20

    await prediction.closeRound(currentRound, 0);

    let treasuryAmount = await prediction.treasuryAmount();
    assert.equal(treasuryAmount.toString(), parseEther("0.7").toString());
    await prediction.connect(admin).claimTreasury(); // Success
  });

  it("Admin/Owner function work as expected", async () => {
    await prediction.connect(admin).pause();
    await prediction.connect(admin).setMinBetAmount("50");

    await expect(
      prediction.connect(admin).setMinBetAmount("0"),
    ).to.be.revertedWith("Must be superior to 0");

    await prediction.connect(admin).setOperator(admin.address);

    await expect(
      prediction.connect(admin).setOperator(ZERO_ADDRESS),
    ).to.be.revertedWith("Cannot be zero address");

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
    // Manual block calculation
    let currentTimestamp = await getCurrentTimestamp();

    await expect(
      prediction.connect(admin).startNewRound(currentTimestamp + 10),
    ).to.be.revertedWith("Not operator");

    // Elapse 20 blocks
    currentTimestamp += INTERVAL_SECONDS;
    await time.increaseTo(currentTimestamp);

    currentRound = await prediction.currentRound();

    await expect(
      prediction.connect(admin).closeRound(currentRound, 0),
    ).to.be.revertedWith("Not operator");
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
      prediction.connect(bullUser1).setMinBetAmount("0"),
    ).to.be.revertedWith("Not admin");
    await expect(
      prediction.connect(bullUser1).setOperator(bearUser1.address),
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
    await expect(prediction.connect(admin).setMinBetAmount("0")).to.be.reverted;
    await expect(prediction.connect(admin).setTreasuryFee("100")).to.be
      .reverted;
    await expect(prediction.connect(admin).unpause()).to.be.reverted;
  });

  it("Rejections for bet bulls/bears work as expected", async () => {
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

    // Manual block calculation
    let currentTimestamp = await getCurrentTimestamp();

    // Start round
    await prediction.startNewRound(currentTimestamp + 10);
    currentRound = await prediction.currentRound();

    // Elapse 20 blocks
    currentTimestamp += INTERVAL_SECONDS;
    await time.increaseTo(currentTimestamp);

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

  it("Should prevent betting when paused", async () => {
    // Manual block calculation
    let currentTimestamp = await getCurrentTimestamp();

    // Start round
    await prediction.startNewRound(currentTimestamp + 10);
    currentRound = await prediction.currentRound();

    // Elapse 20 blocks
    currentTimestamp += INTERVAL_SECONDS;
    await time.increaseTo(currentTimestamp);

    let tx = await prediction.connect(admin).pause();
    // expectEvent(tx, "Pause", { epoch: new BN(3) });
    await expect(
      prediction
        .connect(bullUser1)
        .betBull(currentRound, parseEther("1").toString()),
    ).to.be.reverted;
    await expect(
      prediction
        .connect(bearUser1)
        .betBear(currentRound, parseEther("1").toString()),
    ).to.be.reverted;
  });

  it("Should prevent round operations when paused", async () => {
    // Manual block calculation
    let currentTimestamp = await getCurrentTimestamp();

    // Start round
    await prediction.startNewRound(currentTimestamp + 10);
    currentRound = await prediction.currentRound();

    // Elapse 20 blocks
    currentTimestamp += INTERVAL_SECONDS;
    await time.increaseTo(currentTimestamp);

    let tx = await prediction.connect(admin).pause();
    // expectEvent(tx, "Pause", { epoch: new BN(3) });
    await expect(prediction.closeRound(currentRound, 0)).to.be.reverted;
  });

  it("Should paginate user rounds", async () => {
    // Manual block calculation
    let currentTimestamp = await getCurrentTimestamp();

    // Start round
    await prediction.startNewRound(currentTimestamp + 10);
    let currentRound = await prediction.currentRound();

    // Elapse 20 blocks
    currentTimestamp += INTERVAL_SECONDS;
    await time.increaseTo(currentTimestamp);

    await prediction
      .connect(bullUser1)
      .betBull(currentRound, parseEther("1").toString());
    await prediction
      .connect(bullUser2)
      .betBull(currentRound, parseEther("1").toString());
    await prediction
      .connect(bearUser1)
      .betBear(currentRound, parseEther("1").toString());

    // Get by page size of 1
    const pageSize = 1;

    assertBNArray(
      (await prediction.getUserRounds(bullUser1.address, 0, 1))[0],
      [1],
    );

    let result = await prediction.getUserRounds(bullUser1.address, 0, pageSize);
    let epochData = result[0];
    let positionData = result[1];
    let cursor = result[2];

    assertBNArray(epochData, [1]);

    // Convert all elements in positionData to strings before comparison
    assert.includeOrderedMembers(
      positionData[0].map((item) => item.toString()),
      ["0", "1000000000000000000", "false"],
    );

    assert.equal(cursor, 1);
  });
});
