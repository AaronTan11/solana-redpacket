use solana_sdk::native_token::LAMPORTS_PER_SOL;
use solana_sdk::pubkey::Pubkey;

use crate::consts::*;
use crate::error::AppError;

// ============================================================
// PDA derivation
// ============================================================

pub fn find_red_packet_pda(creator: &Pubkey, id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_PREFIX, creator.as_ref(), &id.to_le_bytes()],
        &PROGRAM_ID,
    )
}

pub fn find_vault_pda(creator: &Pubkey, id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[VAULT_SEED, creator.as_ref(), &id.to_le_bytes()],
        &PROGRAM_ID,
    )
}

pub fn find_treasury_pda_sol() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[TREASURY_SEED, &NATIVE_SOL_MINT], &PROGRAM_ID)
}

// ============================================================
// Instruction data builders
// ============================================================

/// Build create instruction data.
/// Layout: [disc=0][token_type][id:u64][total_amount:u64][num_recipients:u8]
///         [split_mode:u8][expires_at:i64][rp_bump:u8][vault_bump:u8][amounts?:u64*N]
pub fn build_create_data(
    id: u64,
    total_amount: u64,
    num_recipients: u8,
    split_mode: u8,
    expires_at: i64,
    rp_bump: u8,
    vault_bump: u8,
    amounts: Option<&[u64]>,
) -> Vec<u8> {
    let base_len = 30; // 1+1+8+8+1+1+8+1+1
    let amounts_len = if split_mode == SPLIT_RANDOM {
        8 * num_recipients as usize
    } else {
        0
    };
    let mut data = vec![0u8; base_len + amounts_len];

    data[0] = 0; // discriminator
    data[1] = TOKEN_TYPE_SOL;
    data[2..10].copy_from_slice(&id.to_le_bytes());
    data[10..18].copy_from_slice(&total_amount.to_le_bytes());
    data[18] = num_recipients;
    data[19] = split_mode;
    data[20..28].copy_from_slice(&expires_at.to_le_bytes());
    data[28] = rp_bump;
    data[29] = vault_bump;

    if split_mode == SPLIT_RANDOM {
        if let Some(amounts) = amounts {
            for (i, &amt) in amounts.iter().enumerate() {
                let offset = 30 + i * 8;
                data[offset..offset + 8].copy_from_slice(&amt.to_le_bytes());
            }
        }
    }

    data
}

/// Build claim instruction data: [disc=1][token_type][slot_index]
pub fn build_claim_data(slot_index: u8) -> Vec<u8> {
    vec![1, TOKEN_TYPE_SOL, slot_index]
}

/// Build close instruction data: [disc=2][token_type]
pub fn build_close_data() -> Vec<u8> {
    vec![2, TOKEN_TYPE_SOL]
}

// ============================================================
// Account deserialization
// ============================================================

/// Red packet account layout (71 + 40*N bytes, discriminator=1)
#[derive(Debug)]
#[allow(dead_code)]
pub struct RedPacketAccount {
    pub creator: Pubkey,
    pub id: u64,
    pub total_amount: u64,
    pub remaining_amount: u64,
    pub num_recipients: u8,
    pub num_claimed: u8,
    pub split_mode: u8,
    pub bump: u8,
    pub vault_bump: u8,
    pub token_type: u8,
    pub expires_at: i64,
    pub amounts: Vec<u64>,
    pub claimers: Vec<Pubkey>,
}

pub fn decode_red_packet(data: &[u8]) -> Result<RedPacketAccount, AppError> {
    if data.len() < 71 {
        return Err(AppError::BadRequest("Red packet data too short".into()));
    }

    if data[0] != 1 {
        return Err(AppError::BadRequest("Invalid red packet discriminator".into()));
    }

    let creator = Pubkey::try_from(&data[1..33])
        .map_err(|_| AppError::BadRequest("Invalid creator pubkey".into()))?;
    let id = u64::from_le_bytes(data[33..41].try_into().unwrap());
    let total_amount = u64::from_le_bytes(data[41..49].try_into().unwrap());
    let remaining_amount = u64::from_le_bytes(data[49..57].try_into().unwrap());
    let num_recipients = data[57];
    let num_claimed = data[58];
    let split_mode = data[59];
    let bump = data[60];
    let vault_bump = data[61];
    let token_type = data[62];
    let expires_at = i64::from_le_bytes(data[63..71].try_into().unwrap());

    let mut amounts = Vec::with_capacity(num_recipients as usize);
    for i in 0..num_recipients as usize {
        let offset = 71 + i * 8;
        if offset + 8 > data.len() {
            break;
        }
        amounts.push(u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap()));
    }

    let claimers_offset = 71 + num_recipients as usize * 8;
    let mut claimers = Vec::with_capacity(num_recipients as usize);
    for i in 0..num_recipients as usize {
        let offset = claimers_offset + i * 32;
        if offset + 32 > data.len() {
            break;
        }
        if let Ok(pk) = Pubkey::try_from(&data[offset..offset + 32]) {
            claimers.push(pk);
        }
    }

    Ok(RedPacketAccount {
        creator,
        id,
        total_amount,
        remaining_amount,
        num_recipients,
        num_claimed,
        split_mode,
        bump,
        vault_bump,
        token_type,
        expires_at,
        amounts,
        claimers,
    })
}

// ============================================================
// Helpers
// ============================================================

pub fn compute_fee(total_amount: u64) -> u64 {
    let fee = total_amount * FEE_RATE_BPS / FEE_DENOMINATOR;
    if fee > 0 { fee } else { 1 }
}

pub fn sol_to_lamports(sol: f64) -> u64 {
    (sol * LAMPORTS_PER_SOL as f64).round() as u64
}

pub fn lamports_to_sol(lamports: u64) -> f64 {
    lamports as f64 / LAMPORTS_PER_SOL as f64
}

pub fn generate_random_split(total_amount: u64, num_recipients: usize) -> Vec<u64> {
    if num_recipients == 0 {
        return vec![];
    }
    if num_recipients == 1 {
        return vec![total_amount];
    }

    use rand::Rng;
    let mut rng = rand::thread_rng();

    let mut cuts: Vec<f64> = (0..num_recipients - 1).map(|_| rng.gen::<f64>()).collect();
    cuts.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let total = total_amount as f64;
    let mut amounts = Vec::with_capacity(num_recipients);
    let mut prev = 0.0;
    for &cut in &cuts {
        let raw = (cut * total).floor() as u64 - (prev * total).floor() as u64;
        amounts.push(if raw < 1 { 1 } else { raw });
        prev = cut;
    }
    amounts.push(total_amount.saturating_sub((prev * total).floor() as u64));

    // Adjust last slot to ensure exact sum
    let sum: u64 = amounts.iter().sum();
    if sum != total_amount {
        let last = amounts.last_mut().unwrap();
        if sum < total_amount {
            *last += total_amount - sum;
        } else {
            *last = last.saturating_sub(sum - total_amount);
        }
    }

    amounts
}

/// Get status string from red packet state
pub fn get_status(rp: &RedPacketAccount, now_unix: i64) -> &'static str {
    if rp.num_claimed >= rp.num_recipients {
        "fully_claimed"
    } else if now_unix >= rp.expires_at {
        "expired"
    } else {
        "active"
    }
}
