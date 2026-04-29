/**
 * events.ts — WebSocket 事件协议类型
 * 所有事件均为 discriminated union，以 type 字段作为判别器。
 * 客户端→服务器使用 ClientEvent；服务器→客户端使用 ServerEvent。
 */

import type { GameState } from './game';
import type { ParsedPlay } from './pattern';
import type { SettlementResult } from './betting';

// ─── 客户端 → 服务器 ──────────────────────────────────────────────────────────

/** 客户端请求加入指定房间 */
export interface JoinRoomEvent {
  readonly type:     'join_room';
  readonly roomId:   string;
  readonly playerId: string;
}

/** 客户端宣告准备就绪，等待游戏开始 */
export interface ReadyEvent {
  readonly type:     'ready';
  readonly playerId: string;
}

/**
 * 客户端叫地主决定。
 * bid=true 表示叫地主；bid=false 表示不叫（过）。
 */
export interface BidEvent {
  readonly type:     'bid';
  readonly playerId: string;
  readonly bid:      boolean;
}

/** 客户端出牌，携带已在本地解析好的出牌信息 */
export interface PlayCardsEvent {
  readonly type:     'play_cards';
  readonly playerId: string;
  readonly play:     ParsedPlay;
}

/** 客户端选择过牌（不出），仅在非当前轮首出时合法 */
export interface PassEvent {
  readonly type:     'pass';
  readonly playerId: string;
}

/** 客户端发往服务器的所有事件联合类型 */
export type ClientEvent =
  | JoinRoomEvent
  | ReadyEvent
  | BidEvent
  | PlayCardsEvent
  | PassEvent;

// ─── 服务器 → 客户端 ──────────────────────────────────────────────────────────

/** 服务器推送完整游戏状态快照（房间加入、阶段切换、出牌后均会触发） */
export interface RoomStateEvent {
  readonly type:  'room_state';
  readonly state: GameState;
}

/** 服务器通知某位玩家该出牌了，含超时毫秒数 */
export interface TurnEvent {
  readonly type:      'your_turn';
  readonly playerId:  string;
  /** 超时时间（毫秒），客户端应在此时间内做出操作，否则服务器自动过牌 */
  readonly timeoutMs: number;
}

/**
 * 服务器广播某玩家的出牌结果。
 * play=null 表示该玩家选择过牌。
 */
export interface CardsPlayedEvent {
  readonly type:     'cards_played';
  readonly playerId: string;
  readonly play:     ParsedPlay | null;
}

/** 服务器广播游戏结束，含胜者信息和完整结算数据 */
export interface GameEndedEvent {
  readonly type:       'game_ended';
  readonly winnerId:   string;
  readonly settlement: SettlementResult;
}

/** 服务器向客户端推送错误信息（操作不合法、超时、内部错误等） */
export interface ErrorEvent {
  readonly type:    'error';
  /** 机器可读的错误码，供客户端分类处理 */
  readonly code:    string;
  /** 人类可读的错误描述 */
  readonly message: string;
}

/** 服务器发往客户端的所有事件联合类型 */
export type ServerEvent =
  | RoomStateEvent
  | TurnEvent
  | CardsPlayedEvent
  | GameEndedEvent
  | ErrorEvent;
