/**
 * Cloudflare Worker — API del juego "Energia en Crisis".
 *
 * Endpoints (Fase 1.5):
 *   POST /game/start           crea partida + equipos desde content/cases.ts
 *   GET  /game/:id/state       estado completo (reconexion)
 *   POST /game/:id/decision    {teamId, round, optionId} -> aplica applyDecision
 *   POST /game/:id/crisis      solo host: triggerCrisis + apertura de la fase de crisis
 *   POST /game/:id/phase       solo host: avanza lobby -> investigar -> ... -> resultados
 *   GET  /health               sonda de vida
 *
 * El Worker es la unica fuente de verdad: ningun cliente calcula consecuencias.
 */

import type { Phase } from '../../types/game.ts';
import type { DecisionRequest, StartGameRequest } from '../../types/api.ts';
import { ConfigError, readConfig, type Env } from './env.ts';
import { SupabaseRepo, type GameRepo } from './repo.ts';
import {
  changePhase,
  fireCrisis,
  getGameState,
  startGame,
  submitDecision,
  type ServiceDeps,
} from './game-service.ts';
import { ApiError, corsHeaders, errorResponse, jsonResponse, readJsonBody } from './http.ts';

/** Dependencias construidas una vez por peticion. */
export function buildDeps(env: Env, repo?: GameRepo): ServiceDeps {
  if (repo) {
    return { repo, hostToken: env.HOST_TOKEN ?? null, allowInsecureHost: env.ALLOW_INSECURE_HOST === 'true' };
  }
  const config = readConfig(env);
  return {
    repo: new SupabaseRepo(config),
    hostToken: config.hostToken,
    allowInsecureHost: config.allowInsecureHost,
  };
}

/** Enrutador. Exportado para poder ejercitarlo sin levantar un servidor. */
export async function handleRequest(request: Request, env: Env, repo?: GameRepo): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const origin = request.headers.get('origin');
  const cors = corsHeaders(origin, (env.ALLOWED_ORIGINS ?? '*').split(',').map((o) => o.trim()));

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    if (path === '/' || path === '/health') {
      return jsonResponse({ ok: true, service: 'energia-en-crisis-api', time: new Date().toISOString() }, 200, cors);
    }

    const deps = buildDeps(env, repo);

    if (path === '/game/start' && request.method === 'POST') {
      const body = await readJsonBody<StartGameRequest>(request);
      return jsonResponse(await startGame(deps, body), 201, cors);
    }

    const match = path.match(/^\/game\/([^/]+)\/(state|decision|crisis|phase)$/);
    if (match) {
      const [, gameId, action] = match;
      const hostToken = request.headers.get('x-host-token');

      if (action === 'state' && request.method === 'GET') {
        return jsonResponse(await getGameState(deps, gameId), 200, cors);
      }
      if (action === 'decision' && request.method === 'POST') {
        const body = await readJsonBody<DecisionRequest>(request);
        return jsonResponse(await submitDecision(deps, gameId, body), 200, cors);
      }
      if (action === 'crisis' && request.method === 'POST') {
        return jsonResponse(await fireCrisis(deps, gameId, hostToken), 200, cors);
      }
      if (action === 'phase' && request.method === 'POST') {
        const body = await readJsonBody<{ phase?: Phase }>(request);
        return jsonResponse(await changePhase(deps, gameId, body, hostToken), 200, cors);
      }

      throw new ApiError(405, 'bad_request', `${request.method} no esta permitido en ${path}`);
    }

    throw new ApiError(404, 'not_found', `Ruta desconocida: ${path}`);
  } catch (error) {
    if (error instanceof ConfigError) {
      return jsonResponse({ error: 'not_configured', code: 'not_configured', detail: error.message }, 503, cors);
    }
    return errorResponse(error, cors);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
