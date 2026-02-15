use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_token::instructions::Transfer;
use crate::log;
use crate::constants::{ADMIN, ID, TOKEN_PROGRAM_ID, TREASURY_SEED, TREASURY_SIZE, TREASURY_VAULT_SEED, TOKEN_TYPE_SOL};
use crate::error::RedPacketError;
use crate::state;

/// Instruction data layout:
/// [0]     discriminator (already consumed)
/// [0]     token_type: u8 (0=SPL, 1=SOL)
/// [1..9]  amount: u64 (0 = withdraw all)
pub fn process_withdraw_fees(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    // Parse token type and amount
    if data.len() < 9 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let token_type = data[0];
    state::validate_token_type(token_type)?;
    let amount = u64::from_le_bytes(data[1..9].try_into().unwrap());

    let is_sol = token_type == TOKEN_TYPE_SOL;

    // Parse accounts based on token type
    let min_accounts = if is_sol { 2 } else { 5 };
    if accounts.len() < min_accounts {
        return Err(RedPacketError::NotEnoughAccounts.into());
    }

    let admin = &accounts[0];

    // Validate admin is signer and matches ADMIN constant
    if !admin.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if admin.address() != &ADMIN {
        return Err(RedPacketError::UnauthorizedAdmin.into());
    }

    if is_sol {
        let treasury = &accounts[1];

        // Validate treasury
        state::validate_treasury(treasury, &ID)?;

        // Read sol_fees_collected and compute withdrawal
        let rent = Rent::get()?;
        let treasury_rent = rent.try_minimum_balance(TREASURY_SIZE)?;

        let (sol_fees, withdraw_amount) = {
            let tdata = treasury.try_borrow()?;
            let sol_fees = state::get_sol_fees_collected(&tdata);

            // Available = min(sol_fees_collected, lamports above rent-exempt)
            let lamports_above_rent = treasury.lamports().saturating_sub(treasury_rent);
            let available = core::cmp::min(sol_fees, lamports_above_rent);

            let withdraw_amount = if amount == 0 { available } else { amount };

            if withdraw_amount == 0 {
                return Err(RedPacketError::InsufficientTreasuryBalance.into());
            }
            if withdraw_amount > available {
                return Err(RedPacketError::InsufficientTreasuryBalance.into());
            }

            (sol_fees, withdraw_amount)
        };

        // Direct lamport transfer: treasury -> admin
        treasury.set_lamports(
            treasury.lamports()
                .checked_sub(withdraw_amount)
                .ok_or(ProgramError::ArithmeticOverflow)?,
        );
        admin.set_lamports(
            admin.lamports()
                .checked_add(withdraw_amount)
                .ok_or(ProgramError::ArithmeticOverflow)?,
        );

        // Update sol_fees_collected
        {
            let mut tdata = treasury.try_borrow_mut()?;
            state::set_sol_fees_collected(
                &mut tdata,
                sol_fees.checked_sub(withdraw_amount)
                    .ok_or(ProgramError::ArithmeticOverflow)?,
            );
        }

        log("SOL fees withdrawn");
    } else {
        let admin_token_account = &accounts[1];
        let treasury = &accounts[2];
        let treasury_vault = &accounts[3];
        let token_program = &accounts[4];

        // Validate token program
        if token_program.address() != &TOKEN_PROGRAM_ID {
            return Err(RedPacketError::InvalidTokenProgram.into());
        }

        // Validate treasury
        state::validate_treasury(treasury, &ID)?;

        // Read treasury data for PDA signing and vault verification
        let treasury_bump = {
            let tdata = treasury.try_borrow()?;
            let bump = state::get_treasury_bump(&tdata);

            // Verify treasury_vault PDA
            let tv_bump = state::get_treasury_vault_bump(&tdata);
            let tv_bump_bytes = [tv_bump];
            let expected_tv = Address::create_program_address(
                &[TREASURY_VAULT_SEED, &tv_bump_bytes],
                &ID,
            )
            .map_err(|_| ProgramError::from(RedPacketError::InvalidPDA))?;
            if treasury_vault.address() != &expected_tv {
                return Err(RedPacketError::InvalidPDA.into());
            }

            bump
        };

        // Read vault balance from token account data (offset 64 = amount field)
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

        // Transfer from treasury_vault to admin_token_account
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
    }

    Ok(())
}
