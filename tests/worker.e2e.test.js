"use strict";

/**
 * Prueba end-to-end del despliegue en Cloudflare Workers + Durable Objects.
 *
 * Levanta `wrangler dev` (workerd local) y juega una partida contra el Worker
 * real: el router enruta cada socket a su Durable Object según el PIN, el
 * estado vive en el almacenamiento del objeto y las fases avanzan por alarmas
 * (nada de latidos por segundo).
 *
 * Requiere el build estático de la interfaz: `npm run build:static`.
 * Ejecutar: npm run test:worker
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const WebSocket = require("ws");

const PORT = 8788;
const PIN = "TEST";
const OTHER_PIN = "OTRA";
const PASSCODE = "1984";
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(__dirname, "..");

let wrangler;
const sockets = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, { timeout = 15000, interval = 60, label = "condición" } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await sleep(interval);
  }
  throw new Error(`Tiempo agotado esperando: ${label}`);
}

function makeClient(name, pin = PIN) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?pin=${encodeURIComponent(pin)}`);
  const client = {
    name,
    ws,
    state: null,
    teamId: null,
    rejected: null,
    roomNotFound: null,
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

function teamByDistrict(state, districtId) {
  return Object.values(state.teams).find((t) => t.districtId === districtId) || null;
}

async function waitHealth(timeout = 180000) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return await res.json();
    } catch (err) {
      lastError = err;
    }
    await sleep(500);
  }
  throw new Error(`wrangler dev no publicó /healthz: ${lastError && lastError.message}`);
}

test("Blackout en Cloudflare Workers + Durable Objects", async (t) => {
  assert.ok(
    fs.existsSync(path.join(ROOT, "out", "index.html")),
    "falta el build estático de la interfaz: ejecuta `npm run build:static` antes de esta prueba"
  );

  wrangler = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(PORT),
      "--var",
      "ANNOUNCE_SECONDS:2",
      "--var",
      "NEGOTIATION_SECONDS:3",
      // Semilla fija: mismo guion de incidentes que en la prueba del servidor
      // Node (ronda 2 = cuarentena, que no recorta capacidad).
      "--var",
      "GAME_SEED:70",
    ],
    { cwd: ROOT, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" } }
  );

  let log = "";
  wrangler.stdout.on("data", (chunk) => (log += chunk.toString()));
  wrangler.stderr.on("data", (chunk) => (log += chunk.toString()));

  t.after(() => {
    for (const ws of sockets) ws.close();
    if (wrangler && wrangler.pid) {
      try {
        process.kill(-wrangler.pid, "SIGKILL");
      } catch {
        wrangler.kill("SIGKILL");
      }
    }
  });

  await t.test("el Worker sirve la interfaz estática y el healthz", async () => {
    const health = await waitHealth();
    assert.equal(health.ok, true);
    assert.equal(health.runtime, "cloudflare-workers");

    const page = await fetch(`${BASE}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /BLACKOUT/i);

    const host = await fetch(`${BASE}/host/`);
    assert.equal(host.status, 200);
  });

  const host = makeClient("host");
  const teamA = makeClient("mesa-A");
  const teamB = makeClient("mesa-B");
  const stranger = makeClient("sala-ajena", OTHER_PIN);
  await Promise.all([host.ready(), teamA.ready(), teamB.ready(), stranger.ready()]);

  await t.test("cada PIN es una sala aislada en su propio Durable Object", async () => {
    await waitFor(() => host.state && stranger.state, { label: "primer estado de ambas salas" });
    assert.equal(host.state.pin, PIN);
    assert.equal(stranger.state.pin, OTHER_PIN);
    assert.equal(Object.keys(stranger.state.teams).length, 0);
  });

  await t.test("la clave maestra se valida dentro del Durable Object", async () => {
    const intruder = makeClient("intruso");
    await intruder.ready();
    intruder.send({ type: "HOST_OPEN_ROOM", pin: PIN, passcode: "0000" });
    const message = await waitFor(() => intruder.errors[0], { label: "rechazo de clave" });
    assert.match(message, /CLAVE MAESTRA INVÁLIDA/);
    // Y sin abrir la sala, no puede reservar el panel
    intruder.send({ type: "HOST_SEED_DISTRICTS", count: 4 });
    await sleep(400);
    assert.equal(Object.keys(host.state.teams).length, 0);
    intruder.ws.close();
  });

  await t.test("el anfitrión reserva el panel y las mesas reclaman distritos", async () => {
    host.send({ type: "HOST_OPEN_ROOM", pin: PIN, passcode: PASSCODE });
    await waitFor(() => host.state.phase === "LOBBY", { label: "sala abierta" });

    host.send({ type: "HOST_SEED_DISTRICTS", count: 4 });
    await waitFor(() => Object.keys(host.state.teams).length === 4, { label: "4 distritos" });

    teamA.send({ type: "JOIN_DISTRICT", pin: PIN, districtId: "D-01", operator: "MESA 1" });
    await waitFor(() => teamA.teamId, { label: "join de la mesa A" });

    teamB.send({ type: "JOIN_DISTRICT", pin: PIN, districtId: "D-01", operator: "MESA 2" });
    const reason = await waitFor(() => teamB.rejected, { label: "distrito ocupado" });
    assert.match(reason, /YA ESTÁ OPERADO POR OTRA MESA/);

    teamB.send({ type: "JOIN_DISTRICT", pin: PIN, districtId: "D-02", operator: "MESA 2" });
    await waitFor(() => teamB.teamId, { label: "join de la mesa B" });
  });

  await t.test("el override del anfitrión y las palancas de las mesas llegan al estado", async () => {
    teamA.send({ type: "TOGGLE_SECTOR", sector: "industry", state: false });
    await waitFor(() => teamByDistrict(host.state, "D-01").sectors.industry === false, {
      label: "industria apagada por la mesa A",
    });
    assert.equal(host.state.demand.perTeam[teamA.teamId].mw, 180);

    host.send({ type: "HOST_TOGGLE_SECTOR", teamId: teamA.teamId, sector: "industry", state: true });
    await waitFor(() => teamByDistrict(host.state, "D-01").sectors.industry === true, {
      label: "override del anfitrión",
    });
  });

  await t.test("la ronda avanza por alarmas del Durable Object y resuelve sola", async () => {
    host.send({ type: "HOST_START_GAME" });
    await waitFor(() => host.state.phase === "CRISIS_ANNOUNCE", { label: "anuncio" });

    assert.equal(host.state.currentRound, 1);
    assert.equal(host.state.capacity.maxGas, 2400);
    assert.ok(host.state.deadlineTs > Date.now(), "el estado publica la fecha límite de la fase");

    // 2 s de anuncio -> negociación; 3 s -> resolución automática, sin latidos
    await waitFor(() => host.state.phase === "CRISIS_ACTIVE", { label: "negociación por alarma", timeout: 12000 });
    await waitFor(() => host.state.phase === "RESOLUTION", { label: "resolución por alarma", timeout: 12000 });

    const resolution = host.state.lastResolution;
    assert.equal(resolution.outcome, "BLACKOUT");
    assert.equal(resolution.cause, "GAS");
    assert.equal(host.state.blackoutCount, 1);
    assert.equal(host.state.deadlineTs, null);
    assert.equal(host.state.teams[teamA.teamId].welfare, 700);
  });

  await t.test("segundo apagón: fin de partida irreversible y reinicio", async () => {
    host.send({ type: "HOST_NEXT_ROUND" });
    await waitFor(() => host.state.currentRound === 2 && host.state.phase === "CRISIS_ANNOUNCE", {
      label: "anuncio de la ronda 2",
    });
    assert.equal(host.state.capacity.maxMW, 936);
    // El Durable Object sortea los mismos incidentes que el servidor Node:
    // mismo motor (`src/shared/rules.js`) para los dos runtimes.
    assert.deepEqual(host.state.incidents.map((i) => i.id), ["inc-cuarentena"]);
    assert.equal(host.state.lockedSectors.critical, true);

    await waitFor(() => host.state.phase === "CRISIS_ACTIVE", { label: "negociación de la ronda 2", timeout: 12000 });
    host.send({ type: "HOST_RESOLVE_NOW" });
    await waitFor(() => host.state.phase === "GAME_OVER", { label: "derrota irreversible" });
    assert.equal(host.state.blackoutCount, 2);
    assert.equal(host.state.finalResults.irreversible, true);

    host.send({ type: "HOST_RESET_GAME" });
    await waitFor(() => host.state.phase === "LOBBY" && Object.keys(host.state.teams).length === 0, {
      label: "vestíbulo limpio",
    });
    await waitFor(() => teamA.sessionExpired && teamB.sessionExpired, { label: "sesiones expiradas" });
  });

  await t.test("un socket nuevo recibe el estado persistido del objeto", async () => {
    const late = makeClient("tardío");
    await late.ready();
    const state = await waitFor(() => late.state, { label: "estado de la sala desde storage" });
    assert.equal(state.pin, PIN);
    assert.equal(state.phase, "LOBBY");
    assert.equal(state.blackoutCount, 0);
    late.ws.close();
  });

  console.log(log.split("\n").filter((line) => /Ready|wrangler|error/i.test(line)).slice(0, 6).join("\n"));
});