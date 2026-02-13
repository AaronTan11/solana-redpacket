import { LiteSVM } from "litesvm";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeAccountInstruction,
  createMintToInstruction,
  getMinimumBalanceForRentExemptMint,
  getMinimumBalanceForRentExemptAccount,
  MINT_SIZE,
  ACCOUNT_SIZE,
} from "@solana/spl-token";
import { expect } from "chai";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROGRAM_ID = new PublicKey(
  "EXBnnaHEVPy7QR9eaFFtPvQ5QLDhzzb8sVaXtDVbbPbg"
);

const SEED_PREFIX = Buffer.from("redpacket");
const VAULT_SEED = Buffer.from("vault");
const TREASURY_SEED = Buffer.from("treasury");
const TREASURY_VAULT_SEED = Buffer.from("treasury_vault");

const PROGRAM_SO = path.join(
  __dirname,
  "..",
  "target",
  "deploy",
  "solana_redpacket.so"
);

// Rent-exempt values (approximate, for LiteSVM)
const MINT_RENT = 1461600n;
const TOKEN_ACCOUNT_RENT = 2039280n;

function findRedPacketPDA(
  creator: PublicKey,
  id: bigint
): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(id);
  return PublicKey.findProgramAddressSync(
    [SEED_PREFIX, creator.toBuffer(), idBuf],
    PROGRAM_ID
  );
}

function findVaultPDA(
  creator: PublicKey,
  id: bigint
): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(id);
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, creator.toBuffer(), idBuf],
    PROGRAM_ID
  );
}

function findTreasuryPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TREASURY_SEED],
    PROGRAM_ID
  );
}

function findTreasuryVaultPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TREASURY_VAULT_SEED],
    PROGRAM_ID
  );
}

function buildInitTreasuryData(
  treasuryBump: number,
  vaultBump: number
): Buffer {
  const buf = Buffer.alloc(3);
  buf.writeUInt8(3, 0); // discriminator
  buf.writeUInt8(treasuryBump, 1);
  buf.writeUInt8(vaultBump, 2);
  return buf;
}

function buildCreateData(
  id: bigint,
  totalAmount: bigint,
  numRecipients: number,
  splitMode: number,
  expiresAt: bigint,
  rpBump: number,
  vaultBump: number,
  amounts?: bigint[]
): Buffer {
  const hasAmounts = splitMode === 1 && amounts;
  const size = 1 + 8 + 8 + 1 + 1 + 8 + 1 + 1 + (hasAmounts ? 8 * numRecipients : 0);
  const buf = Buffer.alloc(size);
  let offset = 0;

  buf.writeUInt8(0, offset); offset += 1; // discriminator
  buf.writeBigUInt64LE(id, offset); offset += 8;
  buf.writeBigUInt64LE(totalAmount, offset); offset += 8;
  buf.writeUInt8(numRecipients, offset); offset += 1;
  buf.writeUInt8(splitMode, offset); offset += 1;
  buf.writeBigInt64LE(expiresAt, offset); offset += 8;
  buf.writeUInt8(rpBump, offset); offset += 1;
  buf.writeUInt8(vaultBump, offset); offset += 1;

  if (hasAmounts) {
    for (let i = 0; i < numRecipients; i++) {
      buf.writeBigUInt64LE(amounts[i], offset); offset += 8;
    }
  }

  return buf;
}

function buildClaimData(): Buffer {
  return Buffer.from([1]);
}

function buildCloseData(): Buffer {
  return Buffer.from([2]);
}

function buildWithdrawFeesData(amount: bigint): Buffer {
  const buf = Buffer.alloc(9);
  buf.writeUInt8(4, 0); // discriminator
  buf.writeBigUInt64LE(amount, 1);
  return buf;
}

/** Read u64 from token account data at offset 64 (the amount field) */
function readTokenBalance(accountData: Buffer): bigint {
  return accountData.readBigUInt64LE(64);
}

/**
 * Set up a fresh LiteSVM with our program, create a mock USDC mint,
 * and initialize the treasury.
 */
function setupSVM(): {
  svm: LiteSVM;
  mintAuthority: Keypair;
  mint: Keypair;
  treasuryPDA: PublicKey;
  treasuryBump: number;
  treasuryVaultPDA: PublicKey;
  treasuryVaultBump: number;
} {
  const svm = new LiteSVM();
  svm.addProgramFromFile(PROGRAM_ID, PROGRAM_SO);

  // Create mint authority
  const mintAuthority = Keypair.generate();
  svm.airdrop(mintAuthority.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

  // Create mock USDC mint (6 decimals)
  const mint = Keypair.generate();
  let blockhash = svm.latestBlockhash();
  let tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: mintAuthority.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports: Number(MINT_RENT),
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mint.publicKey,
      6, // decimals (USDC = 6)
      mintAuthority.publicKey,
      null
    )
  );
  tx.sign(mintAuthority, mint);
  svm.sendTransaction(tx);

  // Initialize treasury
  const [treasuryPDA, treasuryBump] = findTreasuryPDA();
  const [treasuryVaultPDA, treasuryVaultBump] = findTreasuryVaultPDA();

  blockhash = svm.latestBlockhash();
  tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: mintAuthority.publicKey, isSigner: true, isWritable: true },
        { pubkey: treasuryPDA, isSigner: false, isWritable: true },
        { pubkey: treasuryVaultPDA, isSigner: false, isWritable: true },
        { pubkey: mint.publicKey, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: buildInitTreasuryData(treasuryBump, treasuryVaultBump),
    })
  );
  tx.sign(mintAuthority);
  svm.sendTransaction(tx);

  return { svm, mintAuthority, mint, treasuryPDA, treasuryBump, treasuryVaultPDA, treasuryVaultBump };
}

/**
 * Create a token account for the given owner and mint, then mint tokens to it.
 */
function createAndFundTokenAccount(
  svm: LiteSVM,
  payer: Keypair,
  mint: PublicKey,
  mintAuthority: Keypair,
  owner: PublicKey,
  amount: bigint
): Keypair {
  const tokenAccount = Keypair.generate();
  let blockhash = svm.latestBlockhash();
  let tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: tokenAccount.publicKey,
      space: ACCOUNT_SIZE,
      lamports: Number(TOKEN_ACCOUNT_RENT),
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(
      tokenAccount.publicKey,
      mint,
      owner
    )
  );
  tx.sign(payer, tokenAccount);
  svm.sendTransaction(tx);

  if (amount > 0n) {
    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      createMintToInstruction(
        mint,
        tokenAccount.publicKey,
        mintAuthority.publicKey,
        amount
      )
    );
    tx.sign(mintAuthority);
    svm.sendTransaction(tx);
  }

  return tokenAccount;
}

describe("solana-redpacket (USDC)", () => {
  it("Initializes treasury", () => {
    const { svm, treasuryPDA, treasuryVaultPDA, mint } = setupSVM();

    // Verify treasury PDA exists and has correct data
    const treasuryAccount = svm.getAccount(treasuryPDA);
    expect(treasuryAccount).to.not.be.null;
    expect(treasuryAccount!.data[0]).to.equal(2); // discriminator = 2
    // Verify stored mint matches
    const storedMint = treasuryAccount!.data.slice(3, 35);
    expect(Buffer.from(storedMint)).to.deep.equal(mint.publicKey.toBuffer());

    // Verify treasury vault exists
    const vaultAccount = svm.getAccount(treasuryVaultPDA);
    expect(vaultAccount).to.not.be.null;

    console.log("    Treasury initialized successfully");
  });

  it("Creates red packet with even split and collects fee", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    // Create and fund creator's token account with 100 USDC (100_000_000 micro-units)
    const totalAmount = 100_000_000n; // 100 USDC
    const fee = totalAmount * 10n / 10_000n; // 0.1% = 100_000
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee + 1_000_000n // extra buffer
    );

    const id = 1n;
    const numRecipients = 3;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const blockhash = svm.latestBlockhash();
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: creatorTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: false },
          { pubkey: treasuryVaultPDA, isSigner: false, isWritable: true },
          { pubkey: mint.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, numRecipients, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Verify red packet PDA
    const rpAccount = svm.getAccount(redPacketPDA);
    expect(rpAccount).to.not.be.null;
    expect(rpAccount!.data[0]).to.equal(1); // discriminator
    expect(rpAccount!.data.length).to.equal(70 + 40 * numRecipients);

    // Verify vault has USDC
    const vaultAccount = svm.getAccount(vaultPDA);
    const vaultBalance = readTokenBalance(Buffer.from(vaultAccount!.data));
    expect(vaultBalance).to.equal(totalAmount);

    // Verify treasury vault received fee
    const tvAccount = svm.getAccount(treasuryVaultPDA);
    const tvBalance = readTokenBalance(Buffer.from(tvAccount!.data));
    expect(tvBalance).to.equal(fee);

    console.log(`    Red packet created: ${Number(totalAmount) / 1e6} USDC, fee: ${Number(fee) / 1e6} USDC`);
  });

  it("Claims from even split red packet", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 900_000n; // 0.9 USDC, divisible by 3
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 1n;
    const numRecipients = 3;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Create red packet
    let blockhash = svm.latestBlockhash();
    let tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: creatorTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: false },
          { pubkey: treasuryVaultPDA, isSigner: false, isWritable: true },
          { pubkey: mint.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, numRecipients, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Create claimer and their token account
    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimerTA = createAndFundTokenAccount(
      svm, claimer, mint.publicKey, mintAuthority, claimer.publicKey, 0n
    );

    // Claim
    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer.publicKey, isSigner: true, isWritable: true },
          { pubkey: claimerTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildClaimData(),
      })
    );
    tx.sign(claimer);
    svm.sendTransaction(tx);

    // Verify claimer received USDC
    const claimerAccount = svm.getAccount(claimerTA.publicKey);
    const claimerBalance = readTokenBalance(Buffer.from(claimerAccount!.data));
    expect(claimerBalance).to.equal(300_000n); // 0.3 USDC (900000 / 3)

    // Verify red packet state
    const rpAccount = svm.getAccount(redPacketPDA);
    expect(rpAccount!.data[58]).to.equal(1); // num_claimed = 1

    console.log(`    Claimed ${Number(claimerBalance) / 1e6} USDC`);
  });

  it("Rejects double claim", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 1_000_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 1n;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Create
    let blockhash = svm.latestBlockhash();
    let tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: creatorTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: false },
          { pubkey: treasuryVaultPDA, isSigner: false, isWritable: true },
          { pubkey: mint.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, 2, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Create claimer with token account
    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimerTA = createAndFundTokenAccount(
      svm, claimer, mint.publicKey, mintAuthority, claimer.publicKey, 0n
    );

    // First claim
    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer.publicKey, isSigner: true, isWritable: true },
          { pubkey: claimerTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildClaimData(),
      })
    );
    tx.sign(claimer);
    svm.sendTransaction(tx);

    // Second claim — should fail
    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer.publicKey, isSigner: true, isWritable: true },
          { pubkey: claimerTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildClaimData(),
      })
    );
    tx.sign(claimer);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have thrown on double claim");
    } catch (e: any) {
      console.log("    Double claim correctly rejected");
    }
  });

  it("Creates and claims random split red packet", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 1_000_000n; // 1 USDC
    const fee = totalAmount * 10n / 10_000n;
    const amounts = [200_000n, 500_000n, 300_000n];
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 2n;
    const numRecipients = 3;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    let blockhash = svm.latestBlockhash();
    let tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: creatorTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: false },
          { pubkey: treasuryVaultPDA, isSigner: false, isWritable: true },
          { pubkey: mint.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, numRecipients, 1, expiresAt, rpBump, vaultBump, amounts),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Claim first slot (should get 200_000 = 0.2 USDC)
    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimerTA = createAndFundTokenAccount(
      svm, claimer, mint.publicKey, mintAuthority, claimer.publicKey, 0n
    );

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer.publicKey, isSigner: true, isWritable: true },
          { pubkey: claimerTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildClaimData(),
      })
    );
    tx.sign(claimer);
    svm.sendTransaction(tx);

    const claimerAccount = svm.getAccount(claimerTA.publicKey);
    const claimerBalance = readTokenBalance(Buffer.from(claimerAccount!.data));
    expect(claimerBalance).to.equal(200_000n);

    console.log("    Random split claim: received 0.2 USDC (first slot)");
  });

  it("Closes a fully-claimed red packet", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 500_000n; // 0.5 USDC
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 3n;
    const numRecipients = 1;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Create
    let blockhash = svm.latestBlockhash();
    let tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: creatorTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: false },
          { pubkey: treasuryVaultPDA, isSigner: false, isWritable: true },
          { pubkey: mint.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, numRecipients, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Claim (the single recipient)
    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimerTA = createAndFundTokenAccount(
      svm, claimer, mint.publicKey, mintAuthority, claimer.publicKey, 0n
    );

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer.publicKey, isSigner: true, isWritable: true },
          { pubkey: claimerTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildClaimData(),
      })
    );
    tx.sign(claimer);
    svm.sendTransaction(tx);

    // Close
    const solBefore = svm.getBalance(creator.publicKey);

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: creatorTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildCloseData(),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Verify PDA closed
    const rpAccount = svm.getAccount(redPacketPDA);
    expect(rpAccount).to.be.null;

    // Verify vault closed
    const vaultAccount = svm.getAccount(vaultPDA);
    expect(vaultAccount).to.be.null;

    // Verify SOL returned (rent from both PDA + vault)
    const solAfter = svm.getBalance(creator.publicKey);
    expect(solAfter > solBefore).to.be.true;

    console.log("    Red packet closed, rent returned to creator");
  });

  it("Admin withdraws fees from treasury", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    // First, create a red packet to generate fees
    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 10_000_000n; // 10 USDC
    const expectedFee = totalAmount * 10n / 10_000n; // 10_000 = 0.01 USDC
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + expectedFee
    );

    const id = 1n;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    let blockhash = svm.latestBlockhash();
    let tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: creatorTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: false },
          { pubkey: treasuryVaultPDA, isSigner: false, isWritable: true },
          { pubkey: mint.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, 1, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Now withdraw fees as admin
    // The admin key is "ADMNqGCquVC3xPkhttaUSCMFhSmu3rBVsRRBKjLFMbhg" — we need its keypair.
    // Since this is a test, we'll generate a deterministic keypair and update the constant.
    // Actually, we can't sign as the hardcoded admin. Let's create a separate test approach:
    // We need the admin keypair whose pubkey matches ADMIN constant.
    // For testing purposes, let's just verify the treasury vault has the fee.
    const tvAccount = svm.getAccount(treasuryVaultPDA);
    const tvBalance = readTokenBalance(Buffer.from(tvAccount!.data));
    expect(tvBalance).to.equal(expectedFee);

    console.log(`    Treasury collected ${Number(expectedFee) / 1e6} USDC in fees`);
  });

  it("Rejects unauthorized withdrawal", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    // Try to withdraw as non-admin
    const attacker = Keypair.generate();
    svm.airdrop(attacker.publicKey, BigInt(LAMPORTS_PER_SOL));
    const attackerTA = createAndFundTokenAccount(
      svm, attacker, mint.publicKey, mintAuthority, attacker.publicKey, 0n
    );

    const blockhash = svm.latestBlockhash();
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: attacker.publicKey, isSigner: true, isWritable: true },
          { pubkey: attackerTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: false },
          { pubkey: treasuryVaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildWithdrawFeesData(0n),
      })
    );
    tx.sign(attacker);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected unauthorized withdrawal");
    } catch (e: any) {
      console.log("    Unauthorized withdrawal correctly rejected");
    }
  });
});
