"use strict";

/**
 * Prueba end-to-end contra el servidor real (Next + WebSocket autoritativo).
 * Levanta `node server.js` en un puerto de prueba con temporizadores cortos y
 * juega una partida completa de 4 rondas: dos mesas humanas, overrides del
 * anfitrión, resolución automática al expirar el cronómetro, blackouts,
 * derrota irreversible y clasificación final.
 *
 * Ejecutar: node --test tests/
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const WebSocket = require("ws");

const PORT = 3999;
const PIN = "TEST";
const PASSCODE = "1984";
const BASE = `http://127.0.0.1:${PORT}`;

let server;
const sockets = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, { timeout = 10000, interval = 60, label = "condición" } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await sleep(interval);
  }
  throw new Error(`Tiempo agotado esperando: ${label}`);
}

function makeClient(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const client = {
    name,
    ws,
    state: null,
    teamId: null,
    rejected: null,
    errors: [],
    sessionExpired: false,
    send: (payload) => ws.send(JSON.stringify(payload)),
    ready: () => new Promise((resolve) => ws.on("open", resolve)),
  };

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    switch (msg.type) {
      case "SYNC_STATE":
        client.state = msg.state;
        break;
      case "JOIN_SUCCESS":
        client.teamId = msg.teamId;
        break;
      case "JOIN_REJECTED":
        client.rejected = msg.reason;
        break;
      case "ROOM_NOT_FOUND":
        client.roomNotFound = msg.pin;
        break;
      case "ERROR":
        client.errors.push(msg.message);
        break;
      case "SESSION_EXPIRED":
        client.sessionExpired = true;
        client.teamId = null;
        break;
      default:
        break;
    }
  });

  sockets.push(ws);
  return client;
}

async function waitHealth(timeout = 90000) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return await res.json();
    } catch (err) {
      lastError = err;
    }
    await sleep(300);
  }
  throw new Error(`El servidor no publicó /healthz: ${lastError && lastError.message}`);
}

function teamsById(state) {
  return Object.fromEntries(Object.entries(state.teams).map(([id, team]) => [id, team]));
}

function teamByDistrict(state, districtId) {
  return Object.values(state.teams).find((t) => t.districtId === districtId) || null;
}

/** Suma de los efectos económicos de los incidentes vigentes. */
function incidentSum(state, field) {
  return (state.incidents || []).reduce((sum, i) => sum + (((i.effects || {})[field]) || 0), 0);
}

/** Producto de los multiplicadores de demanda de los incidentes vigentes. */
function incidentDemandFactor(state, sector) {
  return (state.incidents || []).reduce(
    (acc, i) => acc * (((i.effects || {}).demand || {})[sector] || 1),
    1
  );
}

/**
 * Una palanca bloqueada por incidente no se puede cortar: la mesa recibe un
 * error y el override del anfitrión tampoco pasa.
 */
async function assertLocked(host, team, districtId, sector) {
  const seen = team.errors.length;
  assert.equal(teamByDistrict(host.state, districtId).sectors[sector], true);
  team.send({ type: "TOGGLE_SECTOR", sector, state: false });
  const rejected = await waitFor(() => (team.errors.length > seen ? team.errors[team.errors.length - 1] : null), {
    label: `${sector} bloqueado para la mesa`,
  });
  assert.match(rejected, /BLOQUEADA POR INCIDENTE/);
  await sleep(200);
  assert.equal(teamByDistrict(host.state, districtId).sectors[sector], true);

  // El proyector tampoco puede: el incidente es del sistema, no del mando.
  const target = teamByDistrict(host.state, districtId);
  const seenHost = host.errors.length;
  host.send({ type: "HOST_TOGGLE_SECTOR", teamId: target.id, sector, state: false });
  const rejectedHost = await waitFor(
    () => (host.errors.length > seenHost ? host.errors[host.errors.length - 1] : null),
    { label: `${sector} bloqueado para el anfitrión` }
  );
  assert.match(rejectedHost, /PALANCA BLOQUEADA POR INCIDENTE/);
  await sleep(200);
  assert.equal(teamByDistrict(host.state, districtId).sectors[sector], true);
}

test("BLACKOUT: GRID COLLAPSE — partida completa end-to-end", async (t) => {
  server = spawn("node", ["server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST_PASSCODE: PASSCODE,
      ANNOUNCE_SECONDS: "2",
      NEGOTIATION_SECONDS: "3",
      // Semilla fija: el sorteo de incidentes es reproducible. El guion de la
      // semilla 70 está anotado en las pruebas de cada ronda.
      GAME_SEED: "70",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverLog = "";
  server.stdout.on("data", (chunk) => (serverLog += chunk.toString()));
  server.stderr.on("data", (chunk) => (serverLog += chunk.toString()));

  t.after(() => {
    for (const ws of sockets) ws.close();
    if (server && !server.killed) server.kill("SIGKILL");
  });

  const health = await waitHealth();
  assert.equal(health.ok, true);
  assert.equal(health.rooms.length, 0);

  const host = makeClient("host");
  const teamA = makeClient("mesa-A");
  const teamB = makeClient("mesa-B");
  await Promise.all([host.ready(), teamA.ready(), teamB.ready()]);

  await t.test("la consola maestra rechaza una clave inválida", async () => {
    const intruder = makeClient("intruso");
    await intruder.ready();
    intruder.send({ type: "HOST_OPEN_ROOM", pin: PIN, passcode: "0000" });
    const message = await waitFor(() => intruder.errors[0], { label: "error de clave" });
    assert.match(message, /CLAVE MAESTRA INVÁLIDA/);
    intruder.ws.close();
  });

  await t.test("el anfitrión abre la sala y reserva el panel de 4 distritos", async () => {
    host.send({ type: "HOST_OPEN_ROOM", pin: PIN, passcode: PASSCODE });
    await waitFor(() => host.state, { label: "primer SYNC_STATE" });
    assert.equal(host.state.phase, "LOBBY");
    assert.equal(host.state.blackoutCount, 0);
    assert.equal(host.state.currentRound, 0);

    host.send({ type: "HOST_SEED_DISTRICTS", count: 4 });
    await waitFor(() => Object.keys(host.state.teams).length === 4, { label: "4 distritos en la malla" });

    for (const team of Object.values(host.state.teams)) {
      assert.equal(team.claimed, false);
      assert.equal(team.welfare, 1000);
      assert.equal(team.budget, 10000);
      assert.deepEqual(team.sectors, { industry: true, residential: true, critical: true });
    }
  });

  await t.test("WATCH_ROOM deja observar una sala y avisa cuando el PIN no existe", async () => {
    const spectator = makeClient("espectador");
    await spectator.ready();

    spectator.send({ type: "WATCH_ROOM", pin: "NADA" });
    const missing = await waitFor(() => spectator.roomNotFound, { label: "aviso de sala inexistente" });
    assert.equal(missing, "NADA");

    spectator.send({ type: "WATCH_ROOM", pin: PIN });
    await waitFor(() => spectator.state, { label: "estado de la sala observada" });
    assert.equal(spectator.state.pin, PIN);
    assert.equal(Object.keys(spectator.state.teams).length, 4);

    // Un espectador no puede tocar la red
    spectator.send({ type: "TOGGLE_SECTOR", sector: "industry", state: false });
    await sleep(400);
    assert.equal(teamByDistrict(host.state, "D-01").sectors.industry, true);

    spectator.ws.close();
  });

  await t.test("una mesa toma el mando de un distrito y nadie más puede robar el mismo", async () => {
    teamA.send({ type: "JOIN_DISTRICT", pin: PIN, districtId: "D-01", operator: "MESA 1" });
    await waitFor(() => teamA.teamId, { label: "join de la mesa A" });

    const claimed = teamByDistrict(host.state, "D-01");
    assert.equal(claimed.claimed, true);
    assert.equal(claimed.operator, "MESA 1");

    teamB.send({ type: "JOIN_DISTRICT", pin: PIN, districtId: "D-01", operator: "MESA 2" });
    const reason = await waitFor(() => teamB.rejected, { label: "rechazo de distrito ocupado" });
    assert.match(reason, /YA ESTÁ OPERADO POR OTRA MESA/);

    teamB.send({ type: "JOIN_DISTRICT", pin: PIN, districtId: "D-02", operator: "MESA 2" });
    await waitFor(() => teamB.teamId, { label: "join de la mesa B" });
    assert.notEqual(teamA.teamId, teamB.teamId);
  });

  await t.test("las palancas de la mesa y el override del anfitrión llegan al estado compartido", async () => {
    teamA.send({ type: "TOGGLE_SECTOR", sector: "industry", state: false });
    await waitFor(() => teamByDistrict(host.state, "D-01").sectors.industry === false, {
      label: "industria apagada por la mesa A",
    });

    const demandAfter = host.state.demand.perTeam[teamA.teamId];
    assert.equal(demandAfter.mw, 120 + 60);
    assert.equal(demandAfter.gas, 250 + 100);

    // Bug corregido: el anfitrión puede anular sectores de un distrito concreto.
    host.send({ type: "HOST_TOGGLE_SECTOR", teamId: teamA.teamId, sector: "industry", state: true });
    await waitFor(() => teamByDistrict(host.state, "D-01").sectors.industry === true, {
      label: "override del anfitrión aplicado",
    });
    assert.equal(host.state.demand.perTeam[teamA.teamId].mw, 360);

    // Distritos reservados sin operador también responden al proyector.
    const d3 = teamByDistrict(host.state, "D-03");
    host.send({ type: "HOST_TOGGLE_SECTOR", teamId: d3.id, sector: "industry", state: false });
    await waitFor(() => teamByDistrict(host.state, "D-03").sectors.industry === false, {
      label: "override sobre un distrito sin operador",
    });
  });

  await t.test("ronda 1: la crisis se prepara sin reloj y el anfitrión abre el cronómetro", async () => {
    host.send({ type: "HOST_START_GAME" });
    await waitFor(() => host.state.phase === "PLANNING", { label: "planificación sin reloj" });

    // La crisis y la red recortada ya están a la vista, pero el tiempo no corre:
    // el salón puede discutir y mover palancas sin presión.
    assert.equal(host.state.currentRound, 1);
    assert.equal(host.state.activeCrisis.round, 1);
    assert.equal(host.state.capacity.maxMW, 1440);
    assert.equal(host.state.capacity.maxGas, 2400);
    assert.equal(host.state.demand.gas, 3000);
    assert.equal(host.state.deadlineTs, null);
    assert.equal(host.state.timerRunning, false);

    await sleep(1500);
    assert.equal(host.state.phase, "PLANNING", "la planificación no avanza sola");
    assert.equal(host.state.timeRemaining, 0);

    // El anfitrión abre el reloj: anuncio, y de ahí solo a la negociación.
    host.send({ type: "HOST_BEGIN_ROUND" });
    await waitFor(() => host.state.phase === "CRISIS_ANNOUNCE", { label: "anuncio de crisis" });
    assert.ok(host.state.deadlineTs > Date.now(), "el anuncio publica su fecha límite");

    await waitFor(() => host.state.phase === "CRISIS_ACTIVE", { label: "negociación en vivo", timeout: 8000 });
    assert.ok(host.state.timeRemaining <= 3);
  });

  await t.test("al expirar el cronómetro el servidor resuelve solo: BLACKOUT por gas", async () => {
    await waitFor(() => host.state.phase === "RESOLUTION", { label: "resolución automática", timeout: 8000 });

    const resolution = host.state.lastResolution;
    assert.equal(resolution.outcome, "BLACKOUT");
    assert.equal(resolution.cause, "GAS");
    // El arranque de ronda rearma las palancas: la malla vuelve a consumir 1440 MW / 3000 m3
    assert.equal(resolution.totalMW, 1440);
    assert.equal(resolution.totalGas, 3000);
    assert.equal(resolution.capacityGas, 2400);
    assert.equal(host.state.blackoutCount, 1);

    const team = host.state.teams[teamA.teamId];
    assert.equal(team.welfare, 700);
    assert.equal(team.budget, 9200);
    assert.equal(host.state.phase, "RESOLUTION");
  });

  await t.test("ronda 2: se planifica sin reloj, los críticos quedan bloqueados y la red se estabiliza", async () => {
    host.send({ type: "HOST_NEXT_ROUND" });
    await waitFor(() => host.state.phase === "PLANNING" && host.state.currentRound === 2, {
      label: "planificación de la ronda 2",
    });

    // Guion de la semilla 70: la crisis 2 (sequía, -35% eléctrico) más el
    // incidente que bloquea los servicios críticos.
    assert.deepEqual(host.state.incidents.map((i) => i.id), ["inc-cuarentena"]);
    assert.equal(host.state.lockedSectors.critical, true);
    assert.equal(host.state.activeCrisis.electricMultiplier, 0.65);
    // 1440 MW x 0,65 y el gas intacto: la cuarentena no recorta capacidad.
    assert.equal(host.state.capacity.maxMW, 936);
    assert.equal(host.state.capacity.maxGas, 3000);
    assert.equal(host.state.capacity.electricMultiplier, 0.65);

    // Los críticos quedan blindados para todos: ni la mesa ni el anfitrión.
    await assertLocked(host, teamA, "D-01", "critical");

    // En planificación las palancas ya funcionan: el salón puede dejar pactado
    // el corte antes de que empiece a correr el tiempo.
    teamA.send({ type: "TOGGLE_SECTOR", sector: "industry", state: false });
    teamB.send({ type: "TOGGLE_SECTOR", sector: "industry", state: false });
    const d3 = teamByDistrict(host.state, "D-03");
    const d4 = teamByDistrict(host.state, "D-04");
    host.send({ type: "HOST_TOGGLE_SECTOR", teamId: d3.id, sector: "industry", state: false });
    host.send({ type: "HOST_TOGGLE_SECTOR", teamId: d4.id, sector: "industry", state: false });

    await waitFor(
      () =>
        host.state.demand.mw === 720 &&
        Object.values(host.state.teams).every((team) => team.sectors.industry === false),
      { label: "las 4 industrias cedidas" }
    );
    assert.equal(host.state.demand.gas, 4 * (250 + 100));
    assert.equal(host.state.phase, "PLANNING", "el recorte se pactó sin reloj");

    // El anfitrión abre el reloj y lo PAUSA enseguida: el tiempo queda congelado.
    host.send({ type: "HOST_BEGIN_ROUND" });
    host.send({ type: "HOST_PAUSE" });
    await waitFor(() => host.state.paused === true, { label: "cronómetro pausado" });

    const congelado = host.state.timeRemaining;
    assert.ok(congelado > 0 && congelado <= 2, `quedaban pocos segundos: ${congelado}`);
    assert.equal(host.state.deadlineTs, null);
    await sleep(2000);
    assert.equal(host.state.timeRemaining, congelado, "pausado no descuenta segundos");
    assert.equal(host.state.phase, "CRISIS_ANNOUNCE");

    // +30 s se suma a lo que quedaba, y reanudar reprograma la fecha límite.
    host.send({ type: "HOST_ADD_TIME", seconds: 30 });
    await waitFor(() => host.state.timeRemaining === congelado + 30, { label: "+30 s sobre la pausa" });
    assert.equal(host.state.deadlineTs, null);

    host.send({ type: "HOST_RESUME" });
    await waitFor(() => host.state.paused === false && host.state.deadlineTs, { label: "cronómetro reanudado" });
    const restante = Math.round((host.state.deadlineTs - Date.now()) / 1000);
    assert.ok(restante >= congelado + 28 && restante <= congelado + 31, `reanudó con ${restante}s`);

    // Y para no esperar 30 s en la prueba, el anfitrión adelanta la negociación.
    host.send({ type: "HOST_SKIP_ANNOUNCE" });
    await waitFor(() => host.state.phase === "CRISIS_ACTIVE", { label: "negociación en vivo", timeout: 8000 });

    await waitFor(() => host.state.phase === "RESOLUTION", { label: "resolución de la ronda 2", timeout: 10000 });
    const resolution = host.state.lastResolution;
    assert.equal(resolution.outcome, "STABLE");
    assert.equal(resolution.marginMW, 936 - 720);
    assert.deepEqual(resolution.incidents.map((i) => i.id), ["inc-cuarentena"]);

    const team = host.state.teams[teamA.teamId];
    assert.equal(team.sectors.industry, false);
    // 700 + 100 de red estable; la cuarentena no toca bienestar ni caja.
    assert.equal(team.welfare, 700 + 100 + incidentSum(host.state, "welfareAll"));
    // -1.000 paro técnico -500 red residencial -300 red crítica (+ incidentes).
    assert.equal(team.budget, 9200 - 1000 - 500 - 300 + incidentSum(host.state, "budgetAll"));
    assert.equal(host.state.blackoutCount, 1);
  });

  await t.test("rondas 3 y 4: la demanda civil se duplica y el dilema final exige apagar todas las industrias", async () => {
    host.send({ type: "HOST_NEXT_ROUND" });
    await waitFor(() => host.state.currentRound === 3 && host.state.phase === "PLANNING", {
      label: "planificación de la ronda 3",
    });
    host.send({ type: "HOST_BEGIN_ROUND" });
    await waitFor(() => host.state.phase === "CRISIS_ANNOUNCE", { label: "anuncio de la ronda 3" });

    // Guion de la semilla 70: la crisis 3 duplica el consumo civil y el robo de
    // cable del anillo sur recorta un 8% el techo eléctrico.
    assert.deepEqual(host.state.incidents.map((i) => i.id), ["inc-anillo"]);
    assert.equal(host.state.activeCrisis.residentialDemandMultiplier, 2);
    const resFactor = 2 * incidentDemandFactor(host.state, "residential");
    assert.equal(host.state.demand.mw, 4 * Math.round(180 + 120 * resFactor + 60 * incidentDemandFactor(host.state, "critical")));
    assert.equal(host.state.demand.gas, 4 * Math.round(400 + 250 * resFactor + 100 * incidentDemandFactor(host.state, "critical")));
    assert.equal(host.state.demand.mw, 1440 + 480);
    assert.equal(host.state.demand.gas, 3000 + 1000);
    assert.equal(host.state.capacity.maxMW, Math.round(1440 * 0.92));
    assert.equal(host.state.capacity.maxGas, 3000);

    await waitFor(() => host.state.phase === "CRISIS_ACTIVE", { label: "negociación de la ronda 3", timeout: 8000 });
    host.send({ type: "HOST_RESOLVE_NOW" });
    await waitFor(() => host.state.phase === "GAME_OVER", { label: "segundo apagón: fin de partida" });

    assert.equal(host.state.lastResolution.outcome, "BLACKOUT");
    assert.equal(host.state.lastResolution.totalMW, 1920);
    assert.equal(host.state.lastResolution.totalGas, 4000);
    assert.equal(host.state.blackoutCount, 2);
    // La semilla y el guion de incidentes quedan registrados en el acta final.
    assert.equal(host.state.finalResults.seed, 70);
    assert.deepEqual(host.state.finalResults.incidentsPlayed, host.state.usedIncidentIds);
    // La partida muere en la ronda 3: solo se jugaron dos incidentes.
    assert.deepEqual(host.state.usedIncidentIds, ["inc-cuarentena", "inc-anillo"]);

    // Segundo apagón: fallo regional irreversible, fin de partida sin ganadores.
    assert.equal(host.state.finalResults.irreversible, true);
    assert.equal(host.state.finalResults.mentions.exemplary, null);
    assert.ok(host.state.logs.some((log) => /IRREVERSIBLE/.test(log.message)));
  });

  await t.test("reiniciar devuelve la sala al vestíbulo y expulsa las sesiones de las mesas", async () => {
    host.send({ type: "HOST_RESET_GAME" });
    await waitFor(() => host.state.phase === "LOBBY" && Object.keys(host.state.teams).length === 0, {
      label: "vestíbulo limpio",
    });
    await waitFor(() => teamA.sessionExpired && teamB.sessionExpired, { label: "sesiones expiradas" });
    assert.equal(host.state.blackoutCount, 0);
    assert.equal(teamA.teamId, null);
  });

  console.log(serverLog.split("\n").slice(0, 4).join("\n"));
});