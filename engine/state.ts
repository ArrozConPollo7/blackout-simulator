/**
 * Motor de juego: maquina de fases y estado inicial.
 * Puro: sin red, sin DOM, sin Supabase. Se puede testear de forma aislada.
 */

import type { GameState, Phase, TeamState } from '../types/game.ts';
import { canTransition, durationOf, nextPhaseOf } from '../content/phases.ts';
import {
  CONSUMO_REFERENCIA_ELECTRICIDAD,
  CONSUMO_REFERENCIA_GAS,
  EFICIENCIA_INICIAL,
  PRESUPUESTO_INICIAL,
} from '../content/economy.ts';

/** Error de transicion invalida: el Worker lo traduce a 409. */
export class PhaseTransitionError extends Error {
  readonly from: Phase;
  readonly to: Phase;

  constructor(from: Phase, to: Phase) {
    super(`Transicion de fase invalida: ${from} -> ${to}`);
    this.name = 'PhaseTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function initialTeamState(identity: Pick<TeamState, 'id' | 'name' | 'color'>): TeamState {
  return {
    id: identity.id,
    name: identity.name,
    color: identity.color,
    electricidad: CONSUMO_REFERENCIA_ELECTRICIDAD,
    gas: CONSUMO_REFERENCIA_GAS,
    presupuesto: PRESUPUESTO_INICIAL,
    eficiencia: EFICIENCIA_INICIAL,
    puntos: 0,
  };
}

export function initialGameState(teams: TeamState[], now: Date = new Date()): GameState {
  return {
    phase: 'lobby',
    timerEndsAt: now.toISOString(),
    crisisTriggered: false,
    teams,
  };
}

/**
 * Avanza la maquina de fases exactamente un paso.
 * `timerEndsAt` se recalcula desde la duracion de la fase destino: es la unica
 * fuente de verdad del tiempo, ningun cliente cuenta segundos por su cuenta.
 * En fases sin cronometro (lobby, resultados) la marca queda en `now`.
 */
export function advancePhase(state: GameState, nextPhase: Phase, now: Date = new Date()): GameState {
  if (!canTransition(state.phase, nextPhase)) {
    throw new PhaseTransitionError(state.phase, nextPhase);
  }
  const duration = durationOf(nextPhase);
  return {
    ...state,
    phase: nextPhase,
    timerEndsAt: new Date(now.getTime() + (duration ?? 0)).toISOString(),
    crisisTriggered: state.crisisTriggered,
  };
}

export { nextPhaseOf };
