/**
 * Partida activa en este dispositivo (localStorage).
 *
 * El Host crea la partida y guarda su id; los celulares de los equipos entran por el
 * enlace que el Host muestra (`/play/<teamId>?game=<gameId>`), así que el id viaja
 * siempre en la URL. El almacenamiento local es solo un atajo para no reescribir la URL.
 */

export interface ActiveTeamLink {
  id: string;
  name: string;
  color: string;
  path: string;
}

export interface ActiveGame {
  gameId: string;
  hostPath: string;
  updatedAt: number;
  teams: ActiveTeamLink[];
  /** Equipos esperados (el Host elige 4-6 al crear la partida). */
  slots?: number;
}

const KEY = 'eec:partida-activa';

export function readActiveGame(): ActiveGame | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveGame;
    return parsed && typeof parsed.gameId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeActiveGame(game: ActiveGame): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(game));
  } catch {
    /* almacenamiento lleno o bloqueado: la URL sigue siendo la fuente de verdad */
  }
}

export function clearActiveGame(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignorar */
  }
}

/** Resuelve el id de partida: primero la URL, luego el último guardado. */
export function resolveGameId(fromUrl: string | null): string | null {
  if (fromUrl && fromUrl.trim().length > 0) return fromUrl.trim();
  return readActiveGame()?.gameId ?? null;
}
