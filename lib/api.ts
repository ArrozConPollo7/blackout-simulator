/**
 * Cliente HTTP del Worker. Nada de lógica de juego aquí: solo transporte.
 * El cliente NUNCA calcula consecuencias; espera la respuesta del Worker.
 */

import type {
  CrisisResponse,
  DecisionRequest,
  DecisionResponse,
  GameStateResponse,
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
  signal?: AbortSignal;
}

const TIMEOUT_MS = 12000;

async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!env.apiUrl) {
    throw new ApiClientError(0, 'not_configured', 'Falta NEXT_PUBLIC_API_URL en el entorno del frontend.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(`${env.apiUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        ...(options.host && env.hostToken ? { 'x-host-token': env.hostToken } : {}),
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
        return 'Acción reservada al Host: falta o no coincide el token.';
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
