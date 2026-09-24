/**
 * Evento sorpresa: crisis energetica.
 *
 * Regla del documento del proyecto ("Evento sorpresa", seccion 3):
 * el precio de la electricidad sube 30% y el multiplicador se aplica sobre el
 * CONSUMO ACUMULADO DE CADA EQUIPO, no de forma pareja: un equipo que ya redujo
 * (72 kWh) paga 30% de 72 kWh y uno que dejo todo encendido (104 kWh) paga 30% de 104.
 * El costo extra se descuenta del presupuesto restante.
 */

import type { GameState, TeamState } from '../types/game.ts';
import { applyEffect } from './decisions.ts';
import { sobrecostoCrisis } from '../content/economy.ts';

/** Sobrecosto que le corresponde a un equipo por el alza de tarifa. */
export function crisisSurchargeFor(team: TeamState): number {
  return sobrecostoCrisis(team.electricidad);
}

/**
 * Dispara la crisis sobre toda la partida.
 * Idempotente: si ya estaba disparada devuelve el mismo estado (nunca cobra dos veces).
 */
export function triggerCrisis(state: GameState): GameState {
  if (state.crisisTriggered) return state;
  return {
    ...state,
    crisisTriggered: true,
    teams: state.teams.map((team) =>
      applyEffect(team, { presupuesto: -crisisSurchargeFor(team) }),
    ),
  };
}
