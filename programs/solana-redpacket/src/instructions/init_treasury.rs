use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::InitializeAccount3;
use crate::log;
use crate::constants::{
    ID, SYSTEM_PROGRAM_ID, TOKEN_ACCOUNT_SIZE, TOKEN_PROGRAM_ID, TREASURY_SEED, TREASURY_SIZE,
    TREASURY_VAULT_SEED,
};
use crate::error::RedPacketError;
use crate::state;

/// Instruction data layout:
/// [0]     discriminator (already consumed)
/// [0]     treasury_bump: u8
/// [1]     vault_bump: u8
pub fn process_init_treasury(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    if accounts.len() < 6 {
        return Err(RedPacketError::NotEnoughAccounts.into());
    }
    let payer = &accounts[0];
    let treasury = &accounts[1];
    let treasury_vault = &accounts[2];
    let mint = &accounts[3];
    let token_program = &accounts[4];
    let system_program = &accounts[5];

    // Validate payer is signer
    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate program IDs
    if token_program.address() != &TOKEN_PROGRAM_ID {
        return Err(RedPacketError::InvalidTokenProgram.into());
    }
    if system_program.address() != &SYSTEM_PROGRAM_ID {
        return Err(RedPacketError::InvalidSystemProgram.into());
    }

    // Parse bumps
    if data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let treasury_bump = data[0];
    let vault_bump = data[1];

    // Verify treasury PDA address
    let treasury_bump_bytes = [treasury_bump];
    let expected_treasury = Address::create_program_address(
        &[TREASURY_SEED, &treasury_bump_bytes],
        &ID,
    )
    .map_err(|_| ProgramError::from(RedPacketError::InvalidPDA))?;
    if treasury.address() != &expected_treasury {
        return Err(RedPacketError::InvalidPDA.into());
    }

    // Verify treasury_vault PDA address
    let vault_bump_bytes = [vault_bump];
    let expected_vault = Address::create_program_address(
        &[TREASURY_VAULT_SEED, &vault_bump_bytes],
        &ID,
    )
    .map_err(|_| ProgramError::from(RedPacketError::InvalidPDA))?;
    if treasury_vault.address() != &expected_vault {
        return Err(RedPacketError::InvalidPDA.into());
    }

    // Check treasury doesn't already exist (lamports == 0 means uninitialized)
    if treasury.lamports() > 0 {
        return Err(RedPacketError::TreasuryAlreadyInitialized.into());
    }

    let rent = Rent::get()?;

    // Create treasury PDA
    let treasury_rent = rent.try_minimum_balance(TREASURY_SIZE)?;
    let treasury_seeds = [
        Seed::from(TREASURY_SEED),
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
    {
        let mut tdata = treasury.try_borrow_mut()?;
        state::init_treasury(&mut tdata, treasury_bump, vault_bump, mint.address().as_ref());
    }

    // Create treasury vault token account
    let vault_rent = rent.try_minimum_balance(TOKEN_ACCOUNT_SIZE)?;
    let vault_seeds = [
        Seed::from(TREASURY_VAULT_SEED),
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

    log("Treasury initialized");
    Ok(())
}
