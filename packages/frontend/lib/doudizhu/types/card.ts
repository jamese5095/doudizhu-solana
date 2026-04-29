/**
 * card.ts — 牌相关基础类型
 * 数值约定来自 CLAUDE.md：♠=0 ♥=1 ♦=2 ♣=3 王牌花色=4
 */

/** 花色枚举，含四种普通花色和王牌专用花色（小王/大王不区分花色） */
export enum Suit {
  Spade   = 0, // ♠
  Heart   = 1, // ♥
  Diamond = 2, // ♦
  Club    = 3, // ♣
  Joker   = 4, // 王牌专用花色
}

/**
 * 牌面值枚举，决定牌的大小顺序。
 * 3-10 对应数字本身；J=11 Q=12 K=13 A=14 2=15；小王=16 大王=17。
 */
export enum Rank {
  Three      =  3,
  Four       =  4,
  Five       =  5,
  Six        =  6,
  Seven      =  7,
  Eight      =  8,
  Nine       =  9,
  Ten        = 10,
  Jack       = 11,
  Queen      = 12,
  King       = 13,
  Ace        = 14,
  Two        = 15,
  SmallJoker = 16,
  BigJoker   = 17,
}

/** 单张牌，由花色与面值唯一确定，字段均为只读 */
export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
}

/** 手牌：玩家当前持有的全部牌，只读数组防止外部突变 */
export type Hand = readonly Card[];
