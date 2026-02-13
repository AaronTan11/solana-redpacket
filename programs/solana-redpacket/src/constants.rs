use pinocchio::Address;

pub const ID: Address = Address::new_from_array(five8_const::decode_32_const(
    "EXBnnaHEVPy7QR9eaFFtPvQ5QLDhzzb8sVaXtDVbbPbg",
));

/// Seeds
pub const SEED_PREFIX: &[u8] = b"redpacket";
pub const VAULT_SEED: &[u8] = b"vault";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const TREASURY_VAULT_SEED: &[u8] = b"treasury_vault";

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
pub const REDPACKET_BASE_SIZE: usize = 70;
pub const PER_RECIPIENT_SIZE: usize = 40;
pub const TREASURY_SIZE: usize = 35; // discriminator(1) + bump(1) + vault_bump(1) + mint(32)
pub const TOKEN_ACCOUNT_SIZE: usize = 165;

pub const fn redpacket_size(num_recipients: u8) -> usize {
    REDPACKET_BASE_SIZE + PER_RECIPIENT_SIZE * num_recipients as usize
}

/// Admin authority for fee withdrawal (placeholder — replace with real pubkey)
pub const ADMIN: Address = Address::new_from_array(five8_const::decode_32_const(
    "ADMNqGCquVC3xPkhttaUSCMFhSmu3rBVsRRBKjLFMbhg",
));

/// Well-known program IDs
pub const SYSTEM_PROGRAM_ID: Address = Address::new_from_array([0; 32]);
pub const TOKEN_PROGRAM_ID: Address = Address::new_from_array(five8_const::decode_32_const(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
));
