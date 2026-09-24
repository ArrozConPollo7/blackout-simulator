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

const POLL_FALLBACK_MS = 5000;
const REALTIME_DEBOUNCE_MS = 120;

export function useGameState(gameId: string | null): GameConnection {
  const [state, setState] = useState<GameStateResponse | null>(null);
  const [status, setStatus] = useState<LoadStatus>(gameId ? 'cargando' : 'sin-partida');
  const [error, setError] = useState<string | null>(null);
  const [realtime, setRealtime] = useState<RealtimeStatus>('desactivado');
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [clockSkewMs, setClockSkewMs] = useState(0);

  const gameIdRef = useRef(gameId);
  gameIdRef.current = gameId;
  const inFlight = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    const current = gameIdRef.current;
    if (!current) {
      setStatus('sin-partida');
      setState(null);
      return;
    }
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const next = await api.getState(current, controller.signal);
      setState(next);
      setStatus('listo');
      setError(null);
      setLastSyncAt(Date.now());
      const serverTime = Date.parse(next.serverTime);
      if (Number.isFinite(serverTime)) setClockSkewMs(serverTime - Date.now());
    } catch (cause) {
      if (controller.signal.aborted) return;
      setStatus('error');
      setError(describeApiError(cause));
    }
  }, []);

  // Carga inicial y recarga al cambiar de partida.
  useEffect(() => {
    if (!gameId) {
      setState(null);
      setStatus('sin-partida');
      return;
    }
    setStatus('cargando');
    void reload();
  }, [gameId, reload]);

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
      debounce = setTimeout(() => void reload(), REALTIME_DEBOUNCE_MS);
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
          void reload();
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
  }, [gameId, reload]);

  // Respaldo: mientras Realtime no esté suscrito, sondeo lento.
  useEffect(() => {
    if (!gameId || realtime === 'suscrito') return;
    const timer = setInterval(() => void reload(), POLL_FALLBACK_MS);
    return () => clearInterval(timer);
  }, [gameId, realtime, reload]);

  // Refresco al volver a la pestaña (el celular estuvo en segundo plano).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
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
