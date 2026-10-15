/**
 * Votacion colectiva de la crisis (plan 3). Motor puro:
 *   - `resolveVote` decide la medida ganadora (mayoria simple, empate -> la mas severa).
 *   - `applyMeasure` traduce la medida ganadora a un efecto POR EQUIPO y lo aplica.
 *
 * Se aplica "a todos los equipos por igual" en el sentido del plan: la misma regla para
 * todos. Dos medidas cobran distinto a cada equipo a proposito (la tarifa de emergencia
 * castiga a quien mas consumio y el fondo de ayuda mutua mueve dinero de los que van
 * mejor a los que van peor): son las dos reglas que el aula esta votando.
 *
 * Idempotente: si la partida ya tiene medida resuelta, `resolveVote` devuelve el mismo
 * estado y ningun equipo vuelve a pagar.
 */

import type {
  CrisisMeasure,
  CrisisMeasureEffect,
  CrisisOutcome,
  CrisisVote,
  DecisionEffect,
  GameState,
  TeamState,
} from '../types/game.ts';
import { countCrisisVotes } from '../content/crisis.ts';
import { costoElectricidad } from '../content/economy.ts';
import { applyEffect } from './decisions.ts';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Ganador de la votacion (null si la partida no tiene medidas que votar). */
export function resolveVote(
  measures: readonly CrisisMeasure[],
  votes: readonly CrisisVote[],
): CrisisOutcome | null {
  return countCrisisVotes(measures, votes);
}

/**
 * Efecto concreto de una medida sobre un equipo.
 * El reparto solidario no cabe aqui (depende del aula entera): lo resuelve `applyMeasure`.
 */
export function measureEffectFor(team: TeamState, effect: CrisisMeasureEffect): DecisionEffect {
  const delta: DecisionEffect = {};

  if (effect.electricidadPct) {
    delta.electricidad = round2((team.electricidad * effect.electricidadPct) / 100);
  }
  if (effect.gasPct) {
    delta.gas = round2((team.gas * effect.gasPct) / 100);
  }
  if (effect.facturaElectricidadPct) {
    const recargo = Math.round((costoElectricidad(team.electricidad) * effect.facturaElectricidadPct) / 100);
    delta.presupuesto = (delta.presupuesto ?? 0) - recargo;
  }
  if (effect.presupuesto) {
    delta.presupuesto = (delta.presupuesto ?? 0) + effect.presupuesto;
  }
  if (effect.eficiencia) {
    delta.eficiencia = effect.eficiencia;
  }
  return delta;
}

/**
 * Reparto solidario: los equipos por encima del promedio del aula aportan `pct` de su
 * excedente y el fondo se reparte a partes iguales entre los que van por debajo.
 * El dinero no se crea ni se destruye (la suma de deltas es 0, salvo redondeo de pesos).
 */
export function solidarityTransfers(
  teams: readonly TeamState[],
  pct: number,
): Record<string, number> {
  const n = teams.length;
  const deltas: Record<string, number> = {};
  if (n === 0) return deltas;
  const promedio = teams.reduce((acc, t) => acc + t.presupuesto, 0) / n;

  const aportes = teams
    .filter((t) => t.presupuesto > promedio)
    .map((t) => ({ id: t.id, monto: Math.round(((t.presupuesto - promedio) * pct) / 100) }));
  const fondo = aportes.reduce((acc, a) => acc + a.monto, 0);
  const receptores = teams.filter((t) => t.presupuesto < promedio);

  for (const team of teams) deltas[team.id] = 0;
  for (const aporte of aportes) deltas[aporte.id] = -aporte.monto;
  if (receptores.length > 0) {
    const porCabeza = Math.round(fondo / receptores.length);
    for (const receptor of receptores) deltas[receptor.id] += porCabeza;
  } else {
    // Nadie por debajo de la media: el fondo vuelve a quien lo puso (no se pierde dinero).
    for (const aporte of aportes) deltas[aporte.id] += aporte.monto;
  }
  return deltas;
}

export interface AppliedMeasure {
  teams: TeamState[];
  /** Efecto real aplicado a cada equipo, para persistirlo en el historial. */
  deltas: Record<string, DecisionEffect>;
}

/**
 * Aplica la medida ganadora a todos los equipos.
 * Devuelve equipos nuevos (no muta) y el delta real de cada uno, que es lo que el Worker
 * escribe en el historial del equipo (mismo patron que el recargo de la crisis).
 */
export function applyMeasure(
  teams: readonly TeamState[],
  effect: CrisisMeasureEffect,
): AppliedMeasure {
  const solidario =
    effect.fondoSolidarioPct !== undefined ? solidarityTransfers(teams, effect.fondoSolidarioPct) : null;

  const deltas: Record<string, DecisionEffect> = {};
  const aplicados = teams.map((team) => {
    const base = measureEffectFor(team, effect);
    const transferencia = solidario?.[team.id] ?? 0;
    const delta: DecisionEffect = {
      ...base,
      ...(transferencia !== 0 ? { presupuesto: (base.presupuesto ?? 0) + transferencia } : {}),
    };
    deltas[team.id] = delta;
    return applyEffect(team, delta);
  });

  return { teams: aplicados, deltas };
}

export interface CrisisResolution {
  state: GameState;
  outcome: CrisisOutcome | null;
  deltas: Record<string, DecisionEffect>;
}

/**
 * Resuelve la votacion y aplica la medida ganadora sobre toda la partida.
 * Si ya estaba resuelta, devuelve el mismo estado con deltas vacios (nunca cobra dos veces).
 */
export function resolveCrisisVote(state: GameState, votes: readonly CrisisVote[]): CrisisResolution {
  if (state.crisisResolvedMeasureId) return { state, outcome: null, deltas: {} };

  const outcome = resolveVote(state.crisisMeasures, votes);
  if (!outcome) return { state, outcome: null, deltas: {} };

  const aplicado = applyMeasure(state.teams, outcome.effect);
  return {
    state: {
      ...state,
      teams: aplicado.teams,
      crisisVotes: [...votes],
      crisisResolvedMeasureId: outcome.measureId,
    },
    outcome,
    deltas: aplicado.deltas,
  };
}
