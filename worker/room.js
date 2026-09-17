/**
 * BLACKOUT: GRID COLLAPSE — autoridad de una sala en un Durable Object.
 *
 * Un Durable Object por PIN de sala: la única fuente de verdad de esa partida.
 * Mantiene el estado en `ctx.storage` (sobrevive a la hibernación y a los
 * despliegues), acepta los sockets con la API de WebSocket Hibernation y usa
 * `alarm()` para el reloj de ronda: se programa UNA alarma en la fecha límite
 * de la fase, en lugar de latir cada segundo.
 *
 * Toda la aritmética vive en `src/shared/rules.js`, la misma que usan el
 * servidor Node (`server.js`), las vistas y las pruebas.
 */

import * as rules from "../src/shared/rules.js";

const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // sala inactiva: se borra
const ALARM_MARGIN_MS = 60; // despierta un pelín después de la fecha límite

function normalizePin(pin) {
  return String(pin || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

function intEnv(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function timestamp() {
  const now = new Date();
  return [now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}

function addLog(room, type, message) {
  room.logs.unshift({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: timestamp(),
    type,
    message,
  });
  if (room.logs.length > 60) room.logs.pop();
}

/** Traza de la resolución (y del fin de partida si es irreversible). */
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

/** En el vestíbulo la capacidad sigue el tamaño del panel. */
function refreshDerived(room) {
  if (room.phase === "LOBBY" || room.phase === "GAME_OVER") {
    room.capacity = rules.regionalCapacity(rules.districtCount(room), room.activeCrisis, room.incidents);
  }
  rules.recomputeDerived(room);
}

function findTeamByDistrict(room, districtId) {
  return Object.values(room.teams).find((t) => t.districtId === districtId) || null;
}

export class RoomDurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.room = null; // caché en memoria; se relee de storage tras hibernar
    this.maxBlackouts = rules.MAX_BLACKOUTS;
  }

  // ------------------------------------------------------------------ estado
  get pin() {
    return normalizePin(this.ctx.id.name || "VOLT") || "VOLT";
  }

  /** Opciones de sala: semilla fija opcional y respaldo para apagar incidentes. */
  roomOptions() {
    return {
      seed: intEnv(this.env.GAME_SEED, undefined),
      incidents: String(this.env.INCIDENTS || "on").toLowerCase() !== "off",
    };
  }

  async loadRoom() {
    if (this.room) return this.room;

    let room = await this.ctx.storage.get("room");
    if (!room) {
      room = rules.createRoom(this.pin, this.roomOptions());
      room.announceSeconds = intEnv(this.env.ANNOUNCE_SECONDS, rules.ANNOUNCE_SECONDS);
      room.negotiationSeconds = intEnv(this.env.NEGOTIATION_SECONDS, rules.NEGOTIATION_SECONDS);
      await this.ctx.storage.put("room", room);
    }
    this.room = room;
    return room;
  }

  /** Guarda el estado, reprograma la alarma y difunde a todos los sockets. */
  async commit({ broadcast = true } = {}) {
    const room = this.room;
    room.lastActivity = Date.now();
    await this.ctx.storage.put("room", room);
    await this.arm();
    if (broadcast) await this.broadcast();
  }

  async arm() {
    const room = this.room;
    const at = room.deadlineTs
      ? Math.max(Date.now() + 10, room.deadlineTs + ALARM_MARGIN_MS)
      : Date.now() + ROOM_TTL_MS;
    await this.ctx.storage.setAlarm(at);
  }

  snapshot() {
    return { ...this.room, timeRemaining: rules.remainingSeconds(this.room) };
  }

  async broadcast() {
    const payload = JSON.stringify({ type: "SYNC_STATE", state: this.snapshot() });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // socket cerrado: se limpia en webSocketClose
      }
    }
  }

  send(ws, payload) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // ignorado
    }
  }

  // -------------------------------------------------------------- ciclo ronda
  async alarm() {
    const room = await this.loadRoom();
    const now = Date.now();

    if (room.phase === "CRISIS_ANNOUNCE" && room.deadlineTs && now >= room.deadlineTs) {
      rules.openNegotiation(room);
      addLog(
        room,
        "ALERT",
        `CRISIS EN VIVO: ${room.activeCrisis.name} // CAPACIDAD ${room.capacity.maxMW} MW / ${room.capacity.maxGas} m3 // ${room.negotiationSeconds}s PARA NEGOCIAR`
      );
      await this.commit();
      return;
    }

    if (room.phase === "CRISIS_ACTIVE" && room.deadlineTs && now >= room.deadlineTs) {
      const result = rules.resolveRound(room);
      logResolution(room, result);
      await this.commit();
      return;
    }

    // Sin fase con reloj: si nadie ha tocado la sala en ROOM_TTL_MS, se borra.
    if (now - (room.lastActivity || now) > ROOM_TTL_MS) {
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      this.room = null;
      return;
    }

    await this.arm();
  }

  // ------------------------------------------------------------------- rutas
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/room") {
      const room = await this.loadRoom();
      return Response.json(
        {
          pin: room.pin,
          phase: room.phase,
          round: room.currentRound,
          teams: Object.keys(room.teams).length,
          blackouts: room.blackoutCount,
          seed: room.seed,
          paused: Boolean(room.paused),
          incidents: (room.incidents || []).map((i) => i.id),
          locked: Object.keys(room.lockedSectors || {}).filter((k) => room.lockedSectors[k]),
        },
        { headers: { "cache-control": "no-store" } }
      );
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("SE ESPERA UN WEBSOCKET EN /ws", { status: 426 });
    }

    await this.loadRoom();

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ teamId: null, isHost: false });

    server.send(JSON.stringify({ type: "SYNC_STATE", state: this.snapshot() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  // --------------------------------------------------------------- mensajes
  async webSocketMessage(ws, raw) {
    const room = await this.loadRoom();
    let msg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      this.send(ws, { type: "ERROR", message: "TRAMA ILEGIBLE" });
      return;
    }

    const meta = ws.deserializeAttachment() || { teamId: null, isHost: false };

    switch (msg.type) {
      // ---------------------------------------------------------- anfitrión
      case "HOST_OPEN_ROOM": {
        const passcode = String(this.env.HOST_PASSCODE || "");
        if (!passcode) {
          // Diagnóstico explícito: sin secreto configurado NADIE puede operar el
          // proyector, y el mensaje genérico no lo dejaría ver.
          this.send(ws, {
            type: "ERROR",
            message:
              "CLAVE MAESTRA INVÁLIDA // ESTE WORKER NO TIENE HOST_PASSCODE CONFIGURADO: EJECUTA `npx wrangler secret put HOST_PASSCODE` Y VUELVE A DESPLEGAR",
          });
          return;
        }
        if (String(msg.passcode || "") !== passcode) {
          this.send(ws, { type: "ERROR", message: "CLAVE MAESTRA INVÁLIDA // ACCESO DENEGADO" });
          return;
        }
        room.hostConnected = true;
        meta.isHost = true;
        meta.teamId = null;
        ws.serializeAttachment(meta);
        addLog(room, "SYS", `CONSOLA MAESTRA CONECTADA A #${room.pin}`);
        refreshDerived(room);
        await this.commit();
        return;
      }

      case "HOST_SEED_DISTRICTS": {
        if (!meta.isHost) return;
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
          this.send(ws, { type: "ERROR", message: "ESOS DISTRITOS YA ESTÁN EN LA MALLA" });
        }
        refreshDerived(room);
        await this.commit();
        return;
      }

      case "HOST_REMOVE_UNCLAIMED": {
        if (!meta.isHost) return;
        let removed = 0;
        for (const [id, team] of Object.entries(room.teams)) {
          if (!team.claimed) {
            delete room.teams[id];
            removed += 1;
          }
        }
        if (removed > 0) addLog(room, "HOST", `${removed} DISTRITO(S) SIN OPERADOR RETIRADOS DE LA MALLA`);
        refreshDerived(room);
        await this.commit();
        return;
      }

      case "HOST_START_GAME": {
        if (!meta.isHost) return;
        if (room.phase !== "LOBBY") {
          this.send(ws, { type: "ERROR", message: "LA SIMULACIÓN YA ESTÁ EN CURSO" });
          return;
        }
        if (Object.keys(room.teams).length === 0) {
          this.send(ws, { type: "ERROR", message: "NO HAY DISTRITOS EN LA MALLA: RESERVA EL PANEL O ESPERA A LAS MESAS" });
          return;
        }
        const crisis = rules.startRound(room, 1);
        addLog(
          room,
          "ALERT",
          `RONDA 01 PREPARADA // ${crisis.name} // PLANIFICACIÓN SIN RELOJ: EL ANFITRIÓN ABRE EL CRONÓMETRO CUANDO EL SALÓN ESTÉ LISTO`
        );
        for (const line of rules.incidentLogLines(room)) addLog(room, line.type, line.message);
        refreshDerived(room);
        await this.commit();
        return;
      }

      case "HOST_BEGIN_ROUND": {
        if (!meta.isHost || room.phase !== "PLANNING") return;
        rules.beginRound(room);
        addLog(room, "SYS", `CRONÓMETRO ABIERTO POR EL ANFITRIÓN // ANUNCIO DE ${room.announceSeconds}s EN CURSO`);
        refreshDerived(room);
        await this.commit();
        return;
      }

      case "HOST_PAUSE": {
        if (!meta.isHost || !rules.pauseClock(room)) return;
        addLog(room, "SYS", `CRONÓMETRO PAUSADO POR EL ANFITRIÓN // QUEDAN ${room.timeRemaining}s`);
        refreshDerived(room);
        await this.commit();
        return;
      }

      case "HOST_RESUME": {
        if (!meta.isHost || !rules.resumeClock(room)) return;
        addLog(room, "SYS", `CRONÓMETRO REANUDADO // QUEDAN ${room.timeRemaining}s`);
        refreshDerived(room);
        await this.commit();
        return;
      }

      case "HOST_ADD_TIME": {
        if (!meta.isHost) return;
        const seconds = parseInt(msg.seconds, 10) || rules.EXTRA_SECONDS;
        if (!rules.addTime(room, seconds)) return;
        addLog(room, "SYS", `EL ANFITRIÓN SUMÓ ${seconds}s // QUEDAN ${room.timeRemaining}s`);
        refreshDerived(room);
        await this.commit();
        return;
      }

      case "HOST_SKIP_ANNOUNCE": {
        if (!meta.isHost) return;
        if (room.phase !== "CRISIS_ANNOUNCE" && room.phase !== "PLANNING") return;
        rules.openNegotiation(room);
        addLog(room, "SYS", `ANUNCIO ADELANTADO POR EL ANFITRIÓN // NEGOCIACIÓN EN VIVO`);
        refreshDerived(room);
        await this.commit();
        return;
      }

      case "HOST_RESOLVE_NOW": {
        if (!meta.isHost) return;
        if (room.phase !== "CRISIS_ACTIVE" && room.phase !== "CRISIS_ANNOUNCE") return;
        const result = rules.resolveRound(room);
        logResolution(room, result, "RESOLUCIÓN FORZADA POR EL ANFITRIÓN // ");
        refreshDerived(room);
        await this.commit();
        return;
      }

      case "HOST_NEXT_ROUND": {
        if (!meta.isHost || room.phase !== "RESOLUTION") return;
        if (room.currentRound < room.totalRounds) {
          const crisis = rules.startRound(room, room.currentRound + 1);
          addLog(room, "ALERT", `RONDA 0${room.currentRound} PREPARADA // ${crisis.name} // PLANIFICACIÓN SIN RELOJ`);
          for (const line of rules.incidentLogLines(room)) addLog(room, line.type, line.message);
        } else {
          room.finalResults = rules.finalResults(room, { irreversible: false });
          room.phase = "GAME_OVER";
          room.timerRunning = false;
          room.deadlineTs = null;
          addLog(room, "SYS", `SIMULACIÓN COMPLETADA // CLASIFICACIÓN FINAL COMPILADA`);
        }
        refreshDerived(room);
        await this.commit();
        return;
      }

      case "HOST_RESET_GAME": {
        if (!meta.isHost) return;
        const pin = room.pin;
        this.room = rules.createRoom(pin, this.roomOptions());
        this.room.announceSeconds = intRoomSeconds(room, "announceSeconds", this.env, "ANNOUNCE_SECONDS");
        this.room.negotiationSeconds = intRoomSeconds(room, "negotiationSeconds", this.env, "NEGOTIATION_SECONDS");
        addLog(this.room, "HOST", "SIMULACIÓN REINICIADA POR EL ANFITRIÓN // VESTÍBULO LISTO");
        // Las mesas pierden su distrito: vuelven a entrar.
        for (const socket of this.ctx.getWebSockets()) {
          const attachment = socket.deserializeAttachment() || {};
          if (attachment.isHost) continue;
          socket.serializeAttachment({ teamId: null, isHost: false });
          this.send(socket, { type: "SESSION_EXPIRED" });
        }
        refreshDerived(this.room);
        await this.commit();
        return;
      }

      case "HOST_TOGGLE_SECTOR": {
        if (!meta.isHost || room.phase === "GAME_OVER") return;
        const team = room.teams[msg.teamId];
        const spec = rules.SECTOR_SPECS[msg.sector];
        if (!team || !spec) return;
        if (rules.isSectorLocked(room, msg.sector)) {
          this.send(ws, { type: "ERROR", message: `PALANCA BLOQUEADA POR INCIDENTE: ${spec.label}` });
          return;
        }
        team.sectors[msg.sector] = !!msg.state;
        addLog(room, "HOST", `OVERRIDE DE ANFITRIÓN: ${team.name} -> ${spec.label} ${msg.state ? "ENCENDIDA" : "APAGADA"}`);
        refreshDerived(room);
        await this.commit();
        return;
      }

      // -------------------------------------------------------------- mesas
      case "WATCH_ROOM": {
        meta.isHost = false;
        ws.serializeAttachment(meta);
        // El DO ya es la sala concreta: basta con entregar el estado actual.
        this.send(ws, { type: "SYNC_STATE", state: this.snapshot() });
        return;
      }

      case "JOIN_DISTRICT": {
        const teamId = meta.teamId;

        // Reconexión de una mesa que ya tenía distrito
        if (teamId && room.teams[teamId]) {
          const team = room.teams[teamId];
          team.connected = true;
          if (msg.operator) team.operator = String(msg.operator).slice(0, 40);
          meta.isHost = false;
          meta.teamId = team.id;
          ws.serializeAttachment(meta);
          addLog(room, "TEAM", `${team.name} SE RECONECTÓ A LA RED`);
          this.send(ws, { type: "JOIN_SUCCESS", teamId: team.id, pin: room.pin });
          refreshDerived(room);
          await this.commit();
          return;
        }

        const district = rules.districtOf(String(msg.districtId || "").toUpperCase());
        if (!district) {
          this.send(ws, { type: "JOIN_REJECTED", reason: "DISTRITO INEXISTENTE" });
          return;
        }

        let team = findTeamByDistrict(room, district.id);

        if (team && team.claimed && team.connected) {
          this.send(ws, {
            type: "JOIN_REJECTED",
            reason: `${district.name} YA ESTÁ OPERADO POR OTRA MESA (${team.operator || "SIN IDENTIFICAR"})`,
          });
          return;
        }

        if (!team) {
          if (room.phase !== "LOBBY" && room.phase !== "RESOLUTION") {
            this.send(ws, {
              type: "JOIN_REJECTED",
              reason: "NO SE PUEDEN SUMAR DISTRITOS NUEVOS CON UNA RONDA EN VIVO",
            });
            return;
          }
          if (Object.keys(room.teams).length >= rules.MAX_DISTRICTS) {
            this.send(ws, { type: "JOIN_REJECTED", reason: `PANEL COMPLETO (${rules.MAX_DISTRICTS} DISTRITOS)` });
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

        meta.isHost = false;
        meta.teamId = team.id;
        ws.serializeAttachment(meta);

        this.send(ws, { type: "JOIN_SUCCESS", teamId: team.id, pin: room.pin });
        addLog(room, "TEAM", `${team.operator} TOMÓ EL MANDO DE ${team.name} (${district.id}) // SALA #${room.pin}`);
        refreshDerived(room);
        await this.commit();
        return;
      }

      case "LEAVE_DISTRICT": {
        const teamId = meta.teamId;
        const team = teamId ? room.teams[teamId] : null;
        if (!team) return;
        team.connected = false;
        team.claimed = false;
        team.operator = null;
        if (room.phase === "LOBBY") delete room.teams[team.id];
        meta.teamId = null;
        ws.serializeAttachment(meta);
        this.send(ws, { type: "SESSION_EXPIRED" });
        addLog(room, "TEAM", `${team.name} LIBERÓ SU MANDO (SIGUE CONSUMIENDO EN LA MALLA)`);
        refreshDerived(room);
        await this.commit();
        return;
      }

      case "TOGGLE_SECTOR": {
        const teamId = meta.teamId;
        const team = teamId ? room.teams[teamId] : null;
        const spec = rules.SECTOR_SPECS[msg.sector];
        if (!team || !spec) return;
        if (room.phase === "GAME_OVER") {
          this.send(ws, { type: "ERROR", message: "SIMULACIÓN CERRADA // RED IRRECUPERABLE" });
          return;
        }
        if (rules.isSectorLocked(room, msg.sector)) {
          this.send(ws, {
            type: "ERROR",
            message: `${spec.label} BLOQUEADA POR INCIDENTE // NO SE PUEDE CORTAR ESTA RONDA`,
          });
          return;
        }
        team.sectors[msg.sector] = !!msg.state;
        addLog(room, "TEAM", `${team.name}: ${spec.label} ${msg.state ? "ENCENDIDA" : "APAGADA"}`);
        refreshDerived(room);
        await this.commit();
        return;
      }

      case "SCRAM": {
        const teamId = meta.teamId;
        const team = teamId ? room.teams[teamId] : null;
        if (!team || room.phase === "GAME_OVER") return;
        team.sectors = rules.emptySectors(false);
        for (const key of rules.SECTOR_ORDER) {
          if (rules.isSectorLocked(room, key)) team.sectors[key] = true;
        }
        addLog(room, "ALERT", `¡CORTE TOTAL DE EMERGENCIA EN ${team.name}! TODOS LOS ALIMENTADORES ABIERTOS`);
        refreshDerived(room);
        await this.commit();
        return;
      }

      case "PING":
        this.send(ws, { type: "ALERT", message: "PONG" });
        return;

      default:
        return;
    }
  }

  async webSocketClose(ws) {
    const room = await this.loadRoom();
    const meta = ws.deserializeAttachment() || {};

    if (meta.isHost) {
      room.hostConnected = false;
      addLog(room, "WARN", "CONSOLA MAESTRA DESCONECTADA");
      await this.commit();
      return;
    }

    const team = meta.teamId ? room.teams[meta.teamId] : null;
    if (team) {
      team.connected = false;
      addLog(room, "WARN", `${team.name} PERDIÓ EL ENLACE (SIGUE CONSUMIENDO EN LA MALLA)`);
      refreshDerived(room);
      await this.commit();
    }
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
}

/** Conserva las duraciones ya fijadas en la sala al reiniciar la partida. */
function intRoomSeconds(previousRoom, key, env, envKey) {
  if (previousRoom && previousRoom[key]) return previousRoom[key];
  return intEnv(env[envKey], rules[key === "announceSeconds" ? "ANNOUNCE_SECONDS" : "NEGOTIATION_SECONDS"]);
}