/**
 * Catalogo de eventos aleatorios extra (plan 2.2): cortos, injustos a proposito y ajenos a
 * la crisis central. Son la parte del juego que impide que dos partidas se jueguen igual.
 *
 * Reglas de sorteo (en `engine/events.ts`, mismas que el proyecto hermano):
 *   - 0 eventos en `investigar` (ronda de aprendizaje: nadie pierde por azar todavia).
 *   - 1 evento en `decidir`, para toda el aula.
 *   - Un evento nunca se repite dentro de la misma partida.
 *   - Ningun evento puede dejar a un equipo sin ninguna situacion jugable (invariante con
 *     test propio: se filtran los candidatos que rompan esa condicion ANTES de sortear).
 *
 * Lenguaje: el de la casa (nada de jerga tecnica), porque estos textos salen tal cual en el
 * celular del jugador y en la pantalla del Host.
 */

import type { DecisionEffect, GameEventInstance, GameEventKind, Phase } from '../types/game.ts';
import { FALLA_APARATO_RATE, SUBSIDIO_SORPRESA, costoElectricidad, costoGas } from './economy.ts';
import type { ApplianceProfile } from './decisions.ts';

/** Cuantos eventos lleva cada fase. Solo la ronda de decisiones tiene uno. */
export const EVENT_COUNT_BY_ROUND: Record<Phase, number> = {
  lobby: 0,
  investigar: 0,
  decidir: 1,
  crisis: 0,
  crisis_votacion: 0,
  decidir_2: 0,
  resultados: 0,
};

export interface GameEventDefinition {
  id: string;
  kind: GameEventKind;
  title: string;
  /** Material Symbols Outlined (ver Design.md). */
  icon: string;
  /** Necesita un aparato del caso para concretarse (apagon parcial y falla). */
  needsAppliance: boolean;
  description: (applianceName: string | null) => string;
  /** Efecto que se le cobra al equipo, derivado de las tarifas cuando aplica. */
  effect: (appliance: ApplianceProfile | null) => DecisionEffect;
}

const SUBSIDIO: GameEventDefinition = {
  id: 'subsidio-sorpresa',
  kind: 'subsidy',
  title: 'Subsidio sorpresa',
  icon: 'volunteer_activism',
  needsAppliance: false,
  description: () =>
    'La alcaldía condona parte de la factura del barrio: cada equipo recibe $8.000 para invertir.',
  effect: () => ({ presupuesto: SUBSIDIO_SORPRESA }),
};

const APAGON_PARCIAL: GameEventDefinition = {
  id: 'apagon-parcial',
  kind: 'lock',
  title: 'Apagón parcial',
  icon: 'bolt',
  needsAppliance: true,
  description: (nombre) =>
    `Se cayó un poste de la cuadra: en esta ronda nadie puede intervenir el ${
      nombre ? nombre.toLowerCase() : 'aparato afectado'
    }.`,
  effect: () => ({}),
};

const FALLA_DE_APARATO: GameEventDefinition = {
  id: 'falla-de-aparato',
  kind: 'fault',
  title: 'Falla de aparato',
  icon: 'report_problem',
  needsAppliance: true,
  description: (nombre) =>
    `El ${nombre ? nombre.toLowerCase() : 'aparato'} empezó a consumir 20% más: hasta que lo intervengas, esa fuga la paga tu equipo.`,
  /**
   * El recargo no es un numero inventado: es el 20% del consumo de referencia del aparato,
   * cobrado en consumo y en dinero a la tarifa vigente.
   */
  effect: (appliance) => {
    if (!appliance) return {};
    const extraE = round2(appliance.referencia.electricidad * FALLA_APARATO_RATE);
    const extraG = round2(appliance.referencia.gas * FALLA_APARATO_RATE);
    return {
      electricidad: extraE,
      gas: extraG,
      presupuesto: -Math.round(costoElectricidad(extraE) + costoGas(extraG)),
    };
  },
};

export const EVENT_CATALOG: GameEventDefinition[] = [SUBSIDIO, APAGON_PARCIAL, FALLA_DE_APARATO];

export const EVENT_BY_ID: Record<string, GameEventDefinition> = Object.fromEntries(
  EVENT_CATALOG.map((e) => [e.id, e]),
);

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Instancia un evento para esta partida (con su aparato, si lo necesita). */
export function instantiateEvent(
  definition: GameEventDefinition,
  appliance: ApplianceProfile | null,
): GameEventInstance {
  return {
    id: definition.id,
    kind: definition.kind,
    title: definition.title,
    description: definition.description(appliance?.name ?? null),
    icon: definition.icon,
    applianceId: appliance?.id ?? null,
    effect: definition.effect(appliance),
    applied: false,
  };
}
