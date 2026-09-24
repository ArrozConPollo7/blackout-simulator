'use client';

/**
 * Estado de la partida en el cliente.
 *
 * Reglas (Fase 2.2 / 2.3):
 *  1. Al montar (y al reconectar) se pide SIEMPRE el estado completo al Worker con
 *     `GET /game/:id/state`. Los eventos de Realtime solo avisan "algo cambió"; nunca
 *     son la fuente de verdad ni se aplican como parches incrementales.
 *  2. El cronómetro se deriva de `timerEndsAt` (marca absoluta). El `setInterval` solo
 *     recalcula la diferencia, nunca acumula segundos.
 *  3. Si Realtime no está disponible, hay un sondeo lento de respaldo: el estado
 *     sigue viniendo del Worker.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameStateResponse } from '@/types/api';
import type { Phase } from '@/types/game';
import { isTimed } from '@/content/phases';
import { api, describeApiError } from './api';
import { getSupabaseBrowserClient } from './supabase';

export type RealtimeStatus = 'desactivado' | 'conectando' | 'suscrito' | 'error';
export type LoadStatus = 'sin-partida' | 'cargando' | 'listo' | 'error';

export interface GameConnection {
  state: GameStateResponse | null;
  status: LoadStatus;
  error: string | null;
  realtime: RealtimeStatus;
  lastSyncAt: number | null;
  /** Desfase entre el reloj del servidor y el de este dispositivo (ms). */
  clockSkewMs: number;
  reload: () => Promise<void>;
  /** Acepta un estado YA resuelto por el Worker (respuesta de una decisión). */
  applyState: (next: GameStateResponse) => void;
}

const REALTIME_DEBOUNCE_MS = 120;
/** Ritmo del sondeo de respaldo: más rápido cuando Realtime no está suscrito. */
const POLL_MS = { suscrito: 5000, respaldo: 3000 } as const;
/**
 * Tope de una petición de estado. Generoso a propósito: en el aula el Wi-Fi se satura con
 * 30 equipos y una petición puede tardar 10 s o más. Un tope corto condenaría al celular a
 * no recibir nunca el estado (mejor lento que congelado).
 */
const REQUEST_TIMEOUT_MS = 20000;
/** Dos recargas forzadas más seguidas que esto no se pisan: la de en medio sigue viva. */
const FORZADO_MIN_MS = 1200;

export function useGameState(gameId: string | null): GameConnection {
  const [state, setState] = useState<GameStateResponse | null>(null);
  const [status, setStatus] = useState<LoadStatus>(gameId ? 'cargando' : 'sin-partida');
  const [error, setError] = useState<string | null>(null);
  const [realtime, setRealtime] = useState<RealtimeStatus>('desactivado');
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [clockSkewMs, setClockSkewMs] = useState(0);

  const gameIdRef = useRef(gameId);
  gameIdRef.current = gameId;
  /** Intentos vivos ahora mismo (puede haber 2 si uno se pasó del tope y llegó otro). */
  const vivos = useRef(0);
  const ultimoIntento = useRef(0);
  /** Sello del último estado aplicado: una respuesta que llegue tarde no puede regresar la UI. */
  const ultimoSello = useRef(0);
  const stateRef = useRef<GameStateResponse | null>(null);
  stateRef.current = state;

  /**
   * Pide el estado completo al Worker.
   *
   * Reglas que evitan el congelamiento en el aula (30 equipos en el Wi-Fi):
   *  1. **Nunca se aborta una lectura en vuelo.** Antes cada tick abortaba la anterior: con
   *     una red más lenta que el intervalo no terminaba NINGUNA y el celular se quedaba en
   *     la fase vieja para siempre (medido: 7 lanzadas, 6 abortadas, 1 completada, sin
   *     actualizarse en 60 s). Ahora el sondeo se salta el turno.
   *  2. **El tope de tiempo no mata la petición, solo permite otro intento.** Si una lectura
   *     tarda más que `REQUEST_TIMEOUT_MS` (red saturada), se deja vivir —cuando llegue se
   *     aplica— y el siguiente tick puede lanzar una nueva en paralelo.
   *  3. **Respuestas tardías se descartan por sello**: solo se aplica lo que sea más nuevo que
   *     el último estado aplicado, y solo si es de esta partida.
   */
  const pedir = useCallback(async (opts: { forzar?: boolean } = {}) => {
    const current = gameIdRef.current;
    if (!current) {
      setStatus('sin-partida');
      setState(null);
      return;
    }
    const hayIntentoReciente = vivos.current > 0 && Date.now() - ultimoIntento.current < REQUEST_TIMEOUT_MS;
    if (hayIntentoReciente && !opts.forzar) return;
    if (hayIntentoReciente && opts.forzar && Date.now() - ultimoIntento.current < FORZADO_MIN_MS) return;

    vivos.current += 1;
    ultimoIntento.current = Date.now();
    try {
      const next = await api.getState(current, undefined);
      if (next.gameId !== gameIdRef.current) return;
      const sello = Date.parse(next.serverTime);
      if (Number.isFinite(sello) && sello < ultimoSello.current) return;
      if (Number.isFinite(sello)) ultimoSello.current = sello;
      setState(next);
      setStatus('listo');
      setError(null);
      setLastSyncAt(Date.now());
      if (Number.isFinite(sello)) setClockSkewMs(sello - Date.now());
    } catch (cause) {
      // Sin respuesta: se conserva el último estado bueno (el chip de la cabecera avisa de
      // que está viejo) y solo se muestra el error si nunca hubo estado.
      if (stateRef.current) return;
      setStatus('error');
      setError(describeApiError(cause));
    } finally {
      vivos.current -= 1;
    }
  }, []);

  /** Recarga explícita (botón, volver a la app, evento de Realtime). */
  const reload = useCallback(() => pedir({ forzar: true }), [pedir]);

  // Carga inicial y recarga al cambiar de partida.
  useEffect(() => {
    if (!gameId) {
      setState(null);
      setStatus('sin-partida');
      return;
    }
    setStatus('cargando');
    void pedir();
  }, [gameId, pedir]);

  // Suscripción a Realtime: cualquier cambio en games/teams de esta partida dispara un
  // refetch completo. Al (re)suscribirse también se refresca, lo que cubre la reconexión.
  useEffect(() => {
    if (!gameId) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setRealtime('desactivado');
      return;
    }

    setRealtime('conectando');
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void pedir({ forzar: true }), REALTIME_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel(`partida:${gameId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        scheduleReload,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'teams', filter: `game_id=eq.${gameId}` },
        scheduleReload,
      )
      .subscribe((channelStatus) => {
        if (channelStatus === 'SUBSCRIBED') {
          setRealtime('suscrito');
          void pedir({ forzar: true });
        } else if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT') {
          setRealtime('error');
        } else if (channelStatus === 'CLOSED') {
          setRealtime('conectando');
        }
      });

    return () => {
      if (debounce) clearTimeout(debounce);
      void supabase.removeChannel(channel);
    };
  }, [gameId, pedir]);

  // Respaldo: el sondeo va SIEMPRE, más espaciado cuando Realtime ya avisa. Un aula con 30
  // dispositivos no nota una petición cada 8 s, y evita que una suscripción al proyecto
  // equivocado (o caída) deje el proyector y los celulares congelados sin que nadie lo sepa.
  useEffect(() => {
    if (!gameId) return;
    const periodo = realtime === 'suscrito' ? POLL_MS.suscrito : POLL_MS.respaldo;
    const timer = setInterval(() => void pedir(), periodo);
    return () => clearInterval(timer);
  }, [gameId, realtime, pedir]);

  // Refresco al volver a la pestaña (el celular estuvo en segundo plano).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    // Recuperar la conexión también cuenta como volver: en el aula el Wi-Fi se cae y vuelve.
    window.addEventListener('online', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [reload]);

  const applyState = useCallback((next: GameStateResponse) => {
    if (next.gameId !== gameIdRef.current) return;
    setState(next);
    setStatus('listo');
    setError(null);
    setLastSyncAt(Date.now());
    const serverTime = Date.parse(next.serverTime);
    if (Number.isFinite(serverTime)) setClockSkewMs(serverTime - Date.now());
  }, []);

  return { state, status, error, realtime, lastSyncAt, clockSkewMs, reload, applyState };
}

/**
 * Milisegundos restantes de la fase, recalculados contra `timerEndsAt` en cada tick.
 * Devuelve null si la fase no tiene cronómetro (lobby, resultados).
 */
export function useRemainingMs(
  timerEndsAt: string | null | undefined,
  phase: Phase | undefined,
  clockSkewMs = 0,
): number | null {
  const [, tick] = useState(0);
  const active = Boolean(phase && isTimed(phase) && timerEndsAt);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [active]);

  if (!active || !timerEndsAt) return null;
  const deadline = Date.parse(timerEndsAt);
  if (!Number.isFinite(deadline)) return null;
  return Math.max(0, deadline - (Date.now() + clockSkewMs));
}
