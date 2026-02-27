/**
 * Initialize SOL treasury on devnet.
 * Run: npx tsx init-treasury.ts
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";

const PROGRAM_ID = new PublicKey("CeAkHjhJzgrwbg8QWQ8tx6h5UxMZVKuGBeEDYczbc6Gz");
const TREASURY_SEED = Buffer.from("treasury");
const NATIVE_SOL_MINT = Buffer.alloc(32, 0xff);

const RPC_URL = "https://api.devnet.solana.com";

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  // Load wallet keypair
  const keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log(`Payer: ${payer.publicKey.toBase58()}`);

  // Derive SOL treasury PDA
  const [treasuryPDA, treasuryBump] = PublicKey.findProgramAddressSync(
    [TREASURY_SEED, NATIVE_SOL_MINT],
    PROGRAM_ID
  );
  console.log(`SOL Treasury PDA: ${treasuryPDA.toBase58()} (bump: ${treasuryBump})`);

  // Check if already initialized
  const existing = await connection.getAccountInfo(treasuryPDA);
  if (existing) {
    console.log("SOL treasury already initialized!");
    return;
  }

  // Build init_treasury instruction
  // Data: [disc=3][token_type=1][treasury_bump][vault_bump=0]
  const data = Buffer.from([3, 1, treasuryBump, 0]);

  // SOL init_treasury accounts: payer, treasury, system_program (3)
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: treasuryPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await connection.sendTransaction(tx, [payer]);
  console.log(`Transaction sent: ${sig}`);

  await connection.confirmTransaction(sig, "confirmed");
  console.log("SOL treasury initialized successfully!");

  // Verify
  const account = await connection.getAccountInfo(treasuryPDA);
  console.log(`Treasury account size: ${account?.data.length} bytes`);
  console.log(`Treasury owner: ${account?.owner.toBase58()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
