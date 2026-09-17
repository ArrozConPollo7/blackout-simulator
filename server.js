"use strict";

/**
 * Servidor de BLACKOUT: GRID COLLAPSE.
 *
 * Transporte: Next.js (HTTP) + WebSocket (`ws`) en el mismo puerto.
 * Autoridad: este proceso es la única fuente de verdad; los mandos solo envían
 * intenciones (TOGGLE_SECTOR, ...) y reciben el estado completo (SYNC_STATE).
 *
 * Toda la aritmética del juego vive en `src/shared/rules.js` (sin I/O), que es
 * la misma que consumen las vistas y la suite de pruebas.
 */

const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { WebSocketServer, WebSocket } = require("ws");

const rules = require("./src/shared/rules.js");

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3006", 10);
const HOST_PASSCODE = process.env.HOST_PASSCODE || "1984";
const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // salas abandonadas

/** Duraciones del ciclo de ronda: por defecto las del documento (10 s + 60 s). */
const ANNOUNCE_SECONDS = intEnv("ANNOUNCE_SECONDS", rules.ANNOUNCE_SECONDS);
const NEGOTIATION_SECONDS = intEnv("NEGOTIATION_SECONDS", rules.NEGOTIATION_SECONDS);
/** Semilla fija opcional (repetir una partida) y respaldo para apagar incidentes. */
const GAME_SEED = intEnv("GAME_SEED", 0) || undefined;
const INCIDENTS_ENABLED = String(process.env.INCIDENTS || "on").toLowerCase() !== "off";

function intEnv(name, fallback) {
  const parsed = parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function makeRoom(pin) {
  const room = rules.createRoom(pin, { seed: GAME_SEED, incidents: INCIDENTS_ENABLED });
  room.announceSeconds = ANNOUNCE_SECONDS;
  room.negotiationSeconds = NEGOTIATION_SECONDS;
  room.lastActivity = Date.now();
  return room;
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

/** @type {Map<string, ReturnType<typeof rules.createRoom>>} */
const rooms = new Map();

/** Metadatos por socket: a qué sala y a qué distrito pertenece cada cliente. */
const clientMeta = new WeakMap();

/** @type {WebSocketServer | undefined} */
let wss;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function normalizePin(pin) {
  return String(pin || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

function nowTimestamp() {
  const now = new Date();
  return [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}

function addLog(room, type, message) {
  room.logs.unshift({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: nowTimestamp(),
    type,
    message,
  });
  if (room.logs.length > 60) room.logs.pop();
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function roomClients(pin) {
  const list = [];
  for (const client of wss.clients) {
    const meta = clientMeta.get(client);
    if (meta && meta.pin === pin && client.readyState === WebSocket.OPEN) list.push(client);
  }
  return list;
}

function broadcastRoom(pin) {
  const room = rooms.get(pin);
  if (!room) return;

  room.lastActivity = Date.now();
  const payload = JSON.stringify({ type: "SYNC_STATE", state: room });

  for (const client of roomClients(pin)) {
    client.send(payload);
  }
}

function refreshDerived(room) {
  // En el vestíbulo la capacidad sigue el tamaño del panel: crece o decrece con
  // los distritos que reserva el anfitrión. Una vez anunciada la crisis, el
  // techo queda congelado para toda la ronda.
  if (room.phase === "LOBBY" || room.phase === "GAME_OVER") {
    room.capacity = rules.regionalCapacity(rules.districtCount(room), room.activeCrisis, room.incidents);
  }
  rules.recomputeDerived(room);
  return room.demand;
}

function getRoom(pin) {
  return rooms.get(pin) || null;
}

/** Traza de la resolución de ronda (y del fin de partida si es irreversible). */
function logResolution(room, result, prefix = "") {
  addLog(
    room,
    result.outcome === "BLACKOUT" ? "ALERT" : "SYS",
    `${prefix}${result.outcome === "BLACKOUT" ? "¡APAGÓN CRÍTICO!" : "RED ESTABILIZADA"} DEMANDA ${result.totalMW} MW / ${result.totalGas} m3 CONTRA ${result.capacityMW} MW / ${result.capacityGas} m3${
      result.outcome === "BLACKOUT" ? ` (FALLO EN ${result.cause})` : ""
    }`
  );
  if (result.irreversible) {
    addLog(room, "ALERT", "FALLO REGIONAL IRREVERSIBLE — NO HAY GANADORES");
  }
}

function teamOfMeta(meta) {
  if (!meta || !meta.pin || !meta.teamId) return { room: null, team: null };
  const room = getRoom(meta.pin);
  if (!room) return { room: null, team: null };
  return { room, team: room.teams[meta.teamId] || null };
}

function findTeamByDistrict(room, districtId) {
  return Object.values(room.teams).find((t) => t.districtId === districtId) || null;
}

// ---------------------------------------------------------------------------
// Reloj maestro: anuncio (10 s) y negociación (60 s)
// ---------------------------------------------------------------------------

setInterval(() => {
  const touched = new Set();

  for (const room of rooms.values()) {
    if (!room.timerRunning) continue;

    if (room.phase === "CRISIS_ANNOUNCE") {
      room.timeRemaining -= 1;
      if (room.timeRemaining <= 0) {
        rules.openNegotiation(room);
        room.timeRemaining = room.negotiationSeconds;
        addLog(
          room,
          "ALERT",
          `CRISIS EN VIVO: ${room.activeCrisis.name} // CAPACIDAD ${room.capacity.maxMW} MW / ${room.capacity.maxGas} m3 // ${room.negotiationSeconds}s PARA NEGOCIAR`
        );
      }
      touched.add(room);
    } else if (room.phase === "CRISIS_ACTIVE") {
      room.timeRemaining -= 1;
      if (room.timeRemaining <= 0) {
        room.timeRemaining = 0;
        const result = rules.resolveRound(room);
        touched.add(room);
        logResolution(room, result);
      } else {
        touched.add(room);
      }
    }
  }

  for (const room of touched) {
    refreshDerived(room);
    broadcastRoom(room.pin);
  }
}, 1000);

// Recolección de salas abandonadas
setInterval(() => {
  const now = Date.now();
  for (const [pin, room] of rooms) {
    const active = roomClients(pin).length > 0;
    const idle = now - (room.lastActivity || now);
    if (!active && idle > ROOM_TTL_MS) {
      rooms.delete(pin);
      console.log(`> Sala #${pin} liberada por inactividad (${Math.round(idle / 60000)} min)`);
    }
  }
}, 10 * 60 * 1000);

// ---------------------------------------------------------------------------
// Manejo de mensajes
// ---------------------------------------------------------------------------

function handleMessage(ws, msg) {
  const meta = clientMeta.get(ws) || { pin: null, teamId: null, isHost: false };

  switch (msg.type) {
    // --- Anfitrión -------------------------------------------------------
    case "HOST_OPEN_ROOM": {
      if (msg.passcode && String(msg.passcode) !== HOST_PASSCODE) {
        send(ws, { type: "ERROR", message: "CLAVE MAESTRA INVÁLIDA // ACCESO DENEGADO" });
        return;
      }
      const pin = normalizePin(msg.pin) || "VOLT";
      let room = rooms.get(pin);
      if (!room) {
        room = makeRoom(pin);
        rooms.set(pin, room);
      }
      room.hostConnected = true;
      meta.pin = pin;
      meta.teamId = null;
      meta.isHost = true;
      clientMeta.set(ws, meta);
      addLog(room, "SYS", `CONSOLA MAESTRA CONECTADA A #${pin}`);
      refreshDerived(room);
      broadcastRoom(pin);
      return;
    }

    case "HOST_SEED_DISTRICTS": {
      const room = getRoom(meta.pin);
      if (!room || !meta.isHost) return;
      const count = Math.max(rules.MIN_DISTRICTS, Math.min(rules.MAX_DISTRICTS, parseInt(msg.count, 10) || 4));
      let created = 0;

      for (const district of rules.DISTRICTS.slice(0, count)) {
        if (findTeamByDistrict(room, district.id)) continue;
        const team = rules.createDistrictTeam({
          id: `district-${district.id}`,
          districtId: district.id,
          operator: null,
          claimed: false,
        });
        room.teams[team.id] = team;
        created += 1;
      }

      if (created > 0) {
        addLog(room, "HOST", `ANFITRIÓN RESERVÓ ${created} DISTRITO(S) EN LA MALLA (PANEL DE ${count})`);
      } else {
        send(ws, { type: "ERROR", message: "ESOS DISTRITOS YA ESTÁN EN LA MALLA" });
      }
      refreshDerived(room);
      broadcastRoom(room.pin);
      return;
    }

    case "HOST_REMOVE_UNCLAIMED": {
      const room = getRoom(meta.pin);
      if (!room || !meta.isHost) return;
      let removed = 0;
      for (const [id, team] of Object.entries(room.teams)) {
        if (!team.claimed) {
          delete room.teams[id];
          removed += 1;
        }
      }
      if (removed > 0) addLog(room, "HOST", `${removed} DISTRITO(S) SIN OPERADOR RETIRADOS DE LA MALLA`);
      refreshDerived(room);
      broadcastRoom(room.pin);
      return;
    }

    case "HOST_START_GAME": {
      const room = getRoom(meta.pin);
      if (!room || !meta.isHost) return;
      if (room.phase !== "LOBBY") {
        send(ws, { type: "ERROR", message: "LA SIMULACIÓN YA ESTÁ EN CURSO" });
        return;
      }
      if (Object.keys(room.teams).length === 0) {
        send(ws, { type: "ERROR", message: "NO HAY DISTRITOS EN LA MALLA: RESERVA EL PANEL O ESPERA A LAS MESAS" });
        return;
      }
      const crisis = rules.startRound(room, 1);
      addLog(room, "ALERT", `RONDA 01 INICIADA // ${crisis.name} // ANUNCIO EN ${room.announceSeconds}s`);
      for (const line of rules.incidentLogLines(room)) addLog(room, line.type, line.message);
      refreshDerived(room);
      broadcastRoom(room.pin);
      return;
    }

    case "HOST_SKIP_ANNOUNCE": {
      const room = getRoom(meta.pin);
      if (!room || !meta.isHost) return;
      if (room.phase !== "CRISIS_ANNOUNCE") return;
      rules.openNegotiation(room);
      addLog(room, "SYS", `ANUNCIO ADELANTADO POR EL ANFITRIÓN // NEGOCIACIÓN EN VIVO`);
      refreshDerived(room);
      broadcastRoom(room.pin);
      return;
    }

    case "HOST_RESOLVE_NOW": {
      const room = getRoom(meta.pin);
      if (!room || !meta.isHost) return;
      if (room.phase !== "CRISIS_ACTIVE" && room.phase !== "CRISIS_ANNOUNCE") return;
      const result = rules.resolveRound(room);
      logResolution(room, result, "RESOLUCIÓN FORZADA POR EL ANFITRIÓN // ");
      refreshDerived(room);
      broadcastRoom(room.pin);
      return;
    }

    case "HOST_NEXT_ROUND": {
      const room = getRoom(meta.pin);
      if (!room || !meta.isHost) return;

      if (room.phase === "RESOLUTION") {
        if (room.currentRound < room.totalRounds) {
          const crisis = rules.startRound(room, room.currentRound + 1);
          addLog(room, "ALERT", `RONDA 0${room.currentRound} INICIADA // ${crisis.name}`);
          for (const line of rules.incidentLogLines(room)) addLog(room, line.type, line.message);
        } else {
          room.finalResults = rules.finalResults(room, { irreversible: false });
          room.phase = "GAME_OVER";
          room.timerRunning = false;
          addLog(room, "SYS", `SIMULACIÓN COMPLETADA // CLASIFICACIÓN FINAL COMPILADA`);
        }
        refreshDerived(room);
        broadcastRoom(room.pin);
      }
      return;
    }

    case "HOST_RESET_GAME": {
      const room = getRoom(meta.pin);
      if (!room || !meta.isHost) return;
      const pin = room.pin;
      const fresh = makeRoom(pin);
      rooms.set(pin, fresh);
      addLog(fresh, "HOST", "SIMULACIÓN REINICIADA POR EL ANFITRIÓN // VESTÍBULO LISTO");
      // Las mesas ya no pertenecen a la sala: se les pide volver a entrar.
      for (const client of roomClients(pin)) {
        const clientMetaEntry = clientMeta.get(client);
        if (clientMetaEntry && !clientMetaEntry.isHost) {
          clientMetaEntry.teamId = null;
          clientMeta.set(client, clientMetaEntry);
          send(client, { type: "SESSION_EXPIRED" });
        }
      }
      refreshDerived(fresh);
      broadcastRoom(pin);
      return;
    }

    case "HOST_TOGGLE_SECTOR": {
      const room = getRoom(meta.pin);
      if (!room || !meta.isHost) return;
      const team = room.teams[msg.teamId];
      if (!team || !rules.SECTOR_SPECS[msg.sector]) return;
      if (room.phase === "GAME_OVER") return;
      if (rules.isSectorLocked(room, msg.sector)) {
        send(ws, {
          type: "ERROR",
          message: `PALANCA BLOQUEADA POR INCIDENTE: ${rules.SECTOR_SPECS[msg.sector].label}`,
        });
        return;
      }
      team.sectors[msg.sector] = !!msg.state;
      addLog(
        room,
        "HOST",
        `OVERRIDE DE ANFITRIÓN: ${team.name} -> ${rules.SECTOR_SPECS[msg.sector].label} ${msg.state ? "ENCENDIDA" : "APAGADA"}`
      );
      refreshDerived(room);
      broadcastRoom(room.pin);
      return;
    }

    // --- Espectadores (pantallas de apoyo) --------------------------------
    case "WATCH_ROOM": {
      const pin = normalizePin(msg.pin);
      const room = getRoom(pin);
      if (!room) {
        send(ws, { type: "ROOM_NOT_FOUND", pin });
        return;
      }
      meta.pin = pin;
      meta.teamId = null;
      meta.isHost = false;
      clientMeta.set(ws, meta);
      send(ws, { type: "SYNC_STATE", state: room });
      return;
    }

    // --- Mesas -----------------------------------------------------------
    case "JOIN_DISTRICT": {
      const pin = normalizePin(msg.pin) || "VOLT";
      let room = rooms.get(pin);
      if (!room) {
        send(ws, { type: "JOIN_REJECTED", reason: `NO EXISTE UNA SALA CON EL PIN #${pin}` });
        return;
      }

      // Reconexión con sesión previa
      if (msg.teamId && room.teams[msg.teamId]) {
        const team = room.teams[msg.teamId];
        team.connected = true;
        if (msg.operator) team.operator = String(msg.operator).slice(0, 40);
        meta.pin = pin;
        meta.teamId = team.id;
        meta.isHost = false;
        clientMeta.set(ws, meta);
        addLog(room, "TEAM", `${team.name} SE RECONECTÓ A LA RED`);
        send(ws, { type: "JOIN_SUCCESS", teamId: team.id, pin });
        refreshDerived(room);
        broadcastRoom(pin);
        return;
      }

      const district = rules.districtOf(String(msg.districtId || "").toUpperCase());
      if (!district) {
        send(ws, { type: "JOIN_REJECTED", reason: "DISTRITO INEXISTENTE" });
        return;
      }

      let team = findTeamByDistrict(room, district.id);

      if (team && team.claimed && team.connected) {
        send(ws, {
          type: "JOIN_REJECTED",
          reason: `${district.name} YA ESTÁ OPERADO POR OTRA MESA (${team.operator || "SIN IDENTIFICAR"})`,
        });
        return;
      }

      if (!team) {
        if (room.phase !== "LOBBY" && room.phase !== "RESOLUTION") {
          send(ws, {
            type: "JOIN_REJECTED",
            reason: "NO SE PUEDEN SUMAR DISTRITOS NUEVOS CON UNA RONDA EN VIVO",
          });
          return;
        }
        if (Object.keys(room.teams).length >= rules.MAX_DISTRICTS) {
          send(ws, { type: "JOIN_REJECTED", reason: `PANEL COMPLETO (${rules.MAX_DISTRICTS} DISTRITOS)` });
          return;
        }
        team = rules.createDistrictTeam({
          id: `district-${district.id}`,
          districtId: district.id,
          operator: null,
          claimed: false,
        });
        room.teams[team.id] = team;
      }

      team.claimed = true;
      team.connected = true;
      team.operator = String(msg.operator || "").trim().slice(0, 40) || `MESA ${district.id}`;

      meta.pin = pin;
      meta.teamId = team.id;
      meta.isHost = false;
      clientMeta.set(ws, meta);

      send(ws, { type: "JOIN_SUCCESS", teamId: team.id, pin });
      addLog(room, "TEAM", `${team.operator} TOMÓ EL MANDO DE ${team.name} (${district.id}) // SALA #${pin}`);
      refreshDerived(room);
      broadcastRoom(pin);
      return;
    }

    case "LEAVE_DISTRICT": {
      const { room, team } = teamOfMeta(meta);
      if (!room || !team) return;
      team.connected = false;
      team.claimed = false;
      team.operator = null;
      if (room.phase === "LOBBY") {
        delete room.teams[team.id];
      }
      addLog(room, "TEAM", `${team.name} LIBERÓ SU MANDO (SIGUE CONSUMIENDO EN LA MALLA)`);
      ws.send(JSON.stringify({ type: "SESSION_EXPIRED" }));
      meta.teamId = null;
      clientMeta.set(ws, meta);
      refreshDerived(room);
      broadcastRoom(room.pin);
      return;
    }

    case "TOGGLE_SECTOR": {
      const { room, team } = teamOfMeta(meta);
      if (!room || !team) return;
      const spec = rules.SECTOR_SPECS[msg.sector];
      if (!spec) return;
      if (room.phase === "GAME_OVER") {
        send(ws, { type: "ERROR", message: "SIMULACIÓN CERRADA // RED IRRECUPERABLE" });
        return;
      }
      if (rules.isSectorLocked(room, msg.sector)) {
        send(ws, {
          type: "ERROR",
          message: `${spec.label} BLOQUEADA POR INCIDENTE // NO SE PUEDE CORTAR ESTA RONDA`,
        });
        return;
      }
      team.sectors[msg.sector] = !!msg.state;
      addLog(room, "TEAM", `${team.name}: ${spec.label} ${msg.state ? "ENCENDIDA" : "APAGADA"}`);
      refreshDerived(room);
      broadcastRoom(room.pin);
      return;
    }

    case "SCRAM": {
      const { room, team } = teamOfMeta(meta);
      if (!room || !team) return;
      if (room.phase === "GAME_OVER") return;
      team.sectors = rules.emptySectors(false);
      for (const key of rules.SECTOR_ORDER) {
        if (rules.isSectorLocked(room, key)) team.sectors[key] = true;
      }
      addLog(room, "ALERT", `¡CORTE TOTAL DE EMERGENCIA EN ${team.name}! TODOS LOS ALIMENTADORES ABIERTOS`);
      refreshDerived(room);
      broadcastRoom(room.pin);
      return;
    }

    case "PING":
      send(ws, { type: "ALERT", message: "PONG" });
      return;

    default:
      return;
  }
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

app.prepare().then(() => {
  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          version: rules.VERSION,
          rooms: [...rooms.values()].map((r) => ({
            pin: r.pin,
            phase: r.phase,
            round: r.currentRound,
            teams: Object.keys(r.teams).length,
            blackouts: r.blackoutCount,
            seed: r.seed,
            incidents: (r.incidents || []).map((i) => i.id),
            locked: Object.keys(r.lockedSectors || {}).filter((k) => r.lockedSectors[k]),
          })),
        })
      );
      return;
    }
    handle(req, res, parse(req.url, true));
  });

  wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const { pathname } = parse(request.url);
    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws) => {
    clientMeta.set(ws, { pin: null, teamId: null, isHost: false });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: "ERROR", message: "TRAMA ILEGIBLE" });
        return;
      }
      try {
        handleMessage(ws, msg);
      } catch (err) {
        console.error("Error procesando mensaje:", err);
        send(ws, { type: "ERROR", message: "FALLO INTERNO DEL DESPACHO" });
      }
    });

    ws.on("close", () => {
      const meta = clientMeta.get(ws);
      if (!meta || !meta.pin) return;
      const room = rooms.get(meta.pin);
      if (!room) return;

      if (meta.isHost) {
        room.hostConnected = false;
        addLog(room, "WARN", "CONSOLA MAESTRA DESCONECTADA");
        broadcastRoom(room.pin);
        return;
      }

      const team = room.teams[meta.teamId];
      if (team) {
        team.connected = false;
        addLog(room, "WARN", `${team.name} PERDIÓ EL ENLACE (SIGUE CONSUMIENDO EN LA MALLA)`);
        refreshDerived(room);
        broadcastRoom(room.pin);
      }
    });
  });

  server.listen(port, () => {
    console.log(`> BLACKOUT: GRID COLLAPSE v${rules.VERSION} listo en http://${hostname}:${port}`);
    console.log(`> WebSocket autoritativo en ws://${hostname}:${port}/ws`);
    console.log(`> Proyector del anfitrión: http://localhost:${port}/host (clave maestra por defecto: ${HOST_PASSCODE})`);
  });
});