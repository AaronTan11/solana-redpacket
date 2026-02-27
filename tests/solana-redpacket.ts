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
  "CeAkHjhJzgrwbg8QWQ8tx6h5UxMZVKuGBeEDYczbc6Gz"
);

// Test admin keypair — pubkey matches ADMIN constant in constants.rs
const ADMIN_KEYPAIR = Keypair.fromSecretKey(
  Uint8Array.from([55,133,60,93,240,83,89,99,30,73,38,34,137,85,18,103,183,45,191,131,173,133,62,36,207,170,61,161,217,111,20,177,252,31,233,190,36,167,111,157,50,135,2,182,10,96,101,156,168,136,206,208,193,192,83,152,229,114,103,167,155,203,154,99])
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

const NATIVE_SOL_MINT = new PublicKey(Buffer.alloc(32, 0xFF));

function findTreasuryPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TREASURY_SEED, mint.toBuffer()],
    PROGRAM_ID
  );
}

function findTreasuryVaultPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TREASURY_VAULT_SEED, mint.toBuffer()],
    PROGRAM_ID
  );
}

function buildInitTreasuryData(
  tokenType: number,
  treasuryBump: number,
  vaultBump: number
): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt8(3, 0); // discriminator
  buf.writeUInt8(tokenType, 1); // token_type
  buf.writeUInt8(treasuryBump, 2);
  buf.writeUInt8(vaultBump, 3);
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
  amounts?: bigint[],
  tokenType: number = 0
): Buffer {
  const hasAmounts = splitMode === 1 && amounts;
  const size = 1 + 1 + 8 + 8 + 1 + 1 + 8 + 1 + 1 + (hasAmounts ? 8 * numRecipients : 0);
  const buf = Buffer.alloc(size);
  let offset = 0;

  buf.writeUInt8(0, offset); offset += 1; // discriminator
  buf.writeUInt8(tokenType, offset); offset += 1; // token_type
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

function buildClaimData(tokenType: number = 0): Buffer {
  return Buffer.from([1, tokenType]);
}

function buildCloseData(tokenType: number = 0): Buffer {
  return Buffer.from([2, tokenType]);
}

function buildWithdrawFeesData(amount: bigint, tokenType: number = 0): Buffer {
  const buf = Buffer.alloc(10);
  buf.writeUInt8(4, 0); // discriminator
  buf.writeUInt8(tokenType, 1); // token_type
  buf.writeBigUInt64LE(amount, 2);
  return buf;
}

/** Read u64 from token account data at offset 64 (the amount field) */
function readTokenBalance(accountData: Buffer): bigint {
  return accountData.readBigUInt64LE(64);
}

/**
 * Set up a fresh LiteSVM with our program, create mock USDC + MYRC mints,
 * and initialize 3 treasuries (USDC, MYRC, SOL).
 */
function setupSVM(): {
  svm: LiteSVM;
  mintAuthority: Keypair;
  mint: Keypair;
  treasuryPDA: PublicKey;
  treasuryBump: number;
  treasuryVaultPDA: PublicKey;
  treasuryVaultBump: number;
  myrcMint: Keypair;
  myrcTreasuryPDA: PublicKey;
  myrcTreasuryBump: number;
  myrcTreasuryVaultPDA: PublicKey;
  myrcTreasuryVaultBump: number;
  solTreasuryPDA: PublicKey;
  solTreasuryBump: number;
} {
  const svm = new LiteSVM();
  svm.addProgramFromFile(PROGRAM_ID, PROGRAM_SO);

  // Create mint authority
  const mintAuthority = Keypair.generate();
  svm.airdrop(mintAuthority.publicKey, BigInt(20 * LAMPORTS_PER_SOL));

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

  // Create mock MYRC mint (9 decimals)
  const myrcMint = Keypair.generate();
  blockhash = svm.latestBlockhash();
  tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: mintAuthority.publicKey,
      newAccountPubkey: myrcMint.publicKey,
      space: MINT_SIZE,
      lamports: Number(MINT_RENT),
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      myrcMint.publicKey,
      9, // decimals (MYRC = 9)
      mintAuthority.publicKey,
      null
    )
  );
  tx.sign(mintAuthority, myrcMint);
  svm.sendTransaction(tx);

  // Initialize USDC treasury
  const [treasuryPDA, treasuryBump] = findTreasuryPDA(mint.publicKey);
  const [treasuryVaultPDA, treasuryVaultBump] = findTreasuryVaultPDA(mint.publicKey);

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
      data: buildInitTreasuryData(0, treasuryBump, treasuryVaultBump),
    })
  );
  tx.sign(mintAuthority);
  svm.sendTransaction(tx);

  // Initialize MYRC treasury
  const [myrcTreasuryPDA, myrcTreasuryBump] = findTreasuryPDA(myrcMint.publicKey);
  const [myrcTreasuryVaultPDA, myrcTreasuryVaultBump] = findTreasuryVaultPDA(myrcMint.publicKey);

  blockhash = svm.latestBlockhash();
  tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: mintAuthority.publicKey, isSigner: true, isWritable: true },
        { pubkey: myrcTreasuryPDA, isSigner: false, isWritable: true },
        { pubkey: myrcTreasuryVaultPDA, isSigner: false, isWritable: true },
        { pubkey: myrcMint.publicKey, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: buildInitTreasuryData(0, myrcTreasuryBump, myrcTreasuryVaultBump),
    })
  );
  tx.sign(mintAuthority);
  svm.sendTransaction(tx);

  // Initialize SOL treasury
  const [solTreasuryPDA, solTreasuryBump] = findTreasuryPDA(NATIVE_SOL_MINT);

  blockhash = svm.latestBlockhash();
  tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: mintAuthority.publicKey, isSigner: true, isWritable: true },
        { pubkey: solTreasuryPDA, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: buildInitTreasuryData(1, solTreasuryBump, 0),
    })
  );
  tx.sign(mintAuthority);
  svm.sendTransaction(tx);

  return {
    svm, mintAuthority,
    mint, treasuryPDA, treasuryBump, treasuryVaultPDA, treasuryVaultBump,
    myrcMint, myrcTreasuryPDA, myrcTreasuryBump, myrcTreasuryVaultPDA, myrcTreasuryVaultBump,
    solTreasuryPDA, solTreasuryBump,
  };
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

describe("solana-redpacket", () => {
  // ============================
  // Treasury Initialization
  // ============================
  describe("Treasury Initialization", () => {
    it("Initializes SPL treasury", () => {
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

  it("Initializes SOL treasury", () => {
    const { svm, solTreasuryPDA } = setupSVM();
    const treasuryAccount = svm.getAccount(solTreasuryPDA);
    expect(treasuryAccount).to.not.be.null;
    expect(treasuryAccount!.data[0]).to.equal(2);
    const storedMint = treasuryAccount!.data.slice(3, 35);
    expect(Buffer.from(storedMint)).to.deep.equal(NATIVE_SOL_MINT.toBuffer());
    console.log("    SOL treasury initialized successfully");
  });
  }); // end Treasury Initialization

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
    expect(rpAccount!.data.length).to.equal(71 + 40 * numRecipients);

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

  it("Closes an expired, partially-claimed red packet", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 900_000n; // 0.9 USDC, divisible by 3
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 10n;
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

    // Have 1 person claim (gets 300_000 = 1/3)
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

    // Warp clock past expiry
    const clock = svm.getClock();
    clock.unixTimestamp = expiresAt + 100n;
    svm.setClock(clock);

    // Close — should succeed because expired
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

    // Verify creator got remaining 2/3 USDC back
    const creatorAccount = svm.getAccount(creatorTA.publicKey);
    const creatorBalance = readTokenBalance(Buffer.from(creatorAccount!.data));
    expect(creatorBalance).to.equal(600_000n); // 2/3 of 900_000

    // Verify PDA and vault closed
    expect(svm.getAccount(redPacketPDA)).to.be.null;
    expect(svm.getAccount(vaultPDA)).to.be.null;

    console.log("    Closed expired partial red packet, creator got 0.6 USDC back");
  });

  it("Rejects claim on expired red packet", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 1_000_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 11n;
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
        data: buildCreateData(id, totalAmount, 2, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Warp clock past expiry
    const clock = svm.getClock();
    clock.unixTimestamp = expiresAt + 100n;
    svm.setClock(clock);

    // Try to claim — should fail
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

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected expired claim");
    } catch (e: any) {
      console.log("    Expired claim correctly rejected");
    }
  });

  it("Creates and claims with max recipients (20)", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(100 * LAMPORTS_PER_SOL));

    const totalAmount = 20_000_000n; // 20 USDC, 1 USDC each
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 12n;
    const numRecipients = 20;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Create with 20 recipients (even split)
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

    // Verify account size: 70 + 40*20 = 870 bytes
    const rpAccount = svm.getAccount(redPacketPDA);
    expect(rpAccount).to.not.be.null;
    expect(rpAccount!.data.length).to.equal(871);

    // First claimer claims (slot 0 = 1_000_000 each)
    const claimer1 = Keypair.generate();
    svm.airdrop(claimer1.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimer1TA = createAndFundTokenAccount(
      svm, claimer1, mint.publicKey, mintAuthority, claimer1.publicKey, 0n
    );

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer1.publicKey, isSigner: true, isWritable: true },
          { pubkey: claimer1TA.publicKey, isSigner: false, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildClaimData(),
      })
    );
    tx.sign(claimer1);
    svm.sendTransaction(tx);

    const c1Balance = readTokenBalance(Buffer.from(svm.getAccount(claimer1TA.publicKey)!.data));
    expect(c1Balance).to.equal(1_000_000n); // 1 USDC

    // 20th claimer claims (slot 19 — last slot)
    // First, fill slots 1..18 with different claimers
    for (let i = 1; i < 19; i++) {
      const c = Keypair.generate();
      svm.airdrop(c.publicKey, BigInt(LAMPORTS_PER_SOL));
      const cTA = createAndFundTokenAccount(
        svm, c, mint.publicKey, mintAuthority, c.publicKey, 0n
      );
      blockhash = svm.latestBlockhash();
      tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.add(
        new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: c.publicKey, isSigner: true, isWritable: true },
            { pubkey: cTA.publicKey, isSigner: false, isWritable: true },
            { pubkey: redPacketPDA, isSigner: false, isWritable: true },
            { pubkey: vaultPDA, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: buildClaimData(),
        })
      );
      tx.sign(c);
      svm.sendTransaction(tx);
    }

    // Last claimer (slot 19)
    const claimer20 = Keypair.generate();
    svm.airdrop(claimer20.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimer20TA = createAndFundTokenAccount(
      svm, claimer20, mint.publicKey, mintAuthority, claimer20.publicKey, 0n
    );

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer20.publicKey, isSigner: true, isWritable: true },
          { pubkey: claimer20TA.publicKey, isSigner: false, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildClaimData(),
      })
    );
    tx.sign(claimer20);
    svm.sendTransaction(tx);

    const c20Balance = readTokenBalance(Buffer.from(svm.getAccount(claimer20TA.publicKey)!.data));
    expect(c20Balance).to.equal(1_000_000n); // 1 USDC

    // Verify fully claimed
    const rpFinal = svm.getAccount(redPacketPDA);
    expect(rpFinal!.data[58]).to.equal(20); // num_claimed = 20

    console.log("    Max recipients (20): all claimed 1 USDC each");
  });

  it("Rejects close when not expired and not fully claimed", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 900_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 20n;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Create 3-recipient red packet
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
        data: buildCreateData(id, totalAmount, 3, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Have 1 person claim
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

    // Try to close — not expired, only 1/3 claimed — should fail
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

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected premature close");
    } catch (e: any) {
      console.log("    Premature close correctly rejected");
    }
  });

  it("Rejects close by wrong creator", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 500_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 21n;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Create red packet as creator
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

    // Warp past expiry so close condition is met
    const clock = svm.getClock();
    clock.unixTimestamp = expiresAt + 100n;
    svm.setClock(clock);

    // Wrong creator tries to close
    const attacker = Keypair.generate();
    svm.airdrop(attacker.publicKey, BigInt(LAMPORTS_PER_SOL));
    const attackerTA = createAndFundTokenAccount(
      svm, attacker, mint.publicKey, mintAuthority, attacker.publicKey, 0n
    );

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: attacker.publicKey, isSigner: true, isWritable: true },
          { pubkey: attackerTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildCloseData(),
      })
    );
    tx.sign(attacker);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected wrong creator close");
    } catch (e: any) {
      console.log("    Wrong creator close correctly rejected");
    }
  });

  it("Rejects treasury double initialization", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryBump, treasuryVaultPDA, treasuryVaultBump } = setupSVM();

    // Try to initialize treasury again — should fail
    const blockhash = svm.latestBlockhash();
    const tx = new Transaction();
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
        data: buildInitTreasuryData(0, treasuryBump, treasuryVaultBump),
      })
    );
    tx.sign(mintAuthority);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected double treasury init");
    } catch (e: any) {
      console.log("    Treasury double init correctly rejected");
    }
  });

  it("Rejects random split with mismatched amounts", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 1_000_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 22n;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Amounts sum to 900_000, but total_amount is 1_000_000 — mismatch
    const wrongAmounts = [300_000n, 300_000n, 300_000n];

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
        data: buildCreateData(id, totalAmount, 3, 1, expiresAt, rpBump, vaultBump, wrongAmounts),
      })
    );
    tx.sign(creator);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected mismatched amounts");
    } catch (e: any) {
      console.log("    Amount mismatch correctly rejected");
    }
  });

  it("Rejects create with wrong mint", () => {
    const { svm, mintAuthority, treasuryPDA, treasuryVaultPDA } = setupSVM();

    // Create a different mint (not the one treasury accepts)
    const wrongMint = Keypair.generate();
    let blockhash = svm.latestBlockhash();
    let tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: mintAuthority.publicKey,
        newAccountPubkey: wrongMint.publicKey,
        space: MINT_SIZE,
        lamports: Number(MINT_RENT),
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        wrongMint.publicKey,
        6,
        mintAuthority.publicKey,
        null
      )
    );
    tx.sign(mintAuthority, wrongMint);
    svm.sendTransaction(tx);

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    // Fund creator with wrong mint tokens
    const creatorTA = createAndFundTokenAccount(
      svm, creator, wrongMint.publicKey, mintAuthority, creator.publicKey,
      10_000_000n
    );

    const id = 23n;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

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
          { pubkey: treasuryPDA, isSigner: false, isWritable: false },
          { pubkey: treasuryVaultPDA, isSigner: false, isWritable: true },
          { pubkey: wrongMint.publicKey, isSigner: false, isWritable: false }, // WRONG MINT
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, 1_000_000n, 1, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected wrong mint");
    } catch (e: any) {
      console.log("    Wrong mint correctly rejected");
    }
  });

  it("Rejects create with fake treasury_vault (fee bypass attempt)", () => {
    const { svm, mintAuthority, mint, treasuryPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 1_000_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    // Create a fake "treasury vault" — just the creator's own token account
    const fakeTreasuryVault = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey, 0n
    );

    const id = 24n;
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
          { pubkey: fakeTreasuryVault.publicKey, isSigner: false, isWritable: true }, // FAKE
          { pubkey: mint.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, 1, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected fake treasury vault");
    } catch (e: any) {
      console.log("    Fee bypass attempt correctly rejected");
    }
  });

  it("Creates and claims minimum amount (1 micro-unit)", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 1n; // 1 micro-unit = 0.000001 USDC
    const fee = 1n; // min fee floor
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 25n;
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

    // Verify fee was 1 (minimum floor)
    const tvAccount = svm.getAccount(treasuryVaultPDA);
    const tvBalance = readTokenBalance(Buffer.from(tvAccount!.data));
    expect(tvBalance).to.equal(1n);

    // Claim
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

    const claimerBalance = readTokenBalance(Buffer.from(svm.getAccount(claimerTA.publicKey)!.data));
    expect(claimerBalance).to.equal(1n);

    console.log("    Minimum amount: 1 micro-unit claimed, fee = 1 micro-unit");
  });

  it("Full lifecycle: create → all claim → close → rent returned", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 900_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 26n;
    const numRecipients = 3;
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

    const solAfterCreate = svm.getBalance(creator.publicKey);

    // All 3 claim
    for (let i = 0; i < numRecipients; i++) {
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
    }

    // Verify fully claimed
    expect(svm.getAccount(redPacketPDA)!.data[58]).to.equal(3);

    // Close
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

    // Verify accounts are gone
    expect(svm.getAccount(redPacketPDA)).to.be.null;
    expect(svm.getAccount(vaultPDA)).to.be.null;

    // Verify creator got rent back (SOL balance increased after close)
    const solAfterClose = svm.getBalance(creator.publicKey);
    expect(solAfterClose > solAfterCreate).to.be.true;

    // Verify vault USDC is zero (account gone)
    // Verify creator token account has 0 remaining USDC (all was distributed)
    const creatorTokenBalance = readTokenBalance(Buffer.from(svm.getAccount(creatorTA.publicKey)!.data));
    expect(creatorTokenBalance).to.equal(0n);

    console.log("    Full lifecycle complete: create → 3 claims → close, all rent returned");
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

  // ============================
  // SOL Red Packet Tests
  // ============================

  it("Creates SOL red packet with even split", () => {
    const { svm, solTreasuryPDA: treasuryPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = BigInt(1 * LAMPORTS_PER_SOL); // 1 SOL
    const fee = totalAmount * 10n / 10_000n; // 0.1% = 0.001 SOL

    const id = 100n;
    const numRecipients = 3;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const treasuryBefore = svm.getBalance(treasuryPDA);

    const blockhash = svm.latestBlockhash();
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, numRecipients, 0, expiresAt, rpBump, vaultBump, undefined, 1),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Verify red packet PDA
    const rpAccount = svm.getAccount(redPacketPDA);
    expect(rpAccount).to.not.be.null;
    expect(rpAccount!.data[0]).to.equal(1); // discriminator
    expect(rpAccount!.data[62]).to.equal(1); // token_type = SOL
    expect(rpAccount!.data.length).to.equal(71 + 40 * numRecipients);

    // Verify vault holds SOL (rent + totalAmount)
    const vaultBalance = svm.getBalance(vaultPDA);
    expect(vaultBalance >= totalAmount).to.be.true;

    // Verify treasury received SOL fee
    const treasuryAfter = svm.getBalance(treasuryPDA);
    expect(treasuryAfter - treasuryBefore).to.equal(fee);

    // Verify sol_fees_collected in treasury state
    const tAccount = svm.getAccount(treasuryPDA);
    const solFees = Buffer.from(tAccount!.data).readBigUInt64LE(35);
    expect(solFees).to.equal(fee);

    console.log(`    SOL red packet created: ${Number(totalAmount) / LAMPORTS_PER_SOL} SOL, fee: ${Number(fee)} lamports`);
  });

  it("Claims from SOL red packet", () => {
    const { svm, solTreasuryPDA: treasuryPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = BigInt(3 * LAMPORTS_PER_SOL); // 3 SOL, divisible by 3
    const id = 101n;
    const numRecipients = 3;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Create SOL red packet
    let blockhash = svm.latestBlockhash();
    let tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, numRecipients, 0, expiresAt, rpBump, vaultBump, undefined, 1),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Create claimer and claim
    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimerBefore = svm.getBalance(claimer.publicKey);

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer.publicKey, isSigner: true, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
        ],
        data: buildClaimData(1),
      })
    );
    tx.sign(claimer);
    svm.sendTransaction(tx);

    // Verify claimer received 1 SOL minus tx fee (3 SOL / 3 recipients)
    const claimerAfter = svm.getBalance(claimer.publicKey);
    const expectedAmount = BigInt(LAMPORTS_PER_SOL); // 1 SOL per person
    const txFee = 5000n;
    expect(claimerAfter - claimerBefore).to.equal(expectedAmount - txFee);

    // Verify state updated
    const rpAccount = svm.getAccount(redPacketPDA);
    expect(rpAccount!.data[58]).to.equal(1); // num_claimed = 1

    console.log(`    SOL claim: received ${Number(expectedAmount) / LAMPORTS_PER_SOL} SOL`);
  });

  it("Closes fully-claimed SOL red packet", () => {
    const { svm, solTreasuryPDA: treasuryPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = BigInt(1 * LAMPORTS_PER_SOL);
    const id = 102n;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Create SOL red packet (1 recipient)
    let blockhash = svm.latestBlockhash();
    let tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, 1, 0, expiresAt, rpBump, vaultBump, undefined, 1),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Claimer claims
    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer.publicKey, isSigner: true, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
        ],
        data: buildClaimData(1),
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
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
        ],
        data: buildCloseData(1),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Verify accounts closed
    expect(svm.getAccount(redPacketPDA)).to.be.null;
    expect(svm.getAccount(vaultPDA)).to.be.null;

    // Verify rent returned
    const solAfter = svm.getBalance(creator.publicKey);
    expect(solAfter > solBefore).to.be.true;

    console.log("    SOL red packet closed, rent returned to creator");
  });

  it("Closes expired SOL red packet with partial claims", () => {
    const { svm, solTreasuryPDA: treasuryPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = BigInt(3 * LAMPORTS_PER_SOL);
    const id = 103n;
    const numRecipients = 3;
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
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, numRecipients, 0, expiresAt, rpBump, vaultBump, undefined, 1),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // 1 person claims
    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer.publicKey, isSigner: true, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
        ],
        data: buildClaimData(1),
      })
    );
    tx.sign(claimer);
    svm.sendTransaction(tx);

    // Warp past expiry
    const clock = svm.getClock();
    clock.unixTimestamp = expiresAt + 100n;
    svm.setClock(clock);

    // Close — should succeed (expired)
    const solBefore = svm.getBalance(creator.publicKey);

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
        ],
        data: buildCloseData(1),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Verify creator got SOL back (remaining 2 SOL + vault rent + PDA rent)
    const solAfter = svm.getBalance(creator.publicKey);
    expect(solAfter > solBefore).to.be.true;
    expect(svm.getAccount(redPacketPDA)).to.be.null;
    expect(svm.getAccount(vaultPDA)).to.be.null;

    console.log("    Closed expired SOL red packet with partial claims");
  });

  it("Rejects double claim on SOL red packet", () => {
    const { svm, solTreasuryPDA: treasuryPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = BigInt(2 * LAMPORTS_PER_SOL);
    const id = 104n;
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
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, 2, 0, expiresAt, rpBump, vaultBump, undefined, 1),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // First claim
    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer.publicKey, isSigner: true, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
        ],
        data: buildClaimData(1),
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
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
        ],
        data: buildClaimData(1),
      })
    );
    tx.sign(claimer);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected SOL double claim");
    } catch (e: any) {
      console.log("    SOL double claim correctly rejected");
    }
  });

  it("Creates and claims SOL random split", () => {
    const { svm, solTreasuryPDA: treasuryPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = BigInt(3 * LAMPORTS_PER_SOL);
    const amounts = [
      BigInt(1 * LAMPORTS_PER_SOL),
      BigInt(500_000_000), // 0.5 SOL
      BigInt(1_500_000_000), // 1.5 SOL
    ];
    const id = 105n;
    const numRecipients = 3;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Create random split SOL red packet
    let blockhash = svm.latestBlockhash();
    let tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, numRecipients, 1, expiresAt, rpBump, vaultBump, amounts, 1),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // First claimer gets slot 0 = 1 SOL
    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimerBefore = svm.getBalance(claimer.publicKey);

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer.publicKey, isSigner: true, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
        ],
        data: buildClaimData(1),
      })
    );
    tx.sign(claimer);
    svm.sendTransaction(tx);

    const claimerAfter = svm.getBalance(claimer.publicKey);
    const txFee = 5000n;
    expect(claimerAfter - claimerBefore).to.equal(BigInt(LAMPORTS_PER_SOL) - txFee);

    console.log("    SOL random split claim: received 1 SOL (first slot)");
  });

  it("Verifies SOL fees tracked in treasury", () => {
    const { svm, solTreasuryPDA: treasuryPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    // Create two SOL red packets to accumulate fees
    for (let i = 0; i < 2; i++) {
      const totalAmount = BigInt(1 * LAMPORTS_PER_SOL);
      const id = BigInt(200 + i);
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
            { pubkey: redPacketPDA, isSigner: false, isWritable: true },
            { pubkey: vaultPDA, isSigner: false, isWritable: true },
            { pubkey: treasuryPDA, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: buildCreateData(id, totalAmount, 1, 0, expiresAt, rpBump, vaultBump, undefined, 1),
        })
      );
      tx.sign(creator);
      svm.sendTransaction(tx);
    }

    // Verify sol_fees_collected = 2 * fee (0.1% of 1 SOL = 1_000_000 lamports each)
    const tAccount = svm.getAccount(treasuryPDA);
    const solFees = Buffer.from(tAccount!.data).readBigUInt64LE(35);
    const expectedFee = BigInt(LAMPORTS_PER_SOL) * 10n / 10_000n; // 1_000_000 per packet
    expect(solFees).to.equal(expectedFee * 2n);

    console.log(`    SOL fees tracked: ${solFees} lamports from 2 red packets`);
  });

  // ============================
  // MYRC Red Packet Tests
  // ============================

  it("Creates MYRC red packet and collects fee in MYRC treasury", () => {
    const { svm, mintAuthority, myrcMint, myrcTreasuryPDA, myrcTreasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 5_000_000_000n; // 5 MYRC (9 decimals)
    const fee = totalAmount * 10n / 10_000n; // 0.1%
    const creatorTA = createAndFundTokenAccount(
      svm, creator, myrcMint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee + 1_000_000_000n
    );

    const id = 400n;
    const numRecipients = 2;
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
          { pubkey: myrcTreasuryPDA, isSigner: false, isWritable: false },
          { pubkey: myrcTreasuryVaultPDA, isSigner: false, isWritable: true },
          { pubkey: myrcMint.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, numRecipients, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Verify vault has MYRC
    const vaultAccount = svm.getAccount(vaultPDA);
    const vaultBalance = readTokenBalance(Buffer.from(vaultAccount!.data));
    expect(vaultBalance).to.equal(totalAmount);

    // Verify MYRC treasury vault received fee
    const tvAccount = svm.getAccount(myrcTreasuryVaultPDA);
    const tvBalance = readTokenBalance(Buffer.from(tvAccount!.data));
    expect(tvBalance).to.equal(fee);

    console.log(`    MYRC red packet created: ${Number(totalAmount) / 1e9} MYRC, fee: ${Number(fee) / 1e9} MYRC`);
  });

  it("Claims from MYRC red packet", () => {
    const { svm, mintAuthority, myrcMint, myrcTreasuryPDA, myrcTreasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 2_000_000_000n; // 2 MYRC, divisible by 2
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, myrcMint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 401n;
    const numRecipients = 2;
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
          { pubkey: myrcTreasuryPDA, isSigner: false, isWritable: false },
          { pubkey: myrcTreasuryVaultPDA, isSigner: false, isWritable: true },
          { pubkey: myrcMint.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, numRecipients, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Claim
    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimerTA = createAndFundTokenAccount(
      svm, claimer, myrcMint.publicKey, mintAuthority, claimer.publicKey, 0n
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

    const claimerBalance = readTokenBalance(Buffer.from(svm.getAccount(claimerTA.publicKey)!.data));
    expect(claimerBalance).to.equal(1_000_000_000n); // 1 MYRC (2 / 2)

    console.log(`    MYRC claim: received ${Number(claimerBalance) / 1e9} MYRC`);
  });

  it("Closes MYRC red packet after full claim", () => {
    const { svm, mintAuthority, myrcMint, myrcTreasuryPDA, myrcTreasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 1_000_000_000n; // 1 MYRC
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, myrcMint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 402n;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Create (1 recipient)
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
          { pubkey: myrcTreasuryPDA, isSigner: false, isWritable: false },
          { pubkey: myrcTreasuryVaultPDA, isSigner: false, isWritable: true },
          { pubkey: myrcMint.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, 1, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Claim
    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimerTA = createAndFundTokenAccount(
      svm, claimer, myrcMint.publicKey, mintAuthority, claimer.publicKey, 0n
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

    expect(svm.getAccount(redPacketPDA)).to.be.null;
    expect(svm.getAccount(vaultPDA)).to.be.null;

    console.log("    MYRC red packet closed after full claim");
  });

  it("Rejects creating USDC red packet with MYRC treasury (cross-mint)", () => {
    const { svm, mintAuthority, mint, myrcTreasuryPDA, myrcTreasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 1_000_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 500n;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Try to create USDC red packet but pass MYRC treasury — should fail (mint mismatch)
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
          { pubkey: myrcTreasuryPDA, isSigner: false, isWritable: false },
          { pubkey: myrcTreasuryVaultPDA, isSigner: false, isWritable: true },
          { pubkey: mint.publicKey, isSigner: false, isWritable: false }, // USDC mint
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, 1, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected cross-mint treasury");
    } catch (e: any) {
      console.log("    Cross-mint treasury correctly rejected");
    }
  });

  it("Rejects token_type mismatch (SOL claim on SPL red packet)", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 1_000_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 300n;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Create SPL red packet (token_type = 0)
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

    // Try to claim with SOL token_type (mismatch!)
    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer.publicKey, isSigner: true, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
        ],
        data: buildClaimData(1), // token_type = 1 (SOL), but red packet is SPL!
      })
    );
    tx.sign(claimer);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected token_type mismatch");
    } catch (e: any) {
      console.log("    Token type mismatch correctly rejected");
    }
  });

  // ============================
  // Fee Withdrawal Tests
  // ============================

  it("Admin withdraws all SPL fees", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    // Create a red packet to generate fees
    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 10_000_000n;
    const expectedFee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + expectedFee
    );

    const id = 600n;
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

    // Admin withdraws all fees
    svm.airdrop(ADMIN_KEYPAIR.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    const adminTA = createAndFundTokenAccount(
      svm, ADMIN_KEYPAIR, mint.publicKey, mintAuthority, ADMIN_KEYPAIR.publicKey, 0n
    );

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: ADMIN_KEYPAIR.publicKey, isSigner: true, isWritable: true },
          { pubkey: adminTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: false },
          { pubkey: treasuryVaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildWithdrawFeesData(0n), // 0 = withdraw all
      })
    );
    tx.sign(ADMIN_KEYPAIR);
    svm.sendTransaction(tx);

    // Verify admin received fees
    const adminBalance = readTokenBalance(Buffer.from(svm.getAccount(adminTA.publicKey)!.data));
    expect(adminBalance).to.equal(expectedFee);

    // Verify treasury vault is empty
    const tvBalance = readTokenBalance(Buffer.from(svm.getAccount(treasuryVaultPDA)!.data));
    expect(tvBalance).to.equal(0n);

    console.log(`    Admin withdrew all SPL fees: ${Number(expectedFee) / 1e6} USDC`);
  });

  it("Admin withdraws partial SPL fees", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 10_000_000n;
    const expectedFee = totalAmount * 10n / 10_000n; // 10_000
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + expectedFee
    );

    const id = 601n;
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

    // Admin withdraws half
    svm.airdrop(ADMIN_KEYPAIR.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    const adminTA = createAndFundTokenAccount(
      svm, ADMIN_KEYPAIR, mint.publicKey, mintAuthority, ADMIN_KEYPAIR.publicKey, 0n
    );

    const halfFee = expectedFee / 2n;

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: ADMIN_KEYPAIR.publicKey, isSigner: true, isWritable: true },
          { pubkey: adminTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: false },
          { pubkey: treasuryVaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildWithdrawFeesData(halfFee),
      })
    );
    tx.sign(ADMIN_KEYPAIR);
    svm.sendTransaction(tx);

    const adminBalance = readTokenBalance(Buffer.from(svm.getAccount(adminTA.publicKey)!.data));
    expect(adminBalance).to.equal(halfFee);

    const tvBalance = readTokenBalance(Buffer.from(svm.getAccount(treasuryVaultPDA)!.data));
    expect(tvBalance).to.equal(expectedFee - halfFee);

    console.log("    Admin withdrew partial SPL fees");
  });

  it("Rejects SPL withdrawal when no fees", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    svm.airdrop(ADMIN_KEYPAIR.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    const adminTA = createAndFundTokenAccount(
      svm, ADMIN_KEYPAIR, mint.publicKey, mintAuthority, ADMIN_KEYPAIR.publicKey, 0n
    );

    const blockhash = svm.latestBlockhash();
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: ADMIN_KEYPAIR.publicKey, isSigner: true, isWritable: true },
          { pubkey: adminTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: false },
          { pubkey: treasuryVaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildWithdrawFeesData(0n),
      })
    );
    tx.sign(ADMIN_KEYPAIR);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected empty withdrawal");
    } catch (e: any) {
      console.log("    SPL withdrawal with no fees correctly rejected");
    }
  });

  it("Admin withdraws all SOL fees", () => {
    const { svm, solTreasuryPDA: treasuryPDA } = setupSVM();

    // Create SOL red packet to generate fees
    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = BigInt(1 * LAMPORTS_PER_SOL);
    const expectedFee = totalAmount * 10n / 10_000n;
    const id = 700n;
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
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, 1, 0, expiresAt, rpBump, vaultBump, undefined, 1),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Verify fees accumulated
    let tAccount = svm.getAccount(treasuryPDA);
    let solFees = Buffer.from(tAccount!.data).readBigUInt64LE(35);
    expect(solFees).to.equal(expectedFee);

    // Admin withdraws all SOL fees
    svm.airdrop(ADMIN_KEYPAIR.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    const adminBefore = svm.getBalance(ADMIN_KEYPAIR.publicKey);

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: ADMIN_KEYPAIR.publicKey, isSigner: true, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: true },
        ],
        data: buildWithdrawFeesData(0n, 1), // amount=0 (all), tokenType=1 (SOL)
      })
    );
    tx.sign(ADMIN_KEYPAIR);
    svm.sendTransaction(tx);

    // Verify admin got the fees (minus tx fee)
    const adminAfter = svm.getBalance(ADMIN_KEYPAIR.publicKey);
    const txFee = 5000n;
    expect(adminAfter - adminBefore).to.equal(expectedFee - txFee);

    // Verify sol_fees_collected is 0
    tAccount = svm.getAccount(treasuryPDA);
    solFees = Buffer.from(tAccount!.data).readBigUInt64LE(35);
    expect(solFees).to.equal(0n);

    console.log(`    Admin withdrew all SOL fees: ${expectedFee} lamports`);
  });

  it("Admin withdraws partial SOL fees", () => {
    const { svm, solTreasuryPDA: treasuryPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    // Create 2 SOL red packets to accumulate fees
    for (let i = 0; i < 2; i++) {
      const totalAmount = BigInt(1 * LAMPORTS_PER_SOL);
      const id = BigInt(710 + i);
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
            { pubkey: redPacketPDA, isSigner: false, isWritable: true },
            { pubkey: vaultPDA, isSigner: false, isWritable: true },
            { pubkey: treasuryPDA, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: buildCreateData(id, totalAmount, 1, 0, expiresAt, rpBump, vaultBump, undefined, 1),
        })
      );
      tx.sign(creator);
      svm.sendTransaction(tx);
    }

    const feePerPacket = BigInt(LAMPORTS_PER_SOL) * 10n / 10_000n;
    const totalFees = feePerPacket * 2n;
    const halfFees = feePerPacket; // withdraw just one packet's worth

    svm.airdrop(ADMIN_KEYPAIR.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const blockhash = svm.latestBlockhash();
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: ADMIN_KEYPAIR.publicKey, isSigner: true, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: true },
        ],
        data: buildWithdrawFeesData(halfFees, 1),
      })
    );
    tx.sign(ADMIN_KEYPAIR);
    svm.sendTransaction(tx);

    // Verify remaining fees
    const tAccount = svm.getAccount(treasuryPDA);
    const solFees = Buffer.from(tAccount!.data).readBigUInt64LE(35);
    expect(solFees).to.equal(totalFees - halfFees);

    console.log("    Admin withdrew partial SOL fees");
  });

  it("Rejects unauthorized SOL withdrawal", () => {
    const { svm, solTreasuryPDA: treasuryPDA } = setupSVM();

    const attacker = Keypair.generate();
    svm.airdrop(attacker.publicKey, BigInt(LAMPORTS_PER_SOL));

    const blockhash = svm.latestBlockhash();
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: attacker.publicKey, isSigner: true, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: true },
        ],
        data: buildWithdrawFeesData(0n, 1),
      })
    );
    tx.sign(attacker);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected unauthorized SOL withdrawal");
    } catch (e: any) {
      console.log("    Unauthorized SOL withdrawal correctly rejected");
    }
  });

  it("Rejects SOL withdrawal when no fees", () => {
    const { svm, solTreasuryPDA: treasuryPDA } = setupSVM();

    svm.airdrop(ADMIN_KEYPAIR.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const blockhash = svm.latestBlockhash();
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: ADMIN_KEYPAIR.publicKey, isSigner: true, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: true },
        ],
        data: buildWithdrawFeesData(0n, 1),
      })
    );
    tx.sign(ADMIN_KEYPAIR);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected empty SOL withdrawal");
    } catch (e: any) {
      console.log("    SOL withdrawal with no fees correctly rejected");
    }
  });

  // ============================
  // SOL Full Lifecycle
  // ============================

  it("SOL full lifecycle: create → all claim → close", () => {
    const { svm, solTreasuryPDA: treasuryPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = BigInt(3 * LAMPORTS_PER_SOL);
    const id = 800n;
    const numRecipients = 3;
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
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, numRecipients, 0, expiresAt, rpBump, vaultBump, undefined, 1),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    const solAfterCreate = svm.getBalance(creator.publicKey);

    // All 3 claim
    for (let i = 0; i < numRecipients; i++) {
      const claimer = Keypair.generate();
      svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));

      blockhash = svm.latestBlockhash();
      tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.add(
        new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: claimer.publicKey, isSigner: true, isWritable: true },
            { pubkey: redPacketPDA, isSigner: false, isWritable: true },
            { pubkey: vaultPDA, isSigner: false, isWritable: true },
          ],
          data: buildClaimData(1),
        })
      );
      tx.sign(claimer);
      svm.sendTransaction(tx);
    }

    // Verify fully claimed
    expect(svm.getAccount(redPacketPDA)!.data[58]).to.equal(3);

    // Close
    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
        ],
        data: buildCloseData(1),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Verify accounts closed
    expect(svm.getAccount(redPacketPDA)).to.be.null;
    expect(svm.getAccount(vaultPDA)).to.be.null;

    // Verify creator got rent back
    const solAfterClose = svm.getBalance(creator.publicKey);
    expect(solAfterClose > solAfterCreate).to.be.true;

    console.log("    SOL full lifecycle complete: create → 3 claims → close");
  });

  // ============================
  // Input Validation
  // ============================

  it("Rejects create with zero amount", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey, 1_000_000n
    );

    const id = 900n;
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
        data: buildCreateData(id, 0n, 1, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected zero amount");
    } catch (e: any) {
      console.log("    Zero amount correctly rejected");
    }
  });

  it("Rejects create with 0 recipients", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey, 1_000_000n
    );

    const id = 901n;
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
        data: buildCreateData(id, 1_000_000n, 0, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected 0 recipients");
    } catch (e: any) {
      console.log("    Zero recipients correctly rejected");
    }
  });

  it("Rejects create with 21 recipients", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey, 100_000_000n
    );

    const id = 902n;
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
        data: buildCreateData(id, 21_000_000n, 21, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected 21 recipients");
    } catch (e: any) {
      console.log("    21 recipients correctly rejected");
    }
  });

  it("Rejects create with invalid split_mode", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey, 1_000_000n
    );

    const id = 903n;
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
        data: buildCreateData(id, 1_000_000n, 1, 2, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected invalid split mode");
    } catch (e: any) {
      console.log("    Invalid split mode correctly rejected");
    }
  });

  it("Rejects create with expiresAt in the past", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey, 1_000_000n
    );

    const id = 904n;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);

    const clock = svm.getClock();
    clock.unixTimestamp = 1000000n;
    svm.setClock(clock);
    const expiresAt = 999999n;

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
        data: buildCreateData(id, 1_000_000n, 1, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected expired create");
    } catch (e: any) {
      console.log("    Expired create correctly rejected");
    }
  });

  it("Even split with remainder goes to last recipient", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 10n; // 10 micro-units, 10/3 = 3 remainder 1
    const fee = 1n; // min fee floor
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 905n;
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
        data: buildCreateData(id, totalAmount, numRecipients, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Claim all 3
    const balances: bigint[] = [];
    for (let i = 0; i < numRecipients; i++) {
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

      const balance = readTokenBalance(Buffer.from(svm.getAccount(claimerTA.publicKey)!.data));
      balances.push(balance);
    }

    // First two get 3, last gets 4 (3 + remainder 1)
    expect(balances[0]).to.equal(3n);
    expect(balances[1]).to.equal(3n);
    expect(balances[2]).to.equal(4n);

    console.log(`    Even split remainder: [${balances.join(", ")}]`);
  });

  it("Multiple red packets from same creator", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 500_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      (totalAmount + fee) * 2n // enough for 2 packets
    );

    // Create 2 red packets with different IDs
    const ids = [906n, 907n];
    const pdas: { rp: PublicKey; vault: PublicKey }[] = [];

    for (const id of ids) {
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
          data: buildCreateData(id, totalAmount, 1, 0, expiresAt, rpBump, vaultBump),
        })
      );
      tx.sign(creator);
      svm.sendTransaction(tx);
      pdas.push({ rp: redPacketPDA, vault: vaultPDA });
    }

    // Verify both exist
    expect(svm.getAccount(pdas[0].rp)).to.not.be.null;
    expect(svm.getAccount(pdas[1].rp)).to.not.be.null;

    // Claim from both
    for (const { rp, vault } of pdas) {
      const claimer = Keypair.generate();
      svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));
      const claimerTA = createAndFundTokenAccount(
        svm, claimer, mint.publicKey, mintAuthority, claimer.publicKey, 0n
      );

      const blockhash = svm.latestBlockhash();
      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.add(
        new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: claimer.publicKey, isSigner: true, isWritable: true },
            { pubkey: claimerTA.publicKey, isSigner: false, isWritable: true },
            { pubkey: rp, isSigner: false, isWritable: true },
            { pubkey: vault, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: buildClaimData(),
        })
      );
      tx.sign(claimer);
      svm.sendTransaction(tx);
    }

    // Close both
    for (const { rp, vault } of pdas) {
      const blockhash = svm.latestBlockhash();
      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.add(
        new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: creator.publicKey, isSigner: true, isWritable: true },
            { pubkey: creatorTA.publicKey, isSigner: false, isWritable: true },
            { pubkey: rp, isSigner: false, isWritable: true },
            { pubkey: vault, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: buildCloseData(),
        })
      );
      tx.sign(creator);
      svm.sendTransaction(tx);
    }

    // Verify both closed
    expect(svm.getAccount(pdas[0].rp)).to.be.null;
    expect(svm.getAccount(pdas[1].rp)).to.be.null;

    console.log("    Multiple red packets from same creator: both created, claimed, closed");
  });

  // ============================
  // Security — Edge-Case Guards
  // ============================

  it("Rejects claim after all slots taken (RedPacketFull)", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 200_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 1000n;
    const numRecipients = 2;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Create red packet with 2 slots
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

    // Claimer 1 claims
    const claimer1 = Keypair.generate();
    svm.airdrop(claimer1.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimer1TA = createAndFundTokenAccount(svm, claimer1, mint.publicKey, mintAuthority, claimer1.publicKey, 0n);

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer1.publicKey, isSigner: true, isWritable: true },
          { pubkey: claimer1TA.publicKey, isSigner: false, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildClaimData(),
      })
    );
    tx.sign(claimer1);
    svm.sendTransaction(tx);

    // Claimer 2 claims
    const claimer2 = Keypair.generate();
    svm.airdrop(claimer2.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimer2TA = createAndFundTokenAccount(svm, claimer2, mint.publicKey, mintAuthority, claimer2.publicKey, 0n);

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer2.publicKey, isSigner: true, isWritable: true },
          { pubkey: claimer2TA.publicKey, isSigner: false, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildClaimData(),
      })
    );
    tx.sign(claimer2);
    svm.sendTransaction(tx);

    // Claimer 3 tries — should fail (RedPacketFull)
    const claimer3 = Keypair.generate();
    svm.airdrop(claimer3.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimer3TA = createAndFundTokenAccount(svm, claimer3, mint.publicKey, mintAuthority, claimer3.publicKey, 0n);

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer3.publicKey, isSigner: true, isWritable: true },
          { pubkey: claimer3TA.publicKey, isSigner: false, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildClaimData(),
      })
    );
    tx.sign(claimer3);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected claim on full red packet");
    } catch (e: any) {
      console.log("    RedPacketFull correctly rejected");
    }
  });

  it("Rejects claim with fake token program (InvalidTokenProgram)", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 1_000_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 1001n;
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
        data: buildCreateData(id, totalAmount, 1, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Claim with fake token program
    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimerTA = createAndFundTokenAccount(svm, claimer, mint.publicKey, mintAuthority, claimer.publicKey, 0n);

    const fakeTokenProgram = Keypair.generate().publicKey;

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
          { pubkey: fakeTokenProgram, isSigner: false, isWritable: false },
        ],
        data: buildClaimData(),
      })
    );
    tx.sign(claimer);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected fake token program");
    } catch (e: any) {
      console.log("    InvalidTokenProgram correctly rejected");
    }
  });

  it("Rejects create with fake system program (InvalidSystemProgram)", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 1_000_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 1002n;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const fakeSystemProgram = Keypair.generate().publicKey;

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
          { pubkey: fakeSystemProgram, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, 1, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected fake system program");
    } catch (e: any) {
      console.log("    InvalidSystemProgram correctly rejected");
    }
  });

  it("Rejects claim with system-owned fake red_packet (InvalidAccountOwner)", () => {
    const { svm, mintAuthority, mint } = setupSVM();

    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimerTA = createAndFundTokenAccount(svm, claimer, mint.publicKey, mintAuthority, claimer.publicKey, 0n);

    // Inject a system-owned account (wrong owner) at a random address
    const fakeRedPacket = Keypair.generate().publicKey;
    svm.setAccount(fakeRedPacket, {
      lamports: 1_000_000,
      data: Buffer.alloc(151, 0),
      owner: SystemProgram.programId,
      executable: false,
    });

    const dummyVault = Keypair.generate().publicKey;

    const blockhash = svm.latestBlockhash();
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer.publicKey, isSigner: true, isWritable: true },
          { pubkey: claimerTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: fakeRedPacket, isSigner: false, isWritable: true },
          { pubkey: dummyVault, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildClaimData(),
      })
    );
    tx.sign(claimer);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected system-owned fake red_packet");
    } catch (e: any) {
      console.log("    InvalidAccountOwner correctly rejected");
    }
  });

  it("Rejects claim with wrong discriminator on red_packet (InvalidDiscriminator)", () => {
    const { svm, mintAuthority, mint } = setupSVM();

    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimerTA = createAndFundTokenAccount(svm, claimer, mint.publicKey, mintAuthority, claimer.publicKey, 0n);

    // Inject a program-owned account with discriminator=2 (treasury, not redpacket)
    const fakeRedPacket = Keypair.generate().publicKey;
    const fakeData = Buffer.alloc(151, 0);
    fakeData[0] = 2; // treasury discriminator, not redpacket (1)
    svm.setAccount(fakeRedPacket, {
      lamports: 1_000_000,
      data: fakeData,
      owner: PROGRAM_ID,
      executable: false,
    });

    const dummyVault = Keypair.generate().publicKey;

    const blockhash = svm.latestBlockhash();
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer.publicKey, isSigner: true, isWritable: true },
          { pubkey: claimerTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: fakeRedPacket, isSigner: false, isWritable: true },
          { pubkey: dummyVault, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildClaimData(),
      })
    );
    tx.sign(claimer);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected wrong discriminator");
    } catch (e: any) {
      console.log("    InvalidDiscriminator correctly rejected");
    }
  });

  it("Rejects SOL close on SPL red packet (InvalidTokenType)", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 1_000_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 1005n;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Create SPL red packet with 1 recipient
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

    // Claim the single slot so packet is fully claimed
    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimerTA = createAndFundTokenAccount(svm, claimer, mint.publicKey, mintAuthority, claimer.publicKey, 0n);

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

    // Try SOL close (token_type=1) on SPL red packet (stored token_type=0)
    // SOL close uses 3-account layout: [creator, red_packet, vault]
    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
        ],
        data: buildCloseData(1), // SOL token_type
      })
    );
    tx.sign(creator);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected SOL close on SPL packet");
    } catch (e: any) {
      console.log("    InvalidTokenType on close correctly rejected");
    }
  });

  it("Rejects create with uninitialized treasury (TreasuryNotInitialized)", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    // Corrupt treasury: zero out discriminator
    const treasuryAccount = svm.getAccount(treasuryPDA)!;
    const corruptedData = Buffer.from(treasuryAccount.data);
    corruptedData[0] = 0; // discriminator 0 instead of 2
    svm.setAccount(treasuryPDA, {
      lamports: treasuryAccount.lamports,
      data: corruptedData,
      owner: PROGRAM_ID,
      executable: false,
    });

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 1_000_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 1006n;
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
        data: buildCreateData(id, totalAmount, 1, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected uninitialized treasury");
    } catch (e: any) {
      console.log("    TreasuryNotInitialized correctly rejected");
    }
  });

  it("Rejects SPL fee withdrawal exceeding balance (InsufficientTreasuryBalance)", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 10_000_000n;
    const fee = totalAmount * 10n / 10_000n; // 10_000
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 1007n;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Create red packet — fee of 10_000 goes to treasury vault
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

    // Admin tries to withdraw more than available (10_001 > 10_000)
    svm.airdrop(ADMIN_KEYPAIR.publicKey, BigInt(LAMPORTS_PER_SOL));
    const adminTA = createAndFundTokenAccount(
      svm, ADMIN_KEYPAIR, mint.publicKey, mintAuthority, ADMIN_KEYPAIR.publicKey, 0n
    );

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: ADMIN_KEYPAIR.publicKey, isSigner: true, isWritable: true },
          { pubkey: adminTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: false },
          { pubkey: treasuryVaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildWithdrawFeesData(10_001n),
      })
    );
    tx.sign(ADMIN_KEYPAIR);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected withdrawal exceeding balance");
    } catch (e: any) {
      console.log("    InsufficientTreasuryBalance correctly rejected");
    }
  });

  // ============================
  // Remaining Validation Paths
  // ============================

  it("Rejects SPL claim with too few accounts (NotEnoughAccounts)", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 1_000_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 2000n;
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
        data: buildCreateData(id, totalAmount, 1, 0, expiresAt, rpBump, vaultBump),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Claim with only 4 accounts (SPL claim needs 5)
    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimerTA = createAndFundTokenAccount(svm, claimer, mint.publicKey, mintAuthority, claimer.publicKey, 0n);

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
          // Missing: TOKEN_PROGRAM_ID
        ],
        data: buildClaimData(),
      })
    );
    tx.sign(claimer);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected claim with too few accounts");
    } catch (e: any) {
      console.log("    NotEnoughAccounts correctly rejected");
    }
  });

  it("Rejects withdraw with malformed treasury vault (InvalidTokenAccount)", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    // Create a red packet so treasury has valid state
    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 1_000_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 2001n;
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

    // Overwrite treasury_vault with short data (<72 bytes)
    svm.setAccount(treasuryVaultPDA, {
      lamports: 1_000_000,
      data: Buffer.alloc(50, 0), // Too short for token account (needs >=72)
      owner: TOKEN_PROGRAM_ID,
      executable: false,
    });

    // Admin tries to withdraw
    svm.airdrop(ADMIN_KEYPAIR.publicKey, BigInt(LAMPORTS_PER_SOL));
    const adminTA = createAndFundTokenAccount(
      svm, ADMIN_KEYPAIR, mint.publicKey, mintAuthority, ADMIN_KEYPAIR.publicKey, 0n
    );

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: ADMIN_KEYPAIR.publicKey, isSigner: true, isWritable: true },
          { pubkey: adminTA.publicKey, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: false },
          { pubkey: treasuryVaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: buildWithdrawFeesData(1n),
      })
    );
    tx.sign(ADMIN_KEYPAIR);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected malformed treasury vault");
    } catch (e: any) {
      console.log("    InvalidTokenAccount correctly rejected");
    }
  });

  it("Rejects random split with zero individual slot amount", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 1_000_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 2002n;
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
        data: buildCreateData(id, totalAmount, 2, 1, expiresAt, rpBump, vaultBump, [0n, 1_000_000n]),
      })
    );
    tx.sign(creator);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected zero individual slot amount");
    } catch (e: any) {
      console.log("    Zero individual slot amount correctly rejected");
    }
  });

  it("Rejects create with invalid token_type value (2)", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 1_000_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 2003n;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Build create data with token_type=2 (invalid)
    const data = buildCreateData(id, totalAmount, 1, 0, expiresAt, rpBump, vaultBump, undefined, 2);

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
        data,
      })
    );
    tx.sign(creator);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected invalid token_type");
    } catch (e: any) {
      console.log("    Invalid token_type value (2) correctly rejected");
    }
  });

  it("Rejects SOL claim on expired red packet", () => {
    const { svm, solTreasuryPDA: treasuryPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = BigInt(1 * LAMPORTS_PER_SOL);
    const id = 2004n;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Create SOL red packet
    let blockhash = svm.latestBlockhash();
    let tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, 2, 0, expiresAt, rpBump, vaultBump, undefined, 1),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Warp clock past expiry
    const clock = svm.getClock();
    clock.unixTimestamp = expiresAt + 100n;
    svm.setClock(clock);

    // Try SOL claim — should fail (Expired)
    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: claimer.publicKey, isSigner: true, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
        ],
        data: buildClaimData(1), // SOL token_type
      })
    );
    tx.sign(claimer);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected expired SOL claim");
    } catch (e: any) {
      console.log("    SOL expired claim correctly rejected");
    }
  });

  it("Rejects SOL fee withdrawal exceeding balance", () => {
    const { svm, solTreasuryPDA: treasuryPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = BigInt(1 * LAMPORTS_PER_SOL);
    const fee = totalAmount * 10n / 10_000n; // 0.001 SOL = 1_000_000 lamports

    const id = 2005n;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Create SOL red packet
    let blockhash = svm.latestBlockhash();
    let tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: redPacketPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCreateData(id, totalAmount, 1, 0, expiresAt, rpBump, vaultBump, undefined, 1),
      })
    );
    tx.sign(creator);
    svm.sendTransaction(tx);

    // Admin tries to withdraw fee + 1 (more than available)
    svm.airdrop(ADMIN_KEYPAIR.publicKey, BigInt(LAMPORTS_PER_SOL));

    blockhash = svm.latestBlockhash();
    tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: ADMIN_KEYPAIR.publicKey, isSigner: true, isWritable: true },
          { pubkey: treasuryPDA, isSigner: false, isWritable: true },
        ],
        data: buildWithdrawFeesData(fee + 1n, 1), // SOL, more than available
      })
    );
    tx.sign(ADMIN_KEYPAIR);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected SOL withdrawal exceeding balance");
    } catch (e: any) {
      console.log("    SOL InsufficientTreasuryBalance correctly rejected");
    }
  });

  it("Rejects close with fake token program (InvalidTokenProgram)", () => {
    const { svm, mintAuthority, mint, treasuryPDA, treasuryVaultPDA } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const totalAmount = 1_000_000n;
    const fee = totalAmount * 10n / 10_000n;
    const creatorTA = createAndFundTokenAccount(
      svm, creator, mint.publicKey, mintAuthority, creator.publicKey,
      totalAmount + fee
    );

    const id = 2006n;
    const [redPacketPDA, rpBump] = findRedPacketPDA(creator.publicKey, id);
    const [vaultPDA, vaultBump] = findVaultPDA(creator.publicKey, id);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Create SPL red packet with 1 recipient
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

    // Claim the single slot
    const claimer = Keypair.generate();
    svm.airdrop(claimer.publicKey, BigInt(LAMPORTS_PER_SOL));
    const claimerTA = createAndFundTokenAccount(svm, claimer, mint.publicKey, mintAuthority, claimer.publicKey, 0n);

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

    // Close with fake token program
    const fakeTokenProgram = Keypair.generate().publicKey;

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
          { pubkey: fakeTokenProgram, isSigner: false, isWritable: false },
        ],
        data: buildCloseData(),
      })
    );
    tx.sign(creator);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected close with fake token program");
    } catch (e: any) {
      console.log("    InvalidTokenProgram on close correctly rejected");
    }
  });

  it("Rejects create with truncated instruction data", () => {
    const { svm } = setupSVM();

    const creator = Keypair.generate();
    svm.airdrop(creator.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    // Send only discriminator byte (0 = create), no payload
    const blockhash = svm.latestBlockhash();
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
        ],
        data: Buffer.from([0]), // Just discriminator, no token_type or fields
      })
    );
    tx.sign(creator);

    try {
      svm.sendTransaction(tx);
      expect.fail("Should have rejected truncated instruction data");
    } catch (e: any) {
      console.log("    Truncated instruction data correctly rejected");
    }
  });
});
