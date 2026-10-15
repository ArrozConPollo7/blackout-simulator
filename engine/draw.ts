/**
 * Sorteo de contenido de la partida (plan 1.1). Vive en el motor, no en el contenido:
 * `content/` declara que existe, `engine/` decide que le toca a cada equipo.
 *
 * La clave del sorteo es el CASO, no el id del equipo. El id del equipo es un UUID nuevo en
 * cada partida: si el sorteo dependiera de el, fijar `GAME_SEED` para repetir un guion en
 * clase no repetiria nada (medido: dos partidas con la misma semilla repartian situaciones
 * distintas). Con el caso como clave, (semilla + casos) reproduce la partida entera, y como
 * en una partida no hay dos equipos con el mismo caso, cada mesa recibe su propio reparto.
 *
 * Determinista y sin estado: el Worker recalcula el sorteo en cada peticion y obtiene lo
 * mismo, asi que no hay nada que persistir ni que migrar.
 */

import type { DecisionScenario } from '../content/decisions.ts';
import { CASE_BY_ID } from '../content/cases.ts';
import {
  ROUND2_DRAW_MAX,
  ROUND2_DRAW_MIN,
  SCENARIOS_BY_ID,
  pesoEficienciaR2,
  scenariosForCase,
} from '../content/decisions.ts';
import { intBetween, rngFor, sample } from './rng.ts';

/** Clave del sorteo de escenarios. Parte del contrato de reproducibilidad. */
export const ESCENARIOS_KEY = 'escenarios';

/**
 * Situaciones de Ronda 2 que le tocan al equipo de este caso, en orden sorteado.
 * Se sortean entre las que sus aparatos permiten: entre 3 y 4 (plan 1.1).
 *
 * `applianceIds` solo se usa cuando no hay caso (herramientas y tests): sin caso se juega
 * contra el catalogo completo.
 */
export function drawnScenarioIds(
  seed: number,
  caseId: string | null,
  applianceIds?: string[] | null,
): string[] {
  const aparatos = applianceIds !== undefined ? applianceIds : CASE_BY_ID[caseId ?? '']?.appliances ?? null;
  const jugables = scenariosForCase('decidir', aparatos);
  if (jugables.length === 0) return [];
  const rng = rngFor(seed, ESCENARIOS_KEY, caseId ?? 'sin-caso');
  const techo = Math.min(ROUND2_DRAW_MAX, jugables.length);
  if (jugables.length <= ROUND2_DRAW_MIN) return sample(rng, jugables, jugables.length).map((s) => s.id);
  const count = intBetween(rng, ROUND2_DRAW_MIN, techo);
  return sample(rng, jugables, count).map((s) => s.id);
}

/** Las mismas situaciones, resueltas a contenido. */
export function drawnScenarios(
  seed: number,
  caseId: string | null,
  applianceIds?: string[] | null,
): DecisionScenario[] {
  return drawnScenarioIds(seed, caseId, applianceIds)
    .map((id) => SCENARIOS_BY_ID[id])
    .filter((s): s is DecisionScenario => Boolean(s));
}

/** Atajo para el Worker, que siempre tiene el `caseId` a mano. */
export function drawnScenarioIdsForCase(seed: number, caseId: string): string[] {
  return drawnScenarioIds(seed, caseId);
}

/** Atajo equivalente para el contenido. */
export function drawnScenariosForCase(seed: number, caseId: string): DecisionScenario[] {
  return drawnScenarios(seed, caseId);
}

/**
 * Peso del delta de eficiencia de cada situacion sorteada para ese caso.
 * Reparte los mismos 24 puntos entre todos, jueguen 3 o 4 situaciones.
 */
export function pesoForTeam(seed: number, caseId: string): number {
  return pesoEficienciaR2(drawnScenarioIdsForCase(seed, caseId).length);
}

/** true si la situacion le fue sorteada a ese caso (validacion del Worker). */
export function teamPlaysScenario(seed: number, caseId: string, scenarioId: string): boolean {
  return drawnScenarioIdsForCase(seed, caseId).includes(scenarioId);
}
