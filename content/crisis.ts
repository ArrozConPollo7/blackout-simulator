/**
 * La crisis energetica y su votacion colectiva (plan 2.3 y 3): contenido.
 *
 * Todo lo que decide esta partida sale de la semilla (`engine/rng.ts`), en claves con
 * nombre propio y documentadas para que nadie reutilice una y cambie un guion ya auditado:
 *
 *   'crisis'           -> intensidad del alza de tarifa (20-45%)
 *   'crisis-variante'  -> efecto acompanante (solo luz, o luz y gas)
 *   'crisis-medidas'   -> las 3 medidas colectivas que se votan
 *
 * El MOMENTO de la crisis no se sortea: lo dispara el Host cuando la clase va por donde
 * va (es una decision de ritmo de aula, no un numero).
 */

import type {
  CrisisMeasure,
  CrisisMeasureEffect,
  CrisisVariantInfo,
  CrisisVote,
  CrisisOutcome,
} from '../types/game.ts';
import {
  CRISIS_RATE_MAX,
  CRISIS_RATE_MIN,
  CRISIS_RATE_STEP,
  costoGas,
} from './economy.ts';
import { intBetween, pick, rngFor, sample } from '../engine/rng.ts';

// ---------------------------------------------------------------------------
// Intensidad y variante del evento sorpresa
// ---------------------------------------------------------------------------

/** Efecto que acompania al alza de tarifa en esta partida. */
export type CrisisVariant = CrisisVariantInfo;

export const CRISIS_VARIANTS: CrisisVariant[] = [
  {
    id: 'solo-electricidad',
    label: 'La red se sobrecarga: sube la luz.',
    gasSurchargeRate: 0,
  },
  {
    id: 'luz-y-gas',
    label: 'La red se sobrecarga y el gas sube con ella.',
    gasSurchargeRate: 0.15,
  },
];

/**
 * Intensidad del alza de tarifa de esta partida, en tanto por uno (0,20 - 0,45).
 * Antes era siempre 0,30: el numero deja de ser memorizable, que era medio problema.
 */
export function crisisRateFor(seed: number): number {
  const pasos = Math.round((CRISIS_RATE_MAX - CRISIS_RATE_MIN) / CRISIS_RATE_STEP);
  const paso = intBetween(rngFor(seed, 'crisis'), 0, pasos);
  return Number((CRISIS_RATE_MIN + paso * CRISIS_RATE_STEP).toFixed(2));
}

/** Variante acompanante del evento sorpresa para esta partida. */
export function crisisVariantFor(seed: number): CrisisVariant {
  return pick(rngFor(seed, 'crisis-variante'), CRISIS_VARIANTS);
}

/** Recargo en pesos que la variante le cobra a un equipo por su gas acumulado. */
export function crisisGasSurcharge(variant: CrisisVariant, gasAcumulado: number): number {
  if (variant.gasSurchargeRate <= 0) return 0;
  return Math.round(costoGas(Math.max(0, gasAcumulado)) * variant.gasSurchargeRate);
}

// ---------------------------------------------------------------------------
// Medidas colectivas que se votan (plan 3)
// ---------------------------------------------------------------------------

/**
 * Las cuatro respuestas posibles a una crisis de red, cada una con su trade-off:
 * repartir el sacrificio, pagar por lo que se consume, ayudarse entre equipos o invertir.
 * La partida ofrece TRES de las cuatro: la discusion cambia de una clase a otra.
 */
export const CRISIS_MEASURES: CrisisMeasure[] = [
  {
    id: 'racionamiento-parejo',
    label: 'Racionamiento parejo',
    description:
      'Cada casa recorta un 15% su consumo eléctrico y un 10% el de gas. Nadie se queda sin servicio, pero todos pierden algo de confort (-3 de eficiencia).',
    severity: 3,
    effect: { electricidadPct: -15, gasPct: -10, eficiencia: -3 } satisfies CrisisMeasureEffect,
  },
  {
    id: 'tarifa-emergencia',
    label: 'Tarifa de emergencia',
    description:
      'Sin cortes ni racionamiento: la factura eléctrica ya acumulada sube un 40%. Paga más quien más consumió durante la partida.',
    severity: 4,
    effect: { facturaElectricidadPct: 40 } satisfies CrisisMeasureEffect,
  },
  {
    id: 'fondo-ayuda-mutua',
    label: 'Fondo de ayuda mutua',
    description:
      'Los equipos con más presupuesto aportan el 20% de lo que les sobra por encima del promedio del aula, y ese fondo se reparte a partes iguales entre los que van por debajo.',
    severity: 2,
    effect: { fondoSolidarioPct: 20 } satisfies CrisisMeasureEffect,
  },
  {
    id: 'compra-comunitaria',
    label: 'Compra comunitaria',
    description:
      'El barrio compra equipos eficientes a medias: cada equipo pone $6.000 y todos bajan un 8% su consumo eléctrico y un 5% el de gas (+1 de eficiencia).',
    severity: 1,
    effect: { presupuesto: -6000, electricidadPct: -8, gasPct: -5, eficiencia: 1 } satisfies CrisisMeasureEffect,
  },
];

/** Cuantas medidas se ponen a votacion en cada partida (plan 3.1: 2-3). */
export const CRISIS_MEASURE_COUNT = 3;

/** Medidas que ofrece esta partida, de la mas suave a la mas severa (orden de papeleta). */
export function crisisMeasuresFor(seed: number): CrisisMeasure[] {
  return sample(rngFor(seed, 'crisis-medidas'), CRISIS_MEASURES, CRISIS_MEASURE_COUNT).sort(
    (a, b) => a.severity - b.severity,
  );
}

export function crisisMeasureById(
  measures: readonly CrisisMeasure[],
  id: string,
): CrisisMeasure | undefined {
  return measures.find((m) => m.id === id);
}

/**
 * Votacion resuelta: mayoria simple; en empate (o sin votos) gana la medida MAS SEVERA
 * del recuento, y el aula se entera de que no se puso de acuerdo (plan 3.1.4).
 * Puro y deterministico: el Worker solo tiene que persistir el resultado.
 */
export function countCrisisVotes(
  measures: readonly CrisisMeasure[],
  votes: readonly CrisisVote[],
): CrisisOutcome | null {
  if (measures.length === 0) return null;

  const tally = measures.map((measure) => ({
    measure,
    votes: votes.filter((v) => v.measureId === measure.id).length,
  }));

  const maxVotes = Math.max(...tally.map((t) => t.votes));
  const ganadoras = tally.filter((t) => t.votes === maxVotes);
  const empate = ganadoras.length > 1;

  // Desempate explicito: la medida mas severa (y a igual severidad, la primera del orden).
  const ganadora = (empate ? [...ganadoras].sort((a, b) => b.measure.severity - a.measure.severity) : ganadoras)[0];

  return {
    measureId: ganadora.measure.id,
    label: ganadora.measure.label,
    description: ganadora.measure.description,
    effect: ganadora.measure.effect,
    votes: ganadora.votes,
    totalVotes: votes.length,
    tie: empate,
  };
}
