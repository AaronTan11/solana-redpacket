use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_token::instructions::Transfer;
use solana_program_log::log;

use crate::constants::{ID, SEED_PREFIX, TOKEN_PROGRAM_ID, VAULT_SEED};
use crate::error::RedPacketError;
use crate::state;

/// Instruction data layout:
/// [0] discriminator (already consumed)
/// No additional data needed
pub fn process_claim(accounts: &[AccountView], _data: &[u8]) -> ProgramResult {
    if accounts.len() < 5 {
        return Err(RedPacketError::NotEnoughAccounts.into());
    }
    let claimer = &accounts[0];
    let claimer_token_account = &accounts[1];
    let red_packet = &accounts[2];
    let vault = &accounts[3];
    let token_program = &accounts[4];

    // Validate claimer is signer
    if !claimer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate token program
    if token_program.address() != &TOKEN_PROGRAM_ID {
        return Err(RedPacketError::InvalidTokenProgram.into());
    }

    // Validate red packet account
    state::validate_redpacket(red_packet, &ID)?;

    // Read state, perform checks, and verify vault PDA
    let (amount, num_recipients, num_claimed, bump, _vault_bump, creator_bytes, id_bytes) = {
        let data = red_packet.try_borrow()?;

        let num_recipients = state::get_num_recipients(&data);
        let num_claimed = state::get_num_claimed(&data);
        let expires_at = state::get_expires_at(&data);
        let bump = state::get_bump(&data);
        let vault_bump = state::get_vault_bump(&data);

        // Get creator and id for PDA verification
        let mut creator_bytes = [0u8; 32];
        creator_bytes.copy_from_slice(state::get_creator(&data));
        let id = state::get_id(&data);
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
        if state::has_claimed(&data, num_recipients, num_claimed, claimer.address().as_ref()) {
            return Err(RedPacketError::AlreadyClaimed.into());
        }

        let amount = state::get_amount_at(&data, num_claimed);

        (amount, num_recipients, num_claimed, bump, vault_bump, creator_bytes, id_bytes)
    }; // drop immutable borrow

    // Transfer USDC from vault to claimer's token account (red_packet PDA signs)
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
        to: claimer_token_account,
        authority: red_packet,
        amount,
    }
    .invoke_signed(&rp_signer)?;

    // Update state
    {
        let mut data = red_packet.try_borrow_mut()?;

        state::set_claimer_at(
            &mut data,
            num_recipients,
            num_claimed,
            claimer.address().as_ref(),
        );

        state::set_num_claimed(&mut data, num_claimed + 1);
        let remaining = state::get_remaining_amount(&data);
        state::set_remaining_amount(
            &mut data,
            remaining
                .checked_sub(amount)
                .ok_or(ProgramError::ArithmeticOverflow)?,
        );
    }

    log("Claimed");
    Ok(())
}
