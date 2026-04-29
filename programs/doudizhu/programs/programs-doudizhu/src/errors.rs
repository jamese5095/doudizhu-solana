use anchor_lang::prelude::*;

#[error_code]
pub enum DoudizhuError {
    #[msg("Invalid bet tier: must be 0-3")]
    InvalidBetTier,
    #[msg("Duplicate player addresses")]
    DuplicatePlayers,
    #[msg("Base score must be greater than 0")]
    InvalidBaseScore,
    #[msg("Player is not registered in this room")]
    PlayerNotInRoom,
    #[msg("Player has already deposited")]
    AlreadyDeposited,
    #[msg("Room is not in the expected phase")]
    InvalidPhase,
    #[msg("Escrow has already been settled")]
    AlreadySettled,
    #[msg("Not all players have deposited yet")]
    NotAllDeposited,
    #[msg("Caller is not the authorized relay")]
    UnauthorizedRelay,
    #[msg("Winner index must be 0, 1, or 2")]
    InvalidWinnerIndex,
    #[msg("Landlord index must be 0, 1, or 2")]
    InvalidLandlordIndex,
    #[msg("Final multiplier must be greater than 0")]
    InvalidMultiplier,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Game has already started; use dispute_vote for in-progress disputes")]
    GameAlreadyStarted,
    #[msg("Caller is not a registered player in this room")]
    NotAPlayer,
    #[msg("Player has already cast a dispute vote")]
    AlreadyVoted,
    #[msg("Timeout period has not elapsed yet (requires >300s)")]
    TimeoutNotReached,
}
