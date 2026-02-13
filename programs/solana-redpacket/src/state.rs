use pinocchio::{AccountView, Address};
use pinocchio::error::ProgramError;

use crate::constants::{REDPACKET_BASE_SIZE, REDPACKET_DISCRIMINATOR, TREASURY_DISCRIMINATOR, TREASURY_SIZE};
use crate::error::RedPacketError;

// ========================
// RedPacket account layout
// ========================
// 0       discriminator      u8      1
// 1       creator            [u8;32] 32
// 33      id                 u64     8
// 41      total_amount       u64     8
// 49      remaining_amount   u64     8
// 57      num_recipients     u8      1
// 58      num_claimed        u8      1
// 59      split_mode         u8      1
// 60      bump               u8      1
// 61      vault_bump         u8      1
// 62      expires_at         i64     8
// 70      amounts            [u64;N] 8*N
// 70+8N   claimers           [[u8;32];N] 32*N

const DISCRIMINATOR_OFFSET: usize = 0;
const CREATOR_OFFSET: usize = 1;
const ID_OFFSET: usize = 33;
const TOTAL_AMOUNT_OFFSET: usize = 41;
const REMAINING_AMOUNT_OFFSET: usize = 49;
const NUM_RECIPIENTS_OFFSET: usize = 57;
const NUM_CLAIMED_OFFSET: usize = 58;
const SPLIT_MODE_OFFSET: usize = 59;
const BUMP_OFFSET: usize = 60;
const VAULT_BUMP_OFFSET: usize = 61;
const EXPIRES_AT_OFFSET: usize = 62;
const AMOUNTS_OFFSET: usize = 70;

fn read_u64(data: &[u8], offset: usize) -> u64 {
    let bytes: [u8; 8] = data[offset..offset + 8].try_into().unwrap();
    u64::from_le_bytes(bytes)
}

fn read_i64(data: &[u8], offset: usize) -> i64 {
    let bytes: [u8; 8] = data[offset..offset + 8].try_into().unwrap();
    i64::from_le_bytes(bytes)
}

fn write_u64(data: &mut [u8], offset: usize, value: u64) {
    data[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn write_i64(data: &mut [u8], offset: usize, value: i64) {
    data[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn claimers_offset(num_recipients: u8) -> usize {
    AMOUNTS_OFFSET + 8 * num_recipients as usize
}

/// Validate that an account is a valid RedPacket
pub fn validate_redpacket(account: &AccountView, program_id: &Address) -> Result<(), ProgramError> {
    if !account.owned_by(program_id) {
        return Err(RedPacketError::InvalidAccountOwner.into());
    }
    let data = account.try_borrow()?;
    if data.len() < REDPACKET_BASE_SIZE {
        return Err(ProgramError::InvalidAccountData);
    }
    if data[DISCRIMINATOR_OFFSET] != REDPACKET_DISCRIMINATOR {
        return Err(RedPacketError::InvalidDiscriminator.into());
    }
    Ok(())
}

// === RedPacket Readers ===

pub fn get_creator(data: &[u8]) -> &[u8] {
    &data[CREATOR_OFFSET..CREATOR_OFFSET + 32]
}

pub fn get_id(data: &[u8]) -> u64 {
    read_u64(data, ID_OFFSET)
}

pub fn get_total_amount(data: &[u8]) -> u64 {
    read_u64(data, TOTAL_AMOUNT_OFFSET)
}

pub fn get_remaining_amount(data: &[u8]) -> u64 {
    read_u64(data, REMAINING_AMOUNT_OFFSET)
}

pub fn get_num_recipients(data: &[u8]) -> u8 {
    data[NUM_RECIPIENTS_OFFSET]
}

pub fn get_num_claimed(data: &[u8]) -> u8 {
    data[NUM_CLAIMED_OFFSET]
}

pub fn get_split_mode(data: &[u8]) -> u8 {
    data[SPLIT_MODE_OFFSET]
}

pub fn get_bump(data: &[u8]) -> u8 {
    data[BUMP_OFFSET]
}

pub fn get_vault_bump(data: &[u8]) -> u8 {
    data[VAULT_BUMP_OFFSET]
}

pub fn get_expires_at(data: &[u8]) -> i64 {
    read_i64(data, EXPIRES_AT_OFFSET)
}

pub fn get_amount_at(data: &[u8], index: u8) -> u64 {
    let offset = AMOUNTS_OFFSET + 8 * index as usize;
    read_u64(data, offset)
}

pub fn get_claimer_at(data: &[u8], num_recipients: u8, index: u8) -> &[u8] {
    let base = claimers_offset(num_recipients);
    let offset = base + 32 * index as usize;
    &data[offset..offset + 32]
}

// === RedPacket Writers ===

pub fn init_redpacket(
    data: &mut [u8],
    creator: &[u8],
    id: u64,
    total_amount: u64,
    num_recipients: u8,
    split_mode: u8,
    bump: u8,
    vault_bump: u8,
    expires_at: i64,
    amounts: &[u64],
) {
    data[DISCRIMINATOR_OFFSET] = REDPACKET_DISCRIMINATOR;
    data[CREATOR_OFFSET..CREATOR_OFFSET + 32].copy_from_slice(creator);
    write_u64(data, ID_OFFSET, id);
    write_u64(data, TOTAL_AMOUNT_OFFSET, total_amount);
    write_u64(data, REMAINING_AMOUNT_OFFSET, total_amount);
    data[NUM_RECIPIENTS_OFFSET] = num_recipients;
    data[NUM_CLAIMED_OFFSET] = 0;
    data[SPLIT_MODE_OFFSET] = split_mode;
    data[BUMP_OFFSET] = bump;
    data[VAULT_BUMP_OFFSET] = vault_bump;
    write_i64(data, EXPIRES_AT_OFFSET, expires_at);

    for (i, &amount) in amounts.iter().enumerate() {
        let offset = AMOUNTS_OFFSET + 8 * i;
        write_u64(data, offset, amount);
    }
}

pub fn set_remaining_amount(data: &mut [u8], amount: u64) {
    write_u64(data, REMAINING_AMOUNT_OFFSET, amount);
}

pub fn set_num_claimed(data: &mut [u8], count: u8) {
    data[NUM_CLAIMED_OFFSET] = count;
}

pub fn set_claimer_at(data: &mut [u8], num_recipients: u8, index: u8, claimer: &[u8]) {
    let base = claimers_offset(num_recipients);
    let offset = base + 32 * index as usize;
    data[offset..offset + 32].copy_from_slice(claimer);
}

pub fn has_claimed(data: &[u8], num_recipients: u8, num_claimed: u8, claimer: &[u8]) -> bool {
    for i in 0..num_claimed {
        if get_claimer_at(data, num_recipients, i) == claimer {
            return true;
        }
    }
    false
}

// ========================
// Treasury account layout
// ========================
// 0    discriminator   u8      1   (= 2)
// 1    bump            u8      1
// 2    vault_bump      u8      1
// 3    mint            [u8;32] 32

const TREASURY_DISCRIMINATOR_OFFSET: usize = 0;
const TREASURY_BUMP_OFFSET: usize = 1;
const TREASURY_VAULT_BUMP_OFFSET: usize = 2;
const TREASURY_MINT_OFFSET: usize = 3;

pub fn validate_treasury(account: &AccountView, program_id: &Address) -> Result<(), ProgramError> {
    if !account.owned_by(program_id) {
        return Err(RedPacketError::InvalidAccountOwner.into());
    }
    let data = account.try_borrow()?;
    if data.len() < TREASURY_SIZE {
        return Err(ProgramError::InvalidAccountData);
    }
    if data[TREASURY_DISCRIMINATOR_OFFSET] != TREASURY_DISCRIMINATOR {
        return Err(RedPacketError::TreasuryNotInitialized.into());
    }
    Ok(())
}

pub fn init_treasury(data: &mut [u8], bump: u8, vault_bump: u8, mint: &[u8]) {
    data[TREASURY_DISCRIMINATOR_OFFSET] = TREASURY_DISCRIMINATOR;
    data[TREASURY_BUMP_OFFSET] = bump;
    data[TREASURY_VAULT_BUMP_OFFSET] = vault_bump;
    data[TREASURY_MINT_OFFSET..TREASURY_MINT_OFFSET + 32].copy_from_slice(mint);
}

pub fn get_treasury_bump(data: &[u8]) -> u8 {
    data[TREASURY_BUMP_OFFSET]
}

pub fn get_treasury_vault_bump(data: &[u8]) -> u8 {
    data[TREASURY_VAULT_BUMP_OFFSET]
}

pub fn get_treasury_mint(data: &[u8]) -> &[u8] {
    &data[TREASURY_MINT_OFFSET..TREASURY_MINT_OFFSET + 32]
}
