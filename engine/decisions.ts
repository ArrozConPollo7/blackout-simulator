/**
 * Aplicacion de decisiones. Puro: recibe TeamState + opcion y devuelve un TeamState nuevo.
 * Todos los numeros vienen de `DecisionEffect` (contenido), no de logica condicional.
 */

import type { DecisionEffect, DecisionOption, TeamState } from '../types/game.ts';
import { LIMITES } from '../content/economy.ts';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Aplica un efecto crudo a un equipo, respetando los limites fisicos. */
export function applyEffect(team: TeamState, effect: DecisionEffect): TeamState {
  return {
    ...team,
    electricidad: clamp(round2(team.electricidad + (effect.electricidad ?? 0)), LIMITES.electricidad.min, LIMITES.electricidad.max),
    gas: clamp(round2(team.gas + (effect.gas ?? 0)), LIMITES.gas.min, LIMITES.gas.max),
    presupuesto: Math.round(team.presupuesto + (effect.presupuesto ?? 0)),
    eficiencia: clamp(round2(team.eficiencia + (effect.eficiencia ?? 0)), LIMITES.eficiencia.min, LIMITES.eficiencia.max),
  };
}

export interface OpcionesDeAplicacion {
  /**
   * Peso del delta de eficiencia. Los casos no juegan el mismo numero de situaciones de Ronda 2
   * (6 con los 8 aparatos, 3 con 4), asi que cada situacion reparte `6 / jugables`: todos los
   * equipos tienen la misma oportunidad de ganar o perder eficiencia.
   */
  pesoEficiencia?: number;
  /**
   * Ahorro que el equipo YA capturo en la Ronda 1 sobre los mismos aparatos. El efecto de la
   * Ronda 2 se calcula contra la referencia del aparato, no contra lo que el equipo dejo: sin
   * esto, arreglar el aire en la auditoria y volver a ponerlo a 18 °C en la Ronda 2 salia
   * gratis (el ahorro se conservaba igual). Restando aqui ese ahorro, el aparato vuelve a su
   * consumo real y desperdiciar se paga.
   */
  descontarAhorro?: { electricidad?: number; gas?: number };
}

/**
 * Aplica una opcion de decision a un equipo.
 * Devuelve un objeto nuevo: el TeamState que recibe no se muta.
 *
 * `presupuesto` no se ajusta con el descuento: el costo de una decision es el de su consumo
 * declarado ("lo que cuesta ese dia"), y asi lo dice el contenido. El descuento corrige el
 * ESTADO (kWh/m3), que es lo que se compara al final.
 */
export function applyDecision(
  team: TeamState,
  option: DecisionOption,
  opts: OpcionesDeAplicacion = {},
): TeamState {
  const peso = opts.pesoEficiencia ?? 1;
  const descuento = opts.descontarAhorro;
  if (peso === 1 && !descuento) return applyEffect(team, option.effect);
  const effect: DecisionEffect = {
    ...option.effect,
    electricidad: (option.effect.electricidad ?? 0) - (descuento?.electricidad ?? 0),
    gas: (option.effect.gas ?? 0) - (descuento?.gas ?? 0),
    eficiencia: round2((option.effect.eficiencia ?? 0) * peso),
  };
  return applyEffect(team, effect);
}

/** Resumen textual con numeros concretos (microcopy educativo del documento). */
export function describeEffect(effect: DecisionEffect): string {
  const parts: string[] = [];
  const e = effect.electricidad ?? 0;
  const g = effect.gas ?? 0;
  const p = effect.presupuesto ?? 0;
  const ef = effect.eficiencia ?? 0;

  if (e < 0) parts.push(`ahorró ${formatNumber(-e, 2)} kWh`);
  else if (e > 0) parts.push(`sumó ${formatNumber(e, 2)} kWh al consumo`);

  if (g < 0) parts.push(`ahorró ${formatNumber(-g, 2)} m³ de gas`);
  else if (g > 0) parts.push(`sumó ${formatNumber(g, 2)} m³ de gas`);

  if (parts.length === 0) parts.push('no cambió el consumo');

  if (p !== 0) parts.push(`costo ${formatNumber(Math.abs(p), 0)} $`);
  if (ef !== 0) parts.push(`eficiencia ${ef > 0 ? '+' : ''}${formatNumber(ef, 2)}%`);

  const text = parts.join(', ');
  return `Tu decisión ${text}.`;
}

/**
 * Formatea numeros en convencion es-CO (miles con '.', decimales con ',')
 * de forma determinista, sin depender de ICU del runtime.
 */
export function formatNumber(value: number, decimals = 2): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = value < 0 ? '-' : '';
  return decPart ? `${sign}${withThousands},${decPart}` : `${sign}${withThousands}`;
}
