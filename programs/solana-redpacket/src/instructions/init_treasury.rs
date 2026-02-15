use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::InitializeAccount3;
use crate::log;
use crate::constants::{
    ID, NATIVE_SOL_MINT, SYSTEM_PROGRAM_ID, TOKEN_ACCOUNT_SIZE, TOKEN_PROGRAM_ID,
    TOKEN_TYPE_SOL, TREASURY_SEED, TREASURY_SIZE, TREASURY_VAULT_SEED, rent_exempt,
};
use crate::error::RedPacketError;
use crate::state;

/// Instruction data layout:
/// [0]     discriminator (already consumed)
/// [0]     token_type: u8 (0=SPL, 1=SOL)
/// [1]     treasury_bump: u8
/// [2]     vault_bump: u8 (ignored for SOL)
pub fn process_init_treasury(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    if data.len() < 3 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let token_type = data[0];
    state::validate_token_type(token_type)?;
    let treasury_bump = data[1];
    let vault_bump = data[2];

    let is_sol = token_type == TOKEN_TYPE_SOL;

    let min_accounts = if is_sol { 3 } else { 6 };
    if accounts.len() < min_accounts {
        return Err(RedPacketError::NotEnoughAccounts.into());
    }

    let payer = &accounts[0];
    let treasury = &accounts[1];

    // Validate payer is signer
    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Determine mint bytes for PDA derivation
    let mint_bytes: &[u8] = if is_sol {
        // Validate system program
        let system_program = &accounts[2];
        if system_program.address() != &SYSTEM_PROGRAM_ID {
            return Err(RedPacketError::InvalidSystemProgram.into());
        }
        &NATIVE_SOL_MINT
    } else {
        let token_program = &accounts[4];
        let system_program = &accounts[5];
        if token_program.address() != &TOKEN_PROGRAM_ID {
            return Err(RedPacketError::InvalidTokenProgram.into());
        }
        if system_program.address() != &SYSTEM_PROGRAM_ID {
            return Err(RedPacketError::InvalidSystemProgram.into());
        }
        accounts[3].address().as_ref()
    };

    // Verify treasury PDA address (includes mint in seeds)
    let treasury_bump_bytes = [treasury_bump];
    let expected_treasury = Address::create_program_address(
        &[TREASURY_SEED, mint_bytes, &treasury_bump_bytes],
        &ID,
    )
    .map_err(|_| ProgramError::from(RedPacketError::InvalidPDA))?;
    if treasury.address() != &expected_treasury {
        return Err(RedPacketError::InvalidPDA.into());
    }

    // Check treasury doesn't already exist (lamports == 0 means uninitialized)
    if treasury.lamports() > 0 {
        return Err(RedPacketError::TreasuryAlreadyInitialized.into());
    }

    // Create treasury PDA
    let treasury_rent = rent_exempt(TREASURY_SIZE);
    let treasury_seeds = [
        Seed::from(TREASURY_SEED),
        Seed::from(mint_bytes),
        Seed::from(treasury_bump_bytes.as_ref()),
    ];
    let treasury_signer = [Signer::from(&treasury_seeds)];

    CreateAccount {
        from: payer,
        to: treasury,
        lamports: treasury_rent,
        space: TREASURY_SIZE as u64,
        owner: &ID,
    }
    .invoke_signed(&treasury_signer)?;

    // Initialize treasury data
    let effective_vault_bump = if is_sol { 0 } else { vault_bump };
    {
        let mut tdata = treasury.try_borrow_mut()?;
        state::init_treasury(&mut tdata, treasury_bump, effective_vault_bump, mint_bytes);
    }

    if !is_sol {
        let treasury_vault = &accounts[2];
        let mint = &accounts[3];

        // Verify treasury_vault PDA address (includes mint in seeds)
        let vault_bump_bytes = [vault_bump];
        let expected_vault = Address::create_program_address(
            &[TREASURY_VAULT_SEED, mint.address().as_ref(), &vault_bump_bytes],
            &ID,
        )
        .map_err(|_| ProgramError::from(RedPacketError::InvalidPDA))?;
        if treasury_vault.address() != &expected_vault {
            return Err(RedPacketError::InvalidPDA.into());
        }

        // Create treasury vault token account
        let vault_rent = rent_exempt(TOKEN_ACCOUNT_SIZE);
        let vault_seeds = [
            Seed::from(TREASURY_VAULT_SEED),
            Seed::from(mint.address().as_ref()),
            Seed::from(vault_bump_bytes.as_ref()),
        ];
        let vault_signer = [Signer::from(&vault_seeds)];

        CreateAccount {
            from: payer,
            to: treasury_vault,
            lamports: vault_rent,
            space: TOKEN_ACCOUNT_SIZE as u64,
            owner: &TOKEN_PROGRAM_ID,
        }
        .invoke_signed(&vault_signer)?;

        // Initialize token account with treasury PDA as owner
        InitializeAccount3 {
            account: treasury_vault,
            mint,
            owner: treasury.address(),
        }
        .invoke()?;
    }

    log("Treasury initialized");
    Ok(())
}
