use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_token::instructions::{CloseAccount, Transfer};
use crate::log;
use crate::constants::{ID, SEED_PREFIX, TOKEN_PROGRAM_ID, TOKEN_TYPE_SOL, VAULT_SEED};
use crate::error::RedPacketError;
use crate::state;

/// Instruction data layout:
/// [0] discriminator (already consumed)
/// [0] token_type: u8 (0=SPL, 1=SOL)
pub fn process_close(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
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

    let creator;
    let red_packet;
    let vault;

    if is_sol {
        creator = &accounts[0];
        red_packet = &accounts[1];
        vault = &accounts[2];
    } else {
        creator = &accounts[0];
        // accounts[1] = creator_token_account (used later)
        red_packet = &accounts[2];
        vault = &accounts[3];
        // accounts[4] = token_program (used later)

        if accounts[4].address() != &TOKEN_PROGRAM_ID {
            return Err(RedPacketError::InvalidTokenProgram.into());
        }
    }

    // Validate creator is signer
    if !creator.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate red packet account
    state::validate_redpacket(red_packet, &ID)?;

    // Read state and check authorization
    let (bump, creator_bytes, id_bytes, remaining_amount) = {
        let rp_data = red_packet.try_borrow()?;

        // Verify token_type matches stored state
        if state::get_token_type(&rp_data) != token_type {
            return Err(RedPacketError::InvalidTokenType.into());
        }

        // Verify creator matches
        if state::get_creator(&rp_data) != creator.address().as_ref() {
            return Err(RedPacketError::Unauthorized.into());
        }

        let num_recipients = state::get_num_recipients(&rp_data);
        let num_claimed = state::get_num_claimed(&rp_data);
        let expires_at = state::get_expires_at(&rp_data);
        let bump = state::get_bump(&rp_data);
        let vault_bump = state::get_vault_bump(&rp_data);
        let remaining_amount = state::get_remaining_amount(&rp_data);

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

        // Must be either fully claimed or expired
        let all_claimed = num_claimed >= num_recipients;
        let clock = Clock::get()?;
        let is_expired = clock.unix_timestamp >= expires_at;

        if !all_claimed && !is_expired {
            return Err(RedPacketError::NotExpiredOrFull.into());
        }

        (bump, creator_bytes, id_bytes, remaining_amount)
    }; // drop immutable borrow

    if is_sol {
        // Verify vault is owned by our program
        if !vault.owned_by(&ID) {
            return Err(RedPacketError::InvalidAccountOwner.into());
        }

        // Transfer ALL vault lamports to creator (remaining_amount + rent)
        let vault_lamports = vault.lamports();
        if vault_lamports > 0 {
            creator.set_lamports(
                creator.lamports()
                    .checked_add(vault_lamports)
                    .ok_or(ProgramError::ArithmeticOverflow)?,
            );
            vault.set_lamports(0);
        }
    } else {
        // Build red_packet PDA signer for SPL operations
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
                to: &accounts[1], // creator_token_account
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
    }

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
        let mut rp_data = red_packet.try_borrow_mut()?;
        for byte in rp_data.iter_mut() {
            *byte = 0;
        }
    }

    log("Closed");
    Ok(())
}
