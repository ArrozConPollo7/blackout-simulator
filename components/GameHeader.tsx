'use client';

import React, { useEffect, useState } from 'react';
import type { Phase } from '@/types/game';
import { PHASE_PLAN, durationOf } from '@/content/phases';
import { formatRemaining, phaseLabel, realtimeIcon, stepIndex } from '@/lib/ui';
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

/** Últimos 20 s de una fase: el cronómetro entra en pulso de urgencia. */
const AVISO_URGENTE_MS = 20_000;
/** Red de seguridad: si una acción del anfitrión no responde, el botón no queda pegado. */
const ESPERA_MAXIMA_BOTON_MS = 8_000;

/**
 * Rótulo del indicador de enlace. Es lenguaje de sala (el estado del canal entre el
 * proyector y las mesas), nunca vocabulario de infraestructura: el proyector es público.
 */
const ENLACE_LABEL: Record<RealtimeStatus, string> = {
  suscrito: 'EN RED',
  conectando: 'SINCRONIZANDO…',
  error: 'SEÑAL DEGRADADA',
  desactivado: 'SIN ENLACE',
};

/**
 * Header persistente del Host. El tiempo restante se recalcula contra `timerEndsAt`
 * en cada tick (Fase 2.3): si el reloj del cliente está desfasado, se corrige con
 * `clockSkewMs` medido contra el reloj del servicio.
 */
export default function GameHeader({
  phaseName = 'En Juego — Ronda de decisiones',
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

  // Barra de urgencia: se agota contra la duración REAL de la fase (content/phases.ts).
  const duracion = phase ? durationOf(phase) : null;
  const fraccion =
    remaining !== null && duracion ? Math.max(0, Math.min(1, remaining / duracion)) : null;
  const urgente = remaining !== null && remaining > 0 && remaining <= AVISO_URGENTE_MS;
  const zona: 'neutro' | 'verde' | 'ambar' | 'rojo' = isCrisis
    ? 'rojo'
    : fraccion === null
      ? 'neutro'
      : fraccion > 0.5
        ? 'verde'
        : fraccion > 0.2
          ? 'ambar'
          : 'rojo';

  const cajaTimer =
    zona === 'rojo'
      ? 'bg-accent-crisis/10 border-accent-crisis text-accent-crisis'
      : zona === 'ambar'
        ? 'bg-accent-electricidad/10 border-accent-electricidad/60 text-accent-electricidad'
        : zona === 'verde'
          ? 'bg-surface border-accent-eficiencia/40 text-accent-eficiencia'
          : 'bg-surface border-border-subtle text-text-secondary';
  const barraTimer =
    zona === 'rojo'
      ? 'bg-accent-crisis'
      : zona === 'ambar'
        ? 'bg-accent-electricidad'
        : zona === 'verde'
          ? 'bg-accent-eficiencia'
          : 'bg-text-secondary/40';

  // Los botones del anfitrión responden al instante: estado presionado inmediato y
  // 'ABRIENDO…' mientras el servicio confirma la orden (antes parecía que había que
  // pulsar dos veces porque el botón no daba ninguna señal hasta el siguiente refresco).
  const [pendiente, setPendiente] = useState<'crisis' | 'avanzar' | null>(null);

  useEffect(() => {
    if (!busy) setPendiente(null);
  }, [busy]);

  useEffect(() => {
    if (!pendiente) return;
    const id = setTimeout(() => setPendiente(null), ESPERA_MAXIMA_BOTON_MS);
    return () => clearTimeout(id);
  }, [pendiente]);

  const dispararCrisis = () => {
    if (pendiente || busy || isCrisis) return;
    setPendiente('crisis');
    onTriggerCrisis?.();
  };

  const avanzarFase = () => {
    if (pendiente || busy) return;
    setPendiente('avanzar');
    onAdvancePhase?.();
  };

  const pasoActual = stepIndex(phase);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-bg-surface border-b border-border-subtle shadow-lg">
      <div className="h-20 w-full px-margin-desktop flex items-center justify-between gap-4">
        {/* Título, recorrido de fases y estado */}
        <div className="flex items-center gap-space-md min-w-0 overflow-hidden">
          <div className="flex items-center gap-space-xs">
            <div
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                isCrisis ? 'bg-accent-crisis animate-ping' : 'bg-accent-eficiencia animate-pulse'
              }`}
            ></div>
            <span className="font-headline-md text-headline-md tracking-wider text-text-primary uppercase font-bold whitespace-nowrap">
              Energía en Crisis
            </span>
          </div>

          <div className="h-6 w-px bg-border-subtle hidden xl:block"></div>

          {/* Recorrido de la partida como pasos 1..6, con el actual encendido */}
          <div className="hidden xl:flex flex-col gap-1">
            <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-widest whitespace-nowrap">
              PASO {pasoActual + 1} DE {PHASE_PLAN.length} · {phaseName}
            </span>
            <ol className="flex items-center gap-1" aria-label="Recorrido de fases">
              {PHASE_PLAN.map((plan, indice) => {
                const hecho = indice < pasoActual;
                const actual = indice === pasoActual;
                return (
                  <li key={plan.phase} className="flex items-center gap-1">
                    <span
                      title={`${plan.code} — ${plan.label}`}
                      className={`w-6 h-6 rounded-full flex items-center justify-center font-label-sm text-[11px] font-bold tabular-nums border transition-colors ${
                        actual
                          ? isCrisis
                            ? 'bg-accent-crisis text-white border-accent-crisis eec-step-actual'
                            : 'bg-accent-presupuesto text-on-primary-container border-accent-presupuesto eec-step-actual'
                          : hecho
                            ? 'bg-accent-eficiencia/15 text-accent-eficiencia border-accent-eficiencia/40'
                            : 'bg-surface text-text-secondary border-border-subtle'
                      }`}
                    >
                      {indice + 1}
                    </span>
                    {indice < PHASE_PLAN.length - 1 && (
                      <span
                        className={`h-px w-2.5 ${
                          hecho ? 'bg-accent-eficiencia/50' : 'bg-border-subtle'
                        }`}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

          {/* El rótulo de fase solo aparece donde sobra sitio: el recorrido de pasos ya la nombra
              y en pantallas de proyector normales empujaba el cronómetro fuera de su caja. */}
          <div
            className={`hidden 2xl:flex px-2.5 py-1 rounded bg-surface border font-label-md text-label-md font-semibold tracking-wider uppercase whitespace-nowrap ${
              isCrisis
                ? 'border-accent-crisis text-accent-crisis bg-accent-crisis/10'
                : 'border-accent-presupuesto/40 text-accent-presupuesto'
            }`}
          >
            {isCrisis ? 'ALERTA TARIFARIA' : phaseCode}
          </div>
        </div>

        {/* Cronómetro grande, enlace y controles del Host */}
        <div className="flex items-center gap-space-md shrink-0">
          <div
            className={`flex items-center gap-space-sm px-3.5 py-1.5 rounded-lg border shadow-inner ${cajaTimer} ${
              urgente ? 'eec-timer-urgent' : ''
            }`}
          >
            <span className="material-symbols-outlined text-[26px]">timer</span>
            <div className="flex flex-col gap-1">
              <span className="font-label-sm text-[10px] text-text-secondary uppercase leading-none">
                {sinCronometro ? 'SIN CRONÓMETRO' : 'TIEMPO RESTANTE'}
              </span>
              <span
                id="countdown"
                className="eec-timer-digits font-metric-display text-[34px] font-bold tracking-wider leading-none tabular-nums"
              >
                {formattedTime}
              </span>
              {/* Barra que se agota: verde → ámbar → rojo (transform, nunca width). Solo
                  aparece cuando hay cronómetro: en fases sin reloj no se dibuja un carril vacío. */}
              {!sinCronometro && (
                <span
                  className="relative block h-1.5 w-full min-w-[148px] rounded-full bg-surface-container-highest overflow-hidden"
                  aria-hidden="true"
                >
                  <span
                    className={`eec-timer-bar block h-full w-full rounded-full origin-left ${barraTimer}`}
                    style={{ transform: `scaleX(${fraccion ?? 0})` }}
                  />
                </span>
              )}
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 bg-surface rounded-lg font-label-sm text-label-sm border border-border-subtle ${
                realtime === 'error' ? 'text-accent-gas' : 'text-text-secondary'
              }`}
              title={phaseLabel(phase)}
            >
              <span className="material-symbols-outlined text-[16px] text-accent-eficiencia">
                {realtimeIcon(realtime)}
              </span>
              <span>{ENLACE_LABEL[realtime]}</span>
            </div>

            {showControls && onTriggerCrisis && (
              <button
                type="button"
                onClick={dispararCrisis}
                disabled={busy || isCrisis || pendiente !== null}
                aria-busy={pendiente === 'crisis'}
                className={`h-10 px-3.5 rounded-lg font-label-md text-label-md font-bold uppercase tracking-wider transition-all flex items-center gap-2 shadow-sm disabled:cursor-not-allowed ${
                  isCrisis
                    ? 'bg-accent-crisis text-white'
                    : 'bg-primary-container text-on-primary-container hover:opacity-90'
                } ${
                  // Respuesta inmediata al pulsar: el botón se hunde antes de que llegue la respuesta.
                  pendiente === 'crisis'
                    ? 'translate-y-px scale-[0.97] brightness-110 ring-2 ring-white/40'
                    : 'active:scale-95'
                } disabled:opacity-60`}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {isCrisis ? 'warning' : pendiente === 'crisis' ? 'hourglass_top' : 'bolt'}
                </span>
                <span>
                  {pendiente === 'crisis' ? 'ABRIENDO…' : isCrisis ? 'CRISIS ACTIVA' : 'DISPARAR CRISIS'}
                </span>
              </button>
            )}

            {showControls && onAdvancePhase && nextPhaseLabel && (
              <button
                type="button"
                onClick={avanzarFase}
                disabled={busy || pendiente !== null}
                aria-busy={pendiente === 'avanzar'}
                className={`h-10 px-3.5 rounded-lg bg-surface-container-high text-text-primary font-label-md text-label-md font-bold uppercase tracking-wider transition-colors hover:bg-surface-bright flex items-center gap-2 shadow-sm border border-border-subtle disabled:cursor-not-allowed ${
                  pendiente === 'avanzar'
                    ? 'translate-y-px scale-[0.97] bg-surface-bright ring-2 ring-accent-presupuesto/60'
                    : 'active:scale-95'
                } disabled:opacity-60`}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {pendiente === 'avanzar' ? 'hourglass_top' : 'skip_next'}
                </span>
                <span className="whitespace-nowrap">
                  {pendiente === 'avanzar' ? 'ABRIENDO…' : nextPhaseLabel}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        /* La barra de urgencia se agota con transform (nunca width). */
        .eec-timer-bar {
          transition: transform 420ms linear, background-color 300ms ease-out;
          will-change: transform;
        }

        /* Últimos 20 s: pulso del cronómetro. */
        .eec-timer-urgent {
          animation: eecTimerPulse 1.05s ease-in-out infinite;
        }
        .eec-timer-urgent .eec-timer-digits {
          animation: eecTimerBlink 1.05s steps(1, end) infinite;
        }

        @keyframes eecTimerPulse {
          0%,
          100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(255, 59, 78, 0);
          }
          50% {
            transform: scale(1.035);
            box-shadow: 0 0 0 3px rgba(255, 59, 78, 0.28);
          }
        }
        @keyframes eecTimerBlink {
          0%,
          55% {
            opacity: 1;
          }
          56%,
          100% {
            opacity: 0.72;
          }
        }

        /* El paso activo del recorrido queda encendido con un latido seco. */
        .eec-step-actual {
          box-shadow: 0 0 0 3px rgba(62, 198, 240, 0.18);
        }

        @media (prefers-reduced-motion: reduce) {
          .eec-timer-urgent,
          .eec-timer-urgent .eec-timer-digits {
            animation: none !important;
          }
          .eec-timer-bar {
            transition: none !important;
          }
        }
      `}</style>
    </header>
  );
}
