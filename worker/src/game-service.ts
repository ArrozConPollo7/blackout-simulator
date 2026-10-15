/**
 * Casos de uso del juego. Toda la logica pasa por aqui: el Worker es la unica
 * fuente de verdad. Nada de esto vive en el cliente.
 *
 * Las dependencias (repositorio, reloj, token de host) se inyectan para poder
 * probar el flujo completo sin red.
 */

import type {
  CrisisMeasure,
  CrisisOutcome,
  CrisisVote,
  DecisionEffect,
  GameEventInstance,
  GameState,
  Phase,
  TeamState,
} from '../../types/game.ts';
import type {
  CaseView,
  CrisisResponse,
  CrisisVoteRequest,
  CrisisVoteResponse,
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
  isDecisionOptionId,
  resolveScenarioForOption,
  scenarioKeyOfOption,
} from '../../content/decisions.ts';
import type { DecisionScenario } from '../../content/decisions.ts';
import { crisisMeasuresFor, crisisRateFor, crisisVariantFor } from '../../content/crisis.ts';
import { canTransition, nextPhaseOf, roundForPhase } from '../../content/phases.ts';
import {
  advancePhase,
  applyDecision,
  applyEventEffect,
  calculateFinalResults,
  crisisSurchargeFor,
  describeEffect,
  type OpcionesDeAplicacion,
  drawnScenarioIdsForCase,
  drawEvents,
  eventEffectForDecision,
  eventLogKey,
  initialGameState,
  initialTeamState,
  isEventApplied,
  lockedApplianceFor,
  markApplied,
  pesoForTeam,
  puntosFor,
  resolveCrisisVote,
  seedForGame,
  triggerCrisis,
} from '../../engine/index.ts';
import type { DecisionLogInput, DecisionRow, GameRepo, GameRow, TeamRow } from './repo.ts';
import { DEFAULT_HOST_PASSCODE } from './env.ts';
import { ApiError } from './http.ts';

export interface ServiceDeps {
  repo: GameRepo;
  now?: () => Date;
  hostToken?: string | null;
  /** Contraseña que se teclea en la consola del Host. Si falta vale el default. */
  hostPasscode?: string;
  allowInsecureHost?: boolean;
  /** Semilla fija de las partidas (`GAME_SEED`); null = cada partida usa la suya. */
  seed?: number | null;
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

export function toGameState(game: GameRow, teams: TeamRow[], seed = 0): GameState {
  return {
    phase: game.phase,
    timerEndsAt: game.timer_ends_at ?? new Date(0).toISOString(),
    crisisTriggered: Boolean(game.crisis_triggered),
    teams: teams.map(toTeamState),
    seed,
    crisisRate: crisisRateFor(seed),
    crisisVariant: crisisVariantFor(seed),
    activeEvents: [],
    crisisMeasures: crisisMeasuresFor(seed),
    crisisVotes: [],
    crisisResolvedMeasureId: null,
  };
}

/** Semilla de esta partida: la fija `GAME_SEED`, o su propio id si no hay ninguna. */
function seedOf(deps: ServiceDeps, gameId: string): number {
  return seedForGame(gameId, deps.seed ?? null);
}

/** Filas del historial de cada equipo (una sola lectura por equipo). */
async function choicesByTeam(
  deps: ServiceDeps,
  teams: readonly TeamRow[],
): Promise<Record<string, Array<Pick<DecisionRow, 'round' | 'choice' | 'created_at'>>>> {
  const out: Record<string, Array<Pick<DecisionRow, 'round' | 'choice' | 'created_at'>>> = {};
  for (const row of teams) out[row.id] = await deps.repo.listDecisions(row.id);
  return out;
}

/** Eventos del aula ya registrados en el historial (para no repetirlos). */
function usedEventKeys(historial: Array<Pick<DecisionRow, 'round' | 'choice'>>): string[] {
  return [...new Set(historial.map((d) => d.choice).filter((c) => c.startsWith('event:')))];
}

/** Votos de la crisis, reconstruidos del historial (`vote:<medida>`, ronda `crisis_vote`). */
export function crisisVotesOf(
  teams: readonly TeamRow[],
  historial: Record<string, Array<Pick<DecisionRow, 'round' | 'choice' | 'created_at'>>>,
): CrisisVote[] {
  const votos: CrisisVote[] = [];
  for (const row of teams) {
    const fila = historial[row.id]?.find((d) => d.choice.startsWith('vote:'));
    if (fila) {
      votos.push({
        teamId: row.id,
        measureId: fila.choice.slice('vote:'.length),
        votedAt: fila.created_at,
      });
    }
  }
  return votos;
}

/** Medida ya aplicada a la partida (`crisis:medida:<id>` en el historial), si la hay. */
function resolvedMeasureIdOf(
  historial: Array<Pick<DecisionRow, 'round' | 'choice'>>,
): string | null {
  const fila = historial.find((d) => d.choice.startsWith('crisis:medida:'));
  return fila ? fila.choice.slice('crisis:medida:'.length) : null;
}

/** Resultado de la votación: la medida aplicada manda; el recuento se relee para mostrarlo. */
function outcomeOf(
  measures: readonly CrisisMeasure[],
  votos: readonly CrisisVote[],
  medidaId: string | null,
): CrisisOutcome | null {
  if (!medidaId) return null;
  const medida = measures.find((m) => m.id === medidaId);
  if (!medida) return null;
  const votosDe = votos.filter((v) => v.measureId === medida.id).length;
  const empatadas = measures.filter(
    (m) => votos.filter((v) => v.measureId === m.id).length === Math.max(...measures.map((x) => votos.filter((v) => v.measureId === x.id).length)),
  ).length;
  return {
    measureId: medida.id,
    label: medida.label,
    description: medida.description,
    effect: medida.effect,
    votes: votosDe,
    totalVotes: votos.length,
    tie: empatadas > 1,
  };
}

/** Estado completo: el cliente lo pide al montar y cada vez que Realtime avisa un cambio. */
export async function getGameState(deps: ServiceDeps, gameId: string): Promise<GameStateResponse> {
  const { game, teams } = await loadGame(deps, gameId);
  const seed = seedOf(deps, game.id);
  const historial = await choicesByTeam(deps, teams);
  const todas = Object.values(historial).flat();
  const state = toGameState(game, teams, seed);

  const cases: Record<string, CaseView> = {};
  const answered: Record<string, string[]> = {};
  const assignedScenarios: Record<string, string[]> = {};
  for (const row of teams) {
    cases[row.id] = caseView(row.case_id);
    answered[row.id] = [
      ...new Set(
        historial[row.id].filter((d) => isDecisionOptionId(d.choice)).map((d) => scenarioKeyOfOption(d.choice)),
      ),
    ];
    assignedScenarios[row.id] = drawnScenarioIdsForCase(seed, row.case_id);
  }

  const votos = crisisVotesOf(teams, historial);
  const medidaAplicada = resolvedMeasureIdOf(todas);

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
    seed,
    crisisRate: state.crisisRate,
    crisisVariant: state.crisisVariant,
    crisisMeasures: state.crisisMeasures,
    crisisVotes: votos,
    crisisOutcome: outcomeOf(state.crisisMeasures, votos, medidaAplicada),
    /**
     * Eventos de la ronda en curso. No se filtran los ya aplicados: el chip del subsidio
     * tiene que seguir viendose despues de pagarse (el historial solo dice que ya se cobro).
     * El sorteo no se repite entre rondas porque solo `decidir` tiene evento.
     */
    activeEvents: markApplied(
      drawEvents(
        seed,
        state.phase,
        teams.map((t) => ({ id: t.id, caseId: t.case_id })),
        usedEventKeys(todas).filter(() => state.phase !== 'decidir'),
      ),
      todas.map((d) => d.choice),
    ),
    assignedScenarios,
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
/**
 * Ajustes que dependen del caso, del sorteo de la partida y de lo ya jugado por ese equipo:
 *
 *  - **peso de eficiencia**: esta ronda el equipo juega 3 o 4 situaciones sorteadas (plan
 *    1.1), asi que cada una reparte `24 / (4 x n)`. Todos ganan o pierden lo mismo, jueguen
 *    las que jueguen.
 *  - **descuento del ahorro de la Ronda 1**: el efecto de Ronda 2 se calcula contra la
 *    referencia del aparato, así que se resta lo que el equipo ya ganó arreglándolo en la
 *    auditoría. Sin esto, arreglar el aire y luego ponerlo a 18 °C salía gratis.
 */
function contextoDeDecision(
  seed: number,
  teamRow: TeamRow,
  scenario: DecisionScenario,
  previous: Array<Pick<DecisionRow, 'round' | 'choice'>>,
): OpcionesDeAplicacion {
  const caso = CASE_BY_ID[teamRow.case_id];
  if (!caso || scenario.round !== 'decidir') return {};
  const descuento = (scenario.requires ?? []).reduce(
    (acc, aparato) => {
      const elegida = previous.find((d) => d.choice.startsWith(`r1:${aparato}:`));
      const efecto = elegida ? OPTIONS_BY_ID[elegida.choice]?.effect : undefined;
      return {
        electricidad: (acc.electricidad ?? 0) + (efecto?.electricidad ?? 0),
        gas: (acc.gas ?? 0) + (efecto?.gas ?? 0),
      };
    },
    { electricidad: 0, gas: 0 } as { electricidad?: number; gas?: number },
  );
  return {
    pesoEficiencia: pesoForTeam(seed, teamRow.case_id),
    descontarAhorro: descuento,
  };
}

/** Eventos vigentes de la ronda para el aula, con su estado de cobro por equipo. */
function eventosDeLaRonda(
  seed: number,
  phase: Phase,
  teams: readonly TeamRow[],
): GameEventInstance[] {
  return drawEvents(
    seed,
    phase,
    teams.map((t) => ({ id: t.id, caseId: t.case_id })),
  );
}

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

  const seed = seedOf(deps, gameId);

  // Plan 1.1: en la Ronda 2 cada equipo solo responde a las situaciones que le sortearon.
  const sorteadas = drawnScenarioIdsForCase(seed, teamRow.case_id);
  if (scenario.round === 'decidir' && !sorteadas.includes(scenario.id)) {
    throw new ApiError(
      409,
      'wrong_scenario',
      `Esta ronda no le tocó "${scenario.title}": el sorteo repartió ${sorteadas.length} situaciones y esa no es una de ellas.`,
    );
  }

  // Plan 2.2: un apagón parcial deja un aparato fuera de juego durante la ronda.
  const eventos = eventosDeLaRonda(seed, game.phase, teams);
  const bloqueado = lockedApplianceFor(eventos, scenario);
  if (bloqueado) {
    throw new ApiError(
      409,
      'locked_appliance',
      `El apagón parcial dejó fuera ${APPLIANCE_BY_ID[bloqueado]?.name ?? bloqueado}: en esta ronda no se puede intervenir.`,
    );
  }

  const scenarioKey = scenarioKeyOfOption(body.optionId);
  const previous = await deps.repo.listDecisions(teamRow.id);
  if (previous.some((d) => d.choice === body.optionId || scenarioKeyOfOption(d.choice) === scenarioKey)) {
    throw new ApiError(409, 'already_decided', `El equipo ya decidio en "${scenarioKey}"`);
  }

  const before = toTeamState(teamRow);
  let after = applyDecision(before, option, contextoDeDecision(seed, teamRow, scenario, previous));

  // Falla de aparato: la fuga se paga en la decision que toca ese aparato y solo una vez.
  const conEstadoDeEventos = markApplied(
    eventos,
    previous.map((d) => d.choice),
  );
  const falla = eventEffectForDecision(conEstadoDeEventos, scenario);
  if (falla) after = applyEventEffect(after, falla.effect);

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

  const eventosCobrados: GameEventInstance[] = [];
  if (falla) {
    await deps.repo.logDecision({
      teamId: teamRow.id,
      round: 'event',
      choice: eventLogKey(falla.event),
      effect: falla.effect,
    });
    eventosCobrados.push({ ...falla.event, applied: true });
  }

  const state = await getGameState(deps, gameId);
  const feedback = eventosCobrados.length
    ? `${describeEffect(option.effect)} ${eventosCobrados[0].title}: ${eventosCobrados[0].description}`
    : describeEffect(option.effect);
  return {
    feedback,
    effect: falla ? { ...option.effect, ...sumarEfectos(option.effect, falla.effect) } : option.effect,
    team: after,
    scenarioKey,
    events: eventosCobrados,
    state,
  };
}

/** Suma dos efectos (el de la decision y el que le agrega un evento) para el feedback. */
function sumarEfectos(a: DecisionEffect, b: DecisionEffect): DecisionEffect {
  return {
    electricidad: (a.electricidad ?? 0) + (b.electricidad ?? 0),
    gas: (a.gas ?? 0) + (b.gas ?? 0),
    presupuesto: (a.presupuesto ?? 0) + (b.presupuesto ?? 0),
    eficiencia: (a.eficiencia ?? 0) + (b.eficiencia ?? 0),
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
  const seed = seedOf(deps, gameId);
  const state = toGameState(game, teams, seed);
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

/* ------------------------------------------------------------------ */
/* Aleatoriedad de la partida: eventos y votacion colectiva            */
/* ------------------------------------------------------------------ */

/**
 * Liquida los eventos que se cobran al abrir la ronda (hoy el subsidio sorpresa, que le
 * llega a todos los equipos). Idempotente: si el historial ya tiene la fila del evento, no
 * se vuelve a abonar nada (el host puede reabrir la fase sin miedo).
 */
async function settleImmediateEvents(
  deps: ServiceDeps,
  game: GameRow,
  state: GameState,
  teams: readonly TeamRow[],
): Promise<GameState> {
  const seed = seedOf(deps, game.id);
  const eventos = drawEvents(
    seed,
    'decidir',
    teams.map((t) => ({ id: t.id, caseId: t.case_id })),
  );
  const subsidio = eventos.find((e) => e.kind === 'subsidy');
  if (!subsidio) return state;

  const historial = await choicesByTeam(deps, teams);
  const yaCobrado = teams.some((t) => isEventApplied(subsidio, historial[t.id].map((d) => d.choice)));
  if (yaCobrado) return state;

  const equipos: TeamState[] = [];
  for (const team of state.teams) {
    const despues = applyEventEffect(team, subsidio.effect);
    await deps.repo.updateTeam(team.id, { presupuesto: despues.presupuesto });
    await deps.repo.logDecision({
      teamId: team.id,
      round: 'event',
      choice: eventLogKey(subsidio),
      effect: subsidio.effect,
    });
    equipos.push(despues);
  }
  return { ...state, teams: equipos };
}

/** Medida ya aplicada a la partida, leida del historial (`crisis:medida:<id>`). */
async function settledMeasureId(
  deps: ServiceDeps,
  teams: readonly TeamRow[],
): Promise<string | null> {
  for (const team of teams) {
    const historial = await deps.repo.listDecisions(team.id);
    const fila = historial.find((d) => d.choice.startsWith('crisis:medida:'));
    if (fila) return fila.choice.slice('crisis:medida:'.length);
  }
  return null;
}

/**
 * Resuelve la votacion (mayoria simple, empate -> la medida mas severa) y aplica la medida
 * ganadora a TODOS los equipos, dejando el delta real de cada uno en su historial.
 * Idempotente: si ya hay una medida aplicada, no cobra dos veces.
 */
async function settleCrisisVote(
  deps: ServiceDeps,
  game: GameRow,
  state: GameState,
  teams: readonly TeamRow[],
): Promise<GameState> {
  const seed = seedOf(deps, game.id);
  const historial = await choicesByTeam(deps, teams);
  const votos = crisisVotesOf(teams, historial);
  const yaResuelta = await settledMeasureId(deps, teams);

  const { state: resuelto, outcome, deltas } = resolveCrisisVote(
    { ...state, seed, crisisVotes: votos, crisisResolvedMeasureId: yaResuelta },
    votos,
  );
  if (!outcome) return { ...state, crisisVotes: votos, crisisResolvedMeasureId: yaResuelta };

  for (const team of resuelto.teams) {
    const delta = deltas[team.id] ?? {};
    await deps.repo.updateTeam(team.id, {
      electricidad: team.electricidad,
      gas: team.gas,
      presupuesto: team.presupuesto,
      eficiencia: team.eficiencia,
      puntos: team.puntos,
    });
    await deps.repo.logDecision({
      teamId: team.id,
      round: 'crisis',
      choice: `crisis:medida:${outcome.measureId}`,
      effect: delta,
    });
  }

  return resuelto;
}

/**
 * Voto de un equipo en la sub-fase `crisis_votacion` (plan 3.3).
 *
 * Reglas: solo durante la ventana de votacion, una sola vez por equipo, y solo entre las
 * medidas de la papeleta de esta partida. Cuando vota el ultimo equipo, la votacion se
 * cierra sola: se aplica la medida ganadora y la partida pasa a `decidir_2` (el host puede
 * cerrarla antes avanzando de fase, y entonces decide el recuento parcial).
 */
export async function submitCrisisVote(
  deps: ServiceDeps,
  gameId: string,
  body: CrisisVoteRequest,
): Promise<CrisisVoteResponse> {
  const { game, teams } = await loadGame(deps, gameId);

  if (typeof body?.teamId !== 'string' || typeof body?.measureId !== 'string') {
    throw new ApiError(400, 'bad_request', 'Se espera {teamId, measureId}');
  }
  if (game.phase !== 'crisis_votacion') {
    throw new ApiError(
      409,
      'wrong_phase',
      `La votación del aula no está abierta (fase actual: ${game.phase}).`,
    );
  }

  const teamRow = teams.find((t) => t.id === body.teamId);
  if (!teamRow) throw new ApiError(404, 'not_found', `El equipo ${body.teamId} no pertenece a esta partida`);

  const seed = seedOf(deps, gameId);
  const papeleta = crisisMeasuresFor(seed);
  if (!papeleta.some((m) => m.id === body.measureId)) {
    throw new ApiError(400, 'bad_request', `"${body.measureId}" no está en la papeleta de esta partida.`);
  }

  const previous = await deps.repo.listDecisions(teamRow.id);
  if (previous.some((d) => d.choice.startsWith('vote:'))) {
    throw new ApiError(409, 'already_decided', 'Tu equipo ya votó: cada mesa vota una sola vez.');
  }

  const now = deps.now?.() ?? new Date();
  const vote: CrisisVote = { teamId: teamRow.id, measureId: body.measureId, votedAt: now.toISOString() };
  await deps.repo.logDecision({
    teamId: teamRow.id,
    round: 'crisis_vote',
    choice: `vote:${body.measureId}`,
    effect: {},
  });

  // ¿Era el ultimo voto posible? Entonces la ventana se cierra sola.
  const historial = await choicesByTeam(deps, teams);
  const votos = crisisVotesOf(teams, historial);
  let outcome: CrisisOutcome | null = null;
  let closed = false;

  if (votos.length >= teams.length && teams.length > 0) {
    const base = toGameState(game, teams, seed);
    const resuelto = await settleCrisisVote(deps, game, base, teams);
    if (resuelto.crisisResolvedMeasureId) {
      const advanced = advancePhase(base, 'decidir_2', now);
      await deps.repo.updateGame(gameId, {
        phase: advanced.phase,
        timer_ends_at: advanced.timerEndsAt,
      });
      closed = true;
      outcome = (await getGameState(deps, gameId)).crisisOutcome;
    }
  }

  return { vote, outcome, closed, state: await getGameState(deps, gameId) };
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
  const seed = seedOf(deps, gameId);
  let state = toGameState(game, teams, seed);

  // Entrar en `decidir` liquida el evento que le llega al aula entera (subsidio sorpresa).
  if (next === 'decidir') {
    state = await settleImmediateEvents(deps, game, state, teams);
  }

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

  // Cerrar la votación: la medida ganadora se aplica a TODOS antes de las últimas decisiones.
  if (next === 'decidir_2' && state.phase === 'crisis_votacion') {
    state = await settleCrisisVote(deps, game, state, teams);
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
