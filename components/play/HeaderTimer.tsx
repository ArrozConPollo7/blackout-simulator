'use client';

/**
 * Cronómetro de la cabecera del jugador.
 *
 * Vive en su PROPIO subárbol a propósito: `useRemainingMs` repinta cada 250 ms y con el
 * reloj dentro de la página eso arrastraba toda la lista de decisiones. Aquí solo se
 * repinta la pastilla del tiempo (y la viñeta de urgencia), nada más.
 *
 * La viñeta se monta por portal a `document.body`: la cabecera tiene `backdrop-blur`, que
 * convierte al header en el contenedor de sus descendientes `fixed`.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useAudioEvent } from '@/lib/audio';
import { useRemainingMs } from '@/lib/useGameState';
import { formatRemaining } from '@/lib/ui';
import type { Phase } from '@/types/game';
import { hapticTimeWarn } from './haptics';

interface HeaderTimerProps {
  phase: Phase | undefined;
  timerEndsAt: string | null | undefined;
  clockSkewMs: number;
}

/** Aviso sonoro/háptico con el tiempo, una sola vez por tramo. */
const AVISO_MS = 20000;
const URGENTE_MS = 30000;
const CRITICO_MS = 10000;

function HeaderTimer({ phase, timerEndsAt, clockSkewMs }: HeaderTimerProps) {
  const remaining = useRemainingMs(timerEndsAt ?? null, phase, clockSkewMs);
  const playEvent = useAudioEvent();
  const avisado = useRef(false);
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    setMontado(true);
  }, []);

  useEffect(() => {
    if (remaining === null || remaining > AVISO_MS) {
      avisado.current = false;
      return;
    }
    if (avisado.current) return;
    avisado.current = true;
    playEvent('timeLow');
    hapticTimeWarn();
  }, [remaining, playEvent]);

  const urgente = remaining !== null && remaining > 0 && remaining <= URGENTE_MS;
  const critico = remaining !== null && remaining > 0 && remaining <= CRITICO_MS;

  return (
    <>
      <div
        className={`flex items-center gap-1 px-2 py-0.5 rounded bg-bg-primary border ${
          urgente ? 'border-accent-crisis/70' : 'border-border-subtle'
        } ${critico ? 'anim-pulse-critical' : urgente ? 'anim-pulse-urgent' : ''}`}
      >
        <span
          className={`material-symbols-outlined text-[14px] ${
            urgente ? 'text-accent-crisis' : 'text-accent-electricidad'
          }`}
        >
          timer
        </span>
        <span
          className={`font-label-md text-label-md font-bold tabular-nums ${
            urgente ? 'text-accent-crisis' : 'text-accent-electricidad'
          }`}
        >
          {formatRemaining(remaining)}
        </span>
      </div>

      {urgente &&
        montado &&
        createPortal(
          <span
            className={`eec-vignette ${critico ? 'eec-vignette-2' : 'eec-vignette-1'}`}
            aria-hidden
          />,
          document.body,
        )}
    </>
  );
}

export default React.memo(HeaderTimer);
