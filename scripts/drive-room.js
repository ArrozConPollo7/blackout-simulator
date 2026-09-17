/**
 * Utilidad de verificación (herramienta de desarrollo, no parte del juego):
 * abre una sala por WebSocket, reserva el panel, arranca la partida, fuerza la
 * resolución de la ronda 1 y avanza a la ronda 2, donde una semilla fija puede
 * sortear el incidente que bloquea los servicios críticos. Sirve para
 * inspeccionar la interfaz con una ronda bloqueada viva, sin jugarla a mano.
 *
 *   PORT=3001 HOST_PASSCODE=2481 GAME_SEED=70 NEGOTIATION_SECONDS=300 node server.js &
 *   node scripts/drive-room.js
 */
const path = require("path");
const WebSocket = require(path.join(__dirname, "..", "node_modules", "ws"));

const PORT = process.env.PORT || 3001;
const PIN = process.env.PIN || "VOLT";
const PASSCODE = process.env.HOST_PASSCODE || "2481";

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
const send = (msg) => ws.send(JSON.stringify(msg));
let seen = -1;

ws.on("open", () => {
  send({ type: "HOST_OPEN_ROOM", pin: PIN, passcode: PASSCODE });
  setTimeout(() => send({ type: "HOST_SEED_DISTRICTS", count: 4 }), 600);
  setTimeout(() => send({ type: "HOST_START_GAME" }), 1300);
  setTimeout(() => send({ type: "HOST_RESOLVE_NOW" }), 4200);
  setTimeout(() => send({ type: "HOST_NEXT_ROUND" }), 5200);
  setTimeout(() => {
    ws.close();
    process.exit(0);
  }, 8500);
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type !== "SYNC_STATE") return;
  const state = msg.state;
  if (state.currentRound === seen) return;
  seen = state.currentRound;
  console.log(
    `ronda ${state.currentRound} | fase ${state.phase} | incidentes [${(state.incidents || [])
      .map((i) => i.id)
      .join(", ")}] | bloqueos ${JSON.stringify(state.lockedSectors)} | techo ${state.capacity.maxMW} MW / ${state.capacity.maxGas} m3`
  );
});
