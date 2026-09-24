/**
 * Cliente HTTP del Worker. Nada de lógica de juego aquí: solo transporte.
 * El cliente NUNCA calcula consecuencias; espera la respuesta del Worker.
 */

import type {
  CrisisResponse,
  DecisionRequest,
  DecisionResponse,
  GameStateResponse,
  HostVerifyResponse,
  JoinGameResponse,
  PhaseResponse,
  StartGameRequest,
  StartGameResponse,
} from '@/types/api';
import type { Phase } from '@/types/game';
import { env } from './env';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: string;

  constructor(status: number, code: string, detail?: string) {
    super(detail ?? code);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Acciones privilegiadas del Host: añade la cabecera x-host-token. */
  host?: boolean;
  /** Credencial puntual (el sondeo de la contraseña antes de guardarla). */
  hostToken?: string;
  signal?: AbortSignal;
}

const TIMEOUT_MS = 12000;

/**
 * Contraseña del Host de esta sesión del navegador. Vive en memoria + sessionStorage
 * (`lib/host-auth.ts`), nunca en el bundle: la consola la pide al abrirse.
 */
let runtimeHostToken: string | null = null;

export function setRuntimeHostToken(token: string | null): void {
  runtimeHostToken = token && token.trim().length > 0 ? token.trim() : null;
}

export function getRuntimeHostToken(): string | null {
  return runtimeHostToken ?? (env.hostToken || null);
}

async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!env.apiUrl) {
    throw new ApiClientError(0, 'not_configured', 'Falta NEXT_PUBLIC_API_URL en el entorno del frontend.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const hostToken = options.hostToken ?? (options.host ? getRuntimeHostToken() : null);

  try {
    const response = await fetch(`${env.apiUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        ...(hostToken ? { 'x-host-token': hostToken } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      cache: 'no-store',
    });

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : null;

    if (!response.ok) {
      const error = (payload ?? {}) as { code?: string; detail?: string; error?: string };
      throw new ApiClientError(
        response.status,
        error.code ?? error.error ?? 'internal',
        error.detail ?? `El Worker respondió ${response.status}`,
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiClientError(0, 'timeout', 'El Worker no respondió a tiempo.');
    }
    throw new ApiClientError(0, 'network', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  startGame: (body: StartGameRequest = {}) =>
    apiFetch<StartGameResponse>('/game/start', { method: 'POST', body, host: true }),

  /** Sondeo de la contraseña del Host: el valor se prueba antes de guardarlo. */
  verifyHost: (passcode: string) =>
    apiFetch<HostVerifyResponse>('/host/verify', { method: 'POST', hostToken: passcode }),

  /** Alta de una mesa desde el QR del proyector. */
  joinGame: (gameId: string, name: string) =>
    apiFetch<JoinGameResponse>(`/game/${gameId}/join`, { method: 'POST', body: { name } }),

  /** Alta desde la consola del Host (equipo que llega con la partida empezada). */
  addTeam: (gameId: string, name: string) =>
    apiFetch<JoinGameResponse>(`/game/${gameId}/teams`, { method: 'POST', body: { name }, host: true }),

  getState: (gameId: string, signal?: AbortSignal) =>
    apiFetch<GameStateResponse>(`/game/${gameId}/state`, { signal }),

  sendDecision: (gameId: string, body: DecisionRequest) =>
    apiFetch<DecisionResponse>(`/game/${gameId}/decision`, { method: 'POST', body }),

  fireCrisis: (gameId: string) =>
    apiFetch<CrisisResponse>(`/game/${gameId}/crisis`, { method: 'POST', host: true }),

  setPhase: (gameId: string, phase: Phase) =>
    apiFetch<PhaseResponse>(`/game/${gameId}/phase`, { method: 'POST', body: { phase }, host: true }),
};

/** Mensaje legible para el usuario a partir de un error del transporte. */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiClientError) {
    switch (error.code) {
      case 'not_configured':
        return 'La aplicación no tiene configurada la URL del Worker (NEXT_PUBLIC_API_URL).';
      case 'timeout':
        return 'El Worker no respondió; vuelve a intentar.';
      case 'network':
        return `No hay conexión con el Worker (${error.detail ?? 'error de red'}).`;
      case 'forbidden':
        return 'Acción reservada al Host: contraseña incorrecta o ausente.';
      case 'name_taken':
        return error.detail ?? 'Ese nombre de equipo ya está en uso: elegid otro.';
      case 'game_full':
        return error.detail ?? 'La partida ya tiene el máximo de equipos.';
      case 'already_decided':
        return 'Ese escenario ya fue decidido por el equipo.';
      case 'wrong_phase':
        return error.detail ?? 'La partida no está aceptando decisiones en esta fase.';
      default:
        return error.detail ?? error.message;
    }
  }
  return error instanceof Error ? error.message : 'Error inesperado';
}
