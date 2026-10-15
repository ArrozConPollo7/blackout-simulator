/**
 * Evento sorpresa: crisis energetica.
 *
 * Regla del documento del proyecto ("Evento sorpresa", seccion 3):
 * el precio de la electricidad sube y el multiplicador se aplica sobre el CONSUMO ACUMULADO
 * DE CADA EQUIPO, no de forma pareja: un equipo que ya redujo (72 kWh) paga el alza de 72 kWh
 * y uno que dejo todo encendido (104 kWh) la paga de 104. El costo extra se descuenta del
 * presupuesto restante.
 *
 * Dos cosas dejaron de ser fijas (plan 2.3), ambas derivadas de la semilla de la partida:
 *   - la INTENSIDAD del alza (20-45%, antes siempre 30%),
 *   - un efecto acompanante (el gas tambien sube, o no).
 * El MOMENTO sigue en manos del Host: es ritmo de clase, no azar.
 */

import type { GameState, TeamState } from '../types/game.ts';
import { applyEffect } from './decisions.ts';
import { CRISIS_SURCHARGE_RATE, sobrecostoCrisis } from '../content/economy.ts';
import { crisisGasSurcharge } from '../content/crisis.ts';

/** Sobrecosto electrico que le corresponde a un equipo por el alza de tarifa. */
export function crisisSurchargeFor(
  team: TeamState,
  rate: number = CRISIS_SURCHARGE_RATE,
): number {
  return sobrecostoCrisis(team.electricidad, rate);
}

/**
 * Dispara la crisis sobre toda la partida.
 * Idempotente: si ya estaba disparada devuelve el mismo estado (nunca cobra dos veces).
 */
export function triggerCrisis(state: GameState): GameState {
  if (state.crisisTriggered) return state;
  const variante = state.crisisVariant;
  return {
    ...state,
    crisisTriggered: true,
    teams: state.teams.map((team) =>
      applyEffect(team, {
        presupuesto: -(
          crisisSurchargeFor(team, state.crisisRate) + crisisGasSurcharge(variante, team.gas)
        ),
      }),
    ),
  };
}
