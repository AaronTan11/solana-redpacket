import {
  type Address,
  type Instruction,
  address,
  getAddressEncoder,
  getAddressDecoder,
  getProgramDerivedAddress,
  AccountRole,
} from "@solana/kit";

// ============================================================
// Constants (mirrors programs/solana-redpacket/src/constants.rs)
// ============================================================

export const PROGRAM_ID = address(
  "CeAkHjhJzgrwbg8QWQ8tx6h5UxMZVKuGBeEDYczbc6Gz"
);
export const TOKEN_PROGRAM_ID = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
export const SYSTEM_PROGRAM_ID = address(
  "11111111111111111111111111111111"
);
export const ADMIN_ADDRESS = address(
  "HyBxuaafzKP6k4zkEDUp4LrZctS9mJVNUEEJBmp9cp7L"
);

const SEED_PREFIX = new TextEncoder().encode("redpacket");
const VAULT_SEED = new TextEncoder().encode("vault");
const TREASURY_SEED = new TextEncoder().encode("treasury");
const TREASURY_VAULT_SEED = new TextEncoder().encode("treasury_vault");

const NATIVE_SOL_MINT = new Uint8Array(32).fill(0xff);

export const TOKEN_TYPE_SPL = 0;
export const TOKEN_TYPE_SOL = 1;
export const SPLIT_EVEN = 0;
export const SPLIT_RANDOM = 1;
export const MAX_RECIPIENTS = 20;

const FEE_RATE_BPS = 10n;
const FEE_DENOMINATOR = 10_000n;

// ============================================================
// PDA derivation
// ============================================================

const addressEncoder = getAddressEncoder();

function u64LeBytes(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, value, true);
  return buf;
}

export async function findRedPacketPDA(
  creator: Address,
  id: bigint
) {
  return getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [SEED_PREFIX, addressEncoder.encode(creator), u64LeBytes(id)],
  });
}

export async function findVaultPDA(
  creator: Address,
  id: bigint
) {
  return getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [VAULT_SEED, addressEncoder.encode(creator), u64LeBytes(id)],
  });
}

export async function findTreasuryPDA(
  mint: Address | "SOL"
) {
  const mintBytes =
    mint === "SOL" ? NATIVE_SOL_MINT : addressEncoder.encode(mint);
  return getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [TREASURY_SEED, mintBytes],
  });
}

export async function findTreasuryVaultPDA(
  mint: Address
) {
  return getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [TREASURY_VAULT_SEED, addressEncoder.encode(mint)],
  });
}

// ============================================================
// Fee computation
// ============================================================

export function computeFee(totalAmount: bigint): bigint {
  const fee = (totalAmount * FEE_RATE_BPS) / FEE_DENOMINATOR;
  return fee > 0n ? fee : 1n;
}

// ============================================================
// Instruction builders
// ============================================================

// Disc 0: create
// Data: [disc=0][token_type:u8][id:u64][total_amount:u64][num_recipients:u8]
//       [split_mode:u8][expires_at:i64][rp_bump:u8][vault_bump:u8][amounts?:u64*N]
export interface CreateParams {
  tokenType: number;
  id: bigint;
  totalAmount: bigint;
  numRecipients: number;
  splitMode: number;
  expiresAt: bigint;
  rpBump: number;
  vaultBump: number;
  amounts?: bigint[]; // required for SPLIT_RANDOM
  // Accounts
  creator: Address;
  creatorTokenAccount?: Address; // SPL only
  redPacket: Address;
  vault: Address;
  treasury: Address;
  treasuryVault?: Address; // SPL only
  mint?: Address; // SPL only
}

export function buildCreateInstruction(p: CreateParams): Instruction {
  const isSol = p.tokenType === TOKEN_TYPE_SOL;

  // Build data
  const baseLen = 1 + 1 + 8 + 8 + 1 + 1 + 8 + 1 + 1; // 30 bytes
  const amountsLen =
    p.splitMode === SPLIT_RANDOM ? 8 * p.numRecipients : 0;
  const data = new Uint8Array(baseLen + amountsLen);
  const view = new DataView(data.buffer);

  let offset = 0;
  data[offset++] = 0; // discriminator
  data[offset++] = p.tokenType;
  view.setBigUint64(offset, p.id, true);
  offset += 8;
  view.setBigUint64(offset, p.totalAmount, true);
  offset += 8;
  data[offset++] = p.numRecipients;
  data[offset++] = p.splitMode;
  view.setBigInt64(offset, p.expiresAt, true);
  offset += 8;
  data[offset++] = p.rpBump;
  data[offset++] = p.vaultBump;

  if (p.splitMode === SPLIT_RANDOM && p.amounts) {
    for (const amt of p.amounts) {
      view.setBigUint64(offset, amt, true);
      offset += 8;
    }
  }

  if (isSol) {
    // SOL: creator, red_packet, vault, treasury, system_program (5)
    return {
      programAddress: PROGRAM_ID,
      accounts: [
        { address: p.creator, role: AccountRole.WRITABLE_SIGNER },
        { address: p.redPacket, role: AccountRole.WRITABLE },
        { address: p.vault, role: AccountRole.WRITABLE },
        { address: p.treasury, role: AccountRole.WRITABLE },
        { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
      ],
      data,
    };
  }

  // SPL: creator, creator_ta, red_packet, vault, treasury, treasury_vault, mint, token_program, system_program (9)
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: p.creator, role: AccountRole.WRITABLE_SIGNER },
      { address: p.creatorTokenAccount!, role: AccountRole.WRITABLE },
      { address: p.redPacket, role: AccountRole.WRITABLE },
      { address: p.vault, role: AccountRole.WRITABLE },
      { address: p.treasury, role: AccountRole.READONLY },
      { address: p.treasuryVault!, role: AccountRole.WRITABLE },
      { address: p.mint!, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data,
  };
}

// Disc 1: claim
// Data: [disc=1][token_type:u8][slot_index:u8]
export interface ClaimParams {
  tokenType: number;
  slotIndex: number;
  // Accounts
  claimer: Address;
  claimerTokenAccount?: Address; // SPL only
  redPacket: Address;
  vault: Address;
}

export function buildClaimInstruction(p: ClaimParams): Instruction {
  const data = new Uint8Array([1, p.tokenType, p.slotIndex]);
  const isSol = p.tokenType === TOKEN_TYPE_SOL;

  if (isSol) {
    // SOL: claimer, red_packet, vault (3)
    return {
      programAddress: PROGRAM_ID,
      accounts: [
        { address: p.claimer, role: AccountRole.WRITABLE_SIGNER },
        { address: p.redPacket, role: AccountRole.WRITABLE },
        { address: p.vault, role: AccountRole.WRITABLE },
      ],
      data,
    };
  }

  // SPL: claimer, claimer_ta, red_packet, vault, token_program (5)
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: p.claimer, role: AccountRole.WRITABLE_SIGNER },
      { address: p.claimerTokenAccount!, role: AccountRole.WRITABLE },
      { address: p.redPacket, role: AccountRole.WRITABLE },
      { address: p.vault, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data,
  };
}

// Disc 2: close
// Data: [disc=2][token_type:u8]
export interface CloseParams {
  tokenType: number;
  // Accounts
  creator: Address;
  creatorTokenAccount?: Address; // SPL only
  redPacket: Address;
  vault: Address;
}

export function buildCloseInstruction(p: CloseParams): Instruction {
  const data = new Uint8Array([2, p.tokenType]);
  const isSol = p.tokenType === TOKEN_TYPE_SOL;

  if (isSol) {
    // SOL: creator, red_packet, vault (3)
    return {
      programAddress: PROGRAM_ID,
      accounts: [
        { address: p.creator, role: AccountRole.WRITABLE_SIGNER },
        { address: p.redPacket, role: AccountRole.WRITABLE },
        { address: p.vault, role: AccountRole.WRITABLE },
      ],
      data,
    };
  }

  // SPL: creator, creator_ta, red_packet, vault, token_program (5)
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: p.creator, role: AccountRole.WRITABLE_SIGNER },
      { address: p.creatorTokenAccount!, role: AccountRole.WRITABLE },
      { address: p.redPacket, role: AccountRole.WRITABLE },
      { address: p.vault, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data,
  };
}

// Disc 3: init_treasury
// Data: [disc=3][token_type:u8][treasury_bump:u8][vault_bump:u8]
export interface InitTreasuryParams {
  tokenType: number;
  treasuryBump: number;
  vaultBump: number;
  // Accounts
  payer: Address;
  treasury: Address;
  treasuryVault?: Address; // SPL only
  mint?: Address; // SPL only
}

export function buildInitTreasuryInstruction(
  p: InitTreasuryParams
): Instruction {
  const data = new Uint8Array([3, p.tokenType, p.treasuryBump, p.vaultBump]);
  const isSol = p.tokenType === TOKEN_TYPE_SOL;

  if (isSol) {
    // SOL: payer, treasury, system_program (3)
    return {
      programAddress: PROGRAM_ID,
      accounts: [
        { address: p.payer, role: AccountRole.WRITABLE_SIGNER },
        { address: p.treasury, role: AccountRole.WRITABLE },
        { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
      ],
      data,
    };
  }

  // SPL: payer, treasury, treasury_vault, mint, token_program, system_program (6)
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: p.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: p.treasury, role: AccountRole.WRITABLE },
      { address: p.treasuryVault!, role: AccountRole.WRITABLE },
      { address: p.mint!, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data,
  };
}

// Disc 4: withdraw_fees
// Data: [disc=4][token_type:u8][amount:u64]
export interface WithdrawFeesParams {
  tokenType: number;
  amount: bigint; // 0 = withdraw all
  // Accounts
  admin: Address;
  adminTokenAccount?: Address; // SPL only
  treasury: Address;
  treasuryVault?: Address; // SPL only
}

export function buildWithdrawFeesInstruction(
  p: WithdrawFeesParams
): Instruction {
  const data = new Uint8Array(1 + 1 + 8);
  const view = new DataView(data.buffer);
  data[0] = 4; // discriminator
  data[1] = p.tokenType;
  view.setBigUint64(2, p.amount, true);

  const isSol = p.tokenType === TOKEN_TYPE_SOL;

  if (isSol) {
    // SOL: admin, treasury (2)
    return {
      programAddress: PROGRAM_ID,
      accounts: [
        { address: p.admin, role: AccountRole.WRITABLE_SIGNER },
        { address: p.treasury, role: AccountRole.WRITABLE },
      ],
      data,
    };
  }

  // SPL: admin, admin_ta, treasury, treasury_vault, token_program (5)
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: p.admin, role: AccountRole.WRITABLE_SIGNER },
      { address: p.adminTokenAccount!, role: AccountRole.WRITABLE },
      { address: p.treasury, role: AccountRole.READONLY },
      { address: p.treasuryVault!, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data,
  };
}

// ============================================================
// Account deserialization
// ============================================================

const addressDecoder = getAddressDecoder();

export interface RedPacketAccount {
  discriminator: number;
  creator: Address;
  id: bigint;
  totalAmount: bigint;
  remainingAmount: bigint;
  numRecipients: number;
  numClaimed: number;
  splitMode: number;
  bump: number;
  vaultBump: number;
  tokenType: number;
  expiresAt: bigint;
  amounts: bigint[];
  claimers: Address[];
}

export function decodeRedPacket(data: Uint8Array): RedPacketAccount {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const discriminator = data[0];
  const creator = addressDecoder.decode(data.slice(1, 33));
  const id = view.getBigUint64(33, true);
  const totalAmount = view.getBigUint64(41, true);
  const remainingAmount = view.getBigUint64(49, true);
  const numRecipients = data[57];
  const numClaimed = data[58];
  const splitMode = data[59];
  const bump = data[60];
  const vaultBump = data[61];
  const tokenType = data[62];
  const expiresAt = view.getBigInt64(63, true);

  const amounts: bigint[] = [];
  for (let i = 0; i < numRecipients; i++) {
    amounts.push(view.getBigUint64(71 + i * 8, true));
  }

  const claimersOffset = 71 + numRecipients * 8;
  const claimers: Address[] = [];
  for (let i = 0; i < numRecipients; i++) {
    const start = claimersOffset + i * 32;
    const bytes = data.slice(start, start + 32);
    // Only include non-zero addresses (claimed slots)
    if (bytes.some((b) => b !== 0)) {
      claimers.push(addressDecoder.decode(bytes));
    }
  }

  return {
    discriminator,
    creator,
    id,
    totalAmount,
    remainingAmount,
    numRecipients,
    numClaimed,
    splitMode,
    bump,
    vaultBump,
    tokenType,
    expiresAt,
    amounts,
    claimers,
  };
}

export interface TreasuryAccount {
  discriminator: number;
  bump: number;
  vaultBump: number;
  mint: Address;
  solFeesCollected: bigint;
}

export function decodeTreasury(data: Uint8Array): TreasuryAccount {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  return {
    discriminator: data[0],
    bump: data[1],
    vaultBump: data[2],
    mint: addressDecoder.decode(data.slice(3, 35)),
    solFeesCollected: view.getBigUint64(35, true),
  };
}

// ============================================================
// Helpers
// ============================================================

/** Generate random split amounts that sum to totalAmount */
export function generateRandomSplit(
  totalAmount: bigint,
  numRecipients: number
): bigint[] {
  if (numRecipients <= 0) return [];
  if (numRecipients === 1) return [totalAmount];

  // Generate random cut points, then compute differences
  const cuts: number[] = [];
  for (let i = 0; i < numRecipients - 1; i++) {
    cuts.push(Math.random());
  }
  cuts.sort((a, b) => a - b);

  const totalNum = Number(totalAmount);
  const rawAmounts: number[] = [];
  let prev = 0;
  for (const cut of cuts) {
    rawAmounts.push(Math.floor(cut * totalNum) - Math.floor(prev * totalNum));
    prev = cut;
  }
  rawAmounts.push(totalNum - Math.floor(prev * totalNum));

  // Ensure no zero amounts (minimum 1 per slot)
  const amounts = rawAmounts.map((a) => (a < 1 ? 1 : a));
  // Adjust last slot to make sum exact
  const sum = amounts.reduce((s, a) => s + a, 0);
  amounts[amounts.length - 1] += totalNum - sum;

  return amounts.map((a) => BigInt(a));
}

/** Red packet status derived from on-chain data */
export type RedPacketStatus = "active" | "expired" | "fully_claimed";

export function getRedPacketStatus(
  rp: RedPacketAccount,
  nowUnix: number
): RedPacketStatus {
  if (rp.numClaimed >= rp.numRecipients) return "fully_claimed";
  if (nowUnix >= Number(rp.expiresAt)) return "expired";
  return "active";
}

/** Format lamports/micro-units to human-readable string */
export function formatAmount(
  amount: bigint,
  tokenType: number,
  decimals = 9
): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  if (tokenType === TOKEN_TYPE_SOL) {
    return fracStr ? `${whole}.${fracStr} SOL` : `${whole} SOL`;
  }
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

export const BLINKS_BASE_URL =
  import.meta.env.VITE_BLINKS_URL || "http://46.62.206.161";
