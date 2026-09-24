/**
 * Tests del Worker: se ejercita el router real (`handleRequest`) con el repositorio
 * en memoria. Cubre el flujo completo de partida (Fase 1: "un flujo de partida
 * simulada end-to-end") y los caminos de rechazo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  CrisisResponse,
  DecisionResponse,
  GameStateResponse,
  JoinGameResponse,
  StartGameResponse,
} from '../types/api.ts';
import { CASE_CATALOG } from '../content/cases.ts';
import { OPTIONS_BY_ID, ROUND2_SCENARIOS, scenariosForCase } from '../content/decisions.ts';
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

interface Harness {
  repo: InMemoryRepo;
  post: (path: string, body?: unknown, init?: RequestInit) => Promise<Response>;
  get: (path: string, init?: RequestInit) => Promise<Response>;
  start: (body?: unknown) => Promise<StartGameResponse>;
  /** Alta directa por el endpoint público del QR (una mesa escribiendo su nombre). */
  join: (gameId: string, name: string) => Promise<JoinGameResponse>;
}

function harness(env: Env = ENV): Harness {
  const repo = new InMemoryRepo();
  const call = (path: string, init: RequestInit) =>
    handleRequest(new Request(`https://api.test${path}`, init), env, repo);
  const json = (path: string, body?: unknown) =>
    call(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }) as Promise<Response>;
  return {
    repo,
    post: (path, body, init = {}) =>
      call(path, {
        ...init,
        method: 'POST',
        headers: { 'content-type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      }) as Promise<Response>,
    get: (path, init = {}) => call(path, { method: 'GET', ...init }) as Promise<Response>,
    join: async (gameId, name) => harness_join(json, gameId, name),
    /**
     * Partida lista para jugar: crea la partida y mete N mesas por el endpoint real de
     * registro (el mismo que usan los celulares al escanear el QR del proyector).
     */
    start: async (body) => {
      const peticion = (body ?? {}) as { teamCount?: number; cases?: string[] };
      const res = await json('/game/start', body ?? {});
      assert.equal(res.status, 201);
      const started = (await res.json()) as StartGameResponse;

      const mesas = peticion.cases?.length ?? peticion.teamCount ?? CASE_CATALOG.length;
      const teams: StartGameResponse['teams'] = [];
      let state = started.state;
      for (let i = 0; i < Math.min(mesas, CASE_CATALOG.length); i += 1) {
        const joined = await harness_join(json, started.gameId, CASE_CATALOG[i].name);
        teams.push({
          id: joined.teamId,
          name: joined.name,
          caseId: joined.caseId,
          color: joined.color,
          playPath: joined.playPath,
        });
        state = joined.state;
      }
      return { ...started, teams, state };
    },
  };
}

async function harness_join(
  json: (path: string, body?: unknown) => Promise<Response>,
  gameId: string,
  name: string,
): Promise<JoinGameResponse> {
  const res = await json(`/game/${gameId}/join`, { name });
  assert.equal(res.status, 201, `join de "${name}"`);
  return (await res.json()) as JoinGameResponse;
}

const host = (extra: Record<string, string> = {}) => ({ headers: { 'x-host-token': HOST_TOKEN, ...extra } });

/**
 * Lee el estado de una respuesta. `GET /state` lo devuelve directo; los endpoints de
 * host lo devuelven envuelto en `{state}`.
 */
async function stateOf(res: Response): Promise<GameStateResponse> {
  assert.equal(res.status, 200);
  const body = (await res.json()) as GameStateResponse | { state: GameStateResponse };
  return 'state' in body ? body.state : body;
}

describe('Worker — arranque de partida', () => {
  it('POST /game/start abre la partida en lobby y SIN equipos (entran por el QR)', async () => {
    const h = harness();
    const res = await h.post('/game/start', { teamCount: 4 });
    assert.equal(res.status, 201);
    const started = (await res.json()) as StartGameResponse;

    assert.equal(started.phase, 'lobby');
    assert.equal(started.slots, 4);
    assert.deepEqual(started.teams, []);
    assert.equal(started.hostPath, `/host?game=${started.gameId}`);
    assert.equal(started.joinPath, `/join?game=${started.gameId}`);
    assert.equal(started.state.teams.length, 0);
    assert.equal(started.state.results, null);
  });

  it('cada mesa que entra con su nombre recibe el siguiente caso del catálogo', async () => {
    const h = harness();
    const creada = (await (await h.post('/game/start', { teamCount: 3 })).json()) as StartGameResponse;

    const primera = await h.join(creada.gameId, 'Los Tigres');
    const segunda = await h.join(creada.gameId, 'Chispas');
    const tercera = await h.join(creada.gameId, 'Voltios');

    assert.deepEqual(
      [primera.caseId, segunda.caseId, tercera.caseId],
      CASE_CATALOG.slice(0, 3).map((caso) => caso.id),
    );
    assert.equal(new Set([primera.color, segunda.color, tercera.color]).size, 3);
    assert.equal(primera.playPath, `/play/${primera.teamId}?game=${creada.gameId}`);
    assert.equal(tercera.state.teams.length, 3);

    // Todo equipo arranca con el estado del documento.
    for (const team of tercera.state.teams) {
      assert.equal(team.electricidad, 100);
      assert.equal(team.gas, 100);
      assert.equal(team.presupuesto, 100000);
      assert.equal(team.eficiencia, 50);
      assert.equal(team.puntos, 0);
    }
    // El caso llega a la vista del equipo con sus consumos ocultos.
    assert.deepEqual(tercera.state.cases[primera.teamId].hiddenProblems, CASE_CATALOG[0].hiddenProblems);
    assert.equal(tercera.state.results, null);
  });

  it('acepta un numero de equipos menor al catalogo (4-6 del documento)', async () => {
    const h = harness();
    const started = await h.start({ teamCount: 4 });
    assert.equal(started.teams.length, 4);
  });

  it('rechaza un caso inexistente', async () => {
    const h = harness();
    const res = await h.post('/game/start', { cases: ['no-existe'] });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'bad_request');
  });

  it('GET /game/:id/state devuelve caso, progreso y reloj del servidor (reconexion)', async () => {
    const h = harness();
    const started = await h.start();
    const state = await stateOf(await h.get(`/game/${started.gameId}/state`));

    assert.equal(state.gameId, started.gameId);
    assert.equal(state.phase, 'lobby');
    assert.ok(Date.parse(state.serverTime) > 0);
    assert.equal(Object.keys(state.cases).length, CASE_CATALOG.length);
    const duque = started.teams.find((t) => t.caseId === 'familia-duque')!;
    assert.deepEqual(state.cases[duque.id].hiddenProblems, CASE_CATALOG[0].hiddenProblems);
    assert.deepEqual(state.answered[duque.id], []);
  });

  it('devuelve 404 en una partida inexistente', async () => {
    const h = harness();
    const res = await h.get('/game/11111111-1111-1111-1111-111111111111/state');
    assert.equal(res.status, 404);
  });

  it('el Worker es el unico escritor: todas las mutaciones pasan por el repositorio', async () => {
    const h = harness();
    const started = await h.start();
    assert.equal(h.repo.writes.games, 1);
    assert.equal(h.repo.writes.teams, CASE_CATALOG.length);

    await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, host());
    assert.equal(h.repo.writes.games, 2);
  });
});

describe('Worker — fases y permisos de host', () => {
  it('sin token de host no se avanza de fase', async () => {
    const h = harness();
    const started = await h.start();
    const res = await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'forbidden');
  });

  it('con token, avanza una fase y programa el cronometro absoluto', async () => {
    const h = harness();
    const started = await h.start();
    const state = await stateOf(await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, host()));
    assert.equal(state.phase, 'investigar');
    assert.ok(Date.parse(state.timerEndsAt) > Date.now(), 'timerEndsAt debe ser futuro');
  });

  it('rechaza saltar fases', async () => {
    const h = harness();
    const started = await h.start();
    const res = await h.post(`/game/${started.gameId}/phase`, { phase: 'resultados' }, host());
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'conflict');
  });

  it('sin HOST_TOKEN sigue fallando cerrado: nadie sin credencial abre una fase', async () => {
    // Sin HOST_TOKEN queda la contraseña de anfitrión (por defecto 9806, ver HOST_PASSCODE):
    // es un guardia de aula, no un secreto fuerte, así que la puerta sigue existiendo.
    const sinToken = { ...ENV, HOST_TOKEN: undefined };
    const h = harness(sinToken);
    const started = await h.start();

    const ajeno = await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, {
      headers: { 'x-host-token': 'cualquiera' },
    });
    assert.equal(ajeno.status, 403);
    assert.equal((await ajeno.json()).code, 'forbidden');

    const sinCabecera = await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' });
    assert.equal(sinCabecera.status, 403);

    const anfitrion = await h.post(
      `/game/${started.gameId}/phase`,
      { phase: 'investigar' },
      { headers: { 'x-host-token': '9806' } },
    );
    assert.equal(anfitrion.status, 200);
  });

  it('con la credencial de host desactivada a propósito, el Worker no acepta nada (503)', async () => {
    // Despliegue endurecido: `HOST_TOKEN=''` y `HOST_PASSCODE=''` no dejan ninguna
    // credencial válida, así que la puerta se queda cerrada en vez de aceptar vacío.
    const h = harness({ ...ENV, HOST_TOKEN: '', HOST_PASSCODE: undefined });
    const started = await h.start();
    const res = await handleRequest(
      new Request(`https://api.test/game/${started.gameId}/phase`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-host-token': '' },
        body: JSON.stringify({ phase: 'investigar' }),
      }),
      { ...ENV, HOST_TOKEN: '', HOST_PASSCODE: '' },
      h.repo,
    );
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'not_configured');
  });
});

describe('Worker — decisiones', () => {
  it('no acepta decisiones fuera de una ronda de decision', async () => {
    const h = harness();
    const started = await h.start();
    const res = await h.post(`/game/${started.gameId}/decision`, {
      teamId: started.teams[0].id,
      round: 'investigar',
      optionId: 'r1:nevera:completa',
    });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'wrong_phase');
  });

  it('en la Ronda 1 solo acepta los aparatos del caso del equipo', async () => {
    const h = harness();
    const started = await h.start();
    await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, host());

    const oficina = started.teams.find((t) => t.caseId === 'oficina-norte')!;
    const duque = started.teams.find((t) => t.caseId === 'familia-duque')!;

    // "estufa-gas" no existe en Oficina Norte.
    const ajeno = await h.post(`/game/${started.gameId}/decision`, {
      teamId: oficina.id,
      round: 'investigar',
      optionId: 'r1:estufa-gas:completa',
    });
    assert.equal(ajeno.status, 400);

    const valido = await h.post(`/game/${started.gameId}/decision`, {
      teamId: duque.id,
      round: 'investigar',
      optionId: 'r1:computador:completa',
    });
    const body = (await valido.json()) as DecisionResponse;
    assert.equal(valido.status, 200);
    assert.equal(body.team.electricidad, 100 + (OPTIONS_BY_ID['r1:computador:completa'].effect.electricidad ?? 0));
    assert.equal(body.scenarioKey, 'r1:computador');
    assert.match(body.feedback, /Tu decisión ahorró 1,20 kWh/);
  });

  it('rechaza la misma decision dos veces y el mismo escenario por otra opcion', async () => {
    const h = harness();
    const started = await h.start();
    await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, host());
    const teamId = started.teams[0].id;

    const primera = await h.post(`/game/${started.gameId}/decision`, {
      teamId,
      round: 'investigar',
      optionId: 'r1:nevera:completa',
    });
    assert.equal(primera.status, 200);

    for (const optionId of ['r1:nevera:completa', 'r1:nevera:ninguna']) {
      const repetida = await h.post(`/game/${started.gameId}/decision`, {
        teamId,
        round: 'investigar',
        optionId,
      });
      assert.equal(repetida.status, 409);
      assert.equal((await repetida.json()).code, 'already_decided');
    }
  });

  it('rechaza una opcion de otra ronda de la fase activa', async () => {
    const h = harness();
    const started = await h.start();
    await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, host());
    const res = await h.post(`/game/${started.gameId}/decision`, {
      teamId: started.teams[0].id,
      round: 'decidir',
      optionId: 'r2:calor:b',
    });
    assert.equal(res.status, 409);
  });

  it('rechaza una opcion inexistente y un cuerpo malformado', async () => {
    const h = harness();
    const started = await h.start();
    await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, host());

    const inexistente = await h.post(`/game/${started.gameId}/decision`, {
      teamId: started.teams[0].id,
      round: 'investigar',
      optionId: 'r1:nevera:inventada',
    });
    assert.equal(inexistente.status, 400);

    const malformado = await h.post(`/game/${started.gameId}/decision`, { round: 'investigar' });
    assert.equal(malformado.status, 400);
  });

  it('acumula las decisiones de la Ronda 2 en el equipo y las registra en el historial', async () => {
    const h = harness();
    const started = await h.start();
    await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, host());
    await h.post(`/game/${started.gameId}/phase`, { phase: 'decidir' }, host());
    const teamId = started.teams[0].id;

    let esperadoE = 100;
    let esperadoEf = 50;
    let esperadoP = 100000;
    for (const scenario of ROUND2_SCENARIOS) {
      const optionId = `r2:${scenario.id}:b`;
      const option = OPTIONS_BY_ID[optionId];
      const res = await h.post(`/game/${started.gameId}/decision`, {
        teamId,
        round: 'decidir',
        optionId,
      });
      const body = (await res.json()) as DecisionResponse;
      esperadoE += option.effect.electricidad ?? 0;
      esperadoEf += option.effect.eficiencia ?? 0;
      esperadoP += option.effect.presupuesto ?? 0;
      assert.equal(body.team.electricidad, Math.round(esperadoE * 100) / 100, `${optionId}`);
      assert.equal(body.team.eficiencia, esperadoEf);
      assert.equal(body.team.presupuesto, esperadoP);
    }

    const decisiones = h.repo.allDecisions().filter((d) => d.team_id === teamId);
    assert.equal(decisiones.length, ROUND2_SCENARIOS.length);
    assert.deepEqual(
      decisiones.map((d) => d.round),
      ROUND2_SCENARIOS.map(() => 'decidir'),
    );
  });

  it('el estado devuelto expone las decisiones ya tomadas (para la UI tras reconectar)', async () => {
    const h = harness();
    const started = await h.start();
    await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, host());
    await h.post(`/game/${started.gameId}/phase`, { phase: 'decidir' }, host());
    const teamId = started.teams[0].id;
    await h.post(`/game/${started.gameId}/decision`, { teamId, round: 'decidir', optionId: 'r2:calor:b' });

    const state = await stateOf(await h.get(`/game/${started.gameId}/state`));
    assert.deepEqual(state.answered[teamId], ['r2:calor']);
  });
});

describe('Worker — evento sorpresa y cierre', () => {
  it('la crisis es solo del host', async () => {
    const h = harness();
    const started = await h.start();
    await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, host());
    await h.post(`/game/${started.gameId}/phase`, { phase: 'decidir' }, host());
    const res = await h.post(`/game/${started.gameId}/crisis`);
    assert.equal(res.status, 403);
  });

  it('la crisis aplica el recargo proporcional y abre la fase de crisis', async () => {
    const h = harness();
    const started = await h.start();
    await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, host());
    await h.post(`/game/${started.gameId}/phase`, { phase: 'decidir' }, host());

    const teamId = started.teams[0].id;
    const otro = started.teams[1].id;
    await h.post(`/game/${started.gameId}/decision`, { teamId, round: 'decidir', optionId: 'r2:calor:b' });

    const res = await h.post(`/game/${started.gameId}/crisis`, undefined, host());
    const body = (await res.json()) as CrisisResponse;

    assert.equal(res.status, 200);
    assert.equal(body.state.phase, 'crisis');
    assert.equal(body.state.crisisTriggered, true);

    const eficiente = body.state.teams.find((t) => t.id === teamId)!;
    const derrochador = body.state.teams.find((t) => t.id === otro)!;
    assert.ok(body.surcharges[teamId] > 0);
    assert.ok(
      body.surcharges[otro] > body.surcharges[teamId],
      'el recargo es mayor para quien mas consumio (no es parejo)',
    );
    assert.equal(eficiente.presupuesto, 100000 + (OPTIONS_BY_ID['r2:calor:b'].effect.presupuesto ?? 0) - body.surcharges[teamId]);
    assert.equal(derrochador.presupuesto, 100000 - body.surcharges[otro]);

    // El recargo queda en el historial (resumen educativo).
    const logCrisis = h.repo.allDecisions().filter((d) => d.round === 'crisis');
    assert.equal(logCrisis.length, started.teams.length);
    assert.equal(logCrisis.find((d) => d.team_id === teamId)!.choice, 'crisis:price_shock');
  });

  it('disparar la crisis dos veces no cobra dos veces', async () => {
    const h = harness();
    const started = await h.start();
    await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, host());
    await h.post(`/game/${started.gameId}/phase`, { phase: 'decidir' }, host());

    const primera = (await (await h.post(`/game/${started.gameId}/crisis`, undefined, host())).json()) as CrisisResponse;
    const segunda = (await (await h.post(`/game/${started.gameId}/crisis`, undefined, host())).json()) as CrisisResponse;

    assert.deepEqual(segunda.state.teams.map((t) => t.presupuesto), primera.state.teams.map((t) => t.presupuesto));
    assert.ok(Object.values(segunda.surcharges).every((s) => s === 0));
    assert.equal(h.repo.allDecisions().filter((d) => d.round === 'crisis').length, started.teams.length);
  });

  it('avanzar de fase hacia crisis tambien dispara el evento (sin cobrar doble)', async () => {
    const h = harness();
    const started = await h.start();
    await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, host());
    await h.post(`/game/${started.gameId}/phase`, { phase: 'decidir' }, host());

    const viaPhase = await stateOf(await h.post(`/game/${started.gameId}/phase`, { phase: 'crisis' }, host()));
    assert.equal(viaPhase.phase, 'crisis');
    assert.equal(viaPhase.crisisTriggered, true);
    assert.ok(viaPhase.teams.every((t) => t.presupuesto < 100000));

    const viaEndpoint = (await (await h.post(`/game/${started.gameId}/crisis`, undefined, host())).json()) as CrisisResponse;
    assert.ok(Object.values(viaEndpoint.surcharges).every((s) => s === 0));
    assert.deepEqual(
      viaEndpoint.state.teams.map((t) => t.presupuesto),
      viaPhase.teams.map((t) => t.presupuesto),
    );
  });

  it('no se puede disparar la crisis antes de decidir', async () => {
    const h = harness();
    const started = await h.start();
    const res = await h.post(`/game/${started.gameId}/crisis`, undefined, host());
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'wrong_phase');
  });
});

describe('Worker — flujo completo de partida simulada', () => {
  it('lobby -> investigar -> decidir -> crisis -> decidir_2 -> resultados', async () => {
    const h = harness();
    const started = await h.start({ teamCount: 5 });
    const gameId = started.gameId;

    // Ronda 1: cada equipo diagnostica 3 aparatos de su caso.
    let state = await stateOf(await h.post(`/game/${gameId}/phase`, { phase: 'investigar' }, host()));
    assert.equal(state.phase, 'investigar');
    for (const team of started.teams) {
      const aparatos = state.cases[team.id].appliances.slice(0, 3);
      for (const aparato of aparatos) {
        const res = await h.post(`/game/${gameId}/decision`, {
          teamId: team.id,
          round: 'investigar',
          optionId: `r1:${aparato}:completa`,
        });
        assert.equal(res.status, 200, `fallo ${team.name}/${aparato}`);
      }
    }

    // Ronda 2: las situaciones de los aparatos de cada caso, con la opcion equilibrada.
    state = await stateOf(await h.post(`/game/${gameId}/phase`, { phase: 'decidir' }, host()));
    assert.equal(state.phase, 'decidir');
    for (const team of started.teams) {
      const situaciones = scenariosForCase('decidir', state.cases[team.id].appliances);
      assert.ok(situaciones.length > 0, `${team.name} sin situaciones`);
      for (const scenario of situaciones) {
        const res = await h.post(`/game/${gameId}/decision`, {
          teamId: team.id,
          round: 'decidir',
          optionId: `r2:${scenario.id}:b`,
        });
        assert.equal(res.status, 200, `${team.name}/${scenario.id}`);
      }
      // Y una situacion que su caso no juega se rechaza (antes se aceptaba).
      const ajena = ROUND2_SCENARIOS.find((s) => !situaciones.includes(s));
      if (ajena) {
        const rechazada = await h.post(`/game/${gameId}/decision`, {
          teamId: team.id,
          round: 'decidir',
          optionId: `r2:${ajena.id}:b`,
        });
        assert.equal(rechazada.status, 400, `${team.name} no deberia jugar ${ajena.id}`);
      }
    }
    const antesDeCrisis = await stateOf(await h.get(`/game/${gameId}/state`));
    assert.ok(antesDeCrisis.teams.every((t) => t.eficiencia > 50), 'la ronda equilibrada sube eficiencia');

    // Crisis + ultimas decisiones.
    const crisis = (await (await h.post(`/game/${gameId}/crisis`, undefined, host())).json()) as CrisisResponse;
    assert.equal(crisis.state.phase, 'crisis');
    state = await stateOf(await h.post(`/game/${gameId}/phase`, { phase: 'decidir_2' }, host()));
    for (const team of started.teams) {
      const res = await h.post(`/game/${gameId}/decision`, {
        teamId: team.id,
        round: 'decidir_2',
        optionId: 'r2b:crisis-final:desconexion',
      });
      assert.equal(res.status, 200);
    }
    state = await stateOf(await h.post(`/game/${gameId}/phase`, { phase: 'resultados' }, host()));

    assert.equal(state.phase, 'resultados');
    assert.ok(state.results, 'la fase de resultados debe traer el ranking');
    assert.equal(state.results!.ranking.length, started.teams.length);
    assert.deepEqual(
      state.results!.ranking.map((r) => r.rank),
      [1, 2, 3, 4, 5],
    );
    assert.ok(
      state.results!.ranking.every((r, i) => i === 0 || state.results!.ranking[i - 1].team.eficiencia >= r.team.eficiencia),
    );
    // Los puntos quedan persistidos en los equipos.
    assert.ok(state.teams.every((t) => t.puntos > 0));
    const totalDecisiones = h.repo.allDecisions().length;
    assert.ok(totalDecisiones > 0);
  });

  it('tras la reconexion el estado completo se puede pedir en cualquier fase', async () => {
    const h = harness();
    const started = await h.start({ teamCount: 4 });
    await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, host());
    const teamId = started.teams[2].id;
    await h.post(`/game/${started.gameId}/decision`, {
      teamId,
      round: 'investigar',
      optionId: `r1:${CASE_CATALOG[2].appliances[0]}:parcial`,
    });

    const state = await stateOf(await h.get(`/game/${started.gameId}/state`));
    assert.equal(state.phase, 'investigar');
    assert.deepEqual(state.answered[teamId], [`r1:${CASE_CATALOG[2].appliances[0]}`]);
    assert.equal(state.cases[teamId].name, started.teams[2].name);
    assert.equal(state.teams.length, 4);
  });
});

describe('Worker — CORS y salud', () => {
  it('responde la sonda de salud', async () => {
    const h = harness();
    const res = await h.get('/health');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });

  it('atiende el preflight OPTIONS con las cabeceras del Worker', async () => {
    const h = harness();
    const res = await handleRequest(
      new Request('https://api.test/game/start', { method: 'OPTIONS', headers: { origin: 'https://app.test' } }),
      ENV,
      new InMemoryRepo(),
    );
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
    assert.match(res.headers.get('Access-Control-Allow-Headers') ?? '', /x-host-token/);
  });

  it('devuelve 404 en rutas desconocidas', async () => {
    const h = harness();
    const res = await h.get('/no-existe');
    assert.equal(res.status, 404);
  });

  it('falla con 503 y mensaje accionable si falta la configuracion de Supabase', async () => {
    // Sin repositorio inyectado: se valida la configuracion real del Worker.
    const res = await handleRequest(
      new Request('https://api.test/game/x/state'),
      { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
    );
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.code, 'not_configured');
    assert.match(body.detail, /SUPABASE_URL/);
  });
});

describe('Worker — registro de mesas y contraseña del Host', () => {
  it('rechaza nombres vacíos, de un solo carácter o desmesurados', async () => {
    const h = harness();
    const creada = (await (await h.post('/game/start', {})).json()) as StartGameResponse;

    for (const nombre of ['', ' ', 'A', 'x'.repeat(25), 42]) {
      const res = await h.post(`/game/${creada.gameId}/join`, { name: nombre });
      assert.equal(res.status, 400, `deberia rechazar ${JSON.stringify(nombre)}`);
      assert.equal((await res.json()).code, 'bad_request');
    }
    // Un nombre válido con espacios de sobra se normaliza, no se rechaza.
    const limpio = await h.join(creada.gameId, '  Los   Tigres  ');
    assert.equal(limpio.name, 'Los Tigres');
  });

  it('rechaza un nombre ya usado en la partida', async () => {
    const h = harness();
    const creada = (await (await h.post('/game/start', {})).json()) as StartGameResponse;
    await h.join(creada.gameId, 'Los Tigres');

    const repetido = await h.post(`/game/${creada.gameId}/join`, { name: 'los tigres' });
    assert.equal(repetido.status, 409);
    assert.equal((await repetido.json()).code, 'name_taken');
    assert.equal(h.repo.writes.teams, 1, 'el rechazo no debe crear nada');
  });

  it('cierra el registro público en cuanto la partida arranca', async () => {
    const h = harness();
    const started = await h.start({ teamCount: 4 });
    await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, host());

    const tarde = await h.post(`/game/${started.gameId}/join`, { name: 'Los Tigres' });
    assert.equal(tarde.status, 409);
    const body = await tarde.json();
    assert.equal(body.code, 'wrong_phase');
    assert.match(body.detail, /anfitrión|anfitrion/);
  });

  it('el Host sí puede añadir el equipo que llega tarde', async () => {
    const h = harness();
    const started = await h.start({ teamCount: 4 });
    await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, host());

    const sinCredencial = await h.post(`/game/${started.gameId}/teams`, { name: 'Rezagados' });
    assert.equal(sinCredencial.status, 403);

    const resp = await h.post(`/game/${started.gameId}/teams`, { name: 'Rezagados' }, host());
    assert.equal(resp.status, 201);
    const añadido = (await resp.json()) as JoinGameResponse;
    assert.equal(añadido.name, 'Rezagados');
    assert.equal(añadido.state.teams.length, started.teams.length + 1);
    // El caso nuevo es el siguiente libre del catálogo, no uno repetido.
    const usados = añadido.state.teams.map((t) => t.id);
    assert.equal(new Set(usados).size, usados.length);
    assert.equal(añadido.caseId, CASE_CATALOG[started.teams.length].id);
  });

  it('no admite más mesas que casos tiene el catálogo', async () => {
    const h = harness();
    const started = await h.start();
    assert.equal(started.teams.length, CASE_CATALOG.length);

    const sobrante = await h.post(`/game/${started.gameId}/join`, { name: 'Sobrante' });
    assert.equal(sobrante.status, 409);
    assert.equal((await sobrante.json()).code, 'game_full');
  });

  it('el sondeo de contraseña acepta la clave por defecto y el HOST_TOKEN, y rechaza el resto', async () => {
    const h = harness();
    const conPasscode = await handleRequest(
      new Request('https://api.test/host/verify', {
        method: 'POST',
        headers: { 'x-host-token': '9806' },
      }),
      ENV,
      h.repo,
    );
    assert.equal(conPasscode.status, 200);
    assert.deepEqual(await conPasscode.json(), { ok: true, gameId: null });

    const conToken = await handleRequest(
      new Request('https://api.test/host/verify', {
        method: 'POST',
        headers: { 'x-host-token': HOST_TOKEN },
      }),
      ENV,
      h.repo,
    );
    assert.equal(conToken.status, 200);

    const mala = await handleRequest(
      new Request('https://api.test/host/verify', {
        method: 'POST',
        headers: { 'x-host-token': '1234' },
      }),
      ENV,
      h.repo,
    );
    assert.equal(mala.status, 403);

    const sinCabecera = await handleRequest(
      new Request('https://api.test/host/verify', { method: 'POST' }),
      ENV,
      h.repo,
    );
    assert.equal(sinCabecera.status, 403);
  });

  it('la contraseña de anfitrión también autoriza las acciones de la partida', async () => {
    const h = harness();
    const started = await h.start({ teamCount: 4 });
    const comoAnfitrion = { headers: { 'x-host-token': '9806' } };

    const fase = await h.post(`/game/${started.gameId}/phase`, { phase: 'investigar' }, comoAnfitrion);
    assert.equal(fase.status, 200);
    assert.equal((await fase.json()).state.phase, 'investigar');

    const crisis = await h.post(`/game/${started.gameId}/crisis`, undefined, comoAnfitrion);
    assert.equal(crisis.status, 409, 'la crisis solo se dispara al cerrar la ronda de decisiones');
  });

  it('una contraseña configurada en el Worker sustituye a la de fábrica', async () => {
    const h = harness({ ...ENV, HOST_PASSCODE: 'mi-clave-de-clase' });
    const creada = (await (await h.post('/game/start', {})).json()) as StartGameResponse;

    const fabrica = await handleRequest(
      new Request(`https://api.test/game/${creada.gameId}/phase`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-host-token': '9806' },
        body: JSON.stringify({ phase: 'investigar' }),
      }),
      { ...ENV, HOST_PASSCODE: 'mi-clave-de-clase' },
      h.repo,
    );
    assert.equal(fabrica.status, 403, 'la clave de fábrica deja de servir');

    const propia = await handleRequest(
      new Request(`https://api.test/game/${creada.gameId}/phase`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-host-token': 'mi-clave-de-clase' },
        body: JSON.stringify({ phase: 'investigar' }),
      }),
      { ...ENV, HOST_PASSCODE: 'mi-clave-de-clase' },
      h.repo,
    );
    assert.equal(propia.status, 200);
  });
});
