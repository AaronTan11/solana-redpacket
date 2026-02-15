use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_token::instructions::Transfer;
use crate::log;
use crate::constants::{ID, SEED_PREFIX, TOKEN_PROGRAM_ID, TOKEN_TYPE_SOL, VAULT_SEED};
use crate::error::RedPacketError;
use crate::state;

/// Instruction data layout:
/// [0] discriminator (already consumed)
/// [0] token_type: u8 (0=SPL, 1=SOL)
pub fn process_claim(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    // Parse token type
    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let token_type = data[0];
    state::validate_token_type(token_type)?;

    let is_sol = token_type == TOKEN_TYPE_SOL;

    // Parse accounts based on token type
    let min_accounts = if is_sol { 3 } else { 5 };
    if accounts.len() < min_accounts {
        return Err(RedPacketError::NotEnoughAccounts.into());
    }

    let claimer;
    let red_packet;
    let vault;

    if is_sol {
        claimer = &accounts[0];
        red_packet = &accounts[1];
        vault = &accounts[2];
    } else {
        claimer = &accounts[0];
        // accounts[1] = claimer_token_account (used later)
        red_packet = &accounts[2];
        vault = &accounts[3];
        // accounts[4] = token_program (used later)

        // Validate token program
        if accounts[4].address() != &TOKEN_PROGRAM_ID {
            return Err(RedPacketError::InvalidTokenProgram.into());
        }
    }

    // Validate claimer is signer
    if !claimer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate red packet account
    state::validate_redpacket(red_packet, &ID)?;

    // Read state, perform checks, and verify vault PDA
    let (amount, num_recipients, num_claimed, bump, creator_bytes, id_bytes) = {
        let rp_data = red_packet.try_borrow()?;

        // Verify token_type matches stored state
        if state::get_token_type(&rp_data) != token_type {
            return Err(RedPacketError::InvalidTokenType.into());
        }

        let num_recipients = state::get_num_recipients(&rp_data);
        let num_claimed = state::get_num_claimed(&rp_data);
        let expires_at = state::get_expires_at(&rp_data);
        let bump = state::get_bump(&rp_data);
        let vault_bump = state::get_vault_bump(&rp_data);

        // Get creator and id for PDA verification
        let mut creator_bytes = [0u8; 32];
        creator_bytes.copy_from_slice(state::get_creator(&rp_data));
        let id = state::get_id(&rp_data);
        let id_bytes = id.to_le_bytes();

        // Verify vault PDA
        let vault_bump_bytes = [vault_bump];
        let expected_vault = Address::create_program_address(
            &[VAULT_SEED, &creator_bytes, &id_bytes, &vault_bump_bytes],
            &ID,
        )
        .map_err(|_| ProgramError::from(RedPacketError::InvalidPDA))?;
        if vault.address() != &expected_vault {
            return Err(RedPacketError::InvalidPDA.into());
        }

        // Check not expired
        let clock = Clock::get()?;
        if clock.unix_timestamp >= expires_at {
            return Err(RedPacketError::Expired.into());
        }

        // Check not full
        if num_claimed >= num_recipients {
            return Err(RedPacketError::RedPacketFull.into());
        }

        // Check not already claimed
        if state::has_claimed(&rp_data, num_recipients, num_claimed, claimer.address().as_ref()) {
            return Err(RedPacketError::AlreadyClaimed.into());
        }

        let amount = state::get_amount_at(&rp_data, num_claimed);

        (amount, num_recipients, num_claimed, bump, creator_bytes, id_bytes)
    }; // drop immutable borrow

    // Transfer based on token type
    if is_sol {
        // Verify vault is owned by our program (defense-in-depth)
        if !vault.owned_by(&ID) {
            return Err(RedPacketError::InvalidAccountOwner.into());
        }

        // Direct lamport transfer: vault -> claimer
        vault.set_lamports(
            vault.lamports()
                .checked_sub(amount)
                .ok_or(ProgramError::ArithmeticOverflow)?,
        );
        claimer.set_lamports(
            claimer.lamports()
                .checked_add(amount)
                .ok_or(ProgramError::ArithmeticOverflow)?,
        );
    } else {
        // SPL Transfer: vault -> claimer_token_account (red_packet PDA signs)
        let bump_bytes = [bump];
        let rp_seeds = [
            Seed::from(SEED_PREFIX),
            Seed::from(creator_bytes.as_ref()),
            Seed::from(id_bytes.as_ref()),
            Seed::from(bump_bytes.as_ref()),
        ];
        let rp_signer = [Signer::from(&rp_seeds)];

        Transfer {
            from: vault,
            to: &accounts[1], // claimer_token_account
            authority: red_packet,
            amount,
        }
        .invoke_signed(&rp_signer)?;
    }

    // Update state
    {
        let mut rp_data = red_packet.try_borrow_mut()?;

        state::set_claimer_at(
            &mut rp_data,
            num_recipients,
            num_claimed,
            claimer.address().as_ref(),
        );

        state::set_num_claimed(&mut rp_data, num_claimed + 1);
        let remaining = state::get_remaining_amount(&rp_data);
        state::set_remaining_amount(
            &mut rp_data,
            remaining
                .checked_sub(amount)
                .ok_or(ProgramError::ArithmeticOverflow)?,
        );
    }

    log("Claimed");
    Ok(())
}
