use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("CVHSSRrVU6hB5sT1QFb2GpebGYRcjnZFY9L8S5guFaBf");

pub mod errors;
pub mod state;

use errors::DoudizhuError;
use state::{EscrowAccount, RoomAccount};

#[program]
pub mod programs_doudizhu {
    use super::*;

    /// 创建游戏房间：初始化 RoomAccount、EscrowAccount、托管 Token Account。
    ///
    /// 参数：
    ///   room_id         — 16 字节房间唯一标识
    ///   bet_tier        — 档位（0-3）
    ///   base_score      — 该档位底分（DDZ，decimals=0）
    ///   player_pubkeys  — 恰好三个不同玩家地址
    ///   relay_authority — 授权调用 settle 的中继器钱包
    pub fn initialize_room(
        ctx: Context<InitializeRoom>,
        room_id: [u8; 16],
        bet_tier: u8,
        base_score: u64,
        player_pubkeys: [Pubkey; 3],
        relay_authority: Pubkey,
    ) -> Result<()> {
        require!(bet_tier <= 3, DoudizhuError::InvalidBetTier);
        require!(base_score > 0, DoudizhuError::InvalidBaseScore);
        require!(
            player_pubkeys[0] != player_pubkeys[1]
                && player_pubkeys[1] != player_pubkeys[2]
                && player_pubkeys[0] != player_pubkeys[2],
            DoudizhuError::DuplicatePlayers
        );

        let room = &mut ctx.accounts.room;
        room.room_id = room_id;
        room.players = player_pubkeys;
        room.bet_tier = bet_tier;
        room.base_score = base_score;
        room.phase = 0; // WaitingToStart
        room.multiplier = 1;
        room.landlord_index = 0xFF;
        room.winner_index = 0xFF;
        room.created_at = Clock::get()?.unix_timestamp;
        room.relay_authority = relay_authority;
        room.dispute_votes = [false; 3];
        room.bump = ctx.bumps.room;

        let escrow = &mut ctx.accounts.escrow;
        escrow.room_id = room_id;
        escrow.deposits = [0u64; 3];
        escrow.deposit_flags = 0;
        escrow.is_settled = false;
        escrow.bump = ctx.bumps.escrow;

        Ok(())
    }

    /// 玩家加入并存入押注金额。
    ///
    /// 验证：调用者必须是 RoomAccount 登记的三个玩家之一。
    /// 效果：从玩家 Token Account 转入 base_score 到 EscrowAccount。
    ///       三人全部存入后，phase 自动推进到 Bidding（1）。
    #[allow(unused_variables)]
    pub fn join_and_deposit(
        ctx: Context<JoinAndDeposit>,
        room_id: [u8; 16],
    ) -> Result<()> {
        let player_key = ctx.accounts.player.key();

        // — 确定玩家下标 —
        let player_idx = {
            let room = &ctx.accounts.room;
            require!(room.phase == 0, DoudizhuError::InvalidPhase);
            room.players
                .iter()
                .position(|p| p == &player_key)
                .ok_or(DoudizhuError::PlayerNotInRoom)? as u8
        };

        // — 检查未重复存入 —
        let flag = 1u8 << player_idx;
        require!(
            ctx.accounts.escrow.deposit_flags & flag == 0,
            DoudizhuError::AlreadyDeposited
        );

        // — Token CPI：player_ata → escrow_ata —
        let amount = ctx.accounts.room.base_score;
        let decimals = ctx.accounts.mint.decimals;

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.player_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.escrow_token_account.to_account_info(),
                    authority: ctx.accounts.player.to_account_info(),
                },
            ),
            amount,
            decimals,
        )?;

        // — 更新元数据 —
        let escrow = &mut ctx.accounts.escrow;
        escrow.deposits[player_idx as usize] = amount;
        escrow.deposit_flags |= flag;

        // 三人全到齐，推进阶段
        if escrow.deposit_flags == 0b111 {
            ctx.accounts.room.phase = 1; // Bidding
        }

        Ok(())
    }

    /// 结算：按倍率和身份系数计算分配，2% 进 treasury。
    ///
    /// 身份系数：地主=2，农民=1。
    /// 公式：unit = base_score × final_multiplier
    ///   地主胜：各农民扣 min(unit×1, 存款)，地主得总扣款×98%；
    ///   农民胜：地主扣 min(unit×2, 存款)，两农民均分×98%。
    /// 安全：只有 relay_authority 可调用；is_settled 防重入。
    pub fn settle(
        ctx: Context<Settle>,
        room_id: [u8; 16],
        winner_index: u8,
        landlord_index: u8,
        final_multiplier: u16,
    ) -> Result<()> {
        // — 验证 —
        require!(winner_index <= 2, DoudizhuError::InvalidWinnerIndex);
        require!(landlord_index <= 2, DoudizhuError::InvalidLandlordIndex);
        require!(final_multiplier > 0, DoudizhuError::InvalidMultiplier);
        require!(
            ctx.accounts.relay.key() == ctx.accounts.room.relay_authority,
            DoudizhuError::UnauthorizedRelay
        );
        require!(!ctx.accounts.escrow.is_settled, DoudizhuError::AlreadySettled);
        require!(
            ctx.accounts.escrow.deposit_flags == 0b111,
            DoudizhuError::NotAllDeposited
        );

        // — 提前读取需要的值 —
        let deposits = ctx.accounts.escrow.deposits;
        let escrow_bump = ctx.accounts.escrow.bump;
        let decimals = ctx.accounts.mint.decimals;

        let l = landlord_index as usize;
        let farmers: [usize; 2] = match l {
            0 => [1, 2],
            1 => [0, 2],
            _ => [0, 1],
        };
        let winner_is_landlord = winner_index as usize == l;

        let unit = (deposits[0] as u128)
            .checked_mul(final_multiplier as u128)
            .ok_or(DoudizhuError::Overflow)?;

        // — 计算各玩家应收金额和平台手续费 —
        let (receives, fee): ([u64; 3], u64) = if winner_is_landlord {
            // 地主胜：两农民各扣 min(unit, 存款)
            let f0_loss = unit.min(deposits[farmers[0]] as u128);
            let f1_loss = unit.min(deposits[farmers[1]] as u128);
            let total = f0_loss + f1_loss;
            let fee_u128 = total * 2 / 100;
            let landlord_bonus = total - fee_u128;

            let mut r = [0u64; 3];
            r[l] = deposits[l]
                .checked_add(landlord_bonus as u64)
                .ok_or(DoudizhuError::Overflow)?;
            r[farmers[0]] = (deposits[farmers[0]] as u128 - f0_loss) as u64;
            r[farmers[1]] = (deposits[farmers[1]] as u128 - f1_loss) as u64;
            (r, fee_u128 as u64)
        } else {
            // 农民胜：地主扣 min(unit×2, 存款)，两农民均分×98%
            let max_loss = unit.checked_mul(2).ok_or(DoudizhuError::Overflow)?;
            let l_loss = max_loss.min(deposits[l] as u128);
            let fee_u128 = l_loss * 2 / 100;
            let net = l_loss - fee_u128;
            let each = net / 2;
            let rem = net % 2; // 最多 1 DDZ，归 farmers[0]

            let mut r = [0u64; 3];
            r[l] = (deposits[l] as u128 - l_loss) as u64;
            r[farmers[0]] = deposits[farmers[0]]
                .checked_add((each + rem) as u64)
                .ok_or(DoudizhuError::Overflow)?;
            r[farmers[1]] = deposits[farmers[1]]
                .checked_add(each as u64)
                .ok_or(DoudizhuError::Overflow)?;
            (r, fee_u128 as u64)
        };

        // — CPI 签名种子（escrow PDA） —
        let signer_seeds: &[&[&[u8]]] =
            &[&[b"escrow", room_id.as_ref(), &[escrow_bump]]];

        // — 转账给各玩家 —
        let player_atas = [
            ctx.accounts.player0_token_account.to_account_info(),
            ctx.accounts.player1_token_account.to_account_info(),
            ctx.accounts.player2_token_account.to_account_info(),
        ];
        for (pta, &amount) in player_atas.iter().zip(receives.iter()) {
            if amount > 0 {
                transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.escrow_token_account.to_account_info(),
                            mint: ctx.accounts.mint.to_account_info(),
                            to: pta.clone(),
                            authority: ctx.accounts.escrow.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    amount,
                    decimals,
                )?;
            }
        }

        // — 2% 手续费转 treasury —
        if fee > 0 {
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.escrow_token_account.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.treasury_token_account.to_account_info(),
                        authority: ctx.accounts.escrow.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee,
                decimals,
            )?;
        }

        // — 更新链上状态 —
        ctx.accounts.escrow.is_settled = true;
        ctx.accounts.room.winner_index = winner_index;
        ctx.accounts.room.landlord_index = landlord_index;
        ctx.accounts.room.phase = 3; // Ended

        Ok(())
    }

    /// 超时取消：任何人可调用，要求房间处于 WaitingToStart（phase=0）且超过 300 秒未开局。
    /// 效果：退还所有已存款玩家的本金，设置 phase=4（Cancelled）。
    #[allow(unused_variables)]
    pub fn cancel_room(ctx: Context<CancelRoom>, room_id: [u8; 16]) -> Result<()> {
        require!(!ctx.accounts.escrow.is_settled, DoudizhuError::AlreadySettled);
        require!(ctx.accounts.room.phase == 0, DoudizhuError::GameAlreadyStarted);

        let now = Clock::get()?.unix_timestamp;
        require!(
            now > ctx.accounts.room.created_at + 30,
            DoudizhuError::TimeoutNotReached
        );

        let deposits = ctx.accounts.escrow.deposits;
        let deposit_flags = ctx.accounts.escrow.deposit_flags;
        let escrow_bump = ctx.accounts.escrow.bump;
        let decimals = ctx.accounts.mint.decimals;

        let signer_seeds: &[&[&[u8]]] =
            &[&[b"escrow", room_id.as_ref(), &[escrow_bump]]];

        let player_atas = [
            ctx.accounts.player0_token_account.to_account_info(),
            ctx.accounts.player1_token_account.to_account_info(),
            ctx.accounts.player2_token_account.to_account_info(),
        ];

        for (i, pta) in player_atas.iter().enumerate() {
            if deposit_flags & (1u8 << i) != 0 && deposits[i] > 0 {
                transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.escrow_token_account.to_account_info(),
                            mint: ctx.accounts.mint.to_account_info(),
                            to: pta.clone(),
                            authority: ctx.accounts.escrow.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    deposits[i],
                    decimals,
                )?;
            }
        }

        ctx.accounts.escrow.is_settled = true;
        ctx.accounts.room.phase = 4; // Cancelled

        Ok(())
    }

    /// 争议投票：玩家可对进行中的对局发起争议投票。
    /// 2-of-3 多数触发均分退款（无手续费），余数归 player0。
    #[allow(unused_variables)]
    pub fn dispute_vote(ctx: Context<DisputeVote>, room_id: [u8; 16]) -> Result<()> {
        let voter_key = ctx.accounts.voter.key();

        {
            let room = &ctx.accounts.room;
            require!(
                room.phase == 1 || room.phase == 2,
                DoudizhuError::InvalidPhase
            );
        }
        require!(!ctx.accounts.escrow.is_settled, DoudizhuError::AlreadySettled);

        let voter_idx = ctx.accounts.room
            .players
            .iter()
            .position(|p| p == &voter_key)
            .ok_or(DoudizhuError::NotAPlayer)?;

        require!(
            !ctx.accounts.room.dispute_votes[voter_idx],
            DoudizhuError::AlreadyVoted
        );

        ctx.accounts.room.dispute_votes[voter_idx] = true;

        let vote_count = ctx
            .accounts
            .room
            .dispute_votes
            .iter()
            .filter(|&&v| v)
            .count();

        if vote_count >= 2 {
            let deposits = ctx.accounts.escrow.deposits;
            let escrow_bump = ctx.accounts.escrow.bump;
            let decimals = ctx.accounts.mint.decimals;

            let total: u64 = deposits[0]
                .checked_add(deposits[1])
                .and_then(|s| s.checked_add(deposits[2]))
                .ok_or(DoudizhuError::Overflow)?;
            let each = total / 3;
            let rem = total % 3; // 最多 2 DDZ，归 player0

            let receives = [each + rem, each, each];

            let signer_seeds: &[&[&[u8]]] =
                &[&[b"escrow", room_id.as_ref(), &[escrow_bump]]];

            let player_atas = [
                ctx.accounts.player0_token_account.to_account_info(),
                ctx.accounts.player1_token_account.to_account_info(),
                ctx.accounts.player2_token_account.to_account_info(),
            ];

            for (pta, &amount) in player_atas.iter().zip(receives.iter()) {
                if amount > 0 {
                    transfer_checked(
                        CpiContext::new_with_signer(
                            ctx.accounts.token_program.to_account_info(),
                            TransferChecked {
                                from: ctx.accounts.escrow_token_account.to_account_info(),
                                mint: ctx.accounts.mint.to_account_info(),
                                to: pta.clone(),
                                authority: ctx.accounts.escrow.to_account_info(),
                            },
                            signer_seeds,
                        ),
                        amount,
                        decimals,
                    )?;
                }
            }

            ctx.accounts.escrow.is_settled = true;
            ctx.accounts.room.phase = 4; // Cancelled
        }

        Ok(())
    }
}

// ── Accounts Contexts ─────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(room_id: [u8; 16])]
pub struct InitializeRoom<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + RoomAccount::SIZE,
        seeds = [b"room", room_id.as_ref()],
        bump
    )]
    pub room: Account<'info, RoomAccount>,

    #[account(
        init,
        payer = payer,
        space = 8 + EscrowAccount::SIZE,
        seeds = [b"escrow", room_id.as_ref()],
        bump
    )]
    pub escrow: Account<'info, EscrowAccount>,

    /// 托管 Token Account：ATA(escrow_pda, mint)，escrow PDA 为 authority
    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = escrow,
        associated_token::token_program = token_program,
    )]
    pub escrow_token_account: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(room_id: [u8; 16])]
pub struct JoinAndDeposit<'info> {
    #[account(
        mut,
        seeds = [b"room", room_id.as_ref()],
        bump = room.bump
    )]
    pub room: Account<'info, RoomAccount>,

    #[account(
        mut,
        seeds = [b"escrow", room_id.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = escrow,
        associated_token::token_program = token_program,
    )]
    pub escrow_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = player,
        token::token_program = token_program,
    )]
    pub player_token_account: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    pub player: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(room_id: [u8; 16])]
pub struct Settle<'info> {
    #[account(
        mut,
        seeds = [b"room", room_id.as_ref()],
        bump = room.bump
    )]
    pub room: Account<'info, RoomAccount>,

    #[account(
        mut,
        seeds = [b"escrow", room_id.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = escrow,
        associated_token::token_program = token_program,
    )]
    pub escrow_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// 三个玩家的 Token Account（按下标顺序）
    #[account(
        mut,
        token::mint = mint,
        token::authority = room.players[0],
        token::token_program = token_program,
    )]
    pub player0_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = room.players[1],
        token::token_program = token_program,
    )]
    pub player1_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = room.players[2],
        token::token_program = token_program,
    )]
    pub player2_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// 平台手续费账户（2% 归此）
    #[account(mut)]
    pub treasury_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// 必须与 room.relay_authority 一致
    pub relay: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(room_id: [u8; 16])]
pub struct CancelRoom<'info> {
    #[account(
        mut,
        seeds = [b"room", room_id.as_ref()],
        bump = room.bump
    )]
    pub room: Account<'info, RoomAccount>,

    #[account(
        mut,
        seeds = [b"escrow", room_id.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = escrow,
        associated_token::token_program = token_program,
    )]
    pub escrow_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = room.players[0],
        token::token_program = token_program,
    )]
    pub player0_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = room.players[1],
        token::token_program = token_program,
    )]
    pub player1_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = room.players[2],
        token::token_program = token_program,
    )]
    pub player2_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// 任何账户均可触发超时取消
    pub caller: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(room_id: [u8; 16])]
pub struct DisputeVote<'info> {
    #[account(
        mut,
        seeds = [b"room", room_id.as_ref()],
        bump = room.bump
    )]
    pub room: Account<'info, RoomAccount>,

    #[account(
        mut,
        seeds = [b"escrow", room_id.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = escrow,
        associated_token::token_program = token_program,
    )]
    pub escrow_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = room.players[0],
        token::token_program = token_program,
    )]
    pub player0_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = room.players[1],
        token::token_program = token_program,
    )]
    pub player1_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = room.players[2],
        token::token_program = token_program,
    )]
    pub player2_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// 必须是 room.players 中的一员
    pub voter: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
