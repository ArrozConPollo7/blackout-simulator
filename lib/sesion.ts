/**
 * Qué hacer con la partida que este dispositivo recuerda (localStorage).
 *
 * El registro local (`eec:partida-activa`, `eec:mi-equipo:<partida>`) es un atajo, no la
 * verdad: sobrevive a la clase, así que un celular puede seguir ofreciendo la partida
 * anterior cuando en el proyector ya hay una nueva. Regla del proyecto: **nunca se ofrece
 * «continuar» con una partida que el servidor no confirme viva**.
 *
 * Este módulo es puro (sin React ni `window`) para poder probarlo con `node --test` y para
 * que el portal y la vista del jugador decidan con el mismo criterio.
 */

import type { Phase } from '../types/game.ts';

/** Cómo está la partida recordada por el dispositivo. */
export type EstadoPartidaGuardada =
  /** No hay nada guardado: primera visita o registro ya limpiado. */
  | 'sin-registro'
  /** El servidor confirmó que la partida sigue abierta (lobby o cualquier fase jugable). */
  | 'en-juego'
  /** Existe, pero ya está en `resultados`: se acabó. */
  | 'terminada'
  /** El servidor respondió 404: la partida no existe (base recreada, id viejo). */
  | 'no-existe'
  /** No se pudo preguntar (red, API caída): se conserva el atajo, sin afirmar nada. */
  | 'sin-confirmar';

export interface DatosDeSesion {
  /** ¿Hay una partida recordada en este dispositivo? */
  guardada: boolean;
  /** Qué contestó el servidor al pedirle el estado de esa partida. */
  respuesta: 'ok' | 'no-existe' | 'sin-respuesta';
  /** Fase devuelta por el servidor (`null` si no hubo respuesta útil). */
  fase: Phase | null;
}

/**
 * Traduce (registro local + respuesta del servidor) al estado de la sesión.
 *
 * Una partida en `resultados` NO se ofrece para continuar: es exactamente el caso en el que
 * el jugador cree que «ya tiene sesión iniciada» cuando en realidad está viendo la clase
 * anterior.
 */
export function clasificarPartidaGuardada({
  guardada,
  respuesta,
  fase,
}: DatosDeSesion): EstadoPartidaGuardada {
  if (!guardada) return 'sin-registro';
  if (respuesta === 'no-existe') return 'no-existe';
  if (respuesta === 'sin-respuesta') return 'sin-confirmar';
  return fase === 'resultados' ? 'terminada' : 'en-juego';
}

/**
 * ¿Se puede ofrecer «abrir/continuar» con la partida guardada?
 *
 * Sin respuesta del servidor se mantiene el atajo (una API caída no debe bloquear al Host en
 * el aula); con respuesta, solo si sigue viva.
 */
export function sePuedeReanudar(estado: EstadoPartidaGuardada): boolean {
  return estado === 'en-juego' || estado === 'sin-confirmar';
}

/**
 * Aviso para el portal cuando la partida guardada ya no sirve. `sala` es el código corto que
 * se muestra en pantalla (p. ej. `C619`), no el uuid.
 */
export function avisoDeSesion(estado: EstadoPartidaGuardada, sala: string | null): string | null {
  const sufijoSala = sala ? ` (sala ${sala})` : '';
  switch (estado) {
    case 'terminada':
      return `La partida anterior${sufijoSala} ya terminó. Escanea el QR de la partida nueva para volver a jugar.`;
    case 'no-existe':
      return `La partida que este dispositivo recordaba${sufijoSala} ya no existe: se borró el registro.`;
    default:
      return null;
  }
}
