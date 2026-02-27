/**
 * Comprehensive E2E test suite for the blinks server against devnet.
 * Prerequisite: blinks server running on localhost:3001, program deployed, SOL treasury initialized.
 *
 * Run: npx tsx e2e-test.ts
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";

const BLINKS_URL = "http://localhost:3001";
const RPC_URL = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("CeAkHjhJzgrwbg8QWQ8tx6h5UxMZVKuGBeEDYczbc6Gz");
const SEED_PREFIX = Buffer.from("redpacket");
const VAULT_SEED = Buffer.from("vault");
const TREASURY_SEED = Buffer.from("treasury");
const NATIVE_SOL_MINT = Buffer.alloc(32, 0xff);

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  FAIL: ${msg}`);
    failed++;
  } else {
    console.log(`  PASS: ${msg}`);
    passed++;
  }
}

async function signAndSend(
  connection: Connection,
  b64Tx: string,
  signers: Keypair[]
): Promise<string> {
  const tx = Transaction.from(Buffer.from(b64Tx, "base64"));
  tx.sign(...signers);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function blinksGet(path: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    const resp = await fetch(`${BLINKS_URL}${path}`);
    const data = await resp.json();
    if (data.message?.includes("not found") && i < retries - 1) {
      console.log(`  Retrying GET ${path} (attempt ${i + 2}/${retries})...`);
      await sleep(3000);
      continue;
    }
    return { ...data, _status: resp.status };
  }
}

async function blinksPost(path: string, account: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    const resp = await fetch(`${BLINKS_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account }),
    });
    const data = await resp.json();
    if (data.message?.includes("not found") && i < retries - 1) {
      console.log(`  Retrying POST ${path} (attempt ${i + 2}/${retries})...`);
      await sleep(3000);
      continue;
    }
    return { ...data, _status: resp.status };
  }
}

// ============================================================
// PDA Derivation
// ============================================================

function findRedPacketPDA(creator: PublicKey, id: bigint): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(id);
  return PublicKey.findProgramAddressSync(
    [SEED_PREFIX, creator.toBuffer(), idBuf],
    PROGRAM_ID
  );
}

function findVaultPDA(creator: PublicKey, id: bigint): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(id);
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, creator.toBuffer(), idBuf],
    PROGRAM_ID
  );
}

function findTreasuryPDASol(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TREASURY_SEED, NATIVE_SOL_MINT],
    PROGRAM_ID
  );
}

// ============================================================
// Manual instruction builder (for expiry test)
// ============================================================

function buildCreateInstruction(
  creator: PublicKey,
  id: bigint,
  totalLamports: bigint,
  numRecipients: number,
  splitMode: number,
  expiresAt: bigint,
  rpBump: number,
  vaultBump: number,
): TransactionInstruction {
  // Data: [disc=0][token_type=1][id:8][total_amount:8][num_recipients:1]
  //       [split_mode:1][expires_at:8][rp_bump:1][vault_bump:1]
  const data = Buffer.alloc(30);
  data[0] = 0; // disc
  data[1] = 1; // TOKEN_TYPE_SOL
  data.writeBigUInt64LE(id, 2);
  data.writeBigUInt64LE(totalLamports, 10);
  data[18] = numRecipients;
  data[19] = splitMode;
  data.writeBigInt64LE(expiresAt, 20);
  data[28] = rpBump;
  data[29] = vaultBump;

  const [rpAddr] = findRedPacketPDA(creator, id);
  const [vaultAddr] = findVaultPDA(creator, id);
  const [treasuryAddr] = findTreasuryPDASol();

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: rpAddr, isSigner: false, isWritable: true },
      { pubkey: vaultAddr, isSigner: false, isWritable: true },
      { pubkey: treasuryAddr, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function extractId(message: string): bigint {
  const match = message.match(/id=(\d+)/);
  if (!match) throw new Error("No id in message");
  return BigInt(match[1]);
}

// ============================================================
// TEST SCENARIOS
// ============================================================

async function test1_EvenSplit2Recipients(
  connection: Connection,
  creator: Keypair,
  claimer2: Keypair,
) {
  console.log("\n=== TEST 1: Even Split — 2 Recipients ===");

  const createResp = await blinksPost(
    `/api/actions/create?amount=0.01&recipients=2&split_mode=0&expiry_hours=1`,
    creator.publicKey.toBase58()
  );
  assert(!!createResp.transaction, "Create returns transaction");
  assert(!!createResp.message, "Create returns message");

  const redPacketId = extractId(createResp.message);
  console.log(`  Red Packet ID: ${redPacketId}`);

  const createSig = await signAndSend(connection, createResp.transaction, [creator]);
  console.log(`  Create tx: ${createSig}`);

  // Verify on-chain
  const [rpAddr] = findRedPacketPDA(creator.publicKey, redPacketId);
  const rpAccount = await connection.getAccountInfo(rpAddr);
  assert(rpAccount !== null, "Red packet account exists on chain");
  assert(rpAccount!.owner.equals(PROGRAM_ID), "Red packet owned by program");

  const rpData = rpAccount!.data;
  assert(rpData[0] === 1, "Discriminator is 1");
  assert(rpData[57] === 2, "num_recipients = 2");
  assert(rpData[58] === 0, "num_claimed = 0");
  assert(rpData[59] === 0, "split_mode = 0 (even)");

  await sleep(3000);

  // Claim metadata
  const claimMeta = await blinksGet(
    `/api/actions/claim?creator=${creator.publicKey.toBase58()}&id=${redPacketId}`
  );
  assert(claimMeta.title === "Red Packet", "Claim metadata title correct");
  assert(claimMeta.description?.includes("0/2 claimed") ?? false, "Shows 0/2 claimed");
  assert(!claimMeta.disabled, "Not disabled");

  // Claim #1 (creator)
  const claim1Resp = await blinksPost(
    `/api/actions/claim?creator=${creator.publicKey.toBase58()}&id=${redPacketId}`,
    creator.publicKey.toBase58()
  );
  assert(!!claim1Resp.transaction, "Claim #1 returns transaction");
  const claim1Sig = await signAndSend(connection, claim1Resp.transaction, [creator]);
  console.log(`  Claim #1 tx: ${claim1Sig}`);

  const rpAfter1 = await connection.getAccountInfo(rpAddr);
  assert(rpAfter1!.data[58] === 1, "num_claimed = 1 after first claim");

  await sleep(2000);

  // Claim #2 (claimer2)
  const claim2Resp = await blinksPost(
    `/api/actions/claim?creator=${creator.publicKey.toBase58()}&id=${redPacketId}`,
    claimer2.publicKey.toBase58()
  );
  assert(!!claim2Resp.transaction, "Claim #2 returns transaction");
  const claim2Sig = await signAndSend(connection, claim2Resp.transaction, [claimer2]);
  console.log(`  Claim #2 tx: ${claim2Sig}`);

  const rpAfter2 = await connection.getAccountInfo(rpAddr);
  assert(rpAfter2!.data[58] === 2, "num_claimed = 2 (fully claimed)");

  await sleep(2000);

  // Metadata after full claim
  const claimMeta2 = await blinksGet(
    `/api/actions/claim?creator=${creator.publicKey.toBase58()}&id=${redPacketId}`
  );
  assert(claimMeta2.disabled === true, "Disabled after full claim");
  assert(claimMeta2.description?.includes("2/2 claimed") ?? false, "Shows 2/2 claimed");

  // Close
  const closeResp = await blinksPost(
    `/api/actions/close?creator=${creator.publicKey.toBase58()}&id=${redPacketId}`,
    creator.publicKey.toBase58()
  );
  assert(!!closeResp.transaction, "Close returns transaction");
  const closeSig = await signAndSend(connection, closeResp.transaction, [creator]);
  console.log(`  Close tx: ${closeSig}`);

  await sleep(2000);
  const rpClosed = await connection.getAccountInfo(rpAddr);
  assert(rpClosed === null, "Red packet account closed");

  return redPacketId;
}

async function test2_RandomSplit2Recipients(
  connection: Connection,
  creator: Keypair,
  claimer2: Keypair,
) {
  console.log("\n=== TEST 2: Random Split — 2 Recipients ===");

  const createResp = await blinksPost(
    `/api/actions/create?amount=0.01&recipients=2&split_mode=1&expiry_hours=1`,
    creator.publicKey.toBase58()
  );
  assert(!!createResp.transaction, "Create returns transaction");

  const redPacketId = extractId(createResp.message);
  console.log(`  Red Packet ID: ${redPacketId}`);

  const createSig = await signAndSend(connection, createResp.transaction, [creator]);
  console.log(`  Create tx: ${createSig}`);

  await sleep(3000);

  // Verify on-chain: split_mode = 1, amounts sum to total
  const [rpAddr] = findRedPacketPDA(creator.publicKey, redPacketId);
  const rpAccount = await connection.getAccountInfo(rpAddr);
  assert(rpAccount !== null, "Red packet exists");
  const rpData = rpAccount!.data;
  assert(rpData[59] === 1, "split_mode = 1 (random)");

  // Read amounts at offset 71
  const amt0 = rpData.readBigUInt64LE(71);
  const amt1 = rpData.readBigUInt64LE(79);
  const totalAmount = rpData.readBigUInt64LE(41);
  assert(amt0 + amt1 === totalAmount, `Amounts sum to total (${amt0} + ${amt1} = ${totalAmount})`);
  assert(amt0 > 0n && amt1 > 0n, "Both amounts > 0");
  console.log(`  Random amounts: ${amt0}, ${amt1} (total: ${totalAmount})`);

  // Claim #1 (creator)
  const balBefore1 = await connection.getBalance(creator.publicKey);
  const claim1Resp = await blinksPost(
    `/api/actions/claim?creator=${creator.publicKey.toBase58()}&id=${redPacketId}`,
    creator.publicKey.toBase58()
  );
  assert(!!claim1Resp.transaction, "Claim #1 returns transaction");
  await signAndSend(connection, claim1Resp.transaction, [creator]);
  const balAfter1 = await connection.getBalance(creator.publicKey);
  const gain1 = BigInt(balAfter1 - balBefore1);
  // Gain should be close to amt0 (minus tx fee ~5000 lamports)
  console.log(`  Claim #1 balance change: ${gain1} lamports (expected ~${amt0})`);

  await sleep(2000);

  // Claim #2 (claimer2)
  const balBefore2 = await connection.getBalance(claimer2.publicKey);
  const claim2Resp = await blinksPost(
    `/api/actions/claim?creator=${creator.publicKey.toBase58()}&id=${redPacketId}`,
    claimer2.publicKey.toBase58()
  );
  assert(!!claim2Resp.transaction, "Claim #2 returns transaction");
  await signAndSend(connection, claim2Resp.transaction, [claimer2]);
  const balAfter2 = await connection.getBalance(claimer2.publicKey);
  const gain2 = BigInt(balAfter2 - balBefore2);
  console.log(`  Claim #2 balance change: ${gain2} lamports (expected ~${amt1})`);

  await sleep(2000);

  // Close
  const closeResp = await blinksPost(
    `/api/actions/close?creator=${creator.publicKey.toBase58()}&id=${redPacketId}`,
    creator.publicKey.toBase58()
  );
  assert(!!closeResp.transaction, "Close returns transaction");
  await signAndSend(connection, closeResp.transaction, [creator]);

  await sleep(2000);
  const rpClosed = await connection.getAccountInfo(rpAddr);
  assert(rpClosed === null, "Red packet closed");
}

async function test3_SingleRecipient(
  connection: Connection,
  creator: Keypair,
) {
  console.log("\n=== TEST 3: Single Recipient ===");

  const createResp = await blinksPost(
    `/api/actions/create?amount=0.005&recipients=1&split_mode=0&expiry_hours=1`,
    creator.publicKey.toBase58()
  );
  assert(!!createResp.transaction, "Create returns transaction");

  const redPacketId = extractId(createResp.message);
  const createSig = await signAndSend(connection, createResp.transaction, [creator]);
  console.log(`  Create tx: ${createSig}`);

  await sleep(3000);

  const [rpAddr] = findRedPacketPDA(creator.publicKey, redPacketId);
  const rpAccount = await connection.getAccountInfo(rpAddr);
  assert(rpAccount!.data[57] === 1, "num_recipients = 1");

  // Claim
  const claimResp = await blinksPost(
    `/api/actions/claim?creator=${creator.publicKey.toBase58()}&id=${redPacketId}`,
    creator.publicKey.toBase58()
  );
  assert(!!claimResp.transaction, "Claim returns transaction");
  await signAndSend(connection, claimResp.transaction, [creator]);

  await sleep(2000);

  // Metadata: should be disabled
  const meta = await blinksGet(
    `/api/actions/claim?creator=${creator.publicKey.toBase58()}&id=${redPacketId}`
  );
  assert(meta.disabled === true, "Disabled after 1/1 claimed");
  assert(meta.description?.includes("1/1 claimed") ?? false, "Shows 1/1 claimed");

  // Close
  const closeResp = await blinksPost(
    `/api/actions/close?creator=${creator.publicKey.toBase58()}&id=${redPacketId}`,
    creator.publicKey.toBase58()
  );
  assert(!!closeResp.transaction, "Close returns transaction");
  await signAndSend(connection, closeResp.transaction, [creator]);

  await sleep(2000);
  const rpClosed = await connection.getAccountInfo(rpAddr);
  assert(rpClosed === null, "Red packet closed");
}

async function test4_MaxRecipients20(
  connection: Connection,
  creator: Keypair,
) {
  console.log("\n=== TEST 4: Max Recipients (20) ===");

  const createResp = await blinksPost(
    `/api/actions/create?amount=0.02&recipients=20&split_mode=0&expiry_hours=1`,
    creator.publicKey.toBase58()
  );
  assert(!!createResp.transaction, "Create returns transaction");

  const redPacketId = extractId(createResp.message);
  const createSig = await signAndSend(connection, createResp.transaction, [creator]);
  console.log(`  Create tx: ${createSig}`);

  await sleep(3000);

  const [rpAddr] = findRedPacketPDA(creator.publicKey, redPacketId);
  const rpAccount = await connection.getAccountInfo(rpAddr);
  assert(rpAccount !== null, "Red packet exists");
  assert(rpAccount!.data.length === 71 + 40 * 20, `Account size = ${71 + 40 * 20} (got ${rpAccount!.data.length})`);
  assert(rpAccount!.data[57] === 20, "num_recipients = 20");

  // Claim 1 slot to verify it works
  const claimResp = await blinksPost(
    `/api/actions/claim?creator=${creator.publicKey.toBase58()}&id=${redPacketId}`,
    creator.publicKey.toBase58()
  );
  assert(!!claimResp.transaction, "Claim returns transaction");
  await signAndSend(connection, claimResp.transaction, [creator]);

  await sleep(2000);

  const meta = await blinksGet(
    `/api/actions/claim?creator=${creator.publicKey.toBase58()}&id=${redPacketId}`
  );
  assert(meta.description?.includes("1/20 claimed") ?? false, `Shows 1/20 claimed (got: ${meta.description})`);
  assert(!meta.disabled, "Still active (19 slots remaining)");

  // Don't close — leave it open (will expire naturally).
  // Return the id so test8 can use it for "close active" test
  return redPacketId;
}

async function test5_ExpiredPacketClose(
  connection: Connection,
  creator: Keypair,
  claimer2: Keypair,
) {
  console.log("\n=== TEST 5: Expired Packet — Close with Partial Claims ===");

  // Build create instruction manually with short expiry (15 seconds)
  const id = BigInt(Date.now());
  const totalLamports = BigInt(0.01 * LAMPORTS_PER_SOL);
  const numRecipients = 3;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = BigInt(now + 15); // 15 seconds from now

  const [rpAddr, rpBump] = findRedPacketPDA(creator.publicKey, id);
  const [vaultAddr, vaultBump] = findVaultPDA(creator.publicKey, id);

  const ix = buildCreateInstruction(
    creator.publicKey,
    id,
    totalLamports,
    numRecipients,
    0, // even split
    expiresAt,
    rpBump,
    vaultBump,
  );

  const blockhash = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    recentBlockhash: blockhash.blockhash,
    feePayer: creator.publicKey,
  }).add(ix);
  tx.sign(creator);
  const createSig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(createSig, "confirmed");
  console.log(`  Create tx (manual, 15s expiry): ${createSig}`);

  await sleep(3000);

  // Verify created
  const rpAccount = await connection.getAccountInfo(rpAddr);
  assert(rpAccount !== null, "Red packet exists");
  assert(rpAccount!.data[57] === 3, "num_recipients = 3");

  // Claim #1 immediately (before expiry)
  const claim1Resp = await blinksPost(
    `/api/actions/claim?creator=${creator.publicKey.toBase58()}&id=${id}`,
    creator.publicKey.toBase58()
  );
  assert(!!claim1Resp.transaction, "Claim #1 returns transaction (before expiry)");
  await signAndSend(connection, claim1Resp.transaction, [creator]);
  console.log(`  Claim #1 sent (before expiry)`);

  const rpAfterClaim = await connection.getAccountInfo(rpAddr);
  assert(rpAfterClaim!.data[58] === 1, "num_claimed = 1");

  // Wait for expiry
  const waitTime = Number(expiresAt) - Math.floor(Date.now() / 1000) + 3;
  console.log(`  Waiting ${waitTime}s for expiry...`);
  await sleep(Math.max(waitTime, 1) * 1000);

  // Attempt claim #2 after expiry — blinks should reject
  const claim2Resp = await blinksPost(
    `/api/actions/claim?creator=${creator.publicKey.toBase58()}&id=${id}`,
    claimer2.publicKey.toBase58()
  );
  assert(!claim2Resp.transaction, "Claim #2 rejected (expired, no transaction)");
  assert(claim2Resp.message?.toLowerCase().includes("expired") ?? false, `Error mentions expired (got: ${claim2Resp.message})`);

  // Close expired packet — should succeed
  const balBefore = await connection.getBalance(creator.publicKey);
  const closeResp = await blinksPost(
    `/api/actions/close?creator=${creator.publicKey.toBase58()}&id=${id}`,
    creator.publicKey.toBase58()
  );
  assert(!!closeResp.transaction, "Close returns transaction (expired)");
  await signAndSend(connection, closeResp.transaction, [creator]);
  const balAfter = await connection.getBalance(creator.publicKey);
  const reclaimed = balAfter - balBefore;
  console.log(`  Reclaimed ${reclaimed / LAMPORTS_PER_SOL} SOL (2/3 unclaimed + rent)`);
  assert(reclaimed > 0, "Creator reclaimed SOL from expired packet");

  await sleep(2000);
  const rpClosed = await connection.getAccountInfo(rpAddr);
  assert(rpClosed === null, "Red packet closed after expiry");
}

async function test6_DoubleClaimRejection(
  connection: Connection,
  creator: Keypair,
) {
  console.log("\n=== TEST 6: Double Claim Rejection ===");

  const createResp = await blinksPost(
    `/api/actions/create?amount=0.01&recipients=2&split_mode=0&expiry_hours=1`,
    creator.publicKey.toBase58()
  );
  const redPacketId = extractId(createResp.message);
  await signAndSend(connection, createResp.transaction, [creator]);

  await sleep(3000);

  // Claim #1
  const claim1Resp = await blinksPost(
    `/api/actions/claim?creator=${creator.publicKey.toBase58()}&id=${redPacketId}`,
    creator.publicKey.toBase58()
  );
  assert(!!claim1Resp.transaction, "Claim #1 returns transaction");
  await signAndSend(connection, claim1Resp.transaction, [creator]);

  await sleep(2000);

  // Claim #2 with same account — blinks server will return a tx (it doesn't check duplicates),
  // but the on-chain program should reject it with AlreadyClaimed.
  const claim2Resp = await blinksPost(
    `/api/actions/claim?creator=${creator.publicKey.toBase58()}&id=${redPacketId}`,
    creator.publicKey.toBase58()
  );

  if (claim2Resp.transaction) {
    // The blinks server returned a tx — try sending it, expect on-chain failure
    try {
      await signAndSend(connection, claim2Resp.transaction, [creator]);
      assert(false, "Double claim should have failed on-chain");
    } catch (e: any) {
      assert(true, `Double claim rejected on-chain: ${e.message?.substring(0, 80)}`);
    }
  } else {
    // Blinks server rejected it (even better)
    assert(true, "Double claim rejected by blinks server");
  }

  // Verify state unchanged
  const [rpAddr] = findRedPacketPDA(creator.publicKey, redPacketId);
  const rpAccount = await connection.getAccountInfo(rpAddr);
  assert(rpAccount!.data[58] === 1, "num_claimed still 1 after double claim attempt");

  // Cleanup: we leave this one open (2 recipients, only 1 claimed)
  // test8 will test close-active; or it will expire naturally
  return redPacketId;
}

async function test7_CloseByNonCreator(
  connection: Connection,
  creator: Keypair,
  claimer2: Keypair,
) {
  console.log("\n=== TEST 7: Close by Non-Creator ===");

  const createResp = await blinksPost(
    `/api/actions/create?amount=0.005&recipients=1&split_mode=0&expiry_hours=1`,
    creator.publicKey.toBase58()
  );
  const redPacketId = extractId(createResp.message);
  await signAndSend(connection, createResp.transaction, [creator]);

  await sleep(3000);

  // Claim to make it closeable (1/1)
  const claimResp = await blinksPost(
    `/api/actions/claim?creator=${creator.publicKey.toBase58()}&id=${redPacketId}`,
    creator.publicKey.toBase58()
  );
  await signAndSend(connection, claimResp.transaction, [creator]);

  await sleep(2000);

  // Try close with claimer2 (not the creator)
  const closeResp = await blinksPost(
    `/api/actions/close?creator=${creator.publicKey.toBase58()}&id=${redPacketId}`,
    claimer2.publicKey.toBase58()
  );
  assert(!closeResp.transaction, "Close by non-creator returns no transaction");
  assert(closeResp._status === 400, `HTTP 400 for non-creator close (got: ${closeResp._status})`);
  assert(closeResp.message?.includes("creator") ?? false, `Error mentions creator (got: ${closeResp.message})`);

  // Proper close by creator
  const closeResp2 = await blinksPost(
    `/api/actions/close?creator=${creator.publicKey.toBase58()}&id=${redPacketId}`,
    creator.publicKey.toBase58()
  );
  assert(!!closeResp2.transaction, "Close by actual creator succeeds");
  await signAndSend(connection, closeResp2.transaction, [creator]);
}

async function test8_CloseActivePacket(
  connection: Connection,
  creator: Keypair,
  activePacketId: bigint,
) {
  console.log("\n=== TEST 8: Close Active Packet ===");

  // Use the packet from test4 (20 recipients, only 1 claimed, not expired)
  const closeResp = await blinksPost(
    `/api/actions/close?creator=${creator.publicKey.toBase58()}&id=${activePacketId}`,
    creator.publicKey.toBase58()
  );
  assert(!closeResp.transaction, "Close active packet returns no transaction");
  assert(closeResp._status === 400, `HTTP 400 for close-active (got: ${closeResp._status})`);
  assert(
    closeResp.message?.toLowerCase().includes("active") ?? false,
    `Error mentions active (got: ${closeResp.message})`
  );
}

async function test9_FeeAccumulation(
  connection: Connection,
  treasuryBalBefore: number,
) {
  console.log("\n=== TEST 9: Fee Accumulation ===");

  const [treasuryAddr] = findTreasuryPDASol();
  const treasuryBalAfter = await connection.getBalance(treasuryAddr);

  const feesCollected = treasuryBalAfter - treasuryBalBefore;
  console.log(`  Treasury balance before: ${treasuryBalBefore / LAMPORTS_PER_SOL} SOL`);
  console.log(`  Treasury balance after: ${treasuryBalAfter / LAMPORTS_PER_SOL} SOL`);
  console.log(`  Fees collected: ${feesCollected} lamports`);

  // We created multiple red packets (0.01, 0.01, 0.005, 0.02, 0.01, 0.01, 0.005 SOL)
  // Fee per packet = max(1, amount * 10 / 10000)
  // 0.01 SOL = 10_000_000 lamports → fee = 10_000
  // 0.005 SOL = 5_000_000 lamports → fee = 5_000
  // 0.02 SOL = 20_000_000 lamports → fee = 20_000
  // Expected minimum: ~60_000 lamports from our creates
  assert(feesCollected > 0, "Treasury collected fees from creates");
}

async function test10_CreateMetadata() {
  console.log("\n=== TEST 10: Create Metadata (GET) ===");

  const resp = await blinksGet("/api/actions/create");
  assert(resp.title === "Create Red Packet", `Title correct (got: ${resp.title})`);
  assert(!!resp.description, "Description present");
  assert(!!resp.icon, "Icon present");
  assert(!!resp.links?.actions?.length, "Has linked actions");

  const action = resp.links.actions[0];
  assert(!!action.href, "Action has href");
  assert(action.href.includes("{amount}"), "Href contains amount parameter");
  assert(action.href.includes("{recipients}"), "Href contains recipients parameter");
  assert(action.href.includes("{split_mode}"), "Href contains split_mode parameter");
  assert(action.href.includes("{expiry_hours}"), "Href contains expiry_hours parameter");

  const params = action.parameters || [];
  const paramNames = params.map((p: any) => p.name);
  assert(paramNames.includes("amount"), "Has amount parameter");
  assert(paramNames.includes("recipients"), "Has recipients parameter");
  assert(paramNames.includes("split_mode"), "Has split_mode parameter");
  assert(paramNames.includes("expiry_hours"), "Has expiry_hours parameter");
}

async function test11_NonexistentRedPacket(
  creator: Keypair,
) {
  console.log("\n=== TEST 11: Nonexistent Red Packet ===");

  const fakeId = 99999;

  // GET claim metadata for nonexistent packet
  const claimMeta = await blinksGet(
    `/api/actions/claim?creator=${creator.publicKey.toBase58()}&id=${fakeId}`
  );
  assert(claimMeta._status === 404, `Claim GET returns 404 (got: ${claimMeta._status})`);
  assert(claimMeta.message?.includes("not found") ?? false, `Error says not found (got: ${claimMeta.message})`);

  // POST claim for nonexistent packet
  const claimPost = await blinksPost(
    `/api/actions/claim?creator=${creator.publicKey.toBase58()}&id=${fakeId}`,
    creator.publicKey.toBase58()
  );
  assert(!claimPost.transaction, "No transaction for nonexistent claim");
  assert(claimPost._status === 404, `Claim POST returns 404 (got: ${claimPost._status})`);

  // GET close metadata for nonexistent packet
  const closeMeta = await blinksGet(
    `/api/actions/close?creator=${creator.publicKey.toBase58()}&id=${fakeId}`
  );
  assert(closeMeta._status === 404, `Close GET returns 404 (got: ${closeMeta._status})`);

  // POST close for nonexistent packet
  const closePost = await blinksPost(
    `/api/actions/close?creator=${creator.publicKey.toBase58()}&id=${fakeId}`,
    creator.publicKey.toBase58()
  );
  assert(!closePost.transaction, "No transaction for nonexistent close");
  assert(closePost._status === 404, `Close POST returns 404 (got: ${closePost._status})`);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  // Load creator keypair
  const keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const creator = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log(`Creator: ${creator.publicKey.toBase58()}`);

  // Generate test keypairs
  const claimer2 = Keypair.generate();
  const claimer3 = Keypair.generate();
  console.log(`Claimer #2: ${claimer2.publicKey.toBase58()}`);
  console.log(`Claimer #3: ${claimer3.publicKey.toBase58()}`);

  // Fund claimers
  console.log("\n--- Funding test accounts ---");
  for (const [name, kp] of [["claimer2", claimer2], ["claimer3", claimer3]] as const) {
    try {
      const airdropSig = await connection.requestAirdrop(
        kp.publicKey,
        0.05 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdropSig, "confirmed");
      console.log(`  ${name} airdrop confirmed`);
    } catch {
      console.log(`  ${name} airdrop failed, transferring from creator...`);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: creator.publicKey,
          toPubkey: kp.publicKey,
          lamports: 0.05 * LAMPORTS_PER_SOL,
        })
      );
      const sig = await connection.sendTransaction(tx, [creator]);
      await connection.confirmTransaction(sig, "confirmed");
      console.log(`  ${name} funded via transfer`);
    }
  }

  // Record treasury balance before tests
  const [treasuryAddr] = findTreasuryPDASol();
  const treasuryBalBefore = await connection.getBalance(treasuryAddr);
  console.log(`\nTreasury balance before: ${treasuryBalBefore / LAMPORTS_PER_SOL} SOL`);

  // Run tests sequentially
  try {
    await test1_EvenSplit2Recipients(connection, creator, claimer2);
  } catch (e: any) {
    console.error(`  TEST 1 CRASHED: ${e.message}`);
    failed++;
  }

  try {
    await test2_RandomSplit2Recipients(connection, creator, claimer2);
  } catch (e: any) {
    console.error(`  TEST 2 CRASHED: ${e.message}`);
    failed++;
  }

  try {
    await test3_SingleRecipient(connection, creator);
  } catch (e: any) {
    console.error(`  TEST 3 CRASHED: ${e.message}`);
    failed++;
  }

  let test4PacketId: bigint | undefined;
  try {
    test4PacketId = await test4_MaxRecipients20(connection, creator);
  } catch (e: any) {
    console.error(`  TEST 4 CRASHED: ${e.message}`);
    failed++;
  }

  try {
    await test5_ExpiredPacketClose(connection, creator, claimer2);
  } catch (e: any) {
    console.error(`  TEST 5 CRASHED: ${e.message}`);
    failed++;
  }

  try {
    await test6_DoubleClaimRejection(connection, creator);
  } catch (e: any) {
    console.error(`  TEST 6 CRASHED: ${e.message}`);
    failed++;
  }

  try {
    await test7_CloseByNonCreator(connection, creator, claimer2);
  } catch (e: any) {
    console.error(`  TEST 7 CRASHED: ${e.message}`);
    failed++;
  }

  if (test4PacketId !== undefined) {
    try {
      await test8_CloseActivePacket(connection, creator, test4PacketId);
    } catch (e: any) {
      console.error(`  TEST 8 CRASHED: ${e.message}`);
      failed++;
    }
  } else {
    console.log("\n=== TEST 8: SKIPPED (test 4 failed) ===");
    failed++;
  }

  try {
    await test9_FeeAccumulation(connection, treasuryBalBefore);
  } catch (e: any) {
    console.error(`  TEST 9 CRASHED: ${e.message}`);
    failed++;
  }

  try {
    await test10_CreateMetadata();
  } catch (e: any) {
    console.error(`  TEST 10 CRASHED: ${e.message}`);
    failed++;
  }

  try {
    await test11_NonexistentRedPacket(creator);
  } catch (e: any) {
    console.error(`  TEST 11 CRASHED: ${e.message}`);
    failed++;
  }

  // ====================================================
  // SUMMARY
  // ====================================================
  console.log("\n" + "=".repeat(50));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(50));

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\nFATAL ERROR:", e);
  process.exit(1);
});
