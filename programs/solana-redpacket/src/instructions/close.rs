use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_token::instructions::{CloseAccount, Transfer};
use solana_program_log::log;

use crate::constants::{ID, SEED_PREFIX, TOKEN_PROGRAM_ID, VAULT_SEED};
use crate::error::RedPacketError;
use crate::state;

/// Instruction data layout:
/// [0] discriminator (already consumed)
/// No additional data needed
pub fn process_close(accounts: &[AccountView], _data: &[u8]) -> ProgramResult {
    if accounts.len() < 5 {
        return Err(RedPacketError::NotEnoughAccounts.into());
    }
    let creator = &accounts[0];
    let creator_token_account = &accounts[1];
    let red_packet = &accounts[2];
    let vault = &accounts[3];
    let token_program = &accounts[4];

    // Validate creator is signer
    if !creator.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate token program
    if token_program.address() != &TOKEN_PROGRAM_ID {
        return Err(RedPacketError::InvalidTokenProgram.into());
    }

    // Validate red packet account
    state::validate_redpacket(red_packet, &ID)?;

    // Read state and check authorization
    let (bump, creator_bytes, id_bytes, remaining_amount) = {
        let data = red_packet.try_borrow()?;

        // Verify creator matches
        if state::get_creator(&data) != creator.address().as_ref() {
            return Err(RedPacketError::Unauthorized.into());
        }

        let num_recipients = state::get_num_recipients(&data);
        let num_claimed = state::get_num_claimed(&data);
        let expires_at = state::get_expires_at(&data);
        let bump = state::get_bump(&data);
        let vault_bump = state::get_vault_bump(&data);
        let remaining_amount = state::get_remaining_amount(&data);

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

        // Must be either fully claimed or expired
        let all_claimed = num_claimed >= num_recipients;
        let clock = Clock::get()?;
        let is_expired = clock.unix_timestamp >= expires_at;

        if !all_claimed && !is_expired {
            return Err(RedPacketError::NotExpiredOrFull.into());
        }

        (bump, creator_bytes, id_bytes, remaining_amount)
    }; // drop immutable borrow

    // Build red_packet PDA signer
    let bump_bytes = [bump];
    let rp_seeds = [
        Seed::from(SEED_PREFIX),
        Seed::from(creator_bytes.as_ref()),
        Seed::from(id_bytes.as_ref()),
        Seed::from(bump_bytes.as_ref()),
    ];
    let rp_signer = [Signer::from(&rp_seeds)];

    // Transfer remaining USDC from vault to creator's token account
    if remaining_amount > 0 {
        Transfer {
            from: vault,
            to: creator_token_account,
            authority: red_packet,
            amount: remaining_amount,
        }
        .invoke_signed(&rp_signer)?;
    }

    // Close vault token account (SOL rent goes to creator)
    CloseAccount {
        account: vault,
        destination: creator,
        authority: red_packet,
    }
    .invoke_signed(&rp_signer)?;

    // Drain red_packet PDA lamports to creator
    let remaining_lamports = red_packet.lamports();
    creator.set_lamports(
        creator
            .lamports()
            .checked_add(remaining_lamports)
            .ok_or(ProgramError::ArithmeticOverflow)?,
    );
    red_packet.set_lamports(0);

    // Zero out account data
    {
        let mut data = red_packet.try_borrow_mut()?;
        for byte in data.iter_mut() {
            *byte = 0;
        }
    }

    log("Closed");
    Ok(())
}
