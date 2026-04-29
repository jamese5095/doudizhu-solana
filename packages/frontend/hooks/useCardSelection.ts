'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Card, ParsedPlay } from '@doudizhu/types';
import { Rank } from '@doudizhu/types';
import { parsePlay, canBeat } from '@doudizhu/game-engine';

function cardKey(c: Card): string { return `${c.suit}_${c.rank}`; }

/** Generate simple candidate plays from a hand for the hint feature */
function generateCandidates(hand: readonly Card[]): Card[][] {
  const sorted = [...hand].sort((a, b) => a.rank - b.rank);
  const groups = new Map<number, Card[]>();
  for (const card of sorted) {
    const g = groups.get(card.rank) ?? [];
    g.push(card);
    groups.set(card.rank, g);
  }

  const candidates: Card[][] = [];
  for (const cards of groups.values()) {
    candidates.push([cards[0]]);
    if (cards.length >= 2) candidates.push(cards.slice(0, 2));
    if (cards.length >= 3) candidates.push(cards.slice(0, 3));
    if (cards.length >= 4) candidates.push(cards.slice(0, 4));
  }
  // Rocket
  const small = hand.find(c => c.rank === Rank.SmallJoker);
  const big   = hand.find(c => c.rank === Rank.BigJoker);
  if (small && big) candidates.push([small, big]);

  return candidates;
}

export interface CardSelectionResult {
  selectedCards:    Card[];
  toggleCard:       (card: Card) => void;
  clearSelection:   () => void;
  canPlaySelected:  (lastPlay: ParsedPlay | null) => boolean;
  getHint:          (lastPlay: ParsedPlay | null) => Card[];
}

export function useCardSelection(hand: readonly Card[]): CardSelectionResult {
  const [selected, setSelected] = useState<Card[]>([]);

  // Drop selections that are no longer in hand (e.g., after a play is confirmed)
  useEffect(() => {
    const handKeys = new Set(hand.map(cardKey));
    setSelected(prev => prev.filter(c => handKeys.has(cardKey(c))));
  }, [hand]);

  const toggleCard = useCallback((card: Card) => {
    const key = cardKey(card);
    setSelected(prev => {
      const exists = prev.some(c => cardKey(c) === key);
      return exists ? prev.filter(c => cardKey(c) !== key) : [...prev, card];
    });
  }, []);

  const clearSelection = useCallback(() => setSelected([]), []);

  const canPlaySelected = useCallback((lastPlay: ParsedPlay | null): boolean => {
    if (selected.length === 0) return false;
    const parsed = parsePlay(selected);
    if (!parsed) return false;
    return canBeat(parsed, lastPlay);
  }, [selected]);

  const getHint = useCallback((lastPlay: ParsedPlay | null): Card[] => {
    for (const candidate of generateCandidates(hand)) {
      const parsed = parsePlay(candidate);
      if (!parsed) continue;
      if (canBeat(parsed, lastPlay)) return candidate;
    }
    return [];
  }, [hand]);

  return { selectedCards: selected, toggleCard, clearSelection, canPlaySelected, getHint };
}
