/**
 * Plan 3: la votacion colectiva de la crisis.
 *
 * Dos capas:
 *   - motor puro: quien gana (mayoria, empate -> la mas severa), como se aplica la medida a
 *     TODOS los equipos y que no se cobre dos veces;
 *   - Worker: la ventana de votacion, el rechazo del doble voto, la papeleta de la partida y
 *     el cierre automatico cuando vota el ultimo equipo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { CrisisMeasure, CrisisVote, GameState, TeamState } from '../types/game.ts';
import type {
  CrisisVoteResponse,
  GameStateResponse,
  JoinGameResponse,
  StartGameResponse,
} from '../types/api.ts';
import { CRISIS_MEASURES, countCrisisVotes, crisisMeasuresFor } from '../content/crisis.ts';
import { PRESUPUESTO_INICIAL, TARIFA_ELECTRICIDAD, TARIFA_GAS, costoElectricidad } from '../content/economy.ts';
import {
  applyMeasure,
  initialTeamState,
  measureEffectFor,
  resolveCrisisVote,
  solidarityTransfers,
} from '../engine/index.ts';
import { handleRequest } from '../worker/src/index.ts';
import { InMemoryRepo } from '../worker/src/repo-memory.ts';
import type { Env } from '../worker/src/env.ts';

const HOST_TOKEN = 'token-de-prueba';
const ENV: Env = {
  SUPABASE_URL: 'https://ejemplo.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'clave-de-servicio',
  HOST_TOKEN,
  ALLOWED_ORIGINS: '*',
};

const equipo = (over: Partial<TeamState> = {}): TeamState => ({
  ...initialTeamState({ id: 't1', name: 'Equipo 1', color: '#3ECF8E' }),
  ...over,
});

const voto = (teamId: string, measureId: string): CrisisVote => ({
  teamId,
  measureId,
  votedAt: new Date('2026-09-24T10:00:00.000Z').toISOString(),
});

const medida = (id: string): CrisisMeasure => {
  const encontrada = CRISIS_MEASURES.find((m) => m.id === id);
  if (!encontrada) throw new Error(`medida desconocida: ${id}`);
  return encontrada;
};

const estadoDeVotacion = (measures: CrisisMeasure[], teams: TeamState[]): GameState => ({
  phase: 'crisis_votacion',
  timerEndsAt: new Date('2026-09-24T10:05:00.000Z').toISOString(),
  crisisTriggered: true,
  teams,
  seed: 7,
  crisisRate: 0.3,
  crisisVariant: { id: 'solo-electricidad', label: 'solo luz', gasSurchargeRate: 0 },
  activeEvents: [],
  crisisMeasures: measures,
  crisisVotes: [],
  crisisResolvedMeasureId: null,
});

// ---------------------------------------------------------------------------
// Motor puro
// ---------------------------------------------------------------------------

describe('recuento de la votación', () => {
  const papeleta = crisisMeasuresFor(3);

  it('gana la mayoría simple', () => {
    const votos = [
      voto('a', papeleta[0].id),
      voto('b', papeleta[1].id),
      voto('c', papeleta[1].id),
    ];
    const resultado = countCrisisVotes(papeleta, votos)!;
    assert.equal(resultado.measureId, papeleta[1].id);
    assert.equal(resultado.votes, 2);
    assert.equal(resultado.totalVotes, 3);
    assert.equal(resultado.tie, false);
  });

  it('en empate gana la medida más severa y el aula se entera (tie = true)', () => {
    const votos = [voto('a', papeleta[0].id), voto('b', papeleta[2].id)];
    const resultado = countCrisisVotes(papeleta, votos)!;
    const severa = [...papeleta].sort((a, b) => b.severity - a.severity)[0];
    assert.equal(resultado.measureId, severa.id);
    assert.equal(resultado.tie, true);
    assert.equal(resultado.votes, 1);
  });

  it('sin votos gana la más severa de la papeleta (nadie se puso de acuerdo)', () => {
    const resultado = countCrisisVotes(papeleta, [])!;
    const severa = [...papeleta].sort((a, b) => b.severity - a.severity)[0];
    assert.equal(resultado.measureId, severa.id);
    assert.equal(resultado.totalVotes, 0);
    assert.equal(resultado.tie, true);
  });

  it('ignora votos de medidas que no están en la papeleta', () => {
    const resultado = countCrisisVotes([medida('racionamiento-parejo')], [voto('a', 'inventada')])!;
    assert.equal(resultado.measureId, 'racionamiento-parejo');
    assert.equal(resultado.votes, 0);
    assert.equal(resultado.totalVotes, 1, 'el voto existe, aunque no sea de una medida valida');
  });
});

describe('aplicación de la medida ganadora', () => {
  it('el racionamiento recorta un porcentaje del consumo de cada equipo', () => {
    const t = equipo({ electricidad: 100, gas: 80 });
    const delta = measureEffectFor(t, medida('racionamiento-parejo').effect);
    assert.equal(delta.electricidad, -15);
    assert.equal(delta.gas, -8);
    assert.equal(delta.eficiencia, -3);
  });

  it('la tarifa de emergencia cobra proporcional a la factura eléctrica acumulada', () => {
    const eficiente = equipo({ electricidad: 60 });
    const derrochador = equipo({ electricidad: 120 });
    const efecto = medida('tarifa-emergencia').effect;
    const deltaEficiente = measureEffectFor(eficiente, efecto);
    const deltaDerrochador = measureEffectFor(derrochador, efecto);
    assert.equal(deltaEficiente.presupuesto, -Math.round(costoElectricidad(60) * 0.4));
    assert.ok(
      (deltaDerrochador.presupuesto ?? 0) < (deltaEficiente.presupuesto ?? 0),
      'el que mas consumio paga mas',
    );
  });

  it('la compra comunitaria cuesta $6.000 a todos y recorta consumo', () => {
    const delta = measureEffectFor(equipo({ electricidad: 100, gas: 100 }), medida('compra-comunitaria').effect);
    assert.equal(delta.presupuesto, -6000);
    assert.equal(delta.electricidad, -8);
    assert.equal(delta.gas, -5);
    assert.equal(delta.eficiencia, 1);
  });

  it('la medida se aplica a TODOS los equipos y el alcance es aula entera', () => {
    const equipos = [
      equipo({ id: 'a', electricidad: 90, gas: 40 }),
      equipo({ id: 'b', electricidad: 110, gas: 60 }),
      equipo({ id: 'c', electricidad: 70, gas: 20 }),
    ];
    const { teams, deltas } = applyMeasure(equipos, medida('racionamiento-parejo').effect);
    assert.equal(teams.length, 3);
    for (const [i, t] of teams.entries()) {
      assert.equal(t.electricidad, Math.round((equipos[i].electricidad * 0.85) * 100) / 100);
      assert.equal(t.eficiencia, 47); // 50 - 3 para todos, sin excepciones
      assert.ok(deltas[t.id].electricidad! < 0);
    }
  });

  it('el fondo de ayuda mutua mueve dinero de los que van mejor a los que van peor, sin crearlo', () => {
    const equipos = [
      equipo({ id: 'rico', presupuesto: 90000 }),
      equipo({ id: 'medio', presupuesto: 60000 }),
      equipo({ id: 'pobre', presupuesto: 30000 }),
    ];
    const transferencias = solidarityTransfers(equipos, 20);
    const total = Object.values(transferencias).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total) <= 2, `el fondo no crea dinero (suma ${total})`);
    assert.ok(transferencias.rico < 0, 'el que va mejor aporta');
    assert.ok(transferencias.pobre > 0, 'el que va peor recibe');

    const { teams } = applyMeasure(equipos, medida('fondo-ayuda-mutua').effect);
    const rico = teams.find((t) => t.id === 'rico')!;
    const pobre = teams.find((t) => t.id === 'pobre')!;
    assert.ok(rico.presupuesto < 90000 && pobre.presupuesto > 30000);
    assert.ok(Math.abs(teams.reduce((acc, t) => acc + t.presupuesto, 0) - 180000) <= 2);
  });

  it('si nadie está por debajo de la media, el fondo vuelve a quien lo puso', () => {
    const equipos = [equipo({ id: 'a', presupuesto: 50000 }), equipo({ id: 'b', presupuesto: 50000 })];
    const transferencias = solidarityTransfers(equipos, 20);
    assert.deepEqual(transferencias, { a: 0, b: 0 });
  });

  it('la resolución es idempotente: la segunda pasada no cobra otra vez', () => {
    const papeleta = crisisMeasuresFor(5);
    const state = estadoDeVotacion(papeleta, [equipo({ id: 'a' }), equipo({ id: 'b' })]);
    const votos = [voto('a', papeleta[0].id), voto('b', papeleta[0].id)];

    const primera = resolveCrisisVote(state, votos);
    assert.ok(primera.outcome);
    assert.equal(primera.state.crisisResolvedMeasureId, papeleta[0].id);
    assert.notEqual(primera.state.teams[0].presupuesto, state.teams[0].presupuesto);

    const segunda = resolveCrisisVote(primera.state, votos);
    assert.deepEqual(segunda.deltas, {});
    assert.deepEqual(segunda.state.teams, primera.state.teams);
    assert.equal(segunda.outcome, null);
  });
});

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

interface Harness {
  repo: InMemoryRepo;
  post: (path: string, body?: unknown, init?: RequestInit) => Promise<Response>;
  get: (path: string, init?: RequestInit) => Promise<Response>;
  start: (teamCount?: number) => Promise<StartGameResponse>;
}

async function harness(env: Env = ENV): Promise<Harness> {
  const repo = new InMemoryRepo();
  const call = (path: string, init: RequestInit) =>
    handleRequest(new Request(`https://api.test${path}`, init), env, repo);
  const post = (path: string, body?: unknown, init: RequestInit = {}) =>
    call(path, {
      ...init,
      method: 'POST',
      headers: { 'content-type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }) as Promise<Response>;
  const get = (path: string, init: RequestInit = {}) => call(path, { method: 'GET', ...init }) as Promise<Response>;

  return {
    repo,
    post,
    get,
    async start(teamCount = 4) {
      const creada = (await (await post('/game/start', { teamCount })).json()) as StartGameResponse;
      const teams: StartGameResponse['teams'] = [];
      let state = creada.state;
      for (let i = 0; i < teamCount; i += 1) {
        const joined = (await (
          await post(`/game/${creada.gameId}/join`, { name: `Equipo ${i + 1}` })
        ).json()) as JoinGameResponse;
        teams.push({
          id: joined.teamId,
          name: joined.name,
          caseId: joined.caseId,
          color: joined.color,
          playPath: joined.playPath,
        });
        state = joined.state;
      }
      return { ...creada, teams, state };
    },
  };
}

const host = () => ({ headers: { 'x-host-token': HOST_TOKEN } });
const stateOf = async (res: Response): Promise<GameStateResponse> => {
  const body = (await res.json()) as GameStateResponse | { state: GameStateResponse };
  return 'state' in body ? body.state : body;
};

/** Deja la partida en la ventana de votacion con todos los equipos registrados. */
async function enVotacion(h: Harness, teamCount = 4) {
  const started = await h.start(teamCount);
  await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, host());
  await h.post(`/game/${started.gameId}/phase`, { phase: 'decidir' }, host());
  await h.post(`/game/${started.gameId}/phase`, { phase: 'crisis' }, host());
  const state = await stateOf(await h.post(`/game/${started.gameId}/phase`, { phase: 'crisis_votacion' }, host()));
  return { started, state };
}

describe('Worker — ventana de votación', () => {
  it('no acepta votos fuera de la fase de votación', async () => {
    const h = await harness();
    const started = await h.start(4);
    const res = await h.post(`/game/${started.gameId}/crisis-vote`, {
      teamId: started.teams[0].id,
      measureId: 'racionamiento-parejo',
    });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'wrong_phase');
  });

  it('rechaza una medida que no está en la papeleta de la partida', async () => {
    const h = await harness();
    const { started, state } = await enVotacion(h);
    const fuera = CRISIS_MEASURES.find((m) => !state.crisisMeasures.some((p) => p.id === m.id))!;
    assert.ok(fuera, 'la papeleta no puede incluir las cuatro medidas');
    const res = await h.post(`/game/${started.gameId}/crisis-vote`, {
      teamId: started.teams[0].id,
      measureId: fuera.id,
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'bad_request');
  });

  it('rechaza el doble voto del mismo equipo', async () => {
    const h = await harness();
    const { started, state } = await enVotacion(h);
    const elegida = state.crisisMeasures[0].id;

    const primera = await h.post(`/game/${started.gameId}/crisis-vote`, {
      teamId: started.teams[0].id,
      measureId: elegida,
    });
    assert.equal(primera.status, 200);
    const repetida = await h.post(`/game/${started.gameId}/crisis-vote`, {
      teamId: started.teams[0].id,
      measureId: state.crisisMeasures[1].id,
    });
    assert.equal(repetida.status, 409);
    assert.equal((await repetida.json()).code, 'already_decided');
    assert.equal(h.repo.allDecisions().filter((d) => d.choice.startsWith('vote:')).length, 1);
  });

  it('la votación se cierra sola con el último voto y la medida se aplica a todos', async () => {
    const h = await harness();
    const { started, state } = await enVotacion(h, 4);
    const elegida = state.crisisMeasures[1].id;

    let ultimo: CrisisVoteResponse | null = null;
    for (const [i, team] of started.teams.entries()) {
      const res = await h.post(`/game/${started.gameId}/crisis-vote`, { teamId: team.id, measureId: elegida });
      assert.equal(res.status, 200);
      const body = (await res.json()) as CrisisVoteResponse;
      if (i < started.teams.length - 1) {
        assert.equal(body.closed, false);
        assert.equal(body.outcome, null, 'la ventana sigue abierta');
      } else {
        ultimo = body;
      }
    }

    assert.ok(ultimo);
    assert.equal(ultimo.closed, true);
    assert.equal(ultimo.outcome?.measureId, elegida);
    assert.equal(ultimo.state.phase, 'decidir_2', 'el último voto cierra la votación y abre decidir_2');
    assert.equal(ultimo.state.crisisVotes.length, started.teams.length);
    // Todos los equipos con el mismo efecto de la medida ganadora (racionamiento: -3 de eficiencia).
    if (elegida === 'racionamiento-parejo') {
      assert.ok(ultimo.state.teams.every((t) => t.eficiencia === 47));
    }
    // Y queda registrado en el historial: una fila de voto por equipo y una de medida por equipo.
    const votos = h.repo.allDecisions().filter((d) => d.choice.startsWith('vote:'));
    assert.equal(votos.length, started.teams.length);
    const medidas = h.repo.allDecisions().filter((d) => d.choice.startsWith('crisis:medida:'));
    assert.equal(medidas.length, started.teams.length);
    assert.ok(medidas.every((d) => d.choice === `crisis:medida:${elegida}`));
  });

  it('si el host cierra antes de tiempo, decide el recuento parcial y no se cobra dos veces', async () => {
    const h = await harness();
    const { started, state } = await enVotacion(h, 4);
    const elegida = state.crisisMeasures[2].id;

    await h.post(`/game/${started.gameId}/crisis-vote`, { teamId: started.teams[0].id, measureId: elegida });
    await h.post(`/game/${started.gameId}/crisis-vote`, { teamId: started.teams[1].id, measureId: elegida });
    // El host avanza sin esperar a las otras dos mesas.
    const trasCerrar = await stateOf(await h.post(`/game/${started.gameId}/phase`, { phase: 'decidir_2' }, host()));
    assert.equal(trasCerrar.phase, 'decidir_2');
    assert.equal(trasCerrar.crisisOutcome?.measureId, elegida);
    assert.equal(trasCerrar.crisisOutcome?.totalVotes, 2);

    const presupuestos = trasCerrar.teams.map((t) => t.presupuesto);
    // Reintentar el cierre (por ejemplo, el host pulsando otra vez) no vuelve a cobrar.
    const segunda = await stateOf(await h.get(`/game/${started.gameId}/state`));
    assert.deepEqual(segunda.teams.map((t) => t.presupuesto), presupuestos);
    assert.equal(h.repo.allDecisions().filter((d) => d.choice.startsWith('crisis:medida:')).length, 4);
  });

  it('el estado expone la papeleta, los votos y el resultado para el Host y el Player', async () => {
    const h = await harness();
    const { started, state } = await enVotacion(h, 4);
    assert.equal(state.crisisMeasures.length, 3);
    assert.deepEqual(state.crisisVotes, []);
    assert.equal(state.crisisOutcome, null);
    assert.ok(state.crisisRate >= 0.2 && state.crisisRate <= 0.45);
    assert.equal(typeof state.seed, 'number');
    for (const medida of state.crisisMeasures) {
      assert.ok(medida.label && medida.description);
      assert.ok(medida.severity >= 1 && medida.severity <= 4);
    }

    await h.post(`/game/${started.gameId}/crisis-vote`, {
      teamId: started.teams[0].id,
      measureId: state.crisisMeasures[0].id,
    });
    const conVoto = await stateOf(await h.get(`/game/${started.gameId}/state`));
    assert.equal(conVoto.crisisVotes.length, 1);
    assert.equal(conVoto.crisisVotes[0].teamId, started.teams[0].id);
    assert.ok(Date.parse(conVoto.crisisVotes[0].votedAt) > 0);
  });

  it('la medida ganadora deja el mismo delta de eficiencia a toda el aula, sin deudas nuevas', async () => {
    const h = await harness();
    const { started, state } = await enVotacion(h, 4);
    const antes = new Map(state.teams.map((t) => [t.id, t] as const));
    const elegida = state.crisisMeasures[0].id;

    for (const team of started.teams) {
      const res = await h.post(`/game/${started.gameId}/crisis-vote`, { teamId: team.id, measureId: elegida });
      assert.equal(res.status, 200);
    }
    const final = await stateOf(await h.get(`/game/${started.gameId}/state`));

    // La regla es la misma para todos: el efecto fijo de la medida (el reparto solidario,
    // que por definicion trata distinto a cada equipo, no mueve eficiencia).
    const deltasEficiencia = final.teams.map((t) => t.eficiencia - antes.get(t.id)!.eficiencia);
    assert.equal(new Set(deltasEficiencia).size, 1, `deltas distintos: ${deltasEficiencia.join(', ')}`);
    for (const t of final.teams) {
      assert.ok(t.presupuesto > 0, `${t.name} queda en deuda por la medida`);
      assert.ok(t.electricidad >= 0 && t.electricidad <= 220);
    }
  });
});

describe('Worker — ventana de despliegue con la app antigua', () => {
  it('acepta el salto heredado crisis -> decidir_2 y resuelve la votación con los votos que haya', async () => {
    const h = await harness();
    const started = await h.start(4);
    await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, host());
    await h.post(`/game/${started.gameId}/phase`, { phase: 'decidir' }, host());
    await h.post(`/game/${started.gameId}/phase`, { phase: 'crisis' }, host());

    // La app antigua no conoce `crisis_votacion`: pide el salto directo.
    const res = await h.post(`/game/${started.gameId}/phase`, { phase: 'decidir_2' }, host());
    assert.equal(res.status, 200);
    const state = await stateOf(res);
    assert.equal(state.phase, 'decidir_2');
    assert.ok(state.crisisOutcome, 'sin votos decide la medida más severa de la papeleta');
    const severa = [...state.crisisMeasures].sort((a, b) => b.severity - a.severity)[0];
    assert.equal(state.crisisOutcome!.measureId, severa.id);
    assert.equal(state.crisisOutcome!.totalVotes, 0);

    // La medida se aplicó y quedó registrada una sola vez por equipo.
    const medidas = h.repo.allDecisions().filter((d) => d.choice.startsWith('crisis:medida:'));
    assert.equal(medidas.length, started.teams.length);
    assert.ok(medidas.every((d) => d.choice === `crisis:medida:${severa.id}`));

    // Y un salto que NO es el heredado sigue rechazado.
    const invalido = await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, host());
    assert.equal(invalido.status, 409);
  });
});
