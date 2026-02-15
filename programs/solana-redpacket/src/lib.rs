pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use pinocchio::{AccountView, Address, ProgramResult};
use pinocchio::error::ProgramError;

use instructions::{
    process_claim, process_close, process_create, process_init_treasury, process_withdraw_fees,
};

pinocchio::program_entrypoint!(process_instruction);
pinocchio::no_allocator!();
pinocchio::default_panic_handler!();

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

// Raw sol_log syscall — replaces solana-program-log dependency
#[cfg(all(feature = "logging", target_os = "solana"))]
extern "C" {
    fn sol_log_(message: *const u8, len: u64);
}

#[inline(always)]
pub fn log(_msg: &str) {
    #[cfg(all(feature = "logging", target_os = "solana"))]
    unsafe {
        sol_log_(_msg.as_ptr(), _msg.len() as u64);
    }
}
