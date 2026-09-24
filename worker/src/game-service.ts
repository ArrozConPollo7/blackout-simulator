/**
 * Casos de uso del juego. Toda la logica pasa por aqui: el Worker es la unica
 * fuente de verdad. Nada de esto vive en el cliente.
 *
 * Las dependencias (repositorio, reloj, token de host) se inyectan para poder
 * probar el flujo completo sin red.
 */

import type { DecisionEffect, GameState, Phase, TeamState } from '../../types/game.ts';
import type {
  CaseView,
  CrisisResponse,
  DecisionRequest,
  DecisionResponse,
  GameStateResponse,
  HostVerifyResponse,
  JoinGameRequest,
  JoinGameResponse,
  PhaseResponse,
  StartGameRequest,
  StartGameResponse,
} from '../../types/api.ts';
import { CASE_BY_ID, CASE_CATALOG, TEAM_COLORS } from '../../content/cases.ts';
import {
  APPLIANCE_BY_ID,
  OPTIONS_BY_ID,
  findOptionInScenario,
  resolveScenarioForOption,
  scenarioKeyOfOption,
} from '../../content/decisions.ts';
import { canTransition, nextPhaseOf, roundForPhase } from '../../content/phases.ts';
import {
  advancePhase,
  applyDecision,
  calculateFinalResults,
  crisisSurchargeFor,
  describeEffect,
  initialGameState,
  initialTeamState,
  puntosFor,
  triggerCrisis,
} from '../../engine/index.ts';
import type { DecisionLogInput, GameRepo, GameRow, TeamRow } from './repo.ts';
import { DEFAULT_HOST_PASSCODE } from './env.ts';
import { ApiError } from './http.ts';

export interface ServiceDeps {
  repo: GameRepo;
  now?: () => Date;
  hostToken?: string | null;
  /** Contraseña que se teclea en la consola del Host. Si falta vale el default. */
  hostPasscode?: string;
  allowInsecureHost?: boolean;
}

/** Postgres devuelve `numeric` como string: nunca hay que operar con strings. */
function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toTeamState(row: TeamRow): TeamState {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    electricidad: num(row.electricidad),
    gas: num(row.gas),
    presupuesto: num(row.presupuesto),
    eficiencia: num(row.eficiencia),
    puntos: num(row.puntos),
  };
}

export function toGameState(game: GameRow, teams: TeamRow[]): GameState {
  return {
    phase: game.phase,
    timerEndsAt: game.timer_ends_at ?? new Date(0).toISOString(),
    crisisTriggered: Boolean(game.crisis_triggered),
    teams: teams.map(toTeamState),
  };
}

function caseView(caseId: string): CaseView {
  const caso = CASE_BY_ID[caseId];
  if (!caso) {
    throw new ApiError(500, 'internal', `El caso ${caseId} no existe en content/cases.ts`);
  }
  return {
    caseId: caso.id,
    name: caso.name,
    appliances: caso.appliances,
    hiddenProblems: caso.hiddenProblems,
  };
}

async function loadGame(deps: ServiceDeps, gameId: string): Promise<{ game: GameRow; teams: TeamRow[] }> {
  const game = await deps.repo.getGame(gameId);
  if (!game) throw new ApiError(404, 'not_found', `No existe la partida ${gameId}`);
  const teams = await deps.repo.listTeams(gameId);
  return { game, teams };
}

/** Estado completo: el cliente lo pide al montar y cada vez que Realtime avisa un cambio. */
export async function getGameState(deps: ServiceDeps, gameId: string): Promise<GameStateResponse> {
  const { game, teams } = await loadGame(deps, gameId);
  const state = toGameState(game, teams);

  const cases: Record<string, CaseView> = {};
  const answered: Record<string, string[]> = {};
  for (const row of teams) {
    cases[row.id] = caseView(row.case_id);
    const decisions = await deps.repo.listDecisions(row.id);
    answered[row.id] = [...new Set(decisions.map((d) => scenarioKeyOfOption(d.choice) ?? d.choice))];
  }

  return {
    gameId: game.id,
    phase: state.phase,
    timerEndsAt: state.timerEndsAt,
    crisisTriggered: state.crisisTriggered,
    teams: state.teams,
    serverTime: (deps.now?.() ?? new Date()).toISOString(),
    cases,
    answered,
    results: state.phase === 'resultados' ? calculateFinalResults(state, deps.now?.() ?? new Date()) : null,
  };
}

/**
 * Crea la partida. En `lobby` **no hay equipos todavía**: cada mesa entra con el QR
 * del proyector (`/join?game=...`) y escribe su propio nombre, así que el caso se
 * asigna en el orden de llegada (`content/cases.ts`).
 * `slots` solo dice cuántos equipos se esperan; el tope real es el catálogo de casos.
 */
export async function startGame(deps: ServiceDeps, body: StartGameRequest): Promise<StartGameResponse> {
  const now = deps.now?.() ?? new Date();

  // Validación temprana de `cases` (compatibilidad: la partida reparte por orden de llegada).
  if (body.cases) {
    for (const id of body.cases) {
      if (!CASE_BY_ID[id]) throw new ApiError(400, 'bad_request', `Caso desconocido: ${id}`);
    }
  }

  const pedidos = Number.isFinite(body.teamCount) ? Math.trunc(body.teamCount as number) : CASE_CATALOG.length;
  const slots = Math.max(1, Math.min(CASE_CATALOG.length, pedidos || CASE_CATALOG.length));

  const game = await deps.repo.createGame({
    phase: 'lobby',
    timerEndsAt: now.toISOString(),
    crisisTriggered: false,
  });

  return {
    gameId: game.id,
    phase: game.phase,
    slots,
    teams: [],
    hostPath: `/host?game=${game.id}`,
    joinPath: `/join?game=${game.id}`,
    state: await getGameState(deps, game.id),
  };
}

/* ------------------------------------------------------------------ */
/* Alta de equipos: el nombre lo escribe cada mesa                     */
/* ------------------------------------------------------------------ */

const NAME_MIN = 2;
const NAME_MAX = 24;

/** Nombre de equipo: sin caracteres de control, espacios colapsados y longitud acotada. */
export function normalizeTeamName(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new ApiError(400, 'bad_request', 'Cada equipo necesita un nombre.');
  }
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    throw new ApiError(
      400,
      'bad_request',
      `El nombre del equipo debe tener entre ${NAME_MIN} y ${NAME_MAX} caracteres.`,
    );
  }
  return name;
}

interface CreatedTeam {
  teamId: string;
  name: string;
  caseId: string;
  color: string;
}

/**
 * Crea un equipo dentro de la partida. El caso se toma del catálogo en orden y sin
 * repetir; el color de identidad sale del mismo índice, así que dos equipos nunca
 * comparten color. Rechaza nombres repetidos (en el aula, dos "Los Tigres" son un lío).
 */
async function createTeamInGame(
  deps: ServiceDeps,
  gameId: string,
  rawName: unknown,
  options: { allowStarted: boolean },
): Promise<CreatedTeam> {
  const { game, teams } = await loadGame(deps, gameId);

  if (game.phase === 'resultados') {
    throw new ApiError(409, 'wrong_phase', 'La partida ya terminó: crea una nueva para volver a jugar.');
  }
  if (!options.allowStarted && game.phase !== 'lobby') {
    throw new ApiError(
      409,
      'wrong_phase',
      'La partida ya empezó: pide al anfitrión que añada tu equipo desde la consola del Host.',
    );
  }
  if (teams.length >= CASE_CATALOG.length) {
    throw new ApiError(
      409,
      'game_full',
      `La partida admite como máximo ${CASE_CATALOG.length} equipos y ya están todos dentro.`,
    );
  }

  const name = normalizeTeamName(rawName);
  if (teams.some((t) => t.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new ApiError(409, 'name_taken', `Ya hay un equipo llamado "${name}": elegid otro nombre.`);
  }

  const usados = new Set(teams.map((t) => t.case_id));
  const index = CASE_CATALOG.findIndex((caso) => !usados.has(caso.id));
  if (index < 0) {
    throw new ApiError(409, 'game_full', 'No quedan casos libres para repartir en esta partida.');
  }
  const caso = CASE_CATALOG[index];

  const identity = initialTeamState({
    id: '',
    name,
    color: TEAM_COLORS[index % TEAM_COLORS.length],
  });

  const [row] = await deps.repo.createTeams([
    {
      game_id: gameId,
      name: identity.name,
      case_id: caso.id,
      color: identity.color,
      electricidad: identity.electricidad,
      gas: identity.gas,
      presupuesto: identity.presupuesto,
      eficiencia: identity.eficiencia,
      puntos: identity.puntos,
    },
  ]);
  if (!row) throw new ApiError(500, 'internal', 'El repositorio no devolvió el equipo creado');

  return { teamId: row.id, name: row.name, caseId: row.case_id, color: row.color };
}

/** Alta pública: la mesa entra desde el QR del proyector durante el lobby. */
export async function joinGame(
  deps: ServiceDeps,
  gameId: string,
  body: JoinGameRequest,
): Promise<JoinGameResponse> {
  const created = await createTeamInGame(deps, gameId, body?.name, { allowStarted: false });
  return {
    gameId,
    ...created,
    playPath: `/play/${created.teamId}?game=${gameId}`,
    state: await getGameState(deps, gameId),
  };
}

/** Alta desde la consola del Host: sirve para el equipo que llega tarde (fase ya abierta). */
export async function hostAddTeam(
  deps: ServiceDeps,
  gameId: string,
  body: JoinGameRequest,
  hostToken: string | null,
): Promise<JoinGameResponse> {
  assertHost(deps, hostToken);
  const created = await createTeamInGame(deps, gameId, body?.name, { allowStarted: true });
  return {
    gameId,
    ...created,
    playPath: `/play/${created.teamId}?game=${gameId}`,
    state: await getGameState(deps, gameId),
  };
}

/** Comparación de credenciales sin cortocircuito por longitud del prefijo. */
function equalTokens(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Guardia de las acciones privilegiadas. Acepta la contraseña de la consola del Host
 * (la que se teclea al entrar en `/host`) o el `HOST_TOKEN` clásico del Worker: el
 * mismo valor viaja en la cabecera `x-host-token`.
 */
function assertHost(deps: ServiceDeps, token: string | null): void {
  if (deps.allowInsecureHost) return;
  const admitidos = [deps.hostToken, deps.hostPasscode ?? DEFAULT_HOST_PASSCODE].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  if (admitidos.length === 0) {
    throw new ApiError(
      503,
      'not_configured',
      'El Worker no tiene HOST_TOKEN ni HOST_PASSCODE configurados: las acciones de host estan deshabilitadas.',
    );
  }
  const candidato = (token ?? '').trim();
  if (!candidato || !admitidos.some((esperado) => equalTokens(esperado, candidato))) {
    throw new ApiError(403, 'forbidden', 'Contrasena de host incorrecta o ausente (cabecera x-host-token).');
  }
}

/** Sondeo de la contraseña antes de abrir la consola: no revela nada más. */
export function verifyHost(deps: ServiceDeps, token: string | null): HostVerifyResponse {
  assertHost(deps, token);
  return { ok: true, gameId: null };
}

/**
 * Registra una decision de equipo. Valida la fase, la ronda, la pertenencia del caso,
 * aplica `applyDecision` y persiste equipo + historial. Ningun calculo en el cliente.
 */
export async function submitDecision(
  deps: ServiceDeps,
  gameId: string,
  body: DecisionRequest,
): Promise<DecisionResponse> {
  const { game, teams } = await loadGame(deps, gameId);

  if (typeof body.teamId !== 'string' || typeof body.optionId !== 'string' || typeof body.round !== 'string') {
    throw new ApiError(400, 'bad_request', 'Se espera {teamId, round, optionId}');
  }

  const expectedRound = roundForPhase(game.phase);
  if (!expectedRound) {
    throw new ApiError(
      409,
      'wrong_phase',
      `La partida esta en la fase "${game.phase}": no acepta decisiones en este momento.`,
    );
  }
  if (body.round !== expectedRound) {
    throw new ApiError(
      409,
      'wrong_phase',
      `La fase "${game.phase}" corresponde a la ronda "${expectedRound}", no a "${body.round}".`,
    );
  }

  const option = OPTIONS_BY_ID[body.optionId];
  if (!option) throw new ApiError(400, 'bad_request', `Opcion desconocida: ${body.optionId}`);

  const teamRow = teams.find((t) => t.id === body.teamId);
  if (!teamRow) throw new ApiError(404, 'not_found', `El equipo ${body.teamId} no pertenece a esta partida`);

  const scenario = resolveScenarioForOption(body.optionId, teamRow.case_id);
  if (!scenario) {
    throw new ApiError(
      400,
      'bad_request',
      `La opcion ${body.optionId} no aplica al caso ${teamRow.case_id}`,
    );
  }
  if (!findOptionInScenario(scenario, body.optionId)) {
    throw new ApiError(400, 'bad_request', `La opcion ${body.optionId} no pertenece a ${scenario.id}`);
  }

  const scenarioKey = scenarioKeyOfOption(body.optionId);
  const previous = await deps.repo.listDecisions(teamRow.id);
  if (previous.some((d) => d.choice === body.optionId || scenarioKeyOfOption(d.choice) === scenarioKey)) {
    throw new ApiError(409, 'already_decided', `El equipo ya decidio en "${scenarioKey}"`);
  }

  const before = toTeamState(teamRow);
  const after = applyDecision(before, option);

  await deps.repo.updateTeam(teamRow.id, {
    electricidad: after.electricidad,
    gas: after.gas,
    presupuesto: after.presupuesto,
    eficiencia: after.eficiencia,
    puntos: after.puntos,
  });

  const log: DecisionLogInput = {
    teamId: teamRow.id,
    round: body.round,
    choice: body.optionId,
    effect: option.effect,
  };
  await deps.repo.logDecision(log);

  const state = await getGameState(deps, gameId);
  return {
    feedback: describeEffect(option.effect),
    effect: option.effect,
    team: after,
    scenarioKey,
    state,
  };
}

/**
 * Dispara el evento sorpresa. Solo el host.
 * Recargo proporcional al consumo acumulado de cada equipo y, si la partida seguia en
 * la ronda de decisiones, abre automaticamente la fase de crisis (un solo paso).
 */
export async function fireCrisis(
  deps: ServiceDeps,
  gameId: string,
  hostToken: string | null,
): Promise<CrisisResponse> {
  assertHost(deps, hostToken);
  const { game, teams } = await loadGame(deps, gameId);

  if (game.phase !== 'decidir' && game.phase !== 'crisis') {
    throw new ApiError(
      409,
      'wrong_phase',
      `La crisis solo puede dispararse al cerrar la ronda de decisiones (fase actual: ${game.phase}).`,
    );
  }

  const now = deps.now?.() ?? new Date();
  const state = toGameState(game, teams);
  const after = triggerCrisis(state);
  const surcharges: Record<string, number> = {};

  if (!game.crisis_triggered) {
    for (const team of after.teams) {
      const previous = state.teams.find((t) => t.id === team.id)!;
      const surcharge = previous.presupuesto - team.presupuesto;
      surcharges[team.id] = surcharge;
      await deps.repo.updateTeam(team.id, { presupuesto: team.presupuesto });
      await deps.repo.logDecision({
        teamId: team.id,
        round: 'crisis',
        choice: 'crisis:price_shock',
        effect: { presupuesto: -surcharge },
      });
    }
  } else {
    for (const team of state.teams) surcharges[team.id] = 0;
  }

  if (game.phase === 'decidir') {
    const next = advancePhase({ ...after, phase: 'decidir' }, 'crisis', now);
    await deps.repo.updateGame(gameId, {
      phase: next.phase,
      timer_ends_at: next.timerEndsAt,
      crisis_triggered: true,
    });
  } else {
    await deps.repo.updateGame(gameId, { crisis_triggered: true });
  }

  return { surcharges, state: await getGameState(deps, gameId) };
}

/**
 * Avanza la maquina de fases. Solo el host.
 * Entrar en `crisis` dispara el evento sorpresa (mismo efecto que POST /crisis, sin cobrar dos veces).
 * Entrar en `resultados` calcula y persiste los puntos finales.
 */
export async function changePhase(
  deps: ServiceDeps,
  gameId: string,
  body: { phase?: Phase },
  hostToken: string | null,
): Promise<PhaseResponse> {
  assertHost(deps, hostToken);
  const { game, teams } = await loadGame(deps, gameId);
  const next = body.phase;

  if (!next) throw new ApiError(400, 'bad_request', 'Se espera {phase}');
  if (!canTransition(game.phase, next)) {
    throw new ApiError(
      409,
      'conflict',
      `Transicion invalida: ${game.phase} -> ${next}. La secuencia es ${nextPhaseOf(game.phase) ?? '(fin)'}.`,
    );
  }

  const now = deps.now?.() ?? new Date();
  let state = toGameState(game, teams);

  if (next === 'crisis' && !state.crisisTriggered) {
    const conCrisis = triggerCrisis(state);
    for (const team of conCrisis.teams) {
      const previous = state.teams.find((t) => t.id === team.id)!;
      await deps.repo.updateTeam(team.id, { presupuesto: team.presupuesto });
      await deps.repo.logDecision({
        teamId: team.id,
        round: 'crisis',
        choice: 'crisis:price_shock',
        effect: { presupuesto: previous.presupuesto - team.presupuesto },
      });
    }
    state = conCrisis;
  }

  const advanced = advancePhase(state, next, now);

  if (next === 'resultados') {
    const results = calculateFinalResults(advanced, now);
    for (const entry of results.ranking) {
      await deps.repo.updateTeam(entry.team.id, { puntos: entry.puntos });
    }
  }

  await deps.repo.updateGame(gameId, {
    phase: advanced.phase,
    timer_ends_at: advanced.timerEndsAt,
    crisis_triggered: advanced.crisisTriggered,
  });

  return { state: await getGameState(deps, gameId) };
}

export { puntosFor, crisisSurchargeFor };

/** Efecto crudo de una opcion (utilidad para herramientas y tests). */
export function effectOf(optionId: string): DecisionEffect {
  const option = OPTIONS_BY_ID[optionId];
  if (!option) throw new ApiError(400, 'bad_request', `Opcion desconocida: ${optionId}`);
  return option.effect;
}

/** Vista del caso de un equipo, para la pantalla del jugador. */
export function appliancesOf(caseId: string) {
  const caso = CASE_BY_ID[caseId];
  if (!caso) return [];
  return caso.appliances
    .map((id) => APPLIANCE_BY_ID[id])
    .filter((a): a is NonNullable<typeof a> => Boolean(a));
}

export { initialGameState };
