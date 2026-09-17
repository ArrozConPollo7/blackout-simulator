/**
 * BLACKOUT: GRID COLLAPSE — Worker de Cloudflare.
 *
 * Enruta cada socket a la sala que le corresponde: un Durable Object por PIN.
 * El resto de rutas se sirven como estáticos (el build `next export` en `out/`).
 * El servidor Node (`server.js`) sigue existiendo para jugar en LAN sin
 * internet; ambos comparten el mismo motor en `src/shared/rules.js`.
 */

import * as rules from "../src/shared/rules.js";

export { RoomDurableObject } from "./room.js";

function normalizePin(pin) {
  return String(pin || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return Response.json(
        { ok: true, runtime: "cloudflare-workers", version: rules.VERSION },
        { headers: { "cache-control": "no-store" } }
      );
    }

    if (url.pathname === "/ws" || url.pathname === "/ws/") {
      const pin = normalizePin(url.searchParams.get("pin") || "VOLT") || "VOLT";
      const stub = env.ROOMS.get(env.ROOMS.idFromName(pin));
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
