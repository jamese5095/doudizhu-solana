'use client';

import type { Card } from '@doudizhu/types';
import { CardView, CardBack } from './CardView';

interface Props {
  cards:    readonly Card[];
  revealed: boolean;
}

export function KittyCards({ cards, revealed }: Props) {
  return (
    <div className="flex items-center justify-center gap-1">
      {revealed && cards.length > 0
        ? cards.map((c, i) => <CardView key={i} card={c} size="sm" />)
        : [0, 1, 2].map(i => <CardBack key={i} size="sm" />)
      }
    </div>
  );
}
