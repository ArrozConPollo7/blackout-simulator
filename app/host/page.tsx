'use client';

/**
 * Consola del Host (pantalla grande / proyector).
 *
 * Todos los datos vienen del Worker (`GET /game/:id/state`) y se refrescan con
 * Supabase Realtime. Los controles (fase y crisis) son órdenes al Worker: este
 * cliente no calcula nada del juego.
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';

import GameHeader from '@/components/GameHeader';
import TeamCard from '@/components/TeamCard';
import CrisisOverlay from '@/components/CrisisOverlay';
import RankingIndicator from '@/components/RankingIndicator';
import HostGate from '@/components/HostGate';
import JoinQr from '@/components/JoinQr';
import SoundToggle from '@/components/SoundToggle';
import { audio, useAudioEvent, useSoundEnabled } from '@/lib/audio';
import { CONSUMO_REFERENCIA_ELECTRICIDAD, PRESUPUESTO_INICIAL } from '@/content/economy';
import { CASE_CATALOG } from '@/content/cases';
import { compareTeams } from '@/engine/results';
import { api, describeApiError, setRuntimeHostToken } from '@/lib/api';
import { missingConfig } from '@/lib/env';
import { clearHostPass, readHostPass, writeHostPass } from '@/lib/host-auth';
import { readActiveGame, resolveGameId, writeActiveGame } from '@/lib/game-store';
import { useGameState, useRemainingMs } from '@/lib/useGameState';
import {
  hostPhaseOf,
  phaseCode,
  phaseLabel,
  siguienteEtiqueta,
  type PhaseStep,
} from '@/lib/ui';
import type { RankingTrend } from '@/types/game';

// El vecindario 3D solo existe en la pantalla del Host y nunca se renderiza en servidor.
const NeighborhoodStage = dynamic(() => import('@/components/NeighborhoodStage'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[420px] rounded-xl border border-border-subtle bg-bg-surface flex items-center justify-center">
      <span className="font-label-md text-label-md text-text-secondary uppercase">
        Inicializando vecindario 3D…
      </span>
    </div>
  ),
});

function HostConsole() {
  const searchParams = useSearchParams();
  const [gameId, setGameId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  /** null = la consola aún no está desbloqueada (pide la contraseña de anfitrión). */
  const [passcode, setPasscode] = useState<string | null>(null);
  /** true mientras se revalida la contraseña recordada de esta pestaña. */
  const [revisando, setRevisando] = useState(true);
  const [slots, setSlots] = useState<number | null>(null);
  const [nuevoEquipo, setNuevoEquipo] = useState('');
  /** URL absoluta del registro de mesas: es lo que codifica el QR del proyector. */
  const [joinUrl, setJoinUrl] = useState<string | null>(null);

  const connection = useGameState(gameId);
  const state = connection.state;
  const phase = state?.phase;

  // El proyector recuerda la contraseña solo durante esta pestaña (lib/host-auth.ts).
  // Se revalida al abrir: si el anfitrión la cambió en el Worker, la consola no arranca
  // con una credencial muerta (el síntoma era "todo falla" sin decir por qué).
  useEffect(() => {
    const guardada = readHostPass();
    setSlots(readActiveGame()?.slots ?? null);
    if (!guardada) {
      setRevisando(false);
      return;
    }
    let vigente = true;
    setRuntimeHostToken(guardada);
    api
      .verifyHost(guardada)
      .then(() => {
        if (!vigente) return;
        setPasscode(guardada);
        setRevisando(false);
      })
      .catch(() => {
        if (!vigente) return;
        clearHostPass();
        setRuntimeHostToken(null);
        setRevisando(false);
      });
    return () => {
      vigente = false;
    };
  }, []);

  const desbloquear = useCallback((valor: string) => {
    writeHostPass(valor);
    setRuntimeHostToken(valor);
    setPasscode(valor);
  }, []);

  const bloquearConsola = useCallback(() => {
    clearHostPass();
    setRuntimeHostToken(null);
    setPasscode(null);
  }, []);

  useEffect(() => {
    setGameId(resolveGameId(searchParams.get('game')));
  }, [searchParams]);

  // El QR lleva la partida en la URL: la mesa escribe su nombre y entra.
  useEffect(() => {
    if (!state) {
      setJoinUrl(null);
      return;
    }
    setJoinUrl(`${window.location.origin}/join?game=${state.gameId}`);
  }, [state]);

  // Publica la partida activa para el portal y el navegador de demo.
  useEffect(() => {
    if (!state) return;
    writeActiveGame({
      gameId: state.gameId,
      hostPath: `/host?game=${state.gameId}`,
      updatedAt: Date.now(),
      teams: state.teams.map((team) => ({
        id: team.id,
        name: team.name,
        color: team.color,
        path: `/play/${team.id}?game=${state.gameId}`,
      })),
    });
  }, [state]);

  const runHostAction = useCallback(
    async (action: () => Promise<unknown>, mensaje: string) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        setNotice(mensaje);
        audio.play('confirm');
        await connection.reload();
      } catch (cause) {
        setError(describeApiError(cause));
        audio.play('deny');
      } finally {
        setBusy(false);
      }
    },
    [connection],
  );

  const crearPartida = useCallback(
    async (teamCount = 6) => {
      setBusy(true);
      setError(null);
      try {
        const started = await api.startGame({ teamCount });
        setSlots(started.slots);
        writeActiveGame({
          gameId: started.gameId,
          hostPath: started.hostPath,
          updatedAt: Date.now(),
          slots: started.slots,
          teams: [],
        });
        window.history.replaceState(null, '', started.hostPath);
        setGameId(started.gameId);
        setNotice(
          `Partida creada. Muestra el QR: los equipos entran por su cuenta y ponen su nombre (se esperan ${started.slots}).`,
        );
      } catch (cause) {
        setError(describeApiError(cause));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const agregarEquipo = useCallback(async () => {
    const nombre = nuevoEquipo.replace(/\s+/g, ' ').trim();
    if (!state || nombre.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const creado = await api.addTeam(state.gameId, nombre);
      setNuevoEquipo('');
      setNotice(`Equipo "${creado.name}" añadido: ya puede decidir en esta ronda.`);
      await connection.reload();
    } catch (cause) {
      setError(describeApiError(cause));
    } finally {
      setBusy(false);
    }
  }, [busy, connection, nuevoEquipo, state]);

  const olvidarPartida = useCallback(() => {
    setGameId(null);
    window.history.replaceState(null, '', '/host');
  }, []);

  const ranking = useMemo(() => [...(state?.teams ?? [])].sort(compareTeams), [state?.teams]);
  const leaderId = ranking[0]?.id ?? null;

  // Tendencias: guardamos el orden anterior para marcar sube/baja/estable.
  const previousRanks = useRef<Map<string, number>>(new Map());
  const trends = useMemo(() => {
    const map = new Map<string, RankingTrend>();
    ranking.forEach((team, index) => {
      const before = previousRanks.current.get(team.id);
      map.set(team.id, before === undefined || before === index ? 'flat' : before > index ? 'up' : 'down');
    });
    return map;
  }, [ranking]);
  useEffect(() => {
    previousRanks.current = new Map(ranking.map((team, index) => [team.id, index]));
  }, [ranking]);

  const consumoTotal = (state?.teams ?? []).reduce((acc, team) => acc + team.electricidad, 0);
  const referenciaTotal = CONSUMO_REFERENCIA_ELECTRICIDAD * (state?.teams.length ?? 1);
  const cargaLineaPct = referenciaTotal > 0 ? (consumoTotal / referenciaTotal) * 100 : null;
  const eficienciaMedia =
    state && state.teams.length > 0
      ? state.teams.reduce((acc, team) => acc + team.eficiencia, 0) / state.teams.length
      : null;
  const gastoTotal = (state?.teams ?? []).reduce(
    (acc, team) => acc + (PRESUPUESTO_INICIAL - team.presupuesto),
    0,
  );
  const decidieron = state
    ? state.teams.filter((team) => {
        const pendientes = (state.cases[team.id]?.appliances.length ?? 0) + 6 + 1;
        return (state.answered[team.id]?.length ?? 0) >= Math.min(pendientes, 1);
      }).length
    : 0;

  const hostPhase = hostPhaseOf(phase);
  const isCrisis = hostPhase === 'crisis' || Boolean(state?.crisisTriggered);
  const step: PhaseStep = { phase, next: siguienteEtiqueta(phase) };
  const slotsEsperados = slots ?? CASE_CATALOG.length;
  const equiposDentro = state?.teams.length ?? 0;
  const puedeAnadirEquipo =
    Boolean(state) && phase !== 'resultados' && equiposDentro < CASE_CATALOG.length;

  /* ------------------------------------------------------------------ */
  /* Sonido del proyector (lib/audio.ts): sintetizado, sin archivos      */
  /* ------------------------------------------------------------------ */

  const [soundOn] = useSoundEnabled();
  const play = useAudioEvent();
  const remaining = useRemainingMs(state?.timerEndsAt ?? null, phase, connection.clockSkewMs);
  const faseSonada = useRef<typeof phase>(undefined);
  const equiposSonados = useRef(0);
  const avisoTiempoDe = useRef<typeof phase>(undefined);

  // Cambio de fase: relay para abrir ronda, sirena al caer la crisis, fanfarria en el podio.
  useEffect(() => {
    const anterior = faseSonada.current;
    faseSonada.current = phase;
    if (!soundOn || !phase || anterior === undefined || anterior === phase) return;
    if (phase === 'crisis') play('crisis');
    else if (phase === 'resultados') play('podium');
    else play('phase');
  }, [phase, play, soundOn]);

  // Cada mesa que entra (QR o alta manual) se anuncia con un tono breve.
  useEffect(() => {
    const total = state?.teams.length ?? 0;
    const antes = equiposSonados.current;
    equiposSonados.current = total;
    if (!soundOn || total <= antes || antes === 0) return;
    play('join');
  }, [play, soundOn, state?.teams.length]);

  // Zumbido de subestación mientras la sesión está viva; sube de tensión en la crisis.
  useEffect(() => {
    if (!soundOn) {
      audio.stopAmbient();
      return;
    }
    audio.startAmbient();
    return () => audio.stopAmbient();
  }, [soundOn]);

  useEffect(() => {
    audio.setCrisis(hostPhase === 'crisis');
  }, [hostPhase]);

  // Últimos 10 segundos de una fase cronometrada: un tic doble por fase.
  useEffect(() => {
    if (!soundOn || remaining === null || remaining > 10_000) return;
    if (avisoTiempoDe.current === phase) return;
    avisoTiempoDe.current = phase;
    play('timeLow');
  }, [phase, play, remaining, soundOn]);

  // Sin contraseña no hay consola: el proyector es público, los controles no.
  if (!passcode) {
    if (revisando) {
      return (
        <main className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center font-label-md text-label-md uppercase tracking-wider">
          Revalidando credencial del proyector…
        </main>
      );
    }
    return <HostGate onUnlock={desbloquear} />;
  }

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary flex flex-col">
      <GameHeader
        phaseName={phaseLabel(phase)}
        phaseCode={phaseCode(phase)}
        phase={phase}
        timerEndsAt={state?.timerEndsAt ?? null}
        clockSkewMs={connection.clockSkewMs}
        isCrisis={hostPhase === 'crisis'}
        realtime={connection.realtime}
        busy={busy}
        nextPhaseLabel={step.next?.label ?? null}
        onTriggerCrisis={
          phase === 'decidir' || (phase === 'crisis' && !state?.crisisTriggered)
            ? () =>
                runHostAction(
                  () => api.fireCrisis(state!.gameId),
                  'Crisis disparada: el recargo ya está aplicado.',
                )
            : undefined
        }
        onAdvancePhase={
          step.next
            ? () =>
                runHostAction(
                  () => api.setPhase(state!.gameId, step.next!.phase),
                  `Fase abierta: ${step.next!.label}`,
                )
            : undefined
        }
      />

      <main className="w-full pt-24 pb-16 px-margin-desktop flex-1 flex flex-col gap-4 max-w-[1920px] mx-auto">
        {/* Barra de estado y errores */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border-subtle">
          <div className="flex flex-wrap items-center gap-3 font-label-sm text-label-sm text-text-secondary uppercase">
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-accent-presupuesto">
                sensors
              </span>
              {state ? `PARTIDA ${state.gameId.slice(0, 8).toUpperCase()}` : 'SIN PARTIDA ACTIVA'}
            </span>
            {state && (
              <>
                <span className="text-border-subtle">/</span>
                <span>EQUIPOS {state.teams.length}</span>
                <span className="text-border-subtle">/</span>
                <span>
                  CONSUMO DEL AULA{' '}
                  <strong className="text-accent-electricidad tabular-nums">
                    {consumoTotal.toFixed(2)} kWh
                  </strong>
                </span>
                <span className="text-border-subtle">/</span>
                <span>
                  GASTO ACUMULADO{' '}
                  <strong className="text-accent-presupuesto tabular-nums">
                    ${gastoTotal.toLocaleString('es-CO')}
                  </strong>
                </span>
                <span className="text-border-subtle">/</span>
                <span>
                  EFICIENCIA MEDIA{' '}
                  <strong className="text-accent-eficiencia tabular-nums">
                    {eficienciaMedia === null ? '—' : `${eficienciaMedia.toFixed(1)}%`}
                  </strong>
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 font-label-sm text-label-sm">
            <span className="text-text-secondary uppercase">
              {connection.status === 'listo'
                ? 'SINCRONIZACIÓN: OK'
                : connection.status === 'cargando'
                  ? 'SINCRONIZANDO…'
                  : connection.status === 'error'
                    ? 'SIN CONEXIÓN'
                    : 'ESPERANDO PARTIDA'}
            </span>
            <SoundToggle />
            <button
              type="button"
              onClick={olvidarPartida}
              className="px-3 py-1 rounded border border-border-subtle bg-surface text-text-secondary hover:text-text-primary uppercase"
              hidden={!state}
            >
              Otra partida
            </button>
            <button
              type="button"
              onClick={bloquearConsola}
              className="px-3 py-1 rounded border border-border-subtle bg-surface text-text-secondary hover:text-text-primary uppercase flex items-center gap-1"
              title="Cierra la sesión de anfitrión en este navegador"
            >
              <span className="material-symbols-outlined text-[14px]">lock</span>
              Bloquear
            </button>
          </div>
        </div>

        {missingConfig.length > 0 && (
          <div className="rounded-lg border border-accent-gas/40 bg-accent-gas/10 px-4 py-3 font-label-md text-label-md text-text-primary">
            Faltan variables de entorno: {missingConfig.join(', ')}. Copia `.env.example` a
            `.env.local` y reinicia el servidor.
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-accent-crisis/50 bg-accent-crisis/10 px-4 py-3 font-label-md text-label-md text-text-primary">
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="rounded-lg border border-accent-eficiencia/40 bg-accent-eficiencia/10 px-4 py-3 font-label-md text-label-md text-text-primary">
            {notice}
          </div>
        )}

        {/* Sin partida: creación */}
        {!state && connection.status !== 'cargando' && (
          <section className="w-full bg-bg-surface rounded-xl p-8 border border-border-subtle flex flex-col items-center gap-6 text-center">
            <span className="material-symbols-outlined text-[42px] text-accent-presupuesto">
              admin_panel_settings
            </span>
            <div className="flex flex-col gap-2">
              <h1 className="font-headline-lg text-headline-lg font-bold uppercase">
                Crear partida
              </h1>
              <p className="font-body-md text-body-md text-text-secondary max-w-xl">
                El Worker abre la partida y reparte un caso por mesa según el orden de llegada.
                Después verás el QR: cada equipo lo escanea, escribe su nombre y queda dentro.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {[4, 5, 6].map((count) => (
                <button
                  key={count}
                  type="button"
                  disabled={busy}
                  onClick={() => void crearPartida(count)}
                  className="h-12 px-6 rounded-xl bg-primary-container text-on-primary-container font-label-lg text-label-lg font-bold uppercase tracking-wider hover:opacity-90 active:scale-95 disabled:opacity-60"
                >
                  {count} equipos
                </button>
              ))}
            </div>
            {connection.error && (
              <p className="font-body-sm text-body-sm text-accent-gas">{connection.error}</p>
            )}
          </section>
        )}

        {/* LOBBY */}
        {hostPhase === 'lobby' && state && (
          <div className="flex flex-col gap-6 w-full flex-1">
            <section className="w-full bg-bg-surface rounded-xl p-6 lg:p-8 shadow-md border border-border-subtle">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full bg-accent-eficiencia animate-ping"></span>
                    <span className="font-label-sm text-label-sm text-text-secondary tracking-widest uppercase">
                      ENLACE DE RED OPERATIVO
                    </span>
                  </div>
                  <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight uppercase font-bold">
                    Lobby — cada mesa entra con su nombre
                  </h1>
                  <p className="font-body-md text-body-md text-text-secondary max-w-2xl">
                    Proyecta el código QR: cada equipo lo escanea, escribe el nombre de su mesa y
                    recibe un caso con consumos ocultos. Abre la primera ronda cuando estén dentro.
                  </p>
                </div>
                <div className="flex items-center gap-5 shrink-0">
                  <div className="text-right">
                    <span className="block font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
                      Equipos dentro
                    </span>
                    <span className="font-headline-lg text-headline-lg font-bold tabular-nums text-text-primary">
                      {equiposDentro}
                      <span className="text-[18px] text-text-secondary">/{slotsEsperados}</span>
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busy || equiposDentro === 0}
                    onClick={() =>
                      void runHostAction(
                        () => api.setPhase(state.gameId, 'investigar'),
                        'Fase de investigación abierta.',
                      )
                    }
                    className="h-12 px-8 rounded-xl bg-primary-container text-on-primary-container font-label-lg text-label-lg font-bold uppercase tracking-wider shadow-lg hover:opacity-90 active:scale-95 disabled:opacity-60 flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[20px]">play_arrow</span>
                    <span>Iniciar juego</span>
                  </button>
                </div>
              </div>
            </section>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)] gap-4 items-start">
              {/* Registro: QR + alta manual de respaldo */}
              <section className="bg-bg-surface rounded-xl border border-border-subtle p-5 flex flex-col gap-5 shadow-lg">
                {joinUrl ? (
                  <JoinQr url={joinUrl} size={192} />
                ) : (
                  <p className="font-label-md text-label-md text-text-secondary">
                    Preparando el enlace de registro…
                  </p>
                )}

                <div className="flex flex-col gap-2 pt-4 border-t border-border-subtle">
                  <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
                    Alta manual (celular sin cámara)
                  </span>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={nuevoEquipo}
                      onChange={(event) => setNuevoEquipo(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void agregarEquipo();
                        }
                      }}
                      maxLength={24}
                      placeholder="Nombre del equipo"
                      className="flex-1 h-11 px-3 rounded-lg bg-bg-primary border border-border-subtle outline-none font-label-md text-label-md text-text-primary placeholder:text-text-secondary/50 focus:border-accent-presupuesto"
                    />
                    <button
                      type="button"
                      disabled={busy || nuevoEquipo.trim().length < 2}
                      onClick={() => void agregarEquipo()}
                      className="h-11 px-4 rounded-lg border border-border-subtle bg-surface-container-low font-label-sm text-label-sm uppercase tracking-wider text-text-primary hover:border-accent-presupuesto disabled:opacity-50"
                    >
                      Añadir
                    </button>
                  </div>
                </div>
              </section>

              {/* Mesas registradas */}
              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
                  <span>Mesas registradas</span>
                  <span className="tabular-nums">
                    {equiposDentro} de {slotsEsperados}
                  </span>
                </div>

                {state.teams.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border-subtle p-10 flex flex-col items-center gap-3 text-center">
                    <span className="material-symbols-outlined text-[32px] text-text-secondary">
                      qr_code_2
                    </span>
                    <p className="font-label-md text-label-md text-text-secondary uppercase">
                      Todavía no hay ninguna mesa dentro
                    </p>
                    <p className="font-body-sm text-body-sm text-text-secondary max-w-md">
                      Que la primera escanee el QR del proyector. El caso se asigna por orden de
                      llegada, así que dos equipos nunca repiten instalación.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {state.teams.map((team, index) => {
                      const caso = state.cases[team.id];
                      const url = `/play/${team.id}?game=${state.gameId}`;
                      return (
                        <div
                          key={team.id}
                          className="bg-bg-surface rounded-xl p-5 border border-border-subtle shadow-lg flex flex-col gap-3"
                        >
                          <div className="flex items-center justify-between pb-3 border-b border-border-subtle">
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className="w-3.5 h-3.5 rounded-full shrink-0"
                                style={{ backgroundColor: team.color }}
                              ></div>
                              <div className="min-w-0">
                                <span className="font-label-sm text-[11px] text-text-secondary uppercase block">
                                  MESA {String(index + 1).padStart(2, '0')}
                                </span>
                                <h2 className="font-headline-sm font-bold text-text-primary uppercase truncate">
                                  {team.name}
                                </h2>
                              </div>
                            </div>
                            <span className="px-2 py-0.5 rounded bg-accent-eficiencia/10 border border-accent-eficiencia/30 text-accent-eficiencia font-label-sm text-label-sm font-bold uppercase">
                              DENTRO
                            </span>
                          </div>

                          <div className="bg-surface-container-lowest p-3 rounded-lg flex flex-col gap-1 border border-border-subtle">
                            <span className="font-label-sm text-label-sm text-text-secondary">
                              CASO ASIGNADO
                            </span>
                            <span className="font-label-md text-label-md text-text-primary font-bold truncate">
                              {caso?.name ?? 'pendiente'}
                            </span>
                            <span className="font-label-sm text-[11px] text-text-secondary">
                              {caso
                                ? `${caso.appliances.length} aparatos · ${caso.hiddenProblems.length} consumos ocultos`
                                : ''}
                            </span>
                          </div>

                          <a
                            href={url}
                            className="font-label-sm text-[11px] text-accent-presupuesto break-all hover:underline"
                          >
                            {url}
                          </a>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}


        {/* EN JUEGO / CRISIS */}
        {(hostPhase === 'en_juego' || hostPhase === 'crisis') && state && (
          <div className="flex flex-col gap-6 w-full">
            {hostPhase === 'crisis' && (
              <CrisisOverlay cargaLineaPct={cargaLineaPct} />
            )}

            <div className="w-full bg-bg-surface border border-border-subtle rounded-xl px-4 py-2.5 flex items-center justify-between shadow-md">
              <div className="flex items-center gap-3">
                <span
                  className={`w-2 h-2 rounded-full ${hostPhase === 'crisis' ? 'bg-accent-crisis animate-ping' : 'bg-accent-eficiencia animate-pulse'}`}
                ></span>
                <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-wider font-semibold">
                  {phaseLabel(phase)} ·{' '}
                </span>
                <span className="font-body-md text-body-md text-text-primary">
                  {phase === 'investigar'
                    ? 'Los equipos están inspeccionando sus aparatos.'
                    : phase === 'decidir'
                      ? 'Los equipos eligen cómo usar sus aparatos.'
                      : phase === 'crisis'
                        ? 'Alza tarifaria aplicada: el recargo ya está en cada equipo.'
                        : 'Últimas decisiones bajo crisis.'}
                </span>
              </div>
              <div className="hidden sm:flex items-center gap-2 font-label-sm text-label-sm text-text-secondary">
                <span>EFICIENCIA MEDIA {eficienciaMedia === null ? '—' : `${eficienciaMedia.toFixed(1)}%`}</span>
                <span>•</span>
                <span>DECISIONES REGISTRADAS {state.teams.reduce((acc, t) => acc + (state.answered[t.id]?.length ?? 0), 0)}</span>
              </div>
            </div>

            {/* Equipo que llega con la partida empezada: el Host lo añade a mano. */}
            {puedeAnadirEquipo && (
              <div className="w-full bg-bg-surface border border-border-subtle rounded-xl px-4 py-2.5 flex flex-wrap items-center gap-3 shadow-md">
                <span className="flex items-center gap-2 font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
                  <span className="material-symbols-outlined text-[16px]">person_add</span>
                  Equipo tardío
                </span>
                <input
                  type="text"
                  value={nuevoEquipo}
                  onChange={(event) => setNuevoEquipo(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void agregarEquipo();
                    }
                  }}
                  maxLength={24}
                  placeholder="Nombre del equipo que acaba de llegar"
                  className="flex-1 min-w-[200px] h-10 px-3 rounded-lg bg-bg-primary border border-border-subtle outline-none font-label-md text-label-md text-text-primary placeholder:text-text-secondary/50 focus:border-accent-presupuesto"
                />
                <button
                  type="button"
                  disabled={busy || nuevoEquipo.trim().length < 2}
                  onClick={() => void agregarEquipo()}
                  className="h-10 px-4 rounded-lg border border-border-subtle bg-surface-container-low font-label-sm text-label-sm uppercase tracking-wider text-text-primary hover:border-accent-presupuesto disabled:opacity-50"
                >
                  Añadir a la partida
                </button>
                <span className="font-label-sm text-label-sm text-text-secondary">
                  {equiposDentro} de {CASE_CATALOG.length} mesas
                </span>
              </div>
            )}

            <NeighborhoodStage
              teams={state.teams}
              isCrisis={hostPhase === 'crisis'}
              selectedTeamId={selectedTeamId}
              onSelectTeam={(teamId) =>
                setSelectedTeamId((current) => (current === teamId ? null : teamId))
              }
              className="h-[52vh] min-h-[360px]"
            />

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-gutter-desktop w-full">
              {ranking.map((team, index) => (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => setSelectedTeamId(team.id === selectedTeamId ? null : team.id)}
                  className={`text-left rounded-xl transition-all ${
                    team.id === selectedTeamId ? 'ring-2 ring-accent-presupuesto' : ''
                  }`}
                >
                  <TeamCard
                    team={team}
                    rank={index + 1}
                    variant={hostPhase === 'crisis' ? 'crisis' : 'default'}
                    isLeader={team.id === leaderId}
                  />
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 font-label-sm text-label-sm text-text-secondary">
              <span className="uppercase">Tendencias:</span>
              {ranking.slice(0, 3).map((team, index) => (
                <RankingIndicator
                  key={team.id}
                  rank={index + 1}
                  trend={trends.get(team.id) ?? 'flat'}
                  label={team.name}
                />
              ))}
            </div>
          </div>
        )}

        {/* RESULTADOS */}
        {hostPhase === 'resultados' && state && (
          <div className="flex flex-col gap-8 w-full">
            <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[32px] text-accent-eficiencia">
                  military_tech
                </span>
                <div>
                  <h1 className="font-headline-lg text-headline-lg font-bold uppercase tracking-tight text-text-primary">
                    Desempeño final y podio de resiliencia
                  </h1>
                  <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-widest">
                    Ranking por eficiencia; los empates se resuelven por presupuesto restante
                  </span>
                </div>
              </div>
              <span className="px-3 py-1 rounded bg-accent-eficiencia/10 border border-accent-eficiencia/30 text-accent-eficiencia font-label-md text-label-md font-bold uppercase">
                Simulación concluida
              </span>
            </div>

            {state.results && (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-md items-end">
                  {[1, 0, 2].map((position, column) => {
                    const entry = state.results!.ranking[position];
                    if (!entry) return <div key={`vacio-${position}`} className="lg:col-span-4" />;
                    return (
                      <div
                        key={entry.team.id}
                        className={`lg:col-span-4 ${column === 1 ? 'order-1 lg:order-2 lg:-translate-y-4' : column === 0 ? 'order-2 lg:order-1' : 'order-3'}`}
                      >
                        <TeamCard
                          team={entry.team}
                          rank={entry.rank}
                          variant="podium"
                          isLeader={entry.rank === 1}
                        />
                        <p className="mt-2 font-label-sm text-label-sm text-text-secondary text-center">
                          {entry.team.electricidad.toFixed(2)} kWh · {entry.team.gas.toFixed(2)} m³ ·{' '}
                          ${entry.team.presupuesto.toLocaleString('es-CO')} · {entry.team.eficiencia}%
                        </p>
                      </div>
                    );
                  })}
                </div>

                {state.results.ranking.length > 3 && (
                  <div className="w-full bg-surface-container rounded-xl p-4 border border-border-subtle flex flex-col gap-2">
                    {state.results.ranking.slice(3).map((entry) => (
                      <div
                        key={entry.team.id}
                        className="flex flex-wrap items-center justify-between gap-3 font-label-sm text-label-sm"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-label-lg text-label-lg font-bold text-text-secondary">
                            #{entry.rank}
                          </span>
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: entry.team.color }}
                          ></span>
                          <span className="font-headline-sm font-bold uppercase text-text-primary">
                            {entry.team.name}
                          </span>
                          {entry.team.eficiencia < 50 && (
                            <span className="px-2 py-0.5 rounded bg-accent-crisis/10 text-accent-crisis font-bold uppercase">
                              Sobrecosto
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-text-secondary">
                          <span>
                            ELECTRICIDAD{' '}
                            <strong className="text-text-primary tabular-nums">
                              {entry.team.electricidad.toFixed(2)} kWh
                            </strong>
                          </span>
                          <span>
                            GAS{' '}
                            <strong className="text-text-primary tabular-nums">
                              {entry.team.gas.toFixed(2)} m³
                            </strong>
                          </span>
                          <span>
                            PRESUPUESTO{' '}
                            <strong className="text-text-primary tabular-nums">
                              ${entry.team.presupuesto.toLocaleString('es-CO')}
                            </strong>
                          </span>
                          <span>
                            EFICIENCIA{' '}
                            <strong className="text-accent-eficiencia tabular-nums">
                              {entry.team.eficiencia}%
                            </strong>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <section className="w-full bg-surface-container rounded-xl p-space-lg lg:p-space-xl relative overflow-hidden shadow-xl border border-border-subtle">
                  <div className="absolute top-0 left-0 bottom-0 w-2 bg-accent-presupuesto"></div>
                  <div className="flex flex-col gap-space-md pl-space-xs md:pl-space-sm">
                    <div className="flex items-center justify-between flex-wrap gap-space-sm">
                      <div className="flex items-center gap-space-xs">
                        <span className="material-symbols-outlined text-accent-presupuesto text-[24px]">
                          speed
                        </span>
                        <h2 className="font-label-lg text-label-lg uppercase tracking-widest text-accent-presupuesto font-bold">
                          Conclusión educativa
                        </h2>
                      </div>
                      <div className="flex items-center gap-space-xs font-label-sm text-label-sm text-text-secondary uppercase">
                        <span>Promedio del aula</span>
                        <span>•</span>
                        <span>
                          {state.results.promedioEficiencia}% eficiencia ·{' '}
                          {state.results.promedioConsumoElectrico} kWh
                        </span>
                      </div>
                    </div>

                    <blockquote className="font-headline-lg text-headline-lg lg:text-headline-xl text-text-primary font-bold tracking-tight leading-snug">
                      “El equipo que consiguió el mejor resultado no fue necesariamente el que dejó de
                      consumir, sino el que eliminó los consumos innecesarios manteniendo las
                      necesidades básicas.”
                    </blockquote>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md pt-space-xs">
                      <div className="bg-surface-container-lowest p-space-md rounded-lg border border-border-subtle">
                        <div className="flex items-center gap-2 mb-2 text-accent-eficiencia">
                          <span className="material-symbols-outlined text-[18px]">verified</span>
                          <h4 className="font-label-md text-label-md font-bold uppercase">
                            Gestión pasiva vs apagón
                          </h4>
                        </div>
                        <p className="font-body-sm text-body-sm text-text-secondary">
                          Apagar todos los servicios esenciales genera pérdidas de bienestar
                          innecesarias. El control térmico inteligente mantiene la comodidad
                          reduciendo picos de demanda.
                        </p>
                      </div>

                      <div className="bg-surface-container-lowest p-space-md rounded-lg border border-border-subtle">
                        <div className="flex items-center gap-2 mb-2 text-accent-presupuesto">
                          <span className="material-symbols-outlined text-[18px]">
                            account_balance_wallet
                          </span>
                          <h4 className="font-label-md text-label-md font-bold uppercase">
                            Presupuesto sostenible
                          </h4>
                        </div>
                        <p className="font-body-sm text-body-sm text-text-secondary">
                          Prevenir consumos parásitos deja margen financiero para absorber aumentos
                          tarifarios imprevistos durante contingencias de red.
                        </p>
                      </div>

                      <div className="bg-surface-container-lowest p-space-md rounded-lg border border-border-subtle">
                        <div className="flex items-center gap-2 mb-2 text-secondary">
                          <span className="material-symbols-outlined text-[18px]">share</span>
                          <h4 className="font-label-md text-label-md font-bold uppercase">
                            Impacto colectivo en red
                          </h4>
                        </div>
                        <p className="font-body-sm text-body-sm text-text-secondary">
                          El comportamiento de un usuario individual repercute en la estabilidad de
                          toda la micro-red comunitaria. La resiliencia es compartida.
                        </p>
                      </div>
                    </div>
                  </div>
                </section>
              </>
            )}
          </div>
        )}
      </main>

      <footer className="w-full bg-bg-surface border-t border-border-subtle mt-auto">
        <div className="w-full h-12 px-margin-desktop flex items-center justify-between font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
          <div className="flex items-center gap-space-md">
            <span>TELEMETRÍA DE RED</span>
            <span className="text-border-subtle">/</span>
            <span>FUENTE: WORKER (ÚNICA FUENTE DE VERDAD)</span>
          </div>
          <div className="flex items-center gap-space-sm">
            <span
              className={`w-2 h-2 rounded-full ${hostPhase === 'crisis' ? 'bg-accent-crisis animate-ping' : 'bg-accent-eficiencia'}`}
            ></span>
            <span>{hostPhase === 'crisis' ? 'ALERTA TARIFARIA ACTIVA' : 'SISTEMA NOMINAL EN LÍNEA'}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function HostPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center font-label-md">
          CARGANDO CONSOLA HOST…
        </div>
      }
    >
      <HostConsole />
    </Suspense>
  );
}
