/**
 * Plan de fases de la partida. Fuente unica de verdad para:
 *  - el motor (duracion y transiciones),
 *  - el Worker (validacion),
 *  - el frontend (que fases tienen cronometro, para no inventar tiempos locales).
 *
 * `timerEndsAt` siempre es una fecha absoluta ISO: ningun cliente cuenta segundos por
 * su cuenta, solo restan contra esa marca.
 */

import type { Phase } from '../types/game.ts';

export interface PhasePlan {
  phase: Phase;
  code: string; // etiqueta SCADA para el header del Host
  label: string;
  timed: boolean;
  durationMs: number | null;
}

const MINUTE = 60 * 1000;

export const PHASE_PLAN: PhasePlan[] = [
  { phase: 'lobby', code: 'FASE 1: LOBBY', label: 'Registro de equipos', timed: false, durationMs: null },
  {
    phase: 'investigar',
    code: 'FASE 2: INVESTIGAR',
    label: 'Detección de consumos ocultos',
    timed: true,
    durationMs: 2 * MINUTE,
  },
  {
    phase: 'decidir',
    code: 'FASE 3: DECIDIR',
    label: 'Decisiones de eficiencia',
    timed: true,
    durationMs: 3 * MINUTE,
  },
  {
    phase: 'crisis',
    code: 'FASE 4: CRISIS DE RED',
    label: 'Crisis energética — tarifa +30%',
    timed: true,
    durationMs: 2 * MINUTE,
  },
  {
    phase: 'decidir_2',
    code: 'FASE 5: ÚLTIMAS DECISIONES',
    label: 'Últimas decisiones bajo crisis',
    timed: true,
    durationMs: 2 * MINUTE,
  },
  {
    phase: 'resultados',
    code: 'FASE 6: RESULTADOS',
    label: 'Podio y cierre educativo',
    timed: false,
    durationMs: null,
  },
];

export const PHASE_ORDER: Phase[] = PHASE_PLAN.map((p) => p.phase);

export const PHASE_BY_NAME: Record<Phase, PhasePlan> = Object.fromEntries(
  PHASE_PLAN.map((p) => [p.phase, p]),
) as Record<Phase, PhasePlan>;

export function phaseIndex(phase: Phase): number {
  return PHASE_ORDER.indexOf(phase);
}

/** Fase siguiente en la secuencia, o null si ya es la ultima. */
export function nextPhaseOf(phase: Phase): Phase | null {
  const i = phaseIndex(phase);
  return i >= 0 && i < PHASE_ORDER.length - 1 ? PHASE_ORDER[i + 1] : null;
}

/** Solo se permite avanzar de a un paso, nunca retroceder. */
export function canTransition(from: Phase, to: Phase): boolean {
  return phaseIndex(to) === phaseIndex(from) + 1;
}

export function isTimed(phase: Phase): boolean {
  return Boolean(PHASE_BY_NAME[phase]?.timed);
}

export function durationOf(phase: Phase): number | null {
  return PHASE_BY_NAME[phase]?.durationMs ?? null;
}

/** Ronda de decision que corresponde a cada fase (null si la fase no acepta decisiones). */
export function roundForPhase(phase: Phase): 'investigar' | 'decidir' | 'decidir_2' | null {
  if (phase === 'investigar') return 'investigar';
  if (phase === 'decidir') return 'decidir';
  if (phase === 'decidir_2') return 'decidir_2';
  return null;
}
