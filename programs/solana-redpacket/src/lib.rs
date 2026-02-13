pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use pinocchio::{entrypoint, AccountView, Address, ProgramResult};
use pinocchio::error::ProgramError;

use instructions::{
    process_claim, process_close, process_create, process_init_treasury, process_withdraw_fees,
};

entrypoint!(process_instruction);

pub fn process_instruction(
    _program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (discriminator, data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match discriminator {
        0 => process_create(accounts, data),
        1 => process_claim(accounts, data),
        2 => process_close(accounts, data),
        3 => process_init_treasury(accounts, data),
        4 => process_withdraw_fees(accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
