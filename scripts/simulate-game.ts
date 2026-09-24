/**
 * Flujo de partida simulada end-to-end, SIN UI (Fase 1: criterio de salida).
 *
 * Ejercita el router real del Worker (`handleRequest`) con el repositorio en memoria:
 * los mismos endpoints y el mismo motor que van a usar el Host y los Players.
 *
 *   node scripts/simulate-game.ts            # 5 equipos, estrategia equilibrada
 *   node scripts/simulate-game.ts --mixed    # cada equipo juega distinto (derroche/extremo/equilibrado)
 */

import type {
  CrisisResponse,
  DecisionResponse,
  GameStateResponse,
  JoinGameResponse,
  PhaseResponse,
  StartGameResponse,
} from '../types/api.ts';
import { CASE_CATALOG } from '../content/cases.ts';
import { ROUND2_SCENARIOS } from '../content/decisions.ts';
import { handleRequest } from '../worker/src/index.ts';
import { InMemoryRepo } from '../worker/src/repo-memory.ts';
import type { Env } from '../worker/src/env.ts';

const HOST_TOKEN = 'token-simulacion';
const env: Env = {
  SUPABASE_URL: 'https://simulacion.local',
  SUPABASE_SERVICE_ROLE_KEY: 'no-se-usa-con-repo-en-memoria',
  HOST_TOKEN,
  ALLOWED_ORIGINS: '*',
};

const mixed = process.argv.includes('--mixed');
const variantes = ['b', 'a', 'c', 'b', 'b'] as const;
const etapa = (i: number) => (mixed ? { b: 'equilibrado', a: 'derroche', c: 'extremo' }[variantes[i]] : 'equilibrado');
const porEquipo = new Map<string, string>();

const repo = new InMemoryRepo();
const call = (path: string, init: RequestInit) =>
  handleRequest(new Request(`https://api.simulacion${path}`, init), env, repo);

async function post<T>(path: string, body?: unknown, host = false): Promise<T> {
  const res = await call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(host ? { 'x-host-token': HOST_TOKEN } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await res.json()) as T & { detail?: string; code?: string };
  if (res.status >= 400 && !host) {
    // Los rechazos esperados se informan, no se silencian.
    console.log(`  ! ${res.status} ${payload.code}: ${payload.detail}`);
  }
  return payload;
}

const getState = async (gameId: string): Promise<GameStateResponse> =>
  (await (await call(`/game/${gameId}/state`, { method: 'GET' })).json()) as GameStateResponse;

function linea(estado: GameStateResponse, titulo: string) {
  console.log(`\n=== ${titulo} ===`);
  console.log(
    `fase=${estado.phase} crisis=${estado.crisisTriggered} timer=${estado.timerEndsAt} fase_servidor=${estado.serverTime}`,
  );
  for (const t of estado.teams) {
    console.log(
      `  ${t.name.padEnd(22)} ⚡${String(t.electricidad).padStart(6)} kWh  🔥${String(t.gas).padStart(5)} m³  ` +
        `💰${String(t.presupuesto).padStart(7)} $  🌱${String(t.eficiencia).padStart(5)}%  puntos=${t.puntos}`,
    );
  }
}

async function main() {
  console.log('POST /game/start');
  const EQUIPOS = 5;
  const started = (await (await call('/game/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ teamCount: EQUIPOS }),
  })).json()) as StartGameResponse;
  console.log(
    `partida ${started.gameId} · host en ${started.hostPath} · registro en ${started.joinPath}`,
  );

  // Cada mesa entra con su nombre por el mismo endpoint del QR del proyector.
  console.log('\nPOST /game/:id/join (una mesa por caso del catálogo)');
  for (const caso of CASE_CATALOG.slice(0, EQUIPOS)) {
    const joined = await post<JoinGameResponse>(`/game/${started.gameId}/join`, { name: caso.name });
    started.teams.push({
      id: joined.teamId,
      name: joined.name,
      caseId: joined.caseId,
      color: joined.color,
      playPath: joined.playPath,
    });
  }
  for (const t of started.teams) console.log(`  ${t.name.padEnd(22)} ${t.color}  ${t.playPath}`);

  // El Worker es el unico escritor: en lobby no se aceptan decisiones.
  console.log('\n[intento fuera de fase] una decision en lobby:');
  await post<DecisionResponse>(`/game/${started.gameId}/decision`, {
    teamId: started.teams[0].id,
    round: 'investigar',
    optionId: 'r1:nevera:completa',
  });

  console.log('\nPOST /game/:id/phase -> investigar');
  await post<PhaseResponse>(`/game/${started.gameId}/phase`, { phase: 'investigar' }, true);

  // Ronda 1: cada equipo diagnostica los aparatos de su caso.
  const ronda1 = await Promise.all(
    started.teams.map(async (team, i) => {
      let aparatos = 0;
      const fase = await getState(started.gameId);
      for (const aparato of fase.cases[team.id].appliances) {
        const variante = mixed ? ['completa', 'ninguna', 'completa', 'parcial', 'completa'][i] : 'completa';
        await post<DecisionResponse>(`/game/${started.gameId}/decision`, {
          teamId: team.id,
          round: 'investigar',
          optionId: `r1:${aparato}:${variante}`,
        });
        aparatos += 1;
      }
      return { team: team.name, aparatos };
    }),
  );
  console.log('\nRonda 1 (investigar) — aparatos diagnosticados por equipo:');
  for (const r of ronda1) console.log(`  ${r.team.padEnd(22)} ${r.aparatos}`);
  linea(await getState(started.gameId), 'Estado tras la Ronda 1');

  console.log('\nPOST /game/:id/phase -> decidir');
  await post<PhaseResponse>(`/game/${started.gameId}/phase`, { phase: 'decidir' }, true);

  // Ronda 2: las 6 situaciones del documento.
  let ultimoFeedback = '';
  for (const [i, team] of started.teams.entries()) {
    for (const scenario of ROUND2_SCENARIOS) {
      const variante = mixed ? variantes[i] : 'b';
      porEquipo.set(team.id, etapa(i));
      const res = await post<DecisionResponse>(`/game/${started.gameId}/decision`, {
        teamId: team.id,
        round: 'decidir',
        optionId: `r2:${scenario.id}:${variante}`,
      });
      if (i === 0 && res.feedback) ultimoFeedback = `[${scenario.title}] ${res.feedback}`;
    }
  }
  console.log(`\nFeedback del Worker (equipo 1, ultima decision):\n  ${ultimoFeedback}`);
  linea(await getState(started.gameId), 'Estado tras la Ronda 2');

  console.log('\nPOST /game/:id/crisis (solo host)');
  const crisis = await post<CrisisResponse>(`/game/${started.gameId}/crisis`, undefined, true);
  console.log('  recargo por equipo (proporcional a su consumo acumulado):');
  for (const team of crisis.state.teams) {
    console.log(`  ${team.name.padEnd(22)} -${crisis.surcharges[team.id]} $`);
  }
  linea(crisis.state, 'Estado en crisis');

  console.log('\nPOST /game/:id/phase -> decidir_2');
  await post<PhaseResponse>(`/game/${started.gameId}/phase`, { phase: 'decidir_2' }, true);
  for (const [i, team] of started.teams.entries()) {
    const opcion = mixed
      ? ['desconexion', 'habitual', 'desconexion', 'minimo', 'desconexion'][i]
      : 'desconexion';
    await post<DecisionResponse>(`/game/${started.gameId}/decision`, {
      teamId: team.id,
      round: 'decidir_2',
      optionId: `r2b:crisis-final:${opcion}`,
    });
  }
  linea(await getState(started.gameId), 'Estado tras las ultimas decisiones');

  console.log('\nPOST /game/:id/phase -> resultados');
  await post<PhaseResponse>(`/game/${started.gameId}/phase`, { phase: 'resultados' }, true);
  const final = await getState(started.gameId);
  linea(final, 'Resultado final');

  console.log('\nRanking (eficiencia desc, empates por presupuesto restante):');
  for (const entrada of final.results?.ranking ?? []) {
    console.log(
      `  #${entrada.rank} ${entrada.team.name.padEnd(22)} (${porEquipo.get(entrada.team.id) ?? 'equilibrado'}) ` +
        `🌱${entrada.team.eficiencia}%  💰${entrada.team.presupuesto} $  ` +
        `ahorro ${entrada.ahorroElectricidadKwh} kWh / ${entrada.ahorroGasM3} m³  puntos=${entrada.puntos}`,
    );
  }
  console.log(
    `\nPromedios: eficiencia ${final.results?.promedioEficiencia}% · ` +
      `presupuesto ${final.results?.promedioPresupuesto} $ · consumo ${final.results?.promedioConsumoElectrico} kWh`,
  );
  console.log(
    `\nEscrituras del repositorio: ${repo.writes.games} games, ${repo.writes.teams} teams, ${repo.writes.decisions} decisions`,
  );
}

main().catch((error) => {
  console.error('La simulacion fallo:', error);
  process.exitCode = 1;
});
