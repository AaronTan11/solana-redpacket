use pinocchio::error::ProgramError;

#[repr(u32)]
pub enum RedPacketError {
    InvalidAmount = 0,
    InvalidRecipientCount = 1,
    InvalidSplitMode = 2,
    AlreadyClaimed = 3,
    RedPacketFull = 4,
    Expired = 5,
    NotExpiredOrFull = 6,
    Unauthorized = 7,
    InvalidPDA = 8,
    InvalidAccountOwner = 9,
    InvalidDiscriminator = 10,
    AmountMismatch = 11,
    NotEnoughAccounts = 12,
    UnauthorizedAdmin = 13,
    TreasuryNotInitialized = 14,
    InsufficientTreasuryBalance = 15,
    TreasuryAlreadyInitialized = 16,
    InvalidMint = 17,
    InvalidTokenAccount = 18,
    InvalidTokenProgram = 19,
    InvalidSystemProgram = 20,
    InvalidTokenType = 21,
}

impl From<RedPacketError> for ProgramError {
    fn from(e: RedPacketError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
