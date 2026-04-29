import type { ParsedPlay } from '../types';
import { CardPattern } from '../types';

/**
 * 判断 current 能否打过 last。
 *
 * 规则：
 *  1. last 为 null（本轮首出）→ true
 *  2. current 是火箭 → true
 *  3. last 是火箭 → false
 *  4. current 是炸弹，last 不是炸弹 → true
 *  5. current 是炸弹，last 也是炸弹 → 比 rank
 *  6. last 是炸弹，current 不是炸弹/火箭 → false
 *  7. 牌型不同 → false
 *  8. 张数不同 → false（含顺子长度、飞机翅膀类型）
 *  9. 同牌型同张数 → 比 rank（current.rank > last.rank）
 */
export function canBeat(current: ParsedPlay, last: ParsedPlay | null): boolean {
  if (last === null) return true;

  const isBomb    = (p: ParsedPlay) => p.pattern === CardPattern.Bomb;
  const isRocket  = (p: ParsedPlay) => p.pattern === CardPattern.Rocket;

  if (isRocket(current)) return true;
  if (isRocket(last))    return false;

  if (isBomb(current) && !isBomb(last)) return true;
  if (isBomb(current) && isBomb(last))  return current.rank > last.rank;
  if (isBomb(last))                     return false;

  if (current.pattern !== last.pattern)        return false;
  if (current.cards.length !== last.cards.length) return false;

  return current.rank > last.rank;
}
