use solana_sdk::pubkey::Pubkey;
use std::sync::LazyLock;

pub const DEFAULT_RPC_URL: &str = "https://api.devnet.solana.com";
pub const DEFAULT_HOST: &str = "0.0.0.0";
pub const DEFAULT_PORT: &str = "3001";

#[allow(dead_code)]
pub const CHAIN_PARAM: &str = "_chain";

/// Red packet program ID
pub static PROGRAM_ID: LazyLock<Pubkey> = LazyLock::new(|| {
    "CeAkHjhJzgrwbg8QWQ8tx6h5UxMZVKuGBeEDYczbc6Gz"
        .parse()
        .expect("hardcoded program ID is valid")
});

/// PDA seeds
pub const SEED_PREFIX: &[u8] = b"redpacket";
pub const VAULT_SEED: &[u8] = b"vault";
pub const TREASURY_SEED: &[u8] = b"treasury";

/// Sentinel "mint" for native SOL treasury PDA derivation
pub const NATIVE_SOL_MINT: [u8; 32] = [0xFF; 32];

/// Token types
pub const TOKEN_TYPE_SOL: u8 = 1;

/// Split modes
pub const SPLIT_EVEN: u8 = 0;
pub const SPLIT_RANDOM: u8 = 1;

/// Fee: 0.1% = 10 basis points
pub const FEE_RATE_BPS: u64 = 10;
pub const FEE_DENOMINATOR: u64 = 10_000;

/// Max recipients per red packet
pub const MAX_RECIPIENTS: u8 = 20;

/// Icon URL for blink cards
pub const ICON_URL: &str = "https://redpackets.space/red-packet-icon.svg";
