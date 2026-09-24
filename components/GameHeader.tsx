'use client';

import React from 'react';
import type { Phase } from '@/types/game';
import { formatRemaining, phaseLabel, realtimeIcon, realtimeLabel } from '@/lib/ui';
import { useRemainingMs, type RealtimeStatus } from '@/lib/useGameState';

interface GameHeaderProps {
  phaseName?: string;
  phaseCode?: string;
  phase?: Phase;
  /** Marca absoluta de fin de fase: el cronómetro se deriva de aquí, nunca de un contador local. */
  timerEndsAt?: string | null;
  clockSkewMs?: number;
  isCrisis?: boolean;
  realtime?: RealtimeStatus;
  showControls?: boolean;
  busy?: boolean;
  nextPhaseLabel?: string | null;
  onTriggerCrisis?: () => void;
  onAdvancePhase?: () => void;
}

/**
 * Header persistente del Host. El tiempo restante se recalcula contra `timerEndsAt`
 * en cada tick (Fase 2.3): si el reloj del cliente está desfasado, se corrige con
 * `clockSkewMs` medido contra el reloj del Worker.
 */
export default function GameHeader({
  phaseName = 'En Juego — Telemetría de Red',
  phaseCode = 'FASE DE OPERACIÓN',
  phase,
  timerEndsAt = null,
  clockSkewMs = 0,
  isCrisis = false,
  realtime = 'desactivado',
  showControls = true,
  busy = false,
  nextPhaseLabel = null,
  onTriggerCrisis,
  onAdvancePhase,
}: GameHeaderProps) {
  const remaining = useRemainingMs(timerEndsAt, phase, clockSkewMs);
  const formattedTime = formatRemaining(remaining);
  const sinCronometro = remaining === null;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-bg-surface border-b border-border-subtle shadow-lg">
      <div className="h-20 w-full px-margin-desktop flex items-center justify-between">
        {/* Título y estado del sistema */}
        <div className="flex items-center gap-space-md">
          <div className="flex items-center gap-space-xs">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                isCrisis ? 'bg-accent-crisis animate-ping' : 'bg-accent-eficiencia animate-pulse'
              }`}
            ></div>
            <span className="font-headline-md text-headline-md tracking-wider text-text-primary uppercase font-bold whitespace-nowrap">
              Energía en Crisis
            </span>
          </div>

          <div className="h-6 w-px bg-border-subtle hidden xl:block"></div>

          <div className="hidden xl:flex items-center gap-space-xs">
            <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-widest whitespace-nowrap">
              FASE ACTUAL
            </span>
            <div className="px-2 py-0.5 rounded bg-surface border border-border-subtle font-label-md text-label-md text-accent-presupuesto tracking-wide whitespace-nowrap">
              {phaseName}
            </div>
          </div>

          <div
            className={`px-2.5 py-1 rounded bg-surface border font-label-md text-label-md font-semibold tracking-wider uppercase whitespace-nowrap ${
              isCrisis
                ? 'border-accent-crisis text-accent-crisis bg-accent-crisis/10 animate-pulse'
                : 'border-accent-presupuesto/40 text-accent-presupuesto'
            }`}
          >
            {isCrisis ? 'ALERTA DE CRISIS' : phaseCode}
          </div>
        </div>

        {/* Cronómetro y controles del Host */}
        <div className="flex items-center gap-space-md">
          <div
            className={`flex items-center gap-space-xs px-3.5 py-1.5 rounded-lg border shadow-inner ${
              isCrisis
                ? 'bg-accent-crisis/10 border-accent-crisis text-accent-crisis'
                : 'bg-surface border-border-subtle text-accent-electricidad'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">timer</span>
            <div className="flex flex-col">
              <span className="font-label-sm text-[10px] text-text-secondary uppercase leading-none">
                {sinCronometro ? 'SIN CRONÓMETRO' : 'TIEMPO RESTANTE'}
              </span>
              <span
                id="countdown"
                className="font-metric-display-mobile text-metric-display-mobile font-bold tracking-wider leading-none tabular-nums mt-0.5"
              >
                {formattedTime}
              </span>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 bg-surface rounded-lg font-label-sm text-label-sm border border-border-subtle ${
                realtime === 'suscrito'
                  ? 'text-text-secondary'
                  : realtime === 'error'
                    ? 'text-accent-gas'
                    : 'text-text-secondary'
              }`}
              title={phaseLabel(phase)}
            >
              <span className="material-symbols-outlined text-[16px] text-accent-eficiencia">
                {realtimeIcon(realtime)}
              </span>
              <span>{realtimeLabel(realtime)}</span>
            </div>

            {showControls && onTriggerCrisis && (
              <button
                type="button"
                onClick={onTriggerCrisis}
                disabled={busy || isCrisis}
                className={`h-10 px-3.5 rounded-lg font-label-md text-label-md font-bold uppercase tracking-wider transition-all flex items-center gap-2 shadow-sm active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed ${
                  isCrisis
                    ? 'bg-accent-crisis text-white'
                    : 'bg-primary-container text-on-primary-container hover:opacity-90'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {isCrisis ? 'warning' : 'bolt'}
                </span>
                <span>{isCrisis ? 'CRISIS ACTIVA' : 'DISPARAR CRISIS'}</span>
              </button>
            )}

            {showControls && onAdvancePhase && nextPhaseLabel && (
              <button
                type="button"
                onClick={onAdvancePhase}
                disabled={busy}
                className="h-10 px-3.5 rounded-lg bg-surface-container-high text-text-primary font-label-md text-label-md font-bold uppercase tracking-wider transition-colors hover:bg-surface-bright active:scale-95 flex items-center gap-2 shadow-sm border border-border-subtle disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[18px]">skip_next</span>
                <span className="whitespace-nowrap">{nextPhaseLabel}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
