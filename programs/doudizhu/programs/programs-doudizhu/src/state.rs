use anchor_lang::prelude::*;

/// 游戏房间状态账户
/// PDA seeds: ["room", room_id]
#[account]
pub struct RoomAccount {
    /// 房间唯一标识（UUID 去连字符后的 16 字节）
    pub room_id: [u8; 16],
    /// 三个玩家的钱包地址（下标固定，贯穿全局）
    pub players: [Pubkey; 3],
    /// 档位：0=SMALL 1=MEDIUM 2=LARGE 3=WHALE
    pub bet_tier: u8,
    /// 该档位底分（DDZ token，decimals=0）
    pub base_score: u64,
    /// 游戏阶段：0=WaitingToStart 1=Bidding 2=Playing 3=Ended 4=Cancelled
    pub phase: u8,
    /// 当前倍率（初始=1），由服务器在 settle 时传入
    pub multiplier: u16,
    /// 地主座位号（0/1/2），0xFF=未确定
    pub landlord_index: u8,
    /// 胜者座位号（0/1/2），0xFF=未结算
    pub winner_index: u8,
    /// 房间创建时间戳，供超时退款（cancel_room）使用
    pub created_at: i64,
    /// 授权中继器钱包，只有此账户可调用 settle
    pub relay_authority: Pubkey,
    /// 争议投票位：players[i] 投票后置 true，2-of-3 触发均分退款
    pub dispute_votes: [bool; 3],
    /// PDA bump seed
    pub bump: u8,
}

impl RoomAccount {
    /// 不含 Anchor 8 字节 discriminator 的裸数据大小
    pub const SIZE: usize =
        16          // room_id
        + 32 * 3    // players
        + 1         // bet_tier
        + 8         // base_score
        + 1         // phase
        + 2         // multiplier
        + 1         // landlord_index
        + 1         // winner_index
        + 8         // created_at
        + 32        // relay_authority
        + 3         // dispute_votes
        + 1;        // bump
    // = 170 bytes
}

/// 资金托管账户（纯元数据，实际代币在关联的 Token Account）
/// PDA seeds: ["escrow", room_id]
#[account]
pub struct EscrowAccount {
    /// 关联的房间 ID
    pub room_id: [u8; 16],
    /// 各玩家实际存入金额（下标与 RoomAccount.players 对应）
    pub deposits: [u64; 3],
    /// 位掩码：bit i = 1 表示 players[i] 已存入
    pub deposit_flags: u8,
    /// 是否已结算（防止重复调用 settle）
    pub is_settled: bool,
    /// PDA bump seed（供 CPI 签名使用）
    pub bump: u8,
}

impl EscrowAccount {
    /// 不含 Anchor 8 字节 discriminator 的裸数据大小
    pub const SIZE: usize =
        16          // room_id
        + 8 * 3     // deposits
        + 1         // deposit_flags
        + 1         // is_settled
        + 1;        // bump
    // = 43 bytes
}
