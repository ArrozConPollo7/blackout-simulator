'use client';

/**
 * Equipo que ya entró desde este dispositivo.
 *
 * El QR del proyector lleva a `/join?game=...`; si el celular se bloqueó o el equipo
 * recargó la página, aquí se recuerda qué equipo es para ofrecer "continuar" en vez de
 * crear un duplicado. La verdad sigue estando en el Worker (la vista lee `teamId` de la URL).
 */

export interface MyTeam {
  teamId: string;
  name: string;
  color: string;
  joinedAt: number;
}

const keyFor = (gameId: string) => `eec:mi-equipo:${gameId}`;

export function readMyTeam(gameId: string): MyTeam | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(keyFor(gameId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MyTeam;
    return parsed && typeof parsed.teamId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeMyTeam(gameId: string, team: Omit<MyTeam, 'joinedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(keyFor(gameId), JSON.stringify({ ...team, joinedAt: Date.now() }));
  } catch {
    /* ignorar */
  }
}

export function clearMyTeam(gameId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(keyFor(gameId));
  } catch {
    /* ignorar */
  }
}
