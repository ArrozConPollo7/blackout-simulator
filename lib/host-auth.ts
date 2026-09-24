'use client';

/**
 * Contraseña de la consola del Host en este navegador.
 *
 * Vive en `sessionStorage`: sobrevive a recargas del proyector (F5 en medio de una
 * clase) pero desaparece al cerrar la pestaña, así que un equipo que tome el portátil
 * después no hereda la sesión del anfitrión.
 */

const KEY = 'eec:host-pass';

export function readHostPass(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.sessionStorage.getItem(KEY);
    return value && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeHostPass(pass: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(KEY, pass);
  } catch {
    /* almacenamiento bloqueado: la sesión dura solo esta carga */
  }
}

export function clearHostPass(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignorar */
  }
}
