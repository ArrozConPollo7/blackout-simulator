/** Utilidades HTTP: errores tipados, CORS y respuestas JSON. */

import type { ApiErrorBody } from '../../types/api.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorBody['code'];
  readonly detail?: string;

  constructor(status: number, code: ApiErrorBody['code'], detail?: string) {
    super(detail ?? code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }

  toBody(): ApiErrorBody {
    return { error: this.code, code: this.code, detail: this.detail };
  }
}

export function corsHeaders(origin: string | null, allowedOrigins: string[]): Record<string, string> {
  const allowAll = allowedOrigins.includes('*') || allowedOrigins.length === 0;
  const allowed = allowAll ? '*' : origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type,x-host-token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export async function readJsonBody<T>(request: Request): Promise<T> {
  const raw = await request.text();
  if (!raw.trim()) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ApiError(400, 'bad_request', 'El cuerpo de la peticion no es JSON valido');
  }
}

export function errorResponse(error: unknown, headers: Record<string, string> = {}): Response {
  if (error instanceof ApiError) return jsonResponse(error.toBody(), error.status, headers);
  const message = error instanceof Error ? error.message : String(error);
  return jsonResponse(
    { error: 'internal', code: 'internal', detail: message } satisfies ApiErrorBody,
    500,
    headers,
  );
}
