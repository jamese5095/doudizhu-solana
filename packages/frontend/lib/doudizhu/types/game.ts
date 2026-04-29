/**
 * game.ts — 游戏流程相关类型
 * 描述一局斗地主从开始到结束的完整状态机。
 */

import type { Card } from './card';
import type { ParsedPlay } from './pattern';
import type { BetTier } from './betting';

/** 玩家角色：一局中有且仅有一名地主，其余两名为农民 */
export enum PlayerRole {
  Landlord = 'landlord',
  Farmer   = 'farmer',
}

/**
 * 游戏阶段枚举，描述一局游戏的生命周期。
 * WaitingToStart → Bidding → Playing → Ended
 */
export enum GamePhase {
  WaitingToStart = 'waiting', // 等待所有玩家准备
  Bidding        = 'bidding', // 叫地主阶段
  Playing        = 'playing', // 正式对局阶段
  Ended          = 'ended',   // 游戏已结束（有胜者）
}

/** 单名玩家的实时状态快照 */
export interface PlayerState {
  /** 玩家唯一标识符（与链上地址对应） */
  readonly playerId:  string;
  /** 当前局中的角色（叫地主前为初始值，叫牌后确定） */
  readonly role:      PlayerRole;
  /** 玩家手中剩余牌，服务器广播时可视情况屏蔽他人手牌 */
  readonly handCards: readonly Card[];
  /** 是否已准备好进入下一阶段 */
  readonly isReady:   boolean;
}

/**
 * 完整游戏状态，服务器权威数据来源。
 * 所有字段只读，变更需通过事件驱动产生新状态对象。
 */
export interface GameState {
  /** 房间唯一标识符 */
  readonly roomId:           string;
  /** 当前游戏阶段 */
  readonly phase:            GamePhase;
  /** 严格三人，固定索引对应座位 */
  readonly players:          readonly [PlayerState, PlayerState, PlayerState];
  /** 地主所在座位索引（Bidding 阶段结束后确定） */
  readonly landlordIndex:    0 | 1 | 2;
  /** 当前轮到出牌的座位索引 */
  readonly currentTurnIndex: 0 | 1 | 2;
  /** 上一次有效出牌（null 表示当前轮无人出牌，即轮次开始） */
  readonly lastPlay:         ParsedPlay | null;
  /** 上一次有效出牌的玩家 ID（与 lastPlay 同步，null 时无意义） */
  readonly lastPlayerId:     string | null;
  /** 底牌，固定 3 张，叫地主完成后并入地主手牌 */
  readonly kitty:            readonly Card[];
  /** 当前局累计倍率，初始为 1，每次倍率事件相乘 */
  readonly multiplier:       number;
  /** 胜者玩家 ID，游戏进行中为 null */
  readonly winnerId:         string | null;
  /** 房间押注档位，由创建时确定，结算中继器（M5）直接读取 */
  readonly betTier:          BetTier;
  /** 叫地主阶段连续 pass 次数，0-2 递增；达到 3 时重新发牌并归零 */
  readonly biddingPassCount: number;
}
