'use client';

/**
 * Cuenta atrás de lectura (panel de crisis). Igual que `HeaderTimer`, se repinta sola
 * para que el tic del reloj no arrastre el resto de la vista del jugador.
 */

import React from 'react';

import { useRemainingMs } from '@/lib/useGameState';
import { formatRemaining } from '@/lib/ui';
import type { Phase } from '@/types/game';

interface CountdownProps {
  phase: Phase | undefined;
  timerEndsAt: string | null | undefined;
  clockSkewMs: number;
  className?: string;
}

function Countdown({ phase, timerEndsAt, clockSkewMs, className }: CountdownProps) {
  const remaining = useRemainingMs(timerEndsAt ?? null, phase, clockSkewMs);
  return <span className={className}>{formatRemaining(remaining)}</span>;
}

export default React.memo(Countdown);
