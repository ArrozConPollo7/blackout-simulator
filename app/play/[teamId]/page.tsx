'use client';

/**
 * Vista Player (un celular por equipo, sin WebGL).
 *
 * Reglas que esta vista NO rompe:
 *  1. El centro de control es la única fuente de verdad: la selección se marca al
 *     instante, pero el EFECTO de una decisión solo se numera cuando llega la respuesta.
 *  2. Cero datos inventados: cada número sale de `team`, `answered`, `results` o `remaining`.
 *  3. El cronómetro vive en su propio subárbol (`HeaderTimer`): su tic de 250 ms ya no
 *     repinta la lista de decisiones (antes arrastraba toda la página).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AnimatedNumber from '@/components/play/AnimatedNumber';
import Celebration from '@/components/play/Celebration';
import ChoiceButton from '@/components/play/ChoiceButton';
import Countdown from '@/components/play/Countdown';
import EffectChips from '@/components/play/EffectChips';
import HeaderTimer from '@/components/play/HeaderTimer';
import PhaseBanner from '@/components/play/PhaseBanner';
import RoundProgress from '@/components/play/RoundProgress';
import SoundToggle from '@/components/SoundToggle';
import { hapticConfirm, hapticDeny, hapticTap } from '@/components/play/haptics';
import { APPLIANCE_BY_ID, ROUND2B_SCENARIOS, ROUND2_SCENARIOS } from '@/content/decisions';
import { PRESUPUESTO_INICIAL } from '@/content/economy';
import type { ApplianceProfile, DecisionScenario } from '@/content/decisions';
import type { TeamResult } from '@/engine/results';
import type { DecisionEffect, TeamState } from '@/types/game';
import type { GameStateResponse } from '@/types/api';
import { ApiClientError, api } from '@/lib/api';
import { useAudioEvent } from '@/lib/audio';
import { missingConfig } from '@/lib/env';
import { resolveGameId } from '@/lib/game-store';
import { useGameState } from '@/lib/useGameState';
import {
  CONFORT_LABEL,
  CONSUMO_LABEL,
  dinero,
  formatNumber,
  impactHint,
  kwh,
  m3,
  realtimeIcon,
  realtimeLabel,
} from '@/lib/ui';

type Ronda = 'investigar' | 'decidir' | 'decidir_2';

interface Feedback {
  text: string;
  effect: DecisionEffect;
  scenarioKey: string;
}

/** Última selección y su desenlace: pinta la tarjeta elegida hasta que la vista avanza. */
interface ChoiceFeedback {
  scenarioKey: string;
  optionId: string;
  status: 'ok' | 'rejected';
  nonce: number;
  reason: string;
}

/** La confirmación se queda en pantalla lo justo para leerse y luego avanza sola. */
const CONFIRM_HOLD_MS = 1050;
const REJECT_HOLD_MS = 1800;

/**
 * ¿Quedó la ronda de decisiones sin situaciones pendientes? Se usa solo para elegir el
 * sonido (acorde de resolución en vez de confirmación): la verdad sigue siendo del centro
 * de control.
 */
function rondaCompleta(
  state: GameStateResponse,
  round: 'decidir' | 'decidir_2',
  teamId: string,
): boolean {
  const escenarios = round === 'decidir_2' ? ROUND2B_SCENARIOS : ROUND2_SCENARIOS;
  if (escenarios.length === 0) return false;
  const contestadas = state.answered[teamId] ?? [];
  return escenarios.every((escenario) =>
    contestadas.includes(round === 'decidir_2' ? 'r2b' : `r2:${escenario.id}`),
  );
}

/** Rechazo del motor en lenguaje de juego: nunca se muestra texto técnico al jugador. */
function mensajeJugador(error: unknown): string {
  if (error instanceof ApiClientError) {
    switch (error.code) {
      case 'timeout':
      case 'network':
        return 'Sin señal: no llegó la respuesta. Vuelve a tocar tu opción.';
      case 'wrong_phase':
        return 'La ronda ya cambió: espera la próxima lectura del Host.';
      case 'already_decided':
        return 'Esa situación ya quedó registrada.';
      default:
        return 'La jugada no se pudo registrar. Toca otra vez.';
    }
  }
  return 'La jugada no se pudo registrar. Toca otra vez.';
}

export default function PlayerPage({ params }: { params: { teamId: string } }) {
  const teamId = params.teamId;
  const [gameId, setGameId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [choice, setChoice] = useState<ChoiceFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Cada fallo sube el contador: así la sacudida del aviso se repite aunque el texto sea igual. */
  const [errorNonce, setErrorNonce] = useState(0);
  const [openAppliance, setOpenAppliance] = useState<string | null>(null);
  /** Sube con cada decisión confirmada: da el golpe visual a la barra de ronda. */
  const [pulsoRonda, setPulsoRonda] = useState(0);

  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get('game');
    setGameId(resolveGameId(url));
  }, []);

  const connection = useGameState(gameId);
  const state = connection.state;
  const team = state?.teams.find((t) => t.id === teamId) ?? null;
  const caso = state?.cases[teamId] ?? null;
  const answered = state?.answered[teamId] ?? [];
  const phase = state?.phase;

  const playEvent = useAudioEvent();
  const lastPhaseRef = useRef<string | null>(null);
  const lastTelemetryRef = useRef(0);
  const nonceRef = useRef(0);

  // Cambio de fase: relé al abrir ronda, alarma al entrar en crisis, fanfarria al cerrar.
  useEffect(() => {
    if (!phase || lastPhaseRef.current === phase) return;
    const previous = lastPhaseRef.current;
    lastPhaseRef.current = phase;
    if (previous === null) return; // primera carga: nadie ha pedido sonido todavía
    if (phase === 'crisis') playEvent('crisis');
    else if (phase === 'resultados') playEvent('podium');
    else playEvent('phase');
  }, [phase, playEvent]);

  // Blip de telemetría al sincronizar, con freno para no ser un metrónomo.
  const lastSyncAt = connection.lastSyncAt;
  useEffect(() => {
    if (!lastSyncAt) return;
    const now = Date.now();
    if (now - lastTelemetryRef.current < 20000) return;
    lastTelemetryRef.current = now;
    playEvent('telemetry');
  }, [lastSyncAt, playEvent]);

  // La marca de la última elección se limpia sola: confirmada (avanza la ronda)
  // o rechazada (vuelve a quedar elegible).
  useEffect(() => {
    if (!choice) return;
    const ms = choice.status === 'ok' ? CONFIRM_HOLD_MS : REJECT_HOLD_MS;
    const id = setTimeout(() => {
      setChoice((actual) => (actual && actual.nonce === choice.nonce ? null : actual));
    }, ms);
    return () => clearTimeout(id);
  }, [choice]);

  const decidir = async (optionId: string, scenarioKey: string, round: Ronda) => {
    if (!state) return;
    // Marca instantánea: la tarjeta se pinta elegida en el mismo frame del toque.
    setPending(optionId);
    setChoice(null);
    setError(null);
    try {
      const respuesta = await api.sendDecision(state.gameId, { teamId, round, optionId });
      // Solo después de la respuesta del centro de control se muestran los números del efecto.
      setFeedback({ text: respuesta.feedback, effect: respuesta.effect, scenarioKey });
      connection.applyState(respuesta.state);
      setOpenAppliance(null);
      nonceRef.current += 1;
      setChoice({ scenarioKey, optionId, status: 'ok', nonce: nonceRef.current, reason: '' });
      setPulsoRonda((n) => n + 1);
      hapticConfirm();
      // Confirmación; si con esta decisión queda la ronda completa, acorde de resolución.
      const completa = round !== 'investigar' && rondaCompleta(respuesta.state, round, teamId);
      playEvent(completa ? 'resolve' : 'confirm');
    } catch (cause) {
      playEvent('deny');
      hapticDeny();
      const motivo = mensajeJugador(cause);
      setError(motivo);
      setErrorNonce((n) => n + 1);
      nonceRef.current += 1;
      setChoice({
        scenarioKey,
        optionId,
        status: 'rejected',
        nonce: nonceRef.current,
        reason: motivo,
      });
    } finally {
      setPending(null);
    }
  };

  // Callbacks estables: los botones de opción no se repintan si su estado no cambió.
  const decidirRef = useRef(decidir);
  const openRef = useRef(openAppliance);
  useEffect(() => {
    decidirRef.current = decidir;
    openRef.current = openAppliance;
  });

  const onDecideEscenario = useCallback((optionId: string, scenarioKey: string, round: Ronda) => {
    void decidirRef.current(optionId, scenarioKey, round);
  }, []);

  const onDecideAparato = useCallback((optionId: string) => {
    const abierto = openRef.current;
    if (!abierto) return;
    void decidirRef.current(optionId, `r1:${abierto}`, 'investigar');
  }, []);

  const appliances = useMemo(
    () =>
      (caso?.appliances ?? [])
        .map((id) => APPLIANCE_BY_ID[id])
        .filter((a): a is ApplianceProfile => Boolean(a)),
    [caso],
  );

  /** Progreso de la ronda activa, contado desde `answered` (verdad del centro de control). */
  const progreso = useMemo(() => {
    if (!state || !phase) return null;
    if (phase === 'investigar') {
      const ids = caso?.appliances ?? [];
      if (ids.length === 0) return null;
      return {
        etiqueta: 'Aparatos auditados',
        total: ids.length,
        resolved: ids.filter((id) => answered.includes(`r1:${id}`)).length,
        tono: 'electricidad' as const,
      };
    }
    if (phase === 'decidir') {
      return {
        etiqueta: 'Situaciones resueltas',
        total: ROUND2_SCENARIOS.length,
        resolved: ROUND2_SCENARIOS.filter((s) => answered.includes(`r2:${s.id}`)).length,
        tono: 'eficiencia' as const,
      };
    }
    if (phase === 'decidir_2') {
      return {
        etiqueta: 'Decisión bajo tarifa nueva',
        total: ROUND2B_SCENARIOS.length,
        resolved: ROUND2B_SCENARIOS.filter((s) => answered.includes('r2b')).length,
        tono: 'eficiencia' as const,
      };
    }
    return null;
  }, [state, phase, caso, answered]);

  /** Escenario ya resuelto que sigue en pantalla mientras se lee la confirmación. */
  const hold = useMemo(
    () => (choice && choice.status === 'ok' ? { scenarioKey: choice.scenarioKey, optionId: choice.optionId } : null),
    [choice],
  );

  const escenariosRonda2 = phase === 'decidir_2' ? ROUND2B_SCENARIOS : ROUND2_SCENARIOS;
  const rondaActual: Ronda | null =
    phase === 'investigar' ? 'investigar' : phase === 'decidir' ? 'decidir' : phase === 'decidir_2' ? 'decidir_2' : null;

  const avisoSenal =
    connection.status === 'error' || connection.realtime === 'error'
      ? 'SIN SEÑAL'
      : connection.realtime === 'conectando' && state
        ? 'RECONECTANDO…'
        : null;

  if (!gameId) {
    return (
      <Marco>
        <Panel titulo="Falta el enlace de la partida" icono="link_off">
          Pide al Host el enlace de tu equipo: tiene la forma{' '}
          <code className="text-accent-presupuesto">/play/&lt;equipo&gt;?game=&lt;partida&gt;</code>.
        </Panel>
      </Marco>
    );
  }

  if (connection.status === 'cargando' && !state) {
    return (
      <Marco>
        <Panel titulo="Sincronizando lecturas…" icono="sync">
          <span className="flex items-center gap-2">
            Estamos abriendo tu caso. Un instante.
            <span className="anim-dots flex gap-0.5" aria-hidden>
              <span className="w-1 h-1 rounded-full bg-text-secondary" />
              <span className="w-1 h-1 rounded-full bg-text-secondary" />
              <span className="w-1 h-1 rounded-full bg-text-secondary" />
            </span>
          </span>
        </Panel>
      </Marco>
    );
  }

  if (connection.status === 'error' && !state) {
    const sinPartida = /no encontramos|not_found|404/i.test(connection.error ?? '');
    return (
      <Marco>
        <Panel titulo={sinPartida ? 'No encontramos la partida' : 'Sin señal'} icono={sinPartida ? 'search_off' : 'wifi_off'}>
          {sinPartida
            ? 'Este enlace no corresponde a ninguna partida abierta. Pídeselo otra vez a quien monta el juego.'
            : 'No hay enlace con el centro de control. Acércate al Host y vuelve a cargar.'}
        </Panel>
      </Marco>
    );
  }

  if (state && !team) {
    return (
      <Marco>
        <Panel titulo="Equipo no encontrado" icono="person_off">
          El enlace apunta a un equipo que no pertenece a esta partida.
        </Panel>
      </Marco>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary flex flex-col items-center">
      <PhaseBanner phase={phase} />

      <div className="w-full max-w-md min-h-screen flex flex-col bg-bg-primary relative pb-20">
        {/* HEADER MÓVIL */}
        <header className="fixed top-0 max-w-md w-full z-50 bg-bg-surface/95 backdrop-blur-xl border-b border-border-subtle shadow-md">
          <div className="px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full animate-pulse shrink-0"
                  style={{ backgroundColor: team?.color ?? '#8792A8' }}
                ></span>
                <span className="font-label-md text-label-md uppercase tracking-wider text-text-primary font-bold truncate">
                  {team?.name ?? 'Equipo'}
                </span>
                <span className="font-body-sm text-body-sm text-text-secondary truncate hidden min-[400px]:inline">
                  · {caso?.name ?? 'sin caso'}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <HeaderTimer
                  phase={phase}
                  timerEndsAt={state?.timerEndsAt}
                  clockSkewMs={connection.clockSkewMs}
                />
                <SoundToggle className="shrink-0" />
                <span
                  className="material-symbols-outlined text-[18px] text-text-secondary"
                  title={realtimeLabel(connection.realtime)}
                >
                  {realtimeIcon(connection.realtime)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1.5 pt-0.5 anim-stagger">
              <Badge
                icono="bolt"
                etiqueta="Elec"
                color="text-accent-electricidad"
                valor={team ? `${formatNumber(team.electricidad, team.electricidad >= 100 ? 0 : 1)} kWh` : '—'}
                numero={team?.electricidad}
                formato={(valor) => `${formatNumber(valor, valor >= 100 ? 0 : 1)} kWh`}
              />
              <Badge
                icono="local_fire_department"
                etiqueta="Gas"
                color="text-accent-gas"
                valor={team ? `${formatNumber(team.gas, team.gas >= 100 ? 0 : 1)} m³` : '—'}
                numero={team?.gas}
                formato={(valor) => `${formatNumber(valor, valor >= 100 ? 0 : 1)} m³`}
              />
              <Badge
                icono="account_balance_wallet"
                etiqueta="Ppto"
                color="text-accent-presupuesto"
                valor={team ? `$ ${Math.round(team.presupuesto / 1000)}k` : '—'}
                numero={team?.presupuesto}
                formato={(valor) => `$ ${Math.round(valor / 1000)}k`}
              />
              <Badge
                icono="speed"
                etiqueta="Efic"
                color="text-accent-eficiencia"
                valor={team ? `${formatNumber(team.eficiencia, 0)}%` : '—'}
                numero={team?.eficiencia}
                formato={(valor) => `${formatNumber(valor, 0)}%`}
              />
            </div>

            {avisoSenal && (
              <span className="self-start rounded bg-accent-crisis/20 px-1.5 py-0.5 font-label-sm text-[9px] font-bold uppercase tracking-wider text-accent-crisis anim-fade">
                {avisoSenal}
              </span>
            )}
          </div>
        </header>

        <main className="w-full pt-28 px-4 flex-1 flex flex-col gap-4">
          {missingConfig.length > 0 && (
            <p className="rounded-lg border border-accent-gas/40 bg-accent-gas/10 px-3 py-2 font-label-sm text-label-sm">
              Sin enlace directo con la sala: los marcadores se actualizan cada pocos segundos.
            </p>
          )}
          {error && (
            <p
              key={errorNonce}
              className="rounded-lg border border-accent-crisis/50 bg-accent-crisis/10 px-3 py-2 font-label-sm text-label-sm anim-shake"
            >
              {error}
            </p>
          )}

          {/* PROGRESO DE LA RONDA ACTIVA */}
          {progreso && (
            <div className="sticky top-[96px] z-30">
              <RoundProgress
                etiqueta={progreso.etiqueta}
                resolved={progreso.resolved}
                total={progreso.total}
                tono={progreso.tono}
                pulso={pulsoRonda}
              />
            </div>
          )}

          {/* LOBBY */}
          {phase === 'lobby' && (
            <Panel titulo="Esperando al Host" icono="hourglass_top">
              La partida está en el lobby. Cuando el Host abra la investigación aparecerán los
              aparatos de tu caso: <strong className="text-text-primary">{caso?.name}</strong>.
              <span className="mt-3 block font-label-sm text-label-sm text-text-secondary">
                {caso ? `${caso.appliances.length} aparatos · ${caso.hiddenProblems.length} consumos ocultos` : ''}
              </span>
            </Panel>
          )}

          {/* RONDA 1 — INVESTIGAR */}
          {rondaActual === 'investigar' && (
            <div className="flex flex-col gap-4 anim-fade">
              <Encabezado
                titulo="Auditoría de aparatos"
                ayuda="Toca un aparato para ver su ficha técnica y decidir qué hacer con su consumo."
              />

              <div className="grid grid-cols-2 gap-3 anim-stagger">
                {appliances.map((app) => {
                  const yaResuelto = answered.includes(`r1:${app.id}`);
                  const abierto = openAppliance === app.id;
                  return (
                    <button
                      key={app.id}
                      type="button"
                      onClick={() => {
                        playEvent('click');
                        hapticTap();
                        setOpenAppliance(abierto ? null : app.id);
                      }}
                      className={`relative p-3 rounded-xl bg-bg-surface border text-left flex flex-col justify-between min-h-[104px] anim-tactile ${
                        abierto
                          ? 'border-accent-presupuesto ring-1 ring-accent-presupuesto'
                          : yaResuelto
                            ? 'border-accent-eficiencia/40'
                            : 'border-border-subtle'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="material-symbols-outlined text-[24px] text-accent-presupuesto">
                          {app.icon}
                        </span>
                        {yaResuelto && (
                          <span className="anim-pop text-[9px] px-1.5 py-0.5 rounded bg-accent-eficiencia/20 text-accent-eficiencia font-bold uppercase">
                            REVISADO
                          </span>
                        )}
                      </div>
                      <div>
                        <h4 className="font-label-md text-label-md font-bold text-text-primary leading-tight">
                          {app.name}
                        </h4>
                        <span className="font-label-sm text-[11px] text-accent-electricidad block font-semibold tabular-nums mt-0.5">
                          {app.consumoText}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {openAppliance && (
                <FichaAparato
                  app={APPLIANCE_BY_ID[openAppliance]}
                  answered={answered.includes(`r1:${openAppliance}`)}
                  pending={pending}
                  confirmada={hold?.scenarioKey === `r1:${openAppliance}` ? hold.optionId : null}
                  rechazo={
                    choice?.status === 'rejected' && choice.scenarioKey === `r1:${openAppliance}`
                      ? { optionId: choice.optionId, reason: choice.reason }
                      : null
                  }
                  efecto={
                    feedback?.scenarioKey === `r1:${openAppliance}` ? feedback.effect : null
                  }
                  onDecide={onDecideAparato}
                />
              )}

              {feedback?.scenarioKey.startsWith('r1:') && (
                <FeedbackCard key={`${feedback.scenarioKey}:${feedback.text}`} feedback={feedback} />
              )}
            </div>
          )}

          {/* RONDA 2 Y 2b — DECIDIR */}
          {(rondaActual === 'decidir' || rondaActual === 'decidir_2') && (
            <div className="flex flex-col gap-4 anim-fade">
              <Encabezado
                titulo={rondaActual === 'decidir_2' ? 'Últimas decisiones bajo crisis' : 'Situaciones del día'}
                ayuda="Cada situación tiene tres opciones: la tuya se marca al tocar y el marcador se actualiza al confirmar."
              />
              <ListaEscenarios
                escenarios={escenariosRonda2}
                answered={answered}
                pending={pending}
                round={rondaActual}
                hold={hold}
                rechazo={choice?.status === 'rejected' ? choice : null}
                efectoConfirmado={feedback?.effect ?? null}
                onDecide={onDecideEscenario}
              />
              {feedback && !feedback.scenarioKey.startsWith('r1:') && (
                <FeedbackCard key={`${feedback.scenarioKey}:${feedback.text}`} feedback={feedback} />
              )}
            </div>
          )}

          {/* CRISIS */}
          {phase === 'crisis' && (
            <div className="flex flex-col gap-4 anim-fade">
              <div className="relative overflow-hidden rounded-xl bg-error-container/30 p-4 shadow-xl border border-accent-crisis anim-glitch anim-scanline">
                <div className="relative z-10 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded bg-accent-crisis text-white font-label-sm text-label-sm font-bold uppercase tracking-wider anim-pulse-urgent">
                      ¡ALERTA DE CRISIS!
                    </span>
                    <Countdown
                      phase={phase}
                      timerEndsAt={state?.timerEndsAt}
                      clockSkewMs={connection.clockSkewMs}
                      className="font-label-md text-label-md text-accent-crisis font-bold tabular-nums"
                    />
                  </div>
                  <h1 className="font-headline-md text-headline-md text-text-primary uppercase font-bold tracking-tight anim-flicker">
                    El precio de la electricidad subió 30%
                  </h1>
                  <p className="font-body-sm text-body-sm text-text-secondary">
                    El recargo ya se aplicó sobre tu consumo acumulado: pagas 30% más por cada kWh que
                    llevas consumido. Las últimas decisiones abren en un momento.
                  </p>
                </div>
              </div>
              {feedback && <FeedbackCard feedback={feedback} />}
            </div>
          )}

          {/* RESULTADOS */}
          {phase === 'resultados' && state && team && (
            <Resultados
              team={team}
              fila={state.results?.ranking.find((r) => r.team.id === team.id) ?? null}
              total={state.results?.ranking.length ?? null}
              promedioEficiencia={state.results?.promedioEficiencia ?? null}
              promedioConsumo={state.results?.promedioConsumoElectrico ?? null}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-md flex flex-col gap-4">{children}</div>
    </div>
  );
}

function Panel({
  titulo,
  icono,
  children,
}: {
  titulo: string;
  icono: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-bg-surface border border-border-subtle p-5 flex flex-col gap-3 anim-rise">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[22px] text-accent-presupuesto">{icono}</span>
        <h1 className="font-headline-md text-headline-md font-bold uppercase tracking-tight">
          {titulo}
        </h1>
      </div>
      <div className="font-body-sm text-body-sm text-text-secondary">{children}</div>
    </section>
  );
}

function Badge({
  icono,
  etiqueta,
  valor,
  color,
  numero,
  formato,
  duration = 420,
}: {
  icono: string;
  etiqueta: string;
  valor: string;
  color: string;
  /** Número real del KPI: si llega, el valor se anima en vez de saltar. */
  numero?: number;
  formato?: (value: number) => string;
  /** Duración del contador: breve, la cabecera se lee de reojo. */
  duration?: number;
}) {
  /**
   * El ícono da un golpe cada vez que el número cambia, para que la mesa vea de reojo
   * que su decisión movió el marcador.
   */
  const [golpe, setGolpe] = useState(0);
  const previo = useRef<number | undefined>(numero);
  const primera = useRef(true);

  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      previo.current = numero;
      return;
    }
    if (numero !== undefined && previo.current !== undefined && numero !== previo.current) {
      setGolpe((n) => n + 1);
    }
    previo.current = numero;
  }, [numero]);

  return (
    <div className="flex flex-col gap-0.5 px-1.5 py-1 rounded bg-bg-primary/80 border border-border-subtle min-w-0">
      {/* Icono y rótulo comparten renglón para que el número use todo el ancho: en un
          celular de 360 px el icono al lado dejaba 36 px al valor y cortaba «100 kWh». */}
      <span className="flex items-center gap-1 min-w-0">
        <span
          key={golpe}
          className={`material-symbols-outlined ${color} text-[12px] ${golpe > 0 ? 'anim-icon-kick' : ''}`}
        >
          {icono}
        </span>
        <span className="font-label-sm text-[9px] text-text-secondary uppercase leading-none truncate">
          {etiqueta}
        </span>
      </span>
      <span className="font-label-sm text-[12px] text-text-primary font-bold leading-tight tabular-nums whitespace-nowrap">
        {numero !== undefined && formato ? (
          <AnimatedNumber value={numero} format={formato} duration={duration} />
        ) : (
          valor
        )}
      </span>
    </div>
  );
}

function Encabezado({ titulo, ayuda }: { titulo: string; ayuda: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-3.5 rounded-full bg-primary-container"></span>
        <h2 className="font-headline-md text-headline-md tracking-tight text-text-primary font-bold">
          {titulo}
        </h2>
      </div>
      <p className="font-body-sm text-body-sm text-text-secondary pl-3">{ayuda}</p>
    </div>
  );
}

function FeedbackCard({ feedback }: { feedback: Feedback }) {
  return (
    <section className="rounded-xl border border-accent-eficiencia/40 bg-accent-eficiencia/10 p-4 flex flex-col gap-2 anim-slide-in anim-flash-ok">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[20px] text-accent-eficiencia">
          check_circle
        </span>
        <h3 className="font-label-md text-label-md font-bold uppercase text-text-primary">
          Decisión registrada
        </h3>
      </div>
      <p className="font-body-md text-body-md text-text-primary">{feedback.text}</p>
      <EffectChips effect={feedback.effect} />
    </section>
  );
}

function FichaAparato({
  app,
  answered,
  pending,
  confirmada,
  rechazo,
  efecto,
  onDecide,
}: {
  app: ApplianceProfile;
  answered: boolean;
  pending: string | null;
  /** Opción que el centro de control ya confirmó para este aparato. */
  confirmada: string | null;
  /** Rechazo del motor para este aparato, con su motivo. */
  rechazo: { optionId: string; reason: string } | null;
  /** Efecto ya resuelto (solo se numera cuando llegó la respuesta). */
  efecto: DecisionEffect | null;
  onDecide: (optionId: string) => void;
}) {
  const bloqueada = confirmada !== null;

  return (
    <section className="rounded-xl bg-surface-container border border-border-subtle shadow-xl flex flex-col gap-3 p-4 anim-slide-in">
      <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-accent-presupuesto">
            {app.icon}
          </span>
          <h3 className="font-headline-sm font-bold text-text-primary">{app.name}</h3>
        </div>
        <span className="font-label-sm text-label-sm text-text-secondary uppercase">
          {app.category}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 font-label-sm">
        <Dato etiqueta="Potencia" valor={app.potenciaText} color="text-accent-electricidad" />
        <Dato etiqueta="Uso" valor={app.usoText} color="text-text-primary" />
        <Dato etiqueta="Consumo" valor={app.consumoText} color="text-accent-electricidad" />
        <Dato
          etiqueta="Costo estimado"
          valor={dinero(app.referencia.electricidad * 550 + app.referencia.gas * 450)}
          color="text-accent-presupuesto"
        />
      </div>

      <p className="font-body-sm text-body-sm text-text-secondary">
        Situación actual: <strong className="text-text-primary">{app.problemaOculto}</strong>
      </p>

      {answered && !bloqueada ? (
        <p className="font-label-md text-label-md text-accent-eficiencia uppercase">
          Este aparato ya fue atendido.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5 anim-stagger">
          <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
            ¿Qué hace tu equipo con este aparato?
          </span>
          {app.options.map((option, i) => (
            <ChoiceButton
              key={option.id}
              optionId={option.id}
              label={option.label}
              consumo={CONSUMO_LABEL[impactHint(option.effect).consumo]}
              ahorra={impactHint(option.effect).consumo !== 'igual'}
              confort={option.effect.eficiencia ? CONFORT_LABEL[impactHint(option.effect).confort] : undefined}
              index={i}
              state={
                pending === option.id
                  ? 'sending'
                  : confirmada === option.id
                    ? 'confirmed'
                    : rechazo?.optionId === option.id
                      ? 'rejected'
                      : pending !== null || bloqueada
                        ? 'muted'
                        : 'idle'
              }
              disabled={pending !== null || bloqueada}
              reason={rechazo?.optionId === option.id ? rechazo.reason : null}
              effect={confirmada === option.id ? efecto : null}
              onSelect={onDecide}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function Dato({
  etiqueta,
  valor,
  color,
  numero,
  formato,
  contarDesdeCero = false,
}: {
  etiqueta: string;
  valor: string;
  color: string;
  /** Número real: si llega, se anima al aparecer (contador incremental). */
  numero?: number;
  formato?: (value: number) => string;
  /** Revelado contando desde cero (pantalla de resultados). */
  contarDesdeCero?: boolean;
}) {
  return (
    <div className="bg-surface-container-lowest p-2 rounded">
      <span className="text-text-secondary text-[10px] uppercase block">{etiqueta}</span>
      <span className={`font-bold tabular-nums ${color}`}>
        {numero !== undefined && formato ? (
          <AnimatedNumber value={numero} format={formato} contarDesdeCero={contarDesdeCero} />
        ) : (
          valor
        )}
      </span>
    </div>
  );
}

function ListaEscenarios({
  escenarios,
  answered,
  pending,
  round,
  hold,
  rechazo,
  efectoConfirmado,
  onDecide,
}: {
  escenarios: DecisionScenario[];
  answered: string[];
  pending: string | null;
  round: 'decidir' | 'decidir_2';
  /** Escenario ya resuelto que sigue en pantalla mientras se lee la confirmación. */
  hold: { scenarioKey: string; optionId: string } | null;
  rechazo: { scenarioKey: string; optionId: string; reason: string } | null;
  /** Efecto ya resuelto para la tarjeta confirmada (nunca se adivina). */
  efectoConfirmado: DecisionEffect | null;
  onDecide: (optionId: string, scenarioKey: string, round: 'decidir' | 'decidir_2') => void;
}) {
  const clave = (id: string) => (round === 'decidir_2' ? 'r2b' : `r2:${id}`);
  const total = escenarios.length;
  const pendientes = escenarios.filter((escenario) => !answered.includes(clave(escenario.id)));
  const resueltos = total - pendientes.length;
  const enEspera = hold ? escenarios.find((e) => clave(e.id) === hold.scenarioKey) ?? null : null;
  const visible = enEspera ?? pendientes[0] ?? null;
  const claveVisible = visible ? clave(visible.id) : null;

  // Callback estable por situación: las tarjetas memoizadas no se repintan de más.
  const seleccionar = useCallback(
    (optionId: string) => {
      if (claveVisible) onDecide(optionId, claveVisible, round);
    },
    [claveVisible, onDecide, round],
  );

  if (total === 0) {
    return <p className="font-body-md text-body-md text-text-secondary">Sin situaciones pendientes.</p>;
  }

  if (!visible || !claveVisible) {
    return (
      <Panel titulo="Ronda completa" icono="check_circle">
        Ya decidiste todas las situaciones de esta ronda. Espera al Host para el siguiente paso.
      </Panel>
    );
  }

  const confirmada = hold?.scenarioKey === claveVisible ? hold.optionId : null;
  const rechazadoId = rechazo?.scenarioKey === claveVisible ? rechazo.optionId : null;
  const bloqueada = confirmada !== null || enEspera !== null;
  // Durante la confirmación la situación ya cuenta como resuelta: muestra su propio número.
  const numero = enEspera ? Math.max(1, resueltos) : resueltos + 1;

  return (
    <div className="flex flex-col gap-4">
      <div key={visible.id} className="flex flex-col gap-3 anim-rise">
        <section className="flex flex-col gap-2 p-4 rounded-xl bg-bg-surface border border-border-subtle shadow-md">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-container-high w-fit">
            <span className="material-symbols-outlined text-[14px] text-accent-electricidad">
              {visible.icon}
            </span>
            <span className="font-label-sm text-label-sm text-text-secondary uppercase">
              SITUACIÓN {numero} DE {total}
            </span>
          </div>
          <h2 className="font-headline-md text-headline-md text-text-primary tracking-tight font-bold">
            {visible.title}
          </h2>
          <p className="font-body-sm text-body-sm text-text-secondary">{visible.prompt}</p>
        </section>

        <div className="flex flex-col gap-3 anim-stagger">
          {visible.options.map((option, i) => (
            <ChoiceButton
              key={option.id}
              optionId={option.id}
              label={option.label}
              consumo={CONSUMO_LABEL[impactHint(option.effect).consumo]}
              ahorra={impactHint(option.effect).consumo !== 'igual'}
              confort={option.effect.eficiencia ? CONFORT_LABEL[impactHint(option.effect).confort] : undefined}
              index={i}
              state={
                pending === option.id
                  ? 'sending'
                  : confirmada === option.id
                    ? 'confirmed'
                    : rechazadoId === option.id
                      ? 'rejected'
                      : pending !== null || bloqueada
                        ? 'muted'
                        : 'idle'
              }
              disabled={pending !== null || bloqueada}
              reason={rechazadoId === option.id ? rechazo?.reason ?? null : null}
              effect={confirmada === option.id ? efectoConfirmado : null}
              onSelect={seleccionar}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function BarraComparacion({
  etiqueta,
  valor,
  pct,
  color,
}: {
  etiqueta: string;
  valor: number | null;
  /** Proporción real frente al máximo de las dos barras (0-1). */
  pct: number;
  color: string;
}) {
  const seguro = Math.max(0, Math.min(1, Number.isFinite(pct) ? pct : 0));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between font-label-sm text-[10px] uppercase tracking-wider">
        <span className="text-text-secondary">{etiqueta}</span>
        <span className="text-text-primary font-bold tabular-nums">
          {valor === null ? '—' : <AnimatedNumber value={valor} format={kwh} duration={760} contarDesdeCero />}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full border border-border-subtle bg-bg-primary">
        <div
          className={`h-full origin-left rounded-full anim-bar ${color}`}
          style={{ width: `${seguro * 100}%` }}
        />
      </div>
    </div>
  );
}

function Resultados({
  team,
  fila,
  total,
  promedioEficiencia,
  promedioConsumo,
}: {
  team: TeamState;
  fila: TeamResult | null;
  total: number | null;
  promedioEficiencia: number | null;
  promedioConsumo: number | null;
}) {
  const puesto = fila?.rank ?? null;
  const puntos = fila?.puntos ?? team.puntos;
  const mejorQuePromedio = promedioConsumo !== null && team.electricidad <= promedioConsumo;
  const campeon = puesto === 1;
  const ultimo = puesto !== null && total !== null && total > 1 && puesto === total;
  const etiqueta = campeon
    ? 'Primer puesto del aula'
    : ultimo
      ? 'Último puesto del aula'
      : 'Zona media del aula';
  const piezasConfeti = campeon ? 26 : puesto !== null && puesto <= 3 ? 10 : 0;
  const escala = Math.max(team.electricidad, promedioConsumo ?? 0, 0.01);

  return (
    <div className="flex flex-col gap-4 anim-fade">
      <Celebration piezas={piezasConfeti} />

      <section
        className={`relative overflow-hidden rounded-xl bg-bg-surface border p-5 flex flex-col gap-3 ${
          campeon
            ? 'border-accent-electricidad/70'
            : ultimo
              ? 'border-accent-crisis/50'
              : 'border-border-subtle'
        }`}
      >
        {campeon && (
          <span
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent-electricidad/30 via-transparent to-transparent anim-flash-close"
            aria-hidden
          />
        )}
        <div className="relative flex items-baseline justify-between gap-3">
          <div className="flex flex-col">
            <h1 className="font-headline-md text-headline-md font-bold uppercase">Resultado final</h1>
            <span
              className={`font-label-sm text-label-sm uppercase tracking-wider ${
                campeon
                  ? 'text-accent-electricidad'
                  : ultimo
                    ? 'text-accent-crisis'
                    : 'text-text-secondary'
              }`}
            >
              {etiqueta}
            </span>
          </div>
          {/* El puesto entra con contador propio después de las tarjetas. */}
          <span className="anim-podium-in flex items-baseline gap-1">
            <span
              className={`material-symbols-outlined text-[22px] ${
                campeon ? 'text-accent-electricidad' : 'text-accent-eficiencia'
              }`}
            >
              emoji_events
            </span>
            <span
              className={`font-metric-display-mobile text-metric-display-mobile font-bold tabular-nums ${
                campeon
                  ? 'text-accent-electricidad'
                  : ultimo
                    ? 'text-accent-crisis'
                    : 'text-accent-eficiencia'
              }`}
            >
              {puesto !== null ? (
                <AnimatedNumber
                  value={puesto}
                  format={(valor) => `#${Math.round(valor)}`}
                  duration={900}
                  contarDesdeCero
                />
              ) : (
                '—'
              )}
            </span>
            <span className="text-[14px] text-text-secondary">/{total ?? '—'}</span>
          </span>
        </div>

        <div className="relative grid grid-cols-2 gap-2 font-label-sm anim-stagger">
          <Dato
            etiqueta="Electricidad"
            valor={kwh(team.electricidad)}
            color="text-accent-electricidad"
            numero={team.electricidad}
            formato={kwh}
            contarDesdeCero
          />
          <Dato
            etiqueta="Gas"
            valor={m3(team.gas)}
            color="text-accent-gas"
            numero={team.gas}
            formato={m3}
            contarDesdeCero
          />
          <Dato
            etiqueta="Presupuesto"
            valor={dinero(team.presupuesto)}
            color="text-accent-presupuesto"
            numero={team.presupuesto}
            formato={dinero}
            contarDesdeCero
          />
          <Dato
            etiqueta="Eficiencia"
            valor={`${formatNumber(team.eficiencia, 0)} %`}
            color="text-accent-eficiencia"
            numero={team.eficiencia}
            formato={(valor) => `${formatNumber(valor, 0)} %`}
            contarDesdeCero
          />
          <Dato
            etiqueta="Gasto"
            valor={dinero(PRESUPUESTO_INICIAL - team.presupuesto)}
            color="text-text-primary"
            numero={PRESUPUESTO_INICIAL - team.presupuesto}
            formato={dinero}
            contarDesdeCero
          />
          <Dato
            etiqueta="Puntos"
            valor={String(puntos)}
            color="text-accent-eficiencia"
            numero={puntos}
            formato={(valor) => String(Math.round(valor))}
            contarDesdeCero
          />
          {fila && (
            <Dato
              etiqueta="Ahorro vs. base"
              valor={kwh(fila.ahorroElectricidadKwh)}
              color="text-accent-eficiencia"
              numero={fila.ahorroElectricidadKwh}
              formato={kwh}
              contarDesdeCero
            />
          )}
          {fila && (
            <Dato
              etiqueta="Costo del consumo"
              valor={dinero(fila.costoConsumo)}
              color="text-accent-presupuesto"
              numero={fila.costoConsumo}
              formato={dinero}
              contarDesdeCero
            />
          )}
        </div>
        {fila?.desglose && (
          <p className="font-body-sm text-body-sm text-text-secondary m-0">
            El puntaje suma los tres objetivos:{' '}
            <strong className="text-accent-eficiencia">
              eficiencia {Math.round(fila.desglose.eficiencia)}
            </strong>{' '}
            +{' '}
            <strong className="text-accent-electricidad">
              consumo {Math.round(fila.desglose.consumo)}
            </strong>{' '}
            +{' '}
            <strong className="text-accent-presupuesto">
              economía {Math.round(fila.desglose.economia)}
            </strong>
            .
          </p>
        )}
      </section>

      <section className="rounded-xl bg-surface-container border border-border-subtle p-4 flex flex-col gap-3 anim-rise">
        <h2 className="font-label-md text-label-md font-bold uppercase text-text-secondary">
          Comparación con el aula
        </h2>
        <BarraComparacion
          etiqueta="Tu equipo"
          valor={team.electricidad}
          pct={team.electricidad / escala}
          color={mejorQuePromedio ? 'bg-accent-eficiencia' : 'bg-accent-gas'}
        />
        <BarraComparacion
          etiqueta="Promedio del aula"
          valor={promedioConsumo}
          pct={(promedioConsumo ?? 0) / escala}
          color="bg-accent-presupuesto"
        />
        <p className="font-label-md text-label-md font-bold uppercase text-text-primary">
          Eficiencia promedio del aula:{' '}
          <span className="text-accent-eficiencia tabular-nums">
            {promedioEficiencia === null ? '—' : `${formatNumber(promedioEficiencia, 0)} %`}
          </span>
        </p>
        <p
          className={`font-label-md text-label-md font-bold uppercase ${
            mejorQuePromedio ? 'text-accent-eficiencia' : 'text-accent-gas'
          }`}
        >
          {mejorQuePromedio
            ? 'Tu equipo consumió menos que el promedio del aula'
            : 'Tu equipo consumió más que el promedio del aula'}
        </p>
      </section>

      <section className="rounded-xl border border-border-subtle bg-bg-surface p-4 flex flex-col gap-2 anim-rise">
        <h2 className="font-label-md text-label-md font-bold uppercase text-text-secondary">
          ¿Qué aprendimos?
        </h2>
        <p className="font-body-sm text-body-sm text-text-secondary">
          El equipo que consiguió el mejor resultado no fue necesariamente el que dejó de consumir,
          sino el que eliminó los consumos innecesarios manteniendo las necesidades básicas.
        </p>
      </section>
    </div>
  );
}
