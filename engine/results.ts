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
  /** De dónde sale `puntos`: eficiencia, consumo ahorrado y economía, por separado. */
  desglose: ReturnType<typeof desglosePuntaje>;
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
 * Puntaje final: los tres objetivos del documento, con la eficiencia como eje principal.
 *
 *   eficiencia → 10 puntos por punto (0-1000). Es el eje que mide el mensaje del juego:
 *                servicio/confort mantenido por unidad de consumo.
 *   consumo    → 1 punto por kWh y 1 por m³ de gas por debajo de la referencia (0-100 c/u).
 *                Lo que de verdad se dejó de usar, no lo que se declaró.
 *   economía   → 1 punto por cada $2.000 de presupuesto restante (0-50). Lo que costó
 *                conseguir ese ahorro (inversiones y facturas).
 *
 * Consumo y economía pesan juntos hasta ~20%: suficiente para que "dejar de consumir" y
 * "gastar de más" no sean gratis, y no tanto como para dar la vuelta a una diferencia grande
 * de eficiencia — la tesis del test de balanceo (la extremista ahorra más y aun así pierde)
 * sigue en pie. Antes solo contaba la eficiencia y el dinero valía 5 puntos: el documento
 * prometía tres ejes y el código medía uno.
 */
export function puntosFor(team: TeamState): number {
  const ahorroElectrico = Math.max(0, CONSUMO_REFERENCIA_ELECTRICIDAD - team.electricidad);
  const ahorroGas = Math.max(0, CONSUMO_REFERENCIA_GAS - team.gas);
  const economia = Math.max(0, Math.min(team.presupuesto, PRESUPUESTO_INICIAL)) / 2000;
  return Math.round(
    team.eficiencia * 10 + Math.min(ahorroElectrico, 100) + Math.min(ahorroGas, 100) + economia,
  );
}

/** Desglose del puntaje, para explicarlo en pantalla (nunca un número sin origen). */
export function desglosePuntaje(team: TeamState): {
  eficiencia: number;
  consumo: number;
  economia: number;
  total: number;
} {
  const ahorroElectrico = Math.max(0, CONSUMO_REFERENCIA_ELECTRICIDAD - team.electricidad);
  const ahorroGas = Math.max(0, CONSUMO_REFERENCIA_GAS - team.gas);
  const economia = Math.max(0, Math.min(team.presupuesto, PRESUPUESTO_INICIAL)) / 2000;
  const eficiencia = team.eficiencia * 10;
  const consumo = Math.min(ahorroElectrico, 100) + Math.min(ahorroGas, 100);
  return {
    eficiencia: round2(eficiencia),
    consumo: round2(consumo),
    economia: round2(economia),
    total: puntosFor(team),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Comparador del ranking: puntaje desc (los tres ejes), y solo para puntajes idénticos
 * eficiencia, presupuesto e id — determinista de punta a punta. Ordenar por eficiencia a
 * secas dejaba fuera el consumo, que es medio mensaje del juego.
 */
export function compareTeams(a: TeamState, b: TeamState): number {
  const pa = puntosFor(a);
  const pb = puntosFor(b);
  if (pb !== pa) return pb - pa;
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
    desglose: desglosePuntaje(team),
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
