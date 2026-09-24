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
import AnimatedNumber from '@/components/play/AnimatedNumber';
import GridMeter from '@/components/host/GridMeter';
import DecisionFeed from '@/components/host/DecisionFeed';
import PodiumBurst from '@/components/host/PodiumBurst';
import { audio, useAudioEvent, useSoundEnabled } from '@/lib/audio';
import { CONSUMO_REFERENCIA_ELECTRICIDAD, PRESUPUESTO_INICIAL } from '@/content/economy';
import { CASE_CATALOG } from '@/content/cases';
import { scenariosForCase } from '@/content/decisions';
import { compareTeams } from '@/engine/results';
import { api, describeApiError, setRuntimeHostToken } from '@/lib/api';
import { isDevelopment, missingConfig } from '@/lib/env';
import { clearHostPass, readHostPass, writeHostPass } from '@/lib/host-auth';
import { readActiveGame, resolveGameId, writeActiveGame } from '@/lib/game-store';
import { useGameState } from '@/lib/useGameState';
import {
  formatNumber,
  hostPhaseOf,
  phaseCode,
  phaseLabel,
  realtimeLabel,
  salaCode,
  siguienteEtiqueta,
  type PhaseStep,
} from '@/lib/ui';
import type { RankingTrend } from '@/types/game';

/** Suceso real para la tira de actividad del proyector (nada inventado). */
interface FeedEvent {
  id: string;
  team: string;
  color: string;
  texto: string;
  at: number;
}

// El vecindario 3D solo existe en la pantalla del Host y nunca se renderiza en servidor.
const NeighborhoodStage = dynamic(() => import('@/components/NeighborhoodStage'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[420px] rounded-xl border border-border-subtle bg-bg-surface flex items-center justify-center">
      <span className="font-label-md text-label-md text-text-secondary uppercase anim-pulse-urgent">
        Levantando el barrio…
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
  /** La revalidación tarda demasiado: se le dice al anfitrión qué hacer. */
  const [revisandoLento, setRevisandoLento] = useState(false);
  const [slots, setSlots] = useState<number | null>(null);
  const [nuevoEquipo, setNuevoEquipo] = useState('');
  /** URL absoluta del registro de mesas: es lo que codifica el QR del proyector. */
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  /** La consola no es interactiva hasta que React toma el control: evita el "hay que pulsar dos veces". */
  const [montado, setMontado] = useState(false);
  /** Tira de actividad del proyector (sucesos reales, se conservan los últimos). */
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  /** Toma de pantalla al cambiar de ronda. */
  const [toma, setToma] = useState<{ codigo: string; titulo: string; sub: string } | null>(null);

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
  const primerRanking = useRef(true);
  useEffect(() => {
    // Cambio de puesto = momento de celebración (patrón de marcador de concurso): se
    // anuncia solo cuando el orden cambia de verdad, con el delta real.
    const eventos: FeedEvent[] = [];
    ranking.forEach((team, index) => {
      const antes = previousRanks.current.get(team.id);
      if (antes === undefined || antes === index) return;
      const delta = antes - index;
      eventos.push({
        id: `${team.id}:puesto:${index}:${Date.now()}`,
        team: team.name,
        color: team.color,
        texto:
          delta > 1
            ? `subió ${delta} puestos`
            : delta === 1
              ? 'subió un puesto'
              : delta === -1
                ? 'bajó un puesto'
                : `bajó ${Math.abs(delta)} puestos`,
        at: Date.now(),
      });
    });
    previousRanks.current = new Map(ranking.map((team, index) => [team.id, index]));
    if (!primerRanking.current && eventos.length > 0) {
      setFeed((previo) => [...eventos, ...previo].slice(0, 6));
    }
    primerRanking.current = false;
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
  /* Ronda en curso y avance del aula (todo sale del estado real) */
  const rondaActual =
    phase === 'investigar' ? 1 : phase === 'decidir' ? 2 : phase === 'crisis' ? 3 : phase === 'decidir_2' ? 4 : 0;
  const prefijoRonda =
    phase === 'investigar' ? 'r1:' : phase === 'decidir' ? 'r2:' : phase === 'decidir_2' ? 'r2b' : null;
  const mesasQueDecidieron = prefijoRonda
    ? (state?.teams ?? []).filter((team) =>
        (state?.answered[team.id] ?? []).some((clave) => clave.startsWith(prefijoRonda)),
      ).length
    : 0;
  const decisionesTotales = (state?.teams ?? []).reduce(
    (acc, team) => acc + (state?.answered[team.id]?.length ?? 0),
    0,
  );

  const hostPhase = hostPhaseOf(phase);
  const isCrisis = hostPhase === 'crisis' || Boolean(state?.crisisTriggered);
  const step: PhaseStep = { phase, next: siguienteEtiqueta(phase) };
  const slotsEsperados = slots ?? CASE_CATALOG.length;
  const equiposDentro = state?.teams.length ?? 0;
  const puedeAnadirEquipo =
    Boolean(state) && phase !== 'resultados' && equiposDentro < CASE_CATALOG.length;

  /* ------------------------------------------------------------------ */
  /* Vida de la consola: sonido, actividad del aula y tomas de pantalla   */
  /* ------------------------------------------------------------------ */

  // La consola no responde a clics hasta que React toma el control del HTML servido.
  useEffect(() => {
    setMontado(true);
  }, []);

  // Si la revalidación no termina en 8 s (red del aula, recarga a medias), se avisa.
  useEffect(() => {
    if (!revisando) return undefined;
    const id = setTimeout(() => setRevisandoLento(true), 8000);
    return () => clearTimeout(id);
  }, [revisando]);

  const [soundOn] = useSoundEnabled();
  const play = useAudioEvent();
  const faseSonada = useRef<typeof phase>(undefined);
  const logros = useRef(new Set<string>());
  const primeraFoto = useRef(true);
  const avisoTiempoDe = useRef<typeof phase>(undefined);

  // Cambio de fase: relay para abrir ronda, sirena al caer la crisis, fanfarria en el podio.
  useEffect(() => {
    const anterior = faseSonada.current;
    faseSonada.current = phase;
    if (!phase || anterior === undefined || anterior === phase) return undefined;
    if (phase === 'crisis') play('crisis');
    else if (phase === 'resultados') play('podium');
    else play('phase');

    if (phase !== 'resultados') {
      setFeed((previo) =>
        [
          {
            id: `ronda:${phase}:${Date.now()}`,
            team: 'La red',
            color: '#3EC6F0',
            texto: phaseLabel(phase).toLowerCase(),
            at: Date.now(),
          },
          ...previo,
        ].slice(0, 6),
      );
    }

    // La crisis ya tiene su propia toma de pantalla (CrisisOverlay): no se duplica.
    if (phase === 'lobby' || phase === 'resultados' || phase === 'crisis') return undefined;
    const ronda = phase === 'investigar' ? 1 : phase === 'decidir' ? 2 : 4;
    setToma({
      codigo: `RONDA ${ronda} DE 4`,
      titulo: phase === 'investigar' ? 'HORA DE AUDITAR' : 'HORA DE DECIDIR',
      sub: phaseLabel(phase),
    });
    const cerrar = setTimeout(() => setToma(null), 2800);
    return () => clearTimeout(cerrar);
  }, [phase, play]);

  // Actividad del aula: cada suceso sale del estado real (mesas dentro y rondas cerradas).
  useEffect(() => {
    if (!state) return;
    const nuevos: FeedEvent[] = [];
    for (const team of state.teams) {
      const answered = state.answered[team.id] ?? [];
      const casoDelEquipo = state.cases[team.id];
      const aparatos = casoDelEquipo?.appliances.length ?? 0;
      // Cada caso juega solo las situaciones de sus aparatos: el "cerró la ronda" se cuenta
      // contra las suyas, no contra las seis del catálogo (si no, nunca se anunciaría).
      const situaciones = scenariosForCase('decidir', casoDelEquipo?.appliances ?? null).length;
      const marcas: Array<[string, boolean, string]> = [
        [`${team.id}:r1`, aparatos > 0 && answered.filter((k) => k.startsWith('r1:')).length >= aparatos, 'terminó la auditoría'],
        [`${team.id}:r2`, situaciones > 0 && answered.filter((k) => k.startsWith('r2:')).length >= situaciones, 'completó sus decisiones'],
        [`${team.id}:r2b`, answered.includes('r2b'), 'cerró sus últimas decisiones'],
      ];
      for (const [clave, logrado, texto] of marcas) {
        if (!logrado || logros.current.has(clave)) continue;
        logros.current.add(clave);
        // En la primera foto (recarga del proyector) se marcan sin anunciar: nadie acaba de decidir.
        if (primeraFoto.current) continue;
        nuevos.push({
          id: `${clave}:${Date.now()}`,
          team: team.name,
          color: team.color,
          texto,
          at: Date.now(),
        });
      }
    }
    primeraFoto.current = false;
    if (nuevos.length > 0) setFeed((previo) => [...nuevos.reverse(), ...previo].slice(0, 6));
  }, [state]);

  // Zumbido de subestación mientras la sesión está viva; sube de tensión en la crisis.
  useEffect(() => {
    if (!soundOn) {
      audio.stopAmbient();
      return undefined;
    }
    audio.startAmbient();
    return () => audio.stopAmbient();
  }, [soundOn]);

  useEffect(() => {
    audio.setCrisis(hostPhase === 'crisis');
  }, [hostPhase]);

  // Aviso de los últimos 10 s: se calcula en un intervalo que NO re-renderiza la consola
  // (antes era un tick de 4 Hz que volvía a pintar el proyector entero, vecindario incluido).
  useEffect(() => {
    if (!soundOn || !state?.timerEndsAt) return undefined;
    const fin = Date.parse(state.timerEndsAt);
    if (!Number.isFinite(fin)) return undefined;
    const id = setInterval(() => {
      const quedan = fin - (Date.now() + connection.clockSkewMs);
      if (quedan > 0 && quedan <= 10_000 && avisoTiempoDe.current !== phase) {
        avisoTiempoDe.current = phase;
        audio.play('timeLow');
      }
    }, 500);
    return () => clearInterval(id);
  }, [connection.clockSkewMs, phase, soundOn, state?.timerEndsAt]);

  // Sin contraseña no hay consola: el proyector es público, los controles no.
  if (!passcode) {
    if (revisando) {
      return (
        <main className="min-h-screen bg-bg-primary text-text-primary flex flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="material-symbols-outlined text-[30px] text-accent-presupuesto animate-spin">
            progress_activity
          </span>
          <span className="font-label-md text-label-md uppercase tracking-wider">
            Revalidando credencial del proyector…
          </span>
          {revisandoLento && (
            <span className="font-label-sm text-label-sm text-text-secondary">
              Está tardando más de lo normal: si no avanza, recarga la página.
            </span>
          )}
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

      {/* Toma de pantalla al abrir una ronda: el salón entero ve el cambio */}
      {toma && (
        <div className="pointer-events-none fixed left-0 right-0 top-24 z-40 flex justify-center px-6 anim-slide-in">
          <div className="w-full max-w-[1100px] rounded-2xl border border-accent-presupuesto/50 bg-bg-surface/95 backdrop-blur px-8 py-5 shadow-2xl flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="font-label-md text-label-md uppercase tracking-[0.35em] text-accent-presupuesto">
              {toma.codigo}
            </span>
            <span className="font-headline-lg text-headline-lg font-bold uppercase tracking-tight text-text-primary">
              {toma.titulo}
            </span>
            <span className="ml-auto font-label-sm text-label-sm uppercase tracking-wider text-text-secondary">
              {toma.sub}
            </span>
          </div>
        </div>
      )}

      {/* Alerta ambiental: tiñe el borde de la pantalla en crisis, sin tapar nada */}
      {isCrisis && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-30 anim-pulse-urgent bg-[radial-gradient(120%_100%_at_50%_50%,transparent_58%,rgba(255,59,78,0.20)_100%)]"
        />
      )}

      <main className="w-full pt-24 pb-16 px-margin-desktop flex-1 flex flex-col gap-4 max-w-[1920px] mx-auto">
        {/* Barra de estado y errores */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border-subtle">
          <div className="flex flex-wrap items-center gap-3 font-label-sm text-label-sm text-text-secondary uppercase">
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-accent-presupuesto">
                sensors
              </span>
              {state ? `SALA ${salaCode(state.gameId)}` : 'SIN PARTIDA ACTIVA'}
            </span>
            {state && (
              <>
                <span className="text-border-subtle">/</span>
                <span>EQUIPOS {state.teams.length}</span>
                <span className="text-border-subtle">/</span>
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px] text-accent-electricidad">
                    bolt
                  </span>
                  CONSUMO DEL AULA{' '}
                  <strong className="text-accent-electricidad">
                    <AnimatedNumber
                      value={consumoTotal}
                      format={(v) => `${formatNumber(v, 2)} kWh`}
                    />
                  </strong>
                </span>
                <span className="text-border-subtle">/</span>
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px] text-accent-presupuesto">
                    account_balance_wallet
                  </span>
                  GASTO ACUMULADO{' '}
                  <strong className="text-accent-presupuesto">
                    <AnimatedNumber value={gastoTotal} format={(v) => `$ ${formatNumber(v, 0)}`} />
                  </strong>
                </span>
                <span className="text-border-subtle">/</span>
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px] text-accent-eficiencia">
                    speed
                  </span>
                  EFICIENCIA MEDIA{' '}
                  <strong className="text-accent-eficiencia">
                    {eficienciaMedia === null ? (
                      '—'
                    ) : (
                      <AnimatedNumber value={eficienciaMedia} format={(v) => `${formatNumber(v, 1)}%`} />
                    )}
                  </strong>
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 font-label-sm text-label-sm">
            <span
              className={`uppercase ${
                connection.status === 'error' ? 'text-accent-gas' : 'text-text-secondary'
              }`}
            >
              {connection.status === 'listo'
                ? realtimeLabel(connection.realtime)
                : connection.status === 'cargando'
                  ? 'BUSCANDO LA PARTIDA…'
                  : connection.status === 'error'
                    ? 'SIN SEÑAL'
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

        {isDevelopment && missingConfig.length > 0 && (
          <div className="rounded-lg border border-accent-gas/40 bg-accent-gas/10 px-4 py-3 font-label-md text-label-md text-text-primary">
            Aviso de desarrollo: falta {missingConfig.join(', ')}.
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
          <section className="relative w-full bg-bg-surface rounded-2xl p-8 lg:p-12 border border-border-subtle flex flex-col items-center gap-8 text-center overflow-hidden shadow-2xl">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_120%_at_50%_-10%,rgba(62,198,240,0.12),transparent_70%)]"
            />
            <div className="relative flex flex-col items-center gap-3 anim-rise">
              <span className="material-symbols-outlined text-[48px] text-accent-presupuesto">bolt</span>
              <h1 className="font-headline-lg text-headline-lg lg:text-headline-xl lg:text-headline-xl font-bold uppercase tracking-tight">
                Monta la partida
              </h1>
              <p className="font-body-md text-body-md text-text-secondary max-w-xl">
                Elige cuántas mesas van a jugar. Cada equipo entra con el código QR y escribe su
                nombre; el caso se reparte por orden de llegada.
              </p>
            </div>

            <div className="relative flex flex-wrap items-center justify-center gap-4">
              {[4, 5, 6].map((count) => (
                <button
                  key={count}
                  type="button"
                  disabled={!montado || busy}
                  onClick={() => void crearPartida(count)}
                  className="anim-tactile w-40 h-32 rounded-2xl bg-primary-container text-on-primary-container hover:opacity-90 active:scale-95 disabled:opacity-50 flex flex-col items-center justify-center gap-1 shadow-[0_12px_32px_rgba(62,198,240,0.18)]"
                >
                  <span className="font-headline-xl text-headline-xl font-bold tabular-nums leading-none">
                    {count}
                  </span>
                  <span className="font-label-sm text-label-sm font-bold uppercase tracking-[0.2em]">
                    mesas
                  </span>
                </button>
              ))}
            </div>

            <p
              className={`relative font-label-sm text-label-sm uppercase tracking-[0.25em] ${
                busy ? 'text-accent-eficiencia anim-pulse-urgent' : 'text-text-secondary'
              }`}
            >
              {!montado
                ? 'Preparando la consola…'
                : busy
                  ? 'Montando la sala…'
                  : 'Elige el tamaño de la partida'}
            </p>

            {connection.error && (
              <p className="relative font-body-sm text-body-sm text-accent-gas">{connection.error}</p>
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
                    <span className="font-label-sm text-label-sm text-text-secondary tracking-[0.3em] uppercase">
                      REGISTRO ABIERTO · RONDA 0 DE 4
                    </span>
                  </div>
                  <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight uppercase font-bold">
                    Que cada mesa entre y ponga su nombre
                  </h1>
                  <p className="font-body-md text-body-md text-text-secondary max-w-2xl">
                    Proyecta el código QR: cada equipo lo escanea, escribe el nombre de su mesa y
                    recibe su instalación con consumos ocultos. Abre la primera ronda cuando estén
                    todas dentro.
                  </p>
                </div>
                <div className="flex items-center gap-5 shrink-0">
                  <div className="text-right">
                    <span className="block font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
                      Mesas dentro
                    </span>
                    <span className="font-headline-xl text-headline-xl font-bold tabular-nums text-text-primary leading-none">
                      {equiposDentro}
                      <span className="text-[22px] text-text-secondary">/{slotsEsperados}</span>
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
                    className={`h-14 px-9 rounded-xl bg-primary-container text-on-primary-container font-label-lg text-label-lg font-bold uppercase tracking-wider shadow-lg hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 anim-tactile ${
                      equiposDentro > 0 && !busy ? 'anim-pulse-urgent' : ''
                    }`}
                  >
                    <span className="material-symbols-outlined text-[22px]">play_arrow</span>
                    <span>{busy ? 'Abriendo…' : 'Iniciar juego'}</span>
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

              {/* Marcador de mesas: se va llenando conforme entran */}
              <section className="flex flex-col gap-4">
                <div className="flex items-center justify-between font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
                  <span>Mesas en la sala</span>
                  <span className="tabular-nums">{equiposDentro} / {slotsEsperados}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 anim-stagger">
                  {Array.from({ length: slotsEsperados }).map((_, index) => {
                    const team = state.teams[index];
                    if (!team) {
                      return (
                        <div
                          key={`libre-${index}`}
                          className="rounded-xl border border-dashed border-border-subtle/80 p-4 min-h-[104px] flex items-center gap-3"
                        >
                          <span className="font-headline-lg text-headline-lg font-bold tabular-nums text-text-secondary/40">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-label-md text-label-md uppercase text-text-secondary">
                              Mesa libre
                            </span>
                            <span className="font-label-sm text-[11px] text-text-secondary/70 uppercase tracking-wider">
                              esperando al equipo…
                            </span>
                          </div>
                        </div>
                      );
                    }
                    const caso = state.cases[team.id];
                    const url = `/play/${team.id}?game=${state.gameId}`;
                    return (
                      <div
                        key={team.id}
                        className="rounded-xl border bg-bg-surface p-4 min-h-[104px] flex flex-col gap-2 shadow-lg"
                        style={{ borderColor: `${team.color}66` }}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0 animate-pulse"
                            style={{ backgroundColor: team.color }}
                          ></span>
                          <span className="font-headline-sm font-bold uppercase truncate">
                            {team.name}
                          </span>
                          <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded bg-accent-eficiencia/15 border border-accent-eficiencia/30 font-label-sm text-[10px] font-bold uppercase text-accent-eficiencia">
                            dentro
                          </span>
                        </div>
                        <span className="font-label-sm text-[11px] text-text-secondary uppercase tracking-wider">
                          Mesa {String(index + 1).padStart(2, '0')} · {caso?.name ?? 'caso pendiente'}
                        </span>
                        <a
                          href={url}
                          className="font-label-sm text-[10px] text-accent-presupuesto break-all hover:underline"
                        >
                          {url}
                        </a>
                      </div>
                    );
                  })}
                </div>
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

            <div className="w-full rounded-2xl border border-border-subtle bg-bg-surface px-5 py-3.5 flex flex-wrap items-center gap-x-6 gap-y-3 shadow-lg">
              <div className="flex items-center gap-3">
                <span
                  className={`px-3 py-1.5 rounded-xl border font-headline-sm font-bold uppercase tracking-wider ${
                    hostPhase === 'crisis'
                      ? 'border-accent-crisis/60 bg-accent-crisis/15 text-accent-crisis anim-pulse-urgent'
                      : 'border-primary-container/40 bg-primary-container/10 text-accent-presupuesto'
                  }`}
                >
                  {rondaActual > 0 ? `Ronda ${rondaActual} de 4` : 'En pista'}
                </span>
                <span className="font-headline-sm font-bold uppercase text-text-primary">
                  {phaseLabel(phase)}
                </span>
              </div>

              <span className="font-body-md text-body-md text-text-secondary">
                {phase === 'investigar'
                  ? 'Las mesas están cazando los consumos ocultos de su instalación.'
                  : phase === 'decidir'
                    ? 'Cada mesa elige cómo usar sus aparatos.'
                    : phase === 'crisis'
                      ? 'El recargo del 30% ya está aplicado sobre el consumo acumulado.'
                      : phase === 'decidir_2'
                        ? 'Últimas decisiones: la red no perdona dos veces.'
                        : 'La sala está en marcha.'}
              </span>

              <div className="ml-auto flex items-center gap-5 font-label-sm text-label-sm uppercase tracking-wider text-text-secondary">
                {prefijoRonda && (
                  <span>
                    MESAS QUE YA DECIDIERON{' '}
                    <strong className="text-text-primary tabular-nums">
                      {mesasQueDecidieron}/{state.teams.length}
                    </strong>
                  </span>
                )}
                <span>
                  DECISIONES{' '}
                  <strong className="text-text-primary">
                    <AnimatedNumber value={decisionesTotales} />
                  </strong>
                </span>
                <span>
                  EFICIENCIA MEDIA{' '}
                  <strong className="text-accent-eficiencia">
                    {eficienciaMedia === null ? (
                      '—'
                    ) : (
                      <AnimatedNumber value={eficienciaMedia} format={(v) => `${formatNumber(v, 1)}%`} />
                    )}
                  </strong>
                </span>
              </div>

              {prefijoRonda && state.teams.length > 0 && (
                <div className="w-full h-1.5 rounded-full bg-surface-container-highest overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent-eficiencia transition-[width] duration-700 ease-out"
                    style={{ width: `${(mesasQueDecidieron / state.teams.length) * 100}%` }}
                  />
                </div>
              )}
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

            {/* Instrumentos: carga de la red y lo que va pasando en el aula */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] gap-4 items-stretch">
              <GridMeter
                cargaPct={cargaLineaPct}
                isCrisis={hostPhase === 'crisis'}
                className="h-[196px]"
              />
              <DecisionFeed eventos={feed} className="h-[196px]" />
            </div>

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
                    trend={trends.get(team.id) ?? 'flat'}
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
          <div className="relative flex flex-col gap-8 w-full">
            <PodiumBurst active className="rounded-2xl" />
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
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-md items-end anim-stagger">
                  {[1, 0, 2].map((position, column) => {
                    const entry = state.results!.ranking[position];
                    if (!entry) return <div key={`vacio-${position}`} className="lg:col-span-4" />;
                    return (
                      <div
                        key={entry.team.id}
                        className={`lg:col-span-4 anim-reveal ${column === 1 ? 'order-1 lg:order-2 lg:-translate-y-4' : column === 0 ? 'order-2 lg:order-1' : 'order-3'}`}
                        style={{ animationDelay: `${column * 220}ms` }}
                      >
                        <TeamCard
                          team={entry.team}
                          rank={entry.rank}
                          variant="podium"
                          isLeader={entry.rank === 1}
                        />
                        <p className="mt-2 font-label-sm text-label-sm text-text-secondary text-center tabular-nums">
                          {formatNumber(entry.team.electricidad, 2)} kWh ·{' '}
                          {formatNumber(entry.team.gas, 2)} m³ · ${' '}
                          {formatNumber(entry.team.presupuesto, 0)} · {entry.team.eficiencia}%
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
                              {formatNumber(entry.team.electricidad, 2)} kWh
                            </strong>
                          </span>
                          <span>
                            GAS{' '}
                            <strong className="text-text-primary tabular-nums">
                              {formatNumber(entry.team.gas, 2)} m³
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
            <span>{state ? `SALA ${salaCode(state.gameId)}` : 'SIN SALA'}</span>
            <span className="text-border-subtle">/</span>
            <span>4 RONDAS · LA RED ES DE TODOS</span>
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
