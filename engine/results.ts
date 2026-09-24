/**
 * Resultado final (Ronda 3 — "El precio").
 * Ranking ordenado por eficiencia; los empates se resuelven por presupuesto restante.
 */

import type { GameState, TeamState } from '../types/game.ts';
import {
  CONSUMO_REFERENCIA_ELECTRICIDAD,
  CONSUMO_REFERENCIA_GAS,
  PRESUPUESTO_INICIAL,
  costoConsumo,
} from '../content/economy.ts';

export interface TeamResult {
  rank: number;
  team: TeamState;
  puntos: number;
  costoConsumo: number;
  ahorroElectricidadKwh: number;
  ahorroGasM3: number;
}

export interface FinalResults {
  generatedAt: string;
  ranking: TeamResult[];
  leaderId: string | null;
  promedioEficiencia: number;
  promedioPresupuesto: number;
  promedioConsumoElectrico: number;
}

/**
 * Puntos de resiliencia: 10 puntos por cada punto de eficiencia mas hasta 5 puntos por
 * el presupuesto restante. El peso del dinero (5) es menor que el de un punto de
 * eficiencia (10), asi que ordenar por `puntos` da EXACTAMENTE el mismo orden que
 * ordenar por (eficiencia, presupuesto): el ranking no cambia de criterio.
 */
export function puntosFor(team: TeamState): number {
  const dinero = Math.max(0, Math.min(team.presupuesto, PRESUPUESTO_INICIAL)) / 20000;
  return Math.round(team.eficiencia * 10 + dinero);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Comparador del ranking: eficiencia desc, presupuesto desc, id asc (determinista). */
export function compareTeams(a: TeamState, b: TeamState): number {
  if (b.eficiencia !== a.eficiencia) return b.eficiencia - a.eficiencia;
  if (b.presupuesto !== a.presupuesto) return b.presupuesto - a.presupuesto;
  return a.id.localeCompare(b.id);
}

export function calculateFinalResults(state: GameState, now: Date = new Date()): FinalResults {
  const ordered = [...state.teams].sort(compareTeams);
  const ranking: TeamResult[] = ordered.map((team, index) => ({
    rank: index + 1,
    team,
    puntos: puntosFor(team),
    costoConsumo: Math.round(costoConsumo({ electricidad: team.electricidad, gas: team.gas })),
    ahorroElectricidadKwh: round2(CONSUMO_REFERENCIA_ELECTRICIDAD - team.electricidad),
    ahorroGasM3: round2(CONSUMO_REFERENCIA_GAS - team.gas),
  }));

  const n = ranking.length || 1;
  const sum = (pick: (r: TeamResult) => number) =>
    ranking.reduce((acc, r) => acc + pick(r), 0);

  return {
    generatedAt: now.toISOString(),
    ranking,
    leaderId: ranking[0]?.team.id ?? null,
    promedioEficiencia: round2(sum((r) => r.team.eficiencia) / n),
    promedioPresupuesto: Math.round(sum((r) => r.team.presupuesto) / n),
    promedioConsumoElectrico: round2(sum((r) => r.team.electricidad) / n),
  };
}
