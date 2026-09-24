'use client';

/**
 * Opción de decisión del jugador (Ronda 1 y Ronda 2).
 *
 * La regla del juego no se toca: el número del efecto SOLO existe cuando el centro de control ya
 * respondió (`state === 'confirmed'`). Lo que sí es inmediato es la marca de selección:
 * el toque pinta la tarjeta en el mismo frame (borde de acento, ícono, escala mínima,
 * halos de "ENVIANDO…") y ese es el feedback que el jugador necesitaba.
 *
 * Estados:
 *   idle      — en juego, sin tocar.
 *   sending   — elegida: marcada al instante, esperando el veredicto.
 *   confirmed — el centro de control confirmó (destello verde + números reales).
 *   rejected  — el centro de control rechazó (sacudida roja + motivo).
 *   muted     — las demás: atenuadas mientras se resuelve la elegida.
 */

import React, { useEffect, useState } from 'react';

import { useAudioEvent } from '@/lib/audio';
import type { DecisionEffect } from '@/types/game';
import EffectChips from './EffectChips';
import { hapticTap } from './haptics';

export type ChoiceState = 'idle' | 'sending' | 'confirmed' | 'rejected' | 'muted';

interface ChoiceButtonProps {
  optionId: string;
  label: string;
  /** Lectura cualitativa ya traducida (`CONSUMO_LABEL`). */
  consumo: string;
  /** El consumo baja: se pinta en verde. */
  ahorra: boolean;
  /** Impacto en el confort. Solo se pasa cuando la ronda lo puntúa (Ronda 2): si no, la
   *  etiqueta sería idéntica en las tres opciones y no informaría de nada. */
  confort?: string;
  state: ChoiceState;
  /** Posición en la lista: afina el tono del clic (teclado, no melodía). */
  index: number;
  disabled?: boolean;
  /** Motivo del rechazo, en lenguaje de juego. */
  reason?: string | null;
  /** Efecto ya confirmado; nunca se adivina. */
  effect?: DecisionEffect | null;
  onSelect: (optionId: string) => void;
}

const ICONOS: Record<ChoiceState, string> = {
  idle: 'radio_button_unchecked',
  sending: 'radio_button_checked',
  confirmed: 'check_circle',
  rejected: 'error',
  muted: 'radio_button_unchecked',
};

const COLORES_ICONO: Record<ChoiceState, string> = {
  idle: 'text-text-secondary/60',
  sending: 'text-accent-presupuesto',
  confirmed: 'text-accent-eficiencia',
  rejected: 'text-accent-crisis',
  muted: 'text-text-secondary/30',
};

const MARCOS: Record<ChoiceState, string> = {
  idle: 'border-border-subtle bg-bg-surface',
  sending: 'border-accent-presupuesto bg-accent-presupuesto/10',
  confirmed: 'border-accent-eficiencia bg-accent-eficiencia/10',
  rejected: 'border-accent-crisis bg-accent-crisis/10',
  muted: 'border-border-subtle/60 bg-bg-surface',
};

function ChoiceButton({
  optionId,
  label,
  consumo,
  ahorra,
  confort,
  state,
  index,
  disabled = false,
  reason,
  effect,
  onSelect,
}: ChoiceButtonProps) {
  const playEvent = useAudioEvent();
  const [lento, setLento] = useState(false);

  // Si el veredicto tarda, la espera se hace visible (nunca una pantalla muerta).
  useEffect(() => {
    if (state !== 'sending') {
      setLento(false);
      return;
    }
    const id = setTimeout(() => setLento(true), 900);
    return () => clearTimeout(id);
  }, [state]);

  const marcada = state === 'sending' || state === 'confirmed' || state === 'rejected';
  const atenuada = state === 'muted';

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={marcada}
      onClick={() => {
        // Tras un rechazo la tarjeta vuelve a estar disponible: el jugador puede reintentar.
        if (disabled || state === 'sending' || state === 'confirmed') return;
        hapticTap();
        playEvent('click', { pitch: 0.94 + index * 0.06, volume: 0.9 });
        onSelect(optionId);
      }}
      className={`relative overflow-hidden w-full min-h-[58px] p-3.5 rounded-xl border text-left flex flex-col gap-2 anim-tactile ${MARCOS[state]} ${
        state === 'sending' ? 'anim-pop' : ''
      } ${state === 'confirmed' ? 'anim-confirm-pop' : ''} ${state === 'rejected' ? 'anim-deny' : ''} ${
        atenuada ? 'opacity-40' : ''
      } ${disabled && !marcada ? 'opacity-60' : ''}`}
    >
      {/* Halo pulsante de envío: solo escala y opacidad. */}
      {state === 'sending' && (
        <span
          className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-accent-presupuesto anim-choice-ring"
          aria-hidden
        />
      )}
      {/* Destello verde al confirmar. */}
      {state === 'confirmed' && (
        <span
          className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-accent-eficiencia/45 via-accent-eficiencia/10 to-transparent anim-confirm-flash"
          aria-hidden
        />
      )}

      <span className="relative flex items-start justify-between gap-2">
        <span className="font-label-md text-label-md font-bold text-text-primary">{label}</span>
        <span className={`material-symbols-outlined text-[20px] shrink-0 ${COLORES_ICONO[state]}`}>
          {ICONOS[state]}
        </span>
      </span>

      {state === 'sending' && (
        <span className="relative flex flex-col gap-1.5" aria-live="polite">
          <span className="flex items-center gap-1.5 font-label-sm text-[11px] font-bold uppercase tracking-wider text-accent-presupuesto">
            {lento ? 'Sincronizando la jugada' : 'Enviando'}
            <span className="anim-dots flex gap-0.5" aria-hidden>
              <span className="w-1 h-1 rounded-full bg-accent-presupuesto" />
              <span className="w-1 h-1 rounded-full bg-accent-presupuesto" />
              <span className="w-1 h-1 rounded-full bg-accent-presupuesto" />
            </span>
          </span>
          <span className="relative block h-1 w-full overflow-hidden rounded-full bg-bg-primary/80">
            <span
              className={`absolute inset-y-0 w-1/2 rounded-full bg-gradient-to-r from-transparent via-accent-presupuesto to-transparent ${
                lento ? 'anim-send-sweep-fast' : 'anim-send-sweep'
              }`}
            />
          </span>
        </span>
      )}

      {state === 'confirmed' && (
        <span className="relative flex flex-col gap-2" aria-live="polite">
          <span className="font-label-sm text-[11px] font-bold uppercase tracking-wider text-accent-eficiencia">
            Registrada
          </span>
          {effect && <EffectChips effect={effect} />}
        </span>
      )}

      {state === 'rejected' && reason && (
        <span className="relative block font-label-sm text-[11px] font-bold uppercase tracking-wider text-accent-crisis">
          {reason}
        </span>
      )}

      <span className="relative flex gap-3 font-label-sm text-[11px] text-text-secondary">
        <span>
          Consumo:{' '}
          <strong className={ahorra ? 'text-accent-eficiencia' : 'text-text-primary'}>{consumo}</strong>
        </span>
        {confort ? <span>{confort}</span> : null}
      </span>
    </button>
  );
}

export default React.memo(ChoiceButton);
