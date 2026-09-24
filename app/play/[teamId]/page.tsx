'use client';

/**
 * Vista Player (un celular por equipo, sin WebGL).
 *
 * Fase 2.4: los botones de decisión llaman a POST /game/:id/decision y NUNCA tocan el
 * estado local antes de la respuesta del Worker. El feedback ("Tu decisión ahorró X kWh")
 * se muestra con el estado que devuelve el Worker.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import AnimatedNumber from '@/components/play/AnimatedNumber';
import SoundToggle from '@/components/SoundToggle';
import { APPLIANCE_BY_ID, ROUND2B_SCENARIOS, ROUND2_SCENARIOS } from '@/content/decisions';
import { PRESUPUESTO_INICIAL } from '@/content/economy';
import { PHASE_BY_NAME } from '@/content/phases';
import type { ApplianceProfile, DecisionScenario } from '@/content/decisions';
import type { DecisionEffect, TeamState } from '@/types/game';
import type { GameStateResponse } from '@/types/api';
import { api, describeApiError } from '@/lib/api';
import { useAudioEvent } from '@/lib/audio';
import { missingConfig } from '@/lib/env';
import { resolveGameId } from '@/lib/game-store';
import { useGameState, useRemainingMs } from '@/lib/useGameState';
import {
  CONFORT_LABEL,
  CONSUMO_LABEL,
  dinero,
  formatNumber,
  formatRemaining,
  impactHint,
  kwh,
  m3,
  phaseLabel,
  realtimeIcon,
  realtimeLabel,
} from '@/lib/ui';

interface Feedback {
  text: string;
  effect: DecisionEffect;
  scenarioKey: string;
}

/**
 * ¿Quedó la ronda de decisiones sin situaciones pendientes? Se usa solo para elegir el
 * sonido (acorde de resolución en vez de confirmación): la verdad sigue siendo del Worker.
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

export default function PlayerPage({ params }: { params: { teamId: string } }) {
  const teamId = params.teamId;
  const [gameId, setGameId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Cada fallo sube el contador: así la sacudida del aviso se repite aunque el texto sea igual. */
  const [errorNonce, setErrorNonce] = useState(0);
  const [openAppliance, setOpenAppliance] = useState<string | null>(null);

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
  const remaining = useRemainingMs(state?.timerEndsAt ?? null, phase, connection.clockSkewMs);

  const playEvent = useAudioEvent();
  const lastPhaseRef = useRef<string | null>(null);
  const timeWarnedRef = useRef(false);
  const lastTelemetryRef = useRef(0);
  /** El cronómetro solo se pone rojo y pulsa cuando de verdad queda poco. */
  const timerCritical = remaining !== null && remaining <= 30000;

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

  // Aviso de tiempo bajo: tic doble, una sola vez por tramo.
  useEffect(() => {
    if (remaining === null) {
      timeWarnedRef.current = false;
      return;
    }
    if (remaining > 25000) timeWarnedRef.current = false;
    if (remaining > 0 && remaining <= 20000 && !timeWarnedRef.current) {
      timeWarnedRef.current = true;
      playEvent('timeLow');
    }
  }, [remaining, playEvent]);

  // Blip de telemetría al sincronizar con el Worker, con freno para no ser un metrónomo.
  const lastSyncAt = connection.lastSyncAt;
  useEffect(() => {
    if (!lastSyncAt) return;
    const now = Date.now();
    if (now - lastTelemetryRef.current < 20000) return;
    lastTelemetryRef.current = now;
    playEvent('telemetry');
  }, [lastSyncAt, playEvent]);

  const decidir = async (optionId: string, scenarioKey: string, round: 'investigar' | 'decidir' | 'decidir_2') => {
    if (!state) return;
    playEvent('click');
    setPending(optionId);
    setError(null);
    try {
      const respuesta = await api.sendDecision(state.gameId, { teamId, round, optionId });
      // Solo después de la respuesta del Worker se muestra el resultado.
      setFeedback({ text: respuesta.feedback, effect: respuesta.effect, scenarioKey });
      connection.applyState(respuesta.state);
      setOpenAppliance(null);
      // Confirmación; si con esta decisión queda la ronda completa, acorde de resolución.
      const completa = round !== 'investigar' && rondaCompleta(respuesta.state, round, teamId);
      playEvent(completa ? 'resolve' : 'confirm');
    } catch (cause) {
      playEvent('deny');
      setError(describeApiError(cause));
      setErrorNonce((n) => n + 1);
    } finally {
      setPending(null);
    }
  };

  const appliances = useMemo(
    () =>
      (caso?.appliances ?? [])
        .map((id) => APPLIANCE_BY_ID[id])
        .filter((a): a is ApplianceProfile => Boolean(a)),
    [caso],
  );

  const escenariosRonda2 = phase === 'decidir_2' ? ROUND2B_SCENARIOS : ROUND2_SCENARIOS;
  const rondaActual: 'investigar' | 'decidir' | 'decidir_2' | null =
    phase === 'investigar' ? 'investigar' : phase === 'decidir' ? 'decidir' : phase === 'decidir_2' ? 'decidir_2' : null;

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
        <Panel titulo="Conectando con el centro de control…" icono="sync">
          Pidiendo el estado completo de la partida al Worker.
        </Panel>
      </Marco>
    );
  }

  if (connection.status === 'error' && !state) {
    return (
      <Marco>
        <Panel titulo="Sin conexión con el Worker" icono="wifi_off">
          {connection.error}
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
                <span className="font-body-sm text-body-sm text-text-secondary truncate">
                  · {caso?.name ?? 'sin caso'}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div
                  className={`flex items-center gap-1 px-2 py-0.5 rounded bg-bg-primary border ${
                    timerCritical
                      ? 'border-accent-crisis/60 anim-pulse-urgent'
                      : 'border-border-subtle'
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-[14px] ${
                      timerCritical ? 'text-accent-crisis' : 'text-accent-electricidad'
                    }`}
                  >
                    timer
                  </span>
                  <span
                    className={`font-label-md text-label-md font-bold tabular-nums ${
                      timerCritical ? 'text-accent-crisis' : 'text-accent-electricidad'
                    }`}
                  >
                    {formatRemaining(remaining)}
                  </span>
                </div>
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
                valor={team ? `${formatNumber(team.electricidad, 1)}k` : '—'}
                numero={team?.electricidad}
                formato={(valor) => `${formatNumber(valor, 1)}k`}
              />
              <Badge
                icono="local_fire_department"
                etiqueta="Gas"
                color="text-accent-gas"
                valor={team ? m3(team.gas) : '—'}
                numero={team?.gas}
                formato={m3}
              />
              <Badge
                icono="account_balance_wallet"
                etiqueta="Ppto"
                color="text-accent-presupuesto"
                valor={team ? `${Math.round(team.presupuesto / 1000)}k` : '—'}
                numero={team?.presupuesto}
                formato={(valor) => `${Math.round(valor / 1000)}k`}
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
          </div>
        </header>

        <main className="w-full pt-28 px-4 flex-1 flex flex-col gap-4">
          {missingConfig.length > 0 && (
            <p className="rounded-lg border border-accent-gas/40 bg-accent-gas/10 px-3 py-2 font-label-sm text-label-sm">
              Faltan variables de entorno: {missingConfig.join(', ')}
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
                  return (
                    <button
                      key={app.id}
                      type="button"
                      onClick={() => {
                        playEvent('click');
                        setOpenAppliance(openAppliance === app.id ? null : app.id);
                      }}
                      className={`p-3 rounded-xl bg-bg-surface border text-left flex flex-col justify-between min-h-[104px] anim-tactile ${
                        openAppliance === app.id
                          ? 'border-accent-presupuesto ring-1 ring-accent-presupuesto'
                          : 'border-border-subtle'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="material-symbols-outlined text-[24px] text-accent-presupuesto">
                          {app.icon}
                        </span>
                        {yaResuelto && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent-eficiencia/20 text-accent-eficiencia font-bold uppercase">
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
                  onDecide={(optionId) => void decidir(optionId, `r1:${openAppliance}`, 'investigar')}
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
                ayuda="Cada situación tiene tres opciones. El resultado exacto lo calcula el Worker."
              />
              <ListaEscenarios
                escenarios={escenariosRonda2}
                answered={answered}
                pending={pending}
                round={rondaActual}
                onDecide={decidir}
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
                    <span className="font-label-md text-label-md text-accent-crisis font-bold tabular-nums">
                      {formatRemaining(remaining)}
                    </span>
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
              puesto={state.results?.ranking.find((r) => r.team.id === team.id)?.rank ?? null}
              total={state.results?.ranking.length ?? null}
              promedioEficiencia={state.results?.promedioEficiencia ?? null}
              promedioConsumo={state.results?.promedioConsumoElectrico ?? null}
              puntos={state.results?.ranking.find((r) => r.team.id === team.id)?.puntos ?? team.puntos}
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
      <p className="font-body-sm text-body-sm text-text-secondary">{children}</p>
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
}: {
  icono: string;
  etiqueta: string;
  valor: string;
  color: string;
  /** Número real del KPI: si llega, el valor se anima en vez de saltar. */
  numero?: number;
  formato?: (value: number) => string;
}) {
  return (
    <div className="flex items-center gap-1 px-1.5 py-1 rounded bg-bg-primary/80 border border-border-subtle">
      <span className={`material-symbols-outlined ${color} text-[14px]`}>{icono}</span>
      <div className="flex flex-col min-w-0">
        <span className="font-label-sm text-[9px] text-text-secondary uppercase leading-none">
          {etiqueta}
        </span>
        <span className="font-label-sm text-[11px] text-text-primary truncate font-bold leading-tight tabular-nums">
          {numero !== undefined && formato ? (
            <AnimatedNumber value={numero} format={formato} />
          ) : (
            valor
          )}
        </span>
      </div>
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
  const { effect } = feedback;
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
      <div className="flex flex-wrap gap-3 font-label-sm text-label-sm text-text-secondary">
        {effect.electricidad !== undefined && (
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px] text-accent-electricidad">
              bolt
            </span>
            <strong className={effect.electricidad <= 0 ? 'text-accent-eficiencia' : 'text-accent-gas'}>
              {effect.electricidad > 0 ? '+' : ''}
              {kwh(effect.electricidad)}
            </strong>
          </span>
        )}
        {effect.gas !== undefined && effect.gas !== 0 && (
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px] text-accent-gas">
              local_fire_department
            </span>
            <strong className={effect.gas <= 0 ? 'text-accent-eficiencia' : 'text-accent-gas'}>
              {effect.gas > 0 ? '+' : ''}
              {m3(effect.gas)}
            </strong>
          </span>
        )}
        {effect.presupuesto !== undefined && (
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px] text-accent-presupuesto">
              account_balance_wallet
            </span>
            <strong className="text-accent-presupuesto">{dinero(effect.presupuesto)}</strong>
          </span>
        )}
        {effect.eficiencia !== undefined && effect.eficiencia !== 0 && (
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px] text-accent-eficiencia">
              speed
            </span>
            <strong className={effect.eficiencia > 0 ? 'text-accent-eficiencia' : 'text-accent-gas'}>
              {effect.eficiencia > 0 ? '+' : ''}
              {formatNumber(effect.eficiencia, 2)} %
            </strong>
          </span>
        )}
      </div>
    </section>
  );
}

function FichaAparato({
  app,
  answered,
  pending,
  onDecide,
}: {
  app: ApplianceProfile;
  answered: boolean;
  pending: string | null;
  onDecide: (optionId: string) => void;
}) {
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
        <Dato etiqueta="Costo estimado" valor={dinero(app.referencia.electricidad * 550 + app.referencia.gas * 450)} color="text-accent-presupuesto" />
      </div>

      <p className="font-body-sm text-body-sm text-text-secondary">
        Situación actual: <strong className="text-text-primary">{app.problemaOculto}</strong>
      </p>

      {answered ? (
        <p className="font-label-md text-label-md text-accent-eficiencia uppercase">
          Este aparato ya fue atendido.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5 anim-stagger">
          <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
            ¿Qué hace tu equipo con este aparato?
          </span>
          {app.options.map((option) => {
            const hint = impactHint(option.effect);
            return (
              <button
                key={option.id}
                type="button"
                disabled={pending !== null}
                onClick={() => onDecide(option.id)}
                className="min-h-[48px] p-3.5 rounded-xl border border-border-subtle bg-bg-surface text-left flex flex-col gap-1.5 anim-tactile disabled:opacity-60"
              >
                <span className="font-label-md text-label-md font-bold text-text-primary">
                  {option.label}
                </span>
                <span className="flex gap-3 font-label-sm text-[11px] text-text-secondary">
                  <span>
                    Consumo:{' '}
                    <strong className={hint.consumo === 'igual' ? 'text-text-primary' : 'text-accent-eficiencia'}>
                      {CONSUMO_LABEL[hint.consumo]}
                    </strong>
                  </span>
                  <span>{CONFORT_LABEL[hint.confort]}</span>
                </span>
              </button>
            );
          })}
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
  onDecide,
}: {
  escenarios: DecisionScenario[];
  answered: string[];
  pending: string | null;
  round: 'decidir' | 'decidir_2';
  onDecide: (optionId: string, scenarioKey: string, round: 'decidir' | 'decidir_2') => Promise<void>;
}) {
  const clave = (id: string) => (round === 'decidir_2' ? 'r2b' : `r2:${id}`);
  const pendientes = escenarios.filter((escenario) => !answered.includes(clave(escenario.id)));
  const resueltos = escenarios.length - pendientes.length;

  if (escenarios.length === 0) {
    return <p className="font-body-md text-body-md text-text-secondary">Sin situaciones pendientes.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between font-label-sm text-label-sm text-text-secondary uppercase">
        <span>
          Situaciones resueltas: {resueltos} / {escenarios.length}
        </span>
        <span>{phaseLabel(round === 'decidir_2' ? 'decidir_2' : 'decidir')}</span>
      </div>

      {pendientes.length === 0 && (
        <Panel titulo="Ronda completa" icono="check_circle">
          Ya decidiste todas las situaciones de esta ronda. Espera al Host para el siguiente paso.
        </Panel>
      )}

      {pendientes.slice(0, 1).map((escenario) => (
        <div key={escenario.id} className="flex flex-col gap-3 anim-rise">
          <section className="flex flex-col gap-2 p-4 rounded-xl bg-bg-surface border border-border-subtle shadow-md">
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-container-high w-fit">
              <span className="material-symbols-outlined text-[14px] text-accent-electricidad">
                {escenario.icon}
              </span>
              <span className="font-label-sm text-label-sm text-text-secondary uppercase">
                SITUACIÓN {resueltos + 1} DE {escenarios.length}
              </span>
            </div>
            <h2 className="font-headline-md text-headline-md text-text-primary tracking-tight font-bold">
              {escenario.title}
            </h2>
            <p className="font-body-sm text-body-sm text-text-secondary">{escenario.prompt}</p>
          </section>

          <div className="flex flex-col gap-3 anim-stagger">
            {escenario.options.map((option) => {
              const hint = impactHint(option.effect);
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void onDecide(option.id, clave(escenario.id), round)}
                  className="min-h-[58px] p-3.5 rounded-xl border border-border-subtle bg-bg-surface text-left flex flex-col gap-2 anim-tactile disabled:opacity-60"
                >
                  <span className="font-label-md text-label-md font-bold text-text-primary">
                    {option.label}
                  </span>
                  <span className="flex gap-3 font-label-sm text-[11px] text-text-secondary">
                    <span>
                      Consumo:{' '}
                      <strong className={hint.consumo === 'igual' ? 'text-text-primary' : 'text-accent-eficiencia'}>
                        {CONSUMO_LABEL[hint.consumo]}
                      </strong>
                    </span>
                    <span>{CONFORT_LABEL[hint.confort]}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Resultados({
  team,
  puesto,
  total,
  promedioEficiencia,
  promedioConsumo,
  puntos,
}: {
  team: TeamState;
  puesto: number | null;
  total: number | null;
  promedioEficiencia: number | null;
  promedioConsumo: number | null;
  puntos: number;
}) {
  const mejorQuePromedio = promedioConsumo !== null && team.electricidad <= promedioConsumo;
  return (
    <div className="flex flex-col gap-4 anim-fade">
      <section className="rounded-xl bg-bg-surface border border-border-subtle p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="font-headline-md text-headline-md font-bold uppercase">Resultado final</h1>
          {/* Revelado del puesto: entra después de las tarjetas, no al mismo tiempo. */}
          <span
            className="font-metric-display-mobile text-metric-display-mobile text-accent-eficiencia font-bold tabular-nums anim-reveal"
            style={{ animationDelay: '200ms' }}
          >
            {puesto ? `#${puesto}` : '—'}
            <span className="text-[14px] text-text-secondary">/{total ?? '—'}</span>
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 font-label-sm anim-stagger">
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
        </div>
      </section>

      <section className="rounded-xl bg-surface-container border border-border-subtle p-4 flex flex-col gap-2 anim-rise">
        <h2 className="font-label-md text-label-md font-bold uppercase text-text-secondary">
          Comparación con el aula
        </h2>
        <p className="font-body-sm text-body-sm text-text-secondary">
          Consumo promedio del aula:{' '}
          <strong className="text-text-primary">{promedioConsumo === null ? '—' : kwh(promedioConsumo)}</strong>
          {' · '}
          Eficiencia promedio:{' '}
          <strong className="text-text-primary">
            {promedioEficiencia === null ? '—' : `${formatNumber(promedioEficiencia, 0)} %`}
          </strong>
        </p>
        <p
          className={`font-label-md text-label-md font-bold uppercase ${mejorQuePromedio ? 'text-accent-eficiencia' : 'text-accent-gas'}`}
        >
          {mejorQuePromedio
            ? 'Tu equipo consumió menos que el promedio del aula'
            : 'Tu equipo consumió más que el promedio del aula'}
        </p>
      </section>
    </div>
  );
}
