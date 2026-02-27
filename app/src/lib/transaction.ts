import {
  type Instruction,
  type TransactionSigner,
  appendTransactionMessageInstruction,
  assertIsTransactionMessageWithSingleSendingSigner,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signAndSendTransactionMessageWithSigners,
} from "@solana/kit";
import { rpc } from "./rpc";

/**
 * Build, sign, and send a transaction with one or more instructions.
 * Returns the transaction signature bytes.
 */
export async function sendTransaction(
  signer: TransactionSigner,
  instructions: Instruction[]
): Promise<Uint8Array> {
  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let message: any = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m)
  );

  for (const ix of instructions) {
    message = appendTransactionMessageInstruction(ix, message);
  }

  assertIsTransactionMessageWithSingleSendingSigner(message);
  return signAndSendTransactionMessageWithSigners(message);
}
