/**
 * Partida completa simulada, SIN UI.
 *
 * Ejercita el router real del Worker (`handleRequest`) con el repositorio en memoria:
 * los mismos endpoints y el mismo motor que van a usar el Host y los Players.
 *
 *   node scripts/simulate-game.ts             # 5 equipos, estrategia equilibrada
 *   node scripts/simulate-game.ts --mixed     # cada equipo juega distinto (derroche/extremo/equilibrado)
 *   node scripts/simulate-game.ts --scan 300  # barrido de 300 semillas (auditoria de jugabilidad)
 *
 * El barrido es la red de seguridad del plan (seccion 6): comprueba que NINGUNA semilla deja
 * una partida injugable —equipos sin situacion que jugar, decisiones rechazadas sin motivo,
 * equipos en deuda o una votacion que no cierra— y que la misma semilla reproduce la partida
 * entera dos veces igual.
 */

import type {
  CrisisResponse,
  CrisisVoteResponse,
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
const ENV_BASE: Env = {
  SUPABASE_URL: 'https://simulacion.local',
  SUPABASE_SERVICE_ROLE_KEY: 'no-se-usa-con-repo-en-memoria',
  HOST_TOKEN,
  ALLOWED_ORIGINS: '*',
};

const args = process.argv.slice(2);
const mixed = args.includes('--mixed');
const scanArg = args.indexOf('--scan');
const scan = scanArg >= 0 ? Math.max(1, Number(args[scanArg + 1] ?? 100)) : 0;
const variantes = ['b', 'a', 'c', 'b', 'b'] as const;
const etapa = (i: number) =>
  mixed ? { b: 'equilibrado', a: 'derroche', c: 'extremo' }[variantes[i % variantes.length]] : 'equilibrado';

interface Entorno {
  repo: InMemoryRepo;
  call: (path: string, init: RequestInit) => Promise<Response>;
}

/** Entorno aislado por partida: mismo router, misma semilla, repositorio limpio. */
function entorno(seed: number): Entorno {
  const repo = new InMemoryRepo();
  const env: Env = { ...ENV_BASE, GAME_SEED: String(seed) };
  return {
    repo,
    call: (path, init) => handleRequest(new Request(`https://api.simulacion${path}`, init), env, repo),
  };
}

interface ResumenEquipo {
  nombre: string;
  caso: string;
  sorteadas: number;
  jugadas: number;
  bloqueadas: number;
  rechazos: string[];
  voto: string | null;
  eficiencia: number;
  presupuesto: number;
  puntos: number;
}

interface ResumenPartida {
  seed: number;
  equipos: number;
  faseFinal: string;
  medida: string | null;
  resultadoDeVotacion: string;
  semillaDelActa: number;
  tasaDeCrisis: number;
  eventos: string[];
  ranking: string[];
  detalle: ResumenEquipo[];
  problemas: string[];
}

/**
 * Juega una partida completa: lobby -> investigar -> decidir -> crisis -> votacion ->
 * decidir_2 -> resultados, con los equipos entrando por el endpoint real del QR.
 */
async function jugarPartida(
  seed: number,
  equipos: number,
  loguear: boolean,
  votosRepartidos = mixed,
): Promise<ResumenPartida> {
  const { repo, call } = entorno(seed);
  const problemas: string[] = [];
  const detalle: ResumenEquipo[] = [];
  /** Eventos aleatorios que estuvieron vigentes en la ronda de decisiones. */
  const eventosDeLaRonda: string[] = [];

  const post = async <T>(path: string, body?: unknown, host = false): Promise<T> => {
    const res = await call(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(host ? { 'x-host-token': HOST_TOKEN } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = (await res.json()) as T & { detail?: string; code?: string };
    if (res.status >= 400 && loguear) {
      console.log(`  ! ${res.status} ${payload.code}: ${payload.detail}`);
    }
    return payload;
  };
  const estado = async (gameId: string): Promise<GameStateResponse> =>
    (await (await call(`/game/${gameId}/state`, { method: 'GET' })).json()) as GameStateResponse;

  /** Log de una fase: solo en modo verboso. */
  const linea = (estadoActual: GameStateResponse, titulo: string) => {
    if (!loguear) return;
    console.log(`\n=== ${titulo} ===`);
    console.log(
      `fase=${estadoActual.phase} crisis=${estadoActual.crisisTriggered} tarifa=+${Math.round(
        estadoActual.crisisRate * 100,
      )}% variante=${estadoActual.crisisVariant.id} semilla=${estadoActual.seed}`,
    );
    for (const t of estadoActual.teams) {
      console.log(
        `  ${t.name.padEnd(22)} ⚡${String(t.electricidad).padStart(6)} kWh  🔥${String(t.gas).padStart(5)} m³  ` +
          `💰${String(t.presupuesto).padStart(7)} $  🌱${String(t.eficiencia).padStart(5)}%  puntos=${t.puntos}`,
      );
    }
  };

  if (loguear) console.log(`POST /game/start (semilla ${seed})`);
  const started = await post<StartGameResponse>('/game/start', { teamCount: equipos });
  if (loguear) {
    console.log(`partida ${started.gameId} · host en ${started.hostPath} · registro en ${started.joinPath}`);
    console.log('\nPOST /game/:id/join (una mesa por caso del catálogo)');
  }

  const mesas: Array<{ id: string; name: string; caseId: string }> = [];
  for (const caso of CASE_CATALOG.slice(0, equipos)) {
    const joined = await post<JoinGameResponse>(`/game/${started.gameId}/join`, { name: caso.name });
    mesas.push({ id: joined.teamId, name: joined.name, caseId: joined.caseId });
    if (loguear) console.log(`  ${joined.name.padEnd(22)} ${joined.color}  ${joined.playPath}`);
  }

  if (loguear) {
    console.log('\n[intento fuera de fase] una decision en lobby:');
    await post<DecisionResponse>(`/game/${started.gameId}/decision`, {
      teamId: mesas[0].id,
      round: 'investigar',
      optionId: 'r1:nevera:completa',
    });
    console.log('\nPOST /game/:id/phase -> investigar');
  }
  await post<PhaseResponse>(`/game/${started.gameId}/phase`, { phase: 'investigar' }, true);

  // Ronda 1: cada equipo diagnostica los aparatos de su caso.
  let estadoActual = await estado(started.gameId);
  for (const [i, team] of mesas.entries()) {
    const caso = estadoActual.cases[team.id];
    const variante = mixed ? ['completa', 'ninguna', 'completa', 'parcial', 'completa'][i % 5] : 'completa';
    for (const aparato of caso.appliances) {
      await post<DecisionResponse>(`/game/${started.gameId}/decision`, {
        teamId: team.id,
        round: 'investigar',
        optionId: `r1:${aparato}:${variante}`,
      });
    }
  }
  if (loguear) console.log(`\nRonda 1: ${mesas.length} equipos diagnosticaron sus aparatos`);
  linea(await estado(started.gameId), 'Estado tras la Ronda 1');

  if (loguear) console.log('\nPOST /game/:id/phase -> decidir');
  await post<PhaseResponse>(`/game/${started.gameId}/phase`, { phase: 'decidir' }, true);

  // Ronda 2: SOLO las situaciones que el sorteo le dio a cada equipo (plan 1.1).
  estadoActual = await estado(started.gameId);
  for (const [i, team] of mesas.entries()) {
    const sorteadas = estadoActual.assignedScenarios[team.id];
    if (sorteadas.length < 3 || sorteadas.length > 4) {
      problemas.push(`equipo ${team.name}: ${sorteadas.length} situaciones sorteadas`);
    }
    for (const evento of estadoActual.activeEvents) {
      const clave = `${evento.id}${evento.applianceId ? `:${evento.applianceId}` : ''}`;
      if (!eventosDeLaRonda.includes(clave)) eventosDeLaRonda.push(clave);
    }
    const resumen: ResumenEquipo = {
      nombre: team.name,
      caso: team.caseId,
      sorteadas: sorteadas.length,
      jugadas: 0,
      bloqueadas: 0,
      rechazos: [],
      voto: null,
      eficiencia: 0,
      presupuesto: 0,
      puntos: 0,
    };
    for (const scenarioId of sorteadas) {
      const variante = mixed ? variantes[i % variantes.length] : 'b';
      const res = await call(`/game/${started.gameId}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ teamId: team.id, round: 'decidir', optionId: `r2:${scenarioId}:${variante}` }),
      });
      const body = (await res.json()) as DecisionResponse & { code?: string };
      if (res.status === 200) {
        resumen.jugadas += 1;
      } else if (body.code === 'locked_appliance') {
        resumen.bloqueadas += 1;
      } else {
        resumen.rechazos.push(`${scenarioId}: ${res.status} ${body.code}`);
      }
    }
    if (resumen.jugadas + resumen.bloqueadas !== sorteadas.length) {
      problemas.push(`equipo ${team.name}: ${resumen.rechazos.join(', ') || 'situaciones sin resolver'}`);
    }
    if (resumen.jugadas === 0) problemas.push(`equipo ${team.name} se quedo sin ninguna situacion jugable`);
    detalle.push(resumen);
  }

  // Una situacion fuera del sorteo se rechaza con motivo (no se acepta cualquier cosa).
  const ajeno = ROUND2_SCENARIOS.find(
    (s) => !estadoActual.assignedScenarios[mesas[0].id].includes(s.id),
  );
  if (ajeno) {
    const res = await call(`/game/${started.gameId}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: mesas[0].id, round: 'decidir', optionId: `r2:${ajeno.id}:b` }),
    });
    if (res.status !== 409 && res.status !== 400) {
      problemas.push(`situacion fuera del sorteo aceptada (${res.status})`);
    }
  }

  linea(await estado(started.gameId), 'Estado tras la Ronda 2');

  // Crisis: el evento sorpresa.
  if (loguear) console.log('\nPOST /game/:id/crisis (solo host)');
  const crisis = await post<CrisisResponse>(`/game/${started.gameId}/crisis`, undefined, true);
  if (loguear) {
    console.log('  recargo por equipo (proporcional a su consumo acumulado):');
    for (const team of crisis.state.teams) {
      console.log(`  ${team.name.padEnd(22)} -${crisis.surcharges[team.id]} $`);
    }
  }
  linea(crisis.state, 'Estado en crisis');

  // Votacion colectiva del aula.
  if (loguear) console.log('\nPOST /game/:id/phase -> crisis_votacion');
  const votando = await post<PhaseResponse>(`/game/${started.gameId}/phase`, { phase: 'crisis_votacion' }, true);
  if (loguear) {
    console.log('  papeleta:');
    for (const medida of votando.state.crisisMeasures) console.log(`   · ${medida.label}`);
  }
  const papeleta = votando.state.crisisMeasures;
  for (const [i, team] of mesas.entries()) {
    const medida = papeleta[votosRepartidos ? i % papeleta.length : 0];
    const res = await post<CrisisVoteResponse>(`/game/${started.gameId}/crisis-vote`, {
      teamId: team.id,
      measureId: medida.id,
    });
    const resumen = detalle.find((d) => d.nombre === team.name);
    if (resumen) resumen.voto = medida.id;
    if (!res.outcome && i === mesas.length - 1) problemas.push('la votacion no cerro con el ultimo voto');
  }

  const trasVotar = await estado(started.gameId);
  if (loguear) {
    console.log(`\nResultado de la votacion: ${trasVotar.crisisOutcome?.label ?? '(sin resultado)'}`);
    console.log(`  ${trasVotar.crisisOutcome?.description ?? ''}`);
    console.log(`  votos: ${trasVotar.crisisVotes.length} de ${mesas.length} · empate=${trasVotar.crisisOutcome?.tie}`);
  }
  if (trasVotar.phase !== 'decidir_2') {
    problemas.push(`la votacion no llevo la partida a decidir_2 (esta en ${trasVotar.phase})`);
    await post<PhaseResponse>(`/game/${started.gameId}/phase`, { phase: 'decidir_2' }, true);
  }

  // Ultimas decisiones bajo la medida vigente.
  for (const [i, team] of mesas.entries()) {
    const opcion = mixed ? ['desconexion', 'habitual', 'desconexion', 'minimo', 'desconexion'][i % 5] : 'desconexion';
    await post<DecisionResponse>(`/game/${started.gameId}/decision`, {
      teamId: team.id,
      round: 'decidir_2',
      optionId: `r2b:crisis-final:${opcion}`,
    });
  }
  linea(await estado(started.gameId), 'Estado tras las ultimas decisiones');

  if (loguear) console.log('\nPOST /game/:id/phase -> resultados');
  await post<PhaseResponse>(`/game/${started.gameId}/phase`, { phase: 'resultados' }, true);

  const final = await estado(started.gameId);
  linea(final, 'Resultado final');

  for (const entrada of final.results?.ranking ?? []) {
    const resumen = detalle.find((d) => d.nombre === entrada.team.name);
    if (resumen) {
      resumen.eficiencia = entrada.team.eficiencia;
      resumen.presupuesto = entrada.team.presupuesto;
      resumen.puntos = entrada.puntos;
    }
    if (entrada.team.presupuesto <= 0) problemas.push(`${entrada.team.name} termina en deuda`);
  }
  if ((final.results?.ranking.length ?? 0) !== mesas.length) {
    problemas.push(`ranking incompleto: ${final.results?.ranking.length} de ${mesas.length}`);
  }
  if (repo.writes.decisions === 0) problemas.push('la partida no registro ninguna decision');

  if (loguear) {
    console.log('\nRanking (eficiencia desc, empates por presupuesto restante):');
    for (const entrada of final.results?.ranking ?? []) {
      console.log(
        `  #${entrada.rank} ${entrada.team.name.padEnd(22)} (${etapa(
          mesas.findIndex((m) => m.id === entrada.team.id),
        )}) 🌱${entrada.team.eficiencia}%  💰${entrada.team.presupuesto} $  ` +
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
    console.log(`Semilla del acta: ${final.seed} (repetir la partida con GAME_SEED=${final.seed})`);
  }

  return {
    seed,
    equipos: mesas.length,
    faseFinal: final.phase,
    medida: trasVotar.crisisOutcome?.measureId ?? null,
    resultadoDeVotacion: trasVotar.crisisOutcome?.label ?? '(sin resultado)',
    semillaDelActa: final.seed,
    tasaDeCrisis: final.crisisRate,
    eventos: eventosDeLaRonda,
    ranking: (final.results?.ranking ?? []).map((r) => r.team.name),
    detalle,
    problemas,
  };
}

/** Firma estable de una partida, para comparar reproducibilidad semilla a semilla. */
function firma(resumen: ResumenPartida): string {
  return JSON.stringify({
    detalle: resumen.detalle.map((d) => [d.nombre, d.sorteadas, d.jugadas, d.bloqueadas, d.voto, d.eficiencia, d.presupuesto]),
    medida: resumen.medida,
    tasa: resumen.tasaDeCrisis,
    eventos: resumen.eventos,
    fase: resumen.faseFinal,
  });
}

/**
 * Barrido: N semillas seguidas. Es la auditoria que pide el plan — ninguna semilla puede
 * dejar una partida injugable — y ademas comprueba que repetir una semilla la reproduce.
 */
async function barrido(n: number) {
  console.log(`Barrido de ${n} semillas (5 equipos, estrategias mixtas)...\n`);
  const fallos: string[] = [];
  const medidas: Record<string, number> = {};
  const eventos: Record<string, number> = {};
  let conBloqueo = 0;
  let tasasMin = 1;
  let tasasMax = 0;

  for (let seed = 1; seed <= n; seed += 1) {
    const resumen = await jugarPartida(seed, 5, false, true);
    for (const problema of resumen.problemas) fallos.push(`semilla ${seed}: ${problema}`);
    if (resumen.detalle.some((d) => d.bloqueadas > 0)) conBloqueo += 1;
    if (resumen.medida) medidas[resumen.medida] = (medidas[resumen.medida] ?? 0) + 1;
    for (const evento of resumen.eventos) eventos[evento] = (eventos[evento] ?? 0) + 1;
    tasasMin = Math.min(tasasMin, resumen.tasaDeCrisis);
    tasasMax = Math.max(tasasMax, resumen.tasaDeCrisis);
  }

  // Reproducibilidad: la misma semilla debe dar exactamente la misma partida.
  for (const seed of [1, 2, 7]) {
    const [a, b] = [await jugarPartida(seed, 5, false, true), await jugarPartida(seed, 5, false, true)];
    if (firma(a) !== firma(b)) fallos.push(`semilla ${seed}: dos ejecuciones dieron partidas distintas`);
    if (a.semillaDelActa !== seed) fallos.push(`semilla ${seed}: el acta muestra ${a.semillaDelActa}`);
    if (a.faseFinal !== 'resultados') fallos.push(`semilla ${seed}: la partida no llego a resultados`);
  }

  console.log(`Partidas completas: ${n} de ${n}`);
  console.log(`Intensidad de la crisis observada: ${Math.round(tasasMin * 100)}% - ${Math.round(tasasMax * 100)}%`);
  console.log(`Partidas con algun aparato bloqueado por apagon: ${conBloqueo}`);
  console.log(`Medidas ganadoras: ${Object.entries(medidas).map(([id, v]) => `${id} x${v}`).join(' · ') || '(ninguna)'}`);
  console.log(`Eventos sorteados: ${Object.entries(eventos).map(([id, v]) => `${id} x${v}`).join(' · ') || '(ninguno)'}`);

  if (fallos.length > 0) {
    console.error(`\n✖ ${fallos.length} problema(s):`);
    for (const fallo of fallos.slice(0, 20)) console.error(`  - ${fallo}`);
    process.exitCode = 1;
    return;
  }
  console.log('\n✔ Ninguna semilla dejo una partida injugable y la semilla reproduce la partida.');
}

async function main() {
  if (scan > 0) {
    await barrido(scan);
    return;
  }
  const resumen = await jugarPartida(1, 5, true);
  if (resumen.problemas.length > 0) {
    console.error(`\n✖ problemas detectados: ${resumen.problemas.join(' · ')}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('La simulacion fallo:', error);
  process.exitCode = 1;
});
