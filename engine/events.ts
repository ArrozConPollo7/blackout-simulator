/**
 * Aplicacion de los eventos aleatorios extra (plan 2.2).
 *
 * Tres familias de efecto, todas verificables contra el historial de decisiones (que es el
 * unico libro mayor del juego: el Worker no guarda columnas nuevas para esto):
 *
 *   subsidy -> se le abona a TODOS los equipos al entrar en la ronda (fila `event:<id>`).
 *   fault   -> se le cobra al equipo en la decision que toca el aparato averiado
 *              (fila `event:falla-de-aparato:<aparato>` junto a esa decision).
 *   lock    -> no cobra nada: prohibe intervenir un aparato durante la ronda.
 *
 * `applied` sale siempre del historial, nunca de un contador en memoria: si el Worker se
 * reinicia o el equipo reconecta, un evento ya cobrado no se cobra dos veces.
 */

import type { DecisionEffect, GameEventInstance, Phase, TeamState } from '../types/game.ts';
import type { DecisionScenario } from '../content/decisions.ts';
import { APPLIANCE_CATALOG, SCENARIOS_BY_ID } from '../content/decisions.ts';
import { CASE_BY_ID } from '../content/cases.ts';
import {
  EVENT_BY_ID,
  EVENT_CATALOG,
  EVENT_COUNT_BY_ROUND,
  instantiateEvent,
} from '../content/events.ts';
import { drawnScenarioIdsForCase } from './draw.ts';
import { rngFor, sample } from './rng.ts';
import { applyEffect } from './decisions.ts';

/** Clave del sorteo de eventos. Parte del contrato de reproducibilidad. */
export const EVENTO_KEY = 'evento';

/** Equipo minimo para razonar sobre eventos: id y caso (lo que hay en `TeamRow`). */
export interface EventTeamRef {
  id: string;
  caseId: string;
}

/** Fila del historial que marca que el efecto de un evento ya se aplico. */
export function eventLogKey(event: Pick<GameEventInstance, 'id' | 'applianceId'>): string {
  return event.applianceId ? `event:${event.id}:${event.applianceId}` : `event:${event.id}`;
}

/** true si ese evento ya quedo registrado (nunca se cobra dos veces). */
export function isEventApplied(
  event: Pick<GameEventInstance, 'id' | 'applianceId'>,
  choices: readonly string[],
): boolean {
  const key = eventLogKey(event);
  return choices.some((choice) => choice === key || choice.startsWith(`${key}:`));
}

/** Marca los eventos ya registrados en el historial de la partida. */
export function markApplied(
  events: GameEventInstance[],
  choices: readonly string[],
): GameEventInstance[] {
  return events.map((event) => ({ ...event, applied: isEventApplied(event, choices) }));
}

/**
 * Situaciones de un equipo que siguen jugables con un aparato bloqueado.
 * Es el invariante de balance del plan 2.2: ningun evento puede dejar a un equipo sin jugada.
 */
export function playableScenarioIds(
  seed: number,
  team: EventTeamRef,
  lockedApplianceId: string | null,
): string[] {
  const propias = drawnScenarioIdsForCase(seed, team.caseId);
  if (!lockedApplianceId) return propias;
  return propias.filter(
    (id) => !(SCENARIOS_BY_ID[id]?.requires ?? []).includes(lockedApplianceId),
  );
}

/** Aparatos que bloquea un evento de la familia `lock`. */
export function locksOf(events: readonly GameEventInstance[]): string[] {
  return events.filter((e) => e.kind === 'lock' && e.applianceId).map((e) => e.applianceId as string);
}

/** true si un evento deja a algun equipo sin ninguna situacion jugable. */
function breaksBalance(seed: number, teams: readonly EventTeamRef[], event: GameEventInstance): boolean {
  if (event.kind !== 'lock') return false;
  return teams.some((team) => playableScenarioIds(seed, team, event.applianceId).length === 0);
}

/** Aparatos que al menos un equipo de la partida puede sufrir. */
function appliancesInPlay(teams: readonly EventTeamRef[]): string[] {
  const enJuego = new Set<string>();
  for (const team of teams) {
    for (const id of CASE_BY_ID[team.caseId]?.appliances ?? []) enJuego.add(id);
  }
  return APPLIANCE_CATALOG.filter((a) => enJuego.has(a.id)).map((a) => a.id);
}

/** Todas las instancias posibles de evento para esta partida, antes de filtrar. */
export function candidateEvents(teams: readonly EventTeamRef[]): GameEventInstance[] {
  const out: GameEventInstance[] = [];
  for (const definition of EVENT_CATALOG) {
    if (!definition.needsAppliance) {
      out.push(instantiateEvent(definition, null));
      continue;
    }
    for (const applianceId of appliancesInPlay(teams)) {
      const appliance = APPLIANCE_CATALOG.find((a) => a.id === applianceId);
      if (appliance) out.push(instantiateEvent(definition, appliance));
    }
  }
  return out;
}

/** Candidatos que respetan el invariante de balance y no se repiten. */
export function viableEvents(
  seed: number,
  teams: readonly EventTeamRef[],
  used: readonly string[] = [],
): GameEventInstance[] {
  return candidateEvents(teams).filter(
    (event) => !used.includes(eventLogKey(event)) && !breaksBalance(seed, teams, event),
  );
}

/**
 * Eventos vigentes en una fase: 0 en las fases de aprendizaje, 1 en `decidir`.
 * Si ningun candidato respeta el invariante de balance, la ronda se juega sin evento: la
 * partida puede quedarse sin el toque de azar, nunca sin jugadas.
 */
export function drawEvents(
  seed: number,
  phase: Phase,
  teams: readonly EventTeamRef[],
  used: readonly string[] = [],
): GameEventInstance[] {
  const count = EVENT_COUNT_BY_ROUND[phase] ?? 0;
  if (count === 0 || teams.length === 0) return [];
  const candidatos = viableEvents(seed, teams, used);
  if (candidatos.length === 0) return [];
  return sample(rngFor(seed, EVENTO_KEY, phase), candidatos, count);
}

/**
 * Recorre las fases con eventos excluyendo los ya usados: es la forma de comprobar que,
 * con el catalogo actual, un evento nunca se repite dentro de la misma partida.
 */
export function drawEventsForGame(
  seed: number,
  teams: readonly EventTeamRef[],
  phases: readonly Phase[],
): GameEventInstance[] {
  const usados: string[] = [];
  const salida: GameEventInstance[] = [];
  for (const phase of phases) {
    for (const event of drawEvents(seed, phase, teams, usados)) {
      usados.push(eventLogKey(event));
      salida.push(event);
    }
  }
  return salida;
}

/**
 * Eventos que se liquidan al abrir la ronda (hoy solo el subsidio, que le llega a todos).
 * Devuelve el efecto aplicable a cada equipo y el evento que lo justifica.
 */
export function immediateEventFor(
  events: readonly GameEventInstance[],
): { event: GameEventInstance; effect: DecisionEffect } | null {
  const foundation = events.find((e) => e.kind === 'subsidy' && !e.applied);
  return foundation ? { event: foundation, effect: foundation.effect } : null;
}

/** Subsidio sorpresa aplicado a un equipo. */
export function applyEventEffect(team: TeamState, effect: DecisionEffect): TeamState {
  return applyEffect(team, effect);
}

/**
 * Efecto que un evento le agrega a una decision concreta: solo la falla de aparato, y solo
 * cuando la situacion toca el aparato averiado. Cualquier otro evento devuelve null.
 */
export function eventEffectForDecision(
  events: readonly GameEventInstance[],
  scenario: DecisionScenario,
): { event: GameEventInstance; effect: DecisionEffect } | null {
  const averiado = events.find(
    (event) => event.kind === 'fault' && event.applianceId && !event.applied,
  );
  if (!averiado || !averiado.applianceId) return null;
  const toca = (scenario.requires ?? []).includes(averiado.applianceId);
  return toca ? { event: averiado, effect: averiado.effect } : null;
}

/** Aparato averiado que bloquea una situacion (para el rechazo explicado del Worker). */
export function lockedApplianceFor(
  events: readonly GameEventInstance[],
  scenario: DecisionScenario,
): string | null {
  const bloqueado = locksOf(events).find((applianceId) =>
    (scenario.requires ?? []).includes(applianceId),
  );
  return bloqueado ?? null;
}

/** Evento del catalogo por id (utilidad para herramientas y tests). */
export function eventDefinitionById(id: string) {
  return EVENT_BY_ID[id];
}
