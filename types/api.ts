/**
 * Contratos HTTP entre el frontend y el Worker.
 * El Worker es la unica fuente de verdad: el cliente nunca calcula consecuencias.
 */

import type { DecisionEffect, GameState, Phase, TeamState } from './game.ts';
import type { FinalResults } from '../engine/results.ts';

/** Caso que le toca a un equipo, tal como lo devuelve GET /game/:id/state. */
export interface CaseView {
  caseId: string;
  name: string;
  appliances: string[];
  hiddenProblems: string[];
}

/**
 * Estado completo de una partida. Cubre la reconexion (2.2): el cliente pide esto al
 * montar y cada vez que Realtime avisa de un cambio, en vez de acumular eventos.
 */
export interface GameStateResponse {
  gameId: string;
  phase: Phase;
  timerEndsAt: string;
  crisisTriggered: boolean;
  teams: TeamState[];
  /** Reloj del servidor: permite medir el desfase del reloj del cliente. */
  serverTime: string;
  cases: Record<string, CaseView>;
  /** Claves de escenario ya decididas por equipo (permite marcar progreso tras reconectar). */
  answered: Record<string, string[]>;
  /** Ranking final: solo con la fase en `resultados`, null en cualquier otro caso. */
  results: FinalResults | null;
}

export interface StartGameRequest {
  teamCount?: number;
  cases?: string[];
}

export interface StartGameResponse {
  gameId: string;
  phase: Phase;
  /**
   * Equipos que se esperan en esta partida (4-6). Es presentacional: los equipos
   * reales nacen cuando cada mesa entra por `/join` y escribe su nombre.
   */
  slots: number;
  /** Vacío al crear la partida: los equipos entran por POST /game/:id/join. */
  teams: Array<{
    id: string;
    name: string;
    caseId: string;
    color: string;
    playPath: string;
  }>;
  /** Ruta del Host con el id de partida ya incorporado. */
  hostPath: string;
  /** Ruta de registro que viaja en el QR del proyector. */
  joinPath: string;
  state: GameStateResponse;
}

/** Alta de un equipo (mesa) en la partida. El nombre lo escribe el propio equipo. */
export interface JoinGameRequest {
  name: string;
}

export interface JoinGameResponse {
  gameId: string;
  teamId: string;
  name: string;
  caseId: string;
  color: string;
  /** Ruta de la vista del equipo, lista para redirigir. */
  playPath: string;
  state: GameStateResponse;
}

/** Sondeo de la contraseña del Host antes de abrir la consola. */
export interface HostVerifyResponse {
  ok: true;
  /** Ruta del Host de la última partida, si el Worker la conoce. */
  gameId: string | null;
}

export interface DecisionRequest {
  teamId: string;
  round: 'investigar' | 'decidir' | 'decidir_2';
  optionId: string;
}

export interface DecisionResponse {
  feedback: string;
  effect: DecisionEffect;
  team: TeamState;
  /** Clave del escenario resuelto (`r1:nevera`, `r2:calor`, `r2b`). */
  scenarioKey: string;
  state: GameStateResponse;
}

export interface CrisisResponse {
  /** Sobrecosto aplicado a cada equipo por el alza de tarifa. */
  surcharges: Record<string, number>;
  state: GameStateResponse;
}

export interface PhaseResponse {
  state: GameStateResponse;
}

export interface ApiErrorBody {
  error: string;
  code:
    | 'bad_request'
    | 'not_found'
    | 'conflict'
    | 'forbidden'
    | 'wrong_phase'
    | 'already_decided'
    | 'name_taken'
    | 'game_full'
    | 'not_configured'
    | 'internal';
  detail?: string;
}

export type { GameState, Phase, TeamState };
