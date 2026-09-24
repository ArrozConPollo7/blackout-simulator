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

/**
 * Aplica una opcion de decision a un equipo.
 * Devuelve un objeto nuevo: el TeamState que recibe no se muta.
 */
export function applyDecision(team: TeamState, option: DecisionOption): TeamState {
  return applyEffect(team, option.effect);
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
