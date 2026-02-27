use pinocchio::Address;

pub const ID: Address = Address::new_from_array(five8_const::decode_32_const(
    "CeAkHjhJzgrwbg8QWQ8tx6h5UxMZVKuGBeEDYczbc6Gz",
));

/// Seeds
pub const SEED_PREFIX: &[u8] = b"redpacket";
pub const VAULT_SEED: &[u8] = b"vault";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const TREASURY_VAULT_SEED: &[u8] = b"treasury_vault";

/// Token types
pub const TOKEN_TYPE_SPL: u8 = 0;
pub const TOKEN_TYPE_SOL: u8 = 1;

/// Limits
pub const MAX_RECIPIENTS: u8 = 20;

/// Discriminators
pub const REDPACKET_DISCRIMINATOR: u8 = 1;
pub const TREASURY_DISCRIMINATOR: u8 = 2;

/// Split modes
pub const SPLIT_EVEN: u8 = 0;
pub const SPLIT_RANDOM: u8 = 1;

/// Fee: 0.1% = 10 basis points
pub const FEE_RATE_BPS: u64 = 10;
pub const FEE_DENOMINATOR: u64 = 10_000;

/// Account sizes
pub const REDPACKET_BASE_SIZE: usize = 71;
pub const PER_RECIPIENT_SIZE: usize = 40;
pub const TREASURY_SIZE: usize = 43; // discriminator(1) + bump(1) + vault_bump(1) + mint(32) + sol_fees(8)
pub const TOKEN_ACCOUNT_SIZE: usize = 165;

pub const fn redpacket_size(num_recipients: u8) -> usize {
    REDPACKET_BASE_SIZE + PER_RECIPIENT_SIZE * num_recipients as usize
}

/// Admin authority for fee withdrawal
pub const ADMIN: Address = Address::new_from_array(five8_const::decode_32_const(
    "HyBxuaafzKP6k4zkEDUp4LrZctS9mJVNUEEJBmp9cp7L",
));

/// Sentinel "mint" for native SOL treasury PDA derivation (not a real mint)
pub const NATIVE_SOL_MINT: [u8; 32] = [0xFF; 32];

/// Rent-exempt minimum: (data_len + 128) * 3480 * 2
/// Based on DEFAULT_LAMPORTS_PER_BYTE_YEAR = 3480, exemption_threshold = 2.0
/// These values have been stable since Solana genesis.
#[inline(always)]
pub const fn rent_exempt(data_len: usize) -> u64 {
    ((data_len as u64) + 128) * 2 * 3480
}

/// Well-known program IDs
pub const SYSTEM_PROGRAM_ID: Address = Address::new_from_array([0; 32]);
pub const TOKEN_PROGRAM_ID: Address = Address::new_from_array(five8_const::decode_32_const(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
));
