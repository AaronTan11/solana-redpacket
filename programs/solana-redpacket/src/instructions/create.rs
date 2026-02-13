use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::{InitializeAccount3, Transfer};
use solana_program_log::log;

use crate::constants::{
    FEE_DENOMINATOR, FEE_RATE_BPS, ID, MAX_RECIPIENTS, SEED_PREFIX, SPLIT_EVEN, SPLIT_RANDOM,
    SYSTEM_PROGRAM_ID, TOKEN_ACCOUNT_SIZE, TOKEN_PROGRAM_ID, VAULT_SEED, redpacket_size,
};
use crate::error::RedPacketError;
use crate::state;

/// Instruction data layout:
/// [0]       discriminator (already consumed)
/// [0..8]    id: u64
/// [8..16]   total_amount: u64
/// [16]      num_recipients: u8
/// [17]      split_mode: u8
/// [18..26]  expires_at: i64
/// [26]      rp_bump: u8
/// [27]      vault_bump: u8
/// [28..]    amounts: [u64; N] (only for random mode)
pub fn process_create(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    // Parse accounts
    if accounts.len() < 9 {
        return Err(RedPacketError::NotEnoughAccounts.into());
    }
    let creator = &accounts[0];
    let creator_token_account = &accounts[1];
    let red_packet = &accounts[2];
    let vault = &accounts[3];
    let treasury = &accounts[4];
    let treasury_vault = &accounts[5];
    let mint = &accounts[6];
    let token_program = &accounts[7];
    let system_program = &accounts[8];

    // Validate creator is signer
    if !creator.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate program IDs
    if token_program.address() != &TOKEN_PROGRAM_ID {
        return Err(RedPacketError::InvalidTokenProgram.into());
    }
    if system_program.address() != &SYSTEM_PROGRAM_ID {
        return Err(RedPacketError::InvalidSystemProgram.into());
    }

    // Parse instruction data
    if data.len() < 28 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let id = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let total_amount = u64::from_le_bytes(data[8..16].try_into().unwrap());
    let num_recipients = data[16];
    let split_mode = data[17];
    let expires_at = i64::from_le_bytes(data[18..26].try_into().unwrap());
    let rp_bump = data[26];
    let vault_bump = data[27];

    // Validate inputs
    if total_amount == 0 {
        return Err(RedPacketError::InvalidAmount.into());
    }
    if num_recipients == 0 || num_recipients > MAX_RECIPIENTS {
        return Err(RedPacketError::InvalidRecipientCount.into());
    }
    if split_mode != SPLIT_EVEN && split_mode != SPLIT_RANDOM {
        return Err(RedPacketError::InvalidSplitMode.into());
    }

    // Validate expiry
    let clock = Clock::get()?;
    if expires_at <= clock.unix_timestamp {
        return Err(RedPacketError::Expired.into());
    }

    // Verify red_packet PDA address
    let id_bytes = id.to_le_bytes();
    let rp_bump_bytes = [rp_bump];
    let expected_rp = Address::create_program_address(
        &[SEED_PREFIX, creator.address().as_ref(), &id_bytes, &rp_bump_bytes],
        &ID,
    )
    .map_err(|_| ProgramError::from(RedPacketError::InvalidPDA))?;
    if red_packet.address() != &expected_rp {
        return Err(RedPacketError::InvalidPDA.into());
    }

    // Verify vault PDA address
    let vault_bump_bytes = [vault_bump];
    let expected_vault = Address::create_program_address(
        &[VAULT_SEED, creator.address().as_ref(), &id_bytes, &vault_bump_bytes],
        &ID,
    )
    .map_err(|_| ProgramError::from(RedPacketError::InvalidPDA))?;
    if vault.address() != &expected_vault {
        return Err(RedPacketError::InvalidPDA.into());
    }

    // Validate treasury
    state::validate_treasury(treasury, &ID)?;

    // Verify mint matches treasury's accepted mint
    {
        let tdata = treasury.try_borrow()?;
        if mint.address().as_ref() != state::get_treasury_mint(&tdata) {
            return Err(RedPacketError::InvalidMint.into());
        }
    }

    // Compute amounts
    let n = num_recipients as usize;
    let mut amounts = [0u64; 20];

    if split_mode == SPLIT_EVEN {
        let per_person = total_amount / num_recipients as u64;
        let remainder = total_amount % num_recipients as u64;
        for i in 0..n {
            amounts[i] = per_person;
        }
        amounts[n - 1] = per_person
            .checked_add(remainder)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    } else {
        let amounts_data = &data[28..];
        if amounts_data.len() < 8 * n {
            return Err(ProgramError::InvalidInstructionData);
        }
        let mut sum = 0u64;
        for i in 0..n {
            let offset = i * 8;
            let amount = u64::from_le_bytes(
                amounts_data[offset..offset + 8].try_into().unwrap(),
            );
            if amount == 0 {
                return Err(RedPacketError::InvalidAmount.into());
            }
            amounts[i] = amount;
            sum = sum.checked_add(amount).ok_or(ProgramError::ArithmeticOverflow)?;
        }
        if sum != total_amount {
            return Err(RedPacketError::AmountMismatch.into());
        }
    }

    // Compute fee
    let fee = core::cmp::max(
        1,
        total_amount
            .checked_mul(FEE_RATE_BPS)
            .ok_or(ProgramError::ArithmeticOverflow)?
            / FEE_DENOMINATOR,
    );

    // Create red_packet PDA
    let account_size = redpacket_size(num_recipients);
    let rent = Rent::get()?;
    let rp_rent = rent.try_minimum_balance(account_size)?;

    let rp_seeds = [
        Seed::from(SEED_PREFIX),
        Seed::from(creator.address().as_ref()),
        Seed::from(id_bytes.as_ref()),
        Seed::from(rp_bump_bytes.as_ref()),
    ];
    let rp_signer = [Signer::from(&rp_seeds)];

    CreateAccount {
        from: creator,
        to: red_packet,
        lamports: rp_rent,
        space: account_size as u64,
        owner: &ID,
    }
    .invoke_signed(&rp_signer)?;

    // Create vault token account
    let vault_rent = rent.try_minimum_balance(TOKEN_ACCOUNT_SIZE)?;

    let vault_seeds = [
        Seed::from(VAULT_SEED),
        Seed::from(creator.address().as_ref()),
        Seed::from(id_bytes.as_ref()),
        Seed::from(vault_bump_bytes.as_ref()),
    ];
    let vault_signer = [Signer::from(&vault_seeds)];

    CreateAccount {
        from: creator,
        to: vault,
        lamports: vault_rent,
        space: TOKEN_ACCOUNT_SIZE as u64,
        owner: &TOKEN_PROGRAM_ID,
    }
    .invoke_signed(&vault_signer)?;

    // Initialize vault as token account with red_packet PDA as owner
    InitializeAccount3 {
        account: vault,
        mint,
        owner: red_packet.address(),
    }
    .invoke()?;

    // Transfer total_amount USDC from creator to vault
    Transfer {
        from: creator_token_account,
        to: vault,
        authority: creator,
        amount: total_amount,
    }
    .invoke()?;

    // Transfer fee USDC from creator to treasury_vault
    Transfer {
        from: creator_token_account,
        to: treasury_vault,
        authority: creator,
        amount: fee,
    }
    .invoke()?;

    // Initialize red_packet PDA data
    {
        let mut pda_data = red_packet.try_borrow_mut()?;
        state::init_redpacket(
            &mut pda_data,
            creator.address().as_ref(),
            id,
            total_amount,
            num_recipients,
            split_mode,
            rp_bump,
            vault_bump,
            expires_at,
            &amounts[..n],
        );
    }

    log("Red packet created");
    Ok(())
}
