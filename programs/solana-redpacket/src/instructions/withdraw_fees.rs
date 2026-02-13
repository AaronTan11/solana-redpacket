use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, ProgramResult,
};
use pinocchio_token::instructions::Transfer;
use solana_program_log::log;

use crate::constants::{ADMIN, ID, TOKEN_PROGRAM_ID, TREASURY_SEED};
use crate::error::RedPacketError;
use crate::state;

/// Instruction data layout:
/// [0]     discriminator (already consumed)
/// [0..8]  amount: u64 (0 = withdraw all)
pub fn process_withdraw_fees(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    if accounts.len() < 5 {
        return Err(RedPacketError::NotEnoughAccounts.into());
    }
    let admin = &accounts[0];
    let admin_token_account = &accounts[1];
    let treasury = &accounts[2];
    let treasury_vault = &accounts[3];
    let token_program = &accounts[4];

    // Validate admin is signer and matches ADMIN constant
    if !admin.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if admin.address() != &ADMIN {
        return Err(RedPacketError::UnauthorizedAdmin.into());
    }

    // Validate token program
    if token_program.address() != &TOKEN_PROGRAM_ID {
        return Err(RedPacketError::InvalidTokenProgram.into());
    }

    // Validate treasury
    state::validate_treasury(treasury, &ID)?;

    // Parse amount
    if data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());

    // Read treasury bump for PDA signing
    let treasury_bump = {
        let tdata = treasury.try_borrow()?;
        state::get_treasury_bump(&tdata)
    };

    // Read vault balance from token account data (offset 64 = amount field in SPL token account)
    let vault_balance = {
        let vdata = treasury_vault.try_borrow()?;
        if vdata.len() < 72 {
            return Err(RedPacketError::InvalidTokenAccount.into());
        }
        u64::from_le_bytes(vdata[64..72].try_into().unwrap())
    };

    // Determine withdrawal amount
    let withdraw_amount = if amount == 0 { vault_balance } else { amount };

    if withdraw_amount == 0 {
        return Err(RedPacketError::InsufficientTreasuryBalance.into());
    }
    if withdraw_amount > vault_balance {
        return Err(RedPacketError::InsufficientTreasuryBalance.into());
    }

    // Transfer USDC from treasury_vault to admin_token_account
    let bump_bytes = [treasury_bump];
    let seeds = [
        Seed::from(TREASURY_SEED),
        Seed::from(bump_bytes.as_ref()),
    ];
    let signer = [Signer::from(&seeds)];

    Transfer {
        from: treasury_vault,
        to: admin_token_account,
        authority: treasury,
        amount: withdraw_amount,
    }
    .invoke_signed(&signer)?;

    log("Fees withdrawn");
    Ok(())
}
