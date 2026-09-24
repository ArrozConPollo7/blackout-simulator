'use client';

/**
 * Háptica de la vista del jugador: vibración corta como confirmación física del toque.
 *
 * Todo va detrás de `typeof`: en iPhone y en escritorio `navigator.vibrate` no existe y
 * estas funciones quedan en no-op silencioso (nunca rompen la partida).
 */

type Vibracion = number | number[];

function zumbido(patron: Vibracion): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & { vibrate?: (pattern: Vibracion) => boolean };
  if (typeof nav.vibrate !== 'function') return;
  try {
    nav.vibrate(patron);
  } catch {
    /* el dispositivo no admite vibración: se ignora */
  }
}

/** Toque en una opción (el jugador siente que la tarjeta agarró el toque). */
export function hapticTap(): void {
  zumbido(10);
}

/** El centro de control confirmó la jugada. */
export function hapticConfirm(): void {
  zumbido(20);
}

/** El centro de control rechazó la jugada. */
export function hapticDeny(): void {
  zumbido(40);
}

/** Aviso de tiempo bajo: patrón corto, imposible de confundir con un toque. */
export function hapticTimeWarn(): void {
  zumbido([18, 60, 18]);
}
