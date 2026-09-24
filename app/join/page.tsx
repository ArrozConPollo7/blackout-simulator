'use client';

/**
 * Registro de una mesa (equipo).
 *
 * Es el destino del QR del proyector: `/join?game=<id>`. Cada equipo escribe su nombre
 * y el Worker crea el equipo con el caso libre que toque (`POST /game/:id/join`), así que
 * el aula no depende de repartir enlaces a mano. Si el celular ya había entrado antes,
 * se ofrece continuar con ese mismo equipo en vez de crear otro.
 */

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { ApiClientError, api, describeApiError } from '@/lib/api';
import { env, isDevelopment, missingConfig } from '@/lib/env';
import { clearMyTeam, readMyTeam, writeMyTeam, type MyTeam } from '@/lib/team-store';
import AnimatedNumber from '@/components/play/AnimatedNumber';
import { salaCode } from '@/lib/ui';
import type { GameStateResponse } from '@/types/api';

const NAME_MIN = 2;
const NAME_MAX = 24;

export default function JoinPage() {
  // `useSearchParams` obliga a un límite de Suspense en el App Router.
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center font-label-md">
          ABRIENDO REGISTRO DE MESA…
        </main>
      }
    >
      <JoinForm />
    </Suspense>
  );
}

function JoinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const gameId = (searchParams.get('game') ?? '').trim();

  const [state, setState] = useState<GameStateResponse | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [miEquipo, setMiEquipo] = useState<MyTeam | null>(null);

  const recargar = useCallback(async () => {
    if (!gameId) {
      setCargando(false);
      return;
    }
    setCargando(true);
    try {
      setState(await api.getState(gameId));
      setErrorCarga(null);
    } catch (cause) {
      setErrorCarga(describeApiError(cause));
    } finally {
      setCargando(false);
    }
  }, [gameId]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  useEffect(() => {
    if (gameId) setMiEquipo(readMyTeam(gameId));
  }, [gameId]);

  // Sondeo lento: mientras el aula se registra, la pantalla muestra quién va entrando.
  useEffect(() => {
    if (!gameId) return;
    const timer = setInterval(() => void recargar(), 4000);
    return () => clearInterval(timer);
  }, [gameId, recargar]);

  const equipoGuardadoSigueVivo = useMemo(
    () => Boolean(miEquipo && state?.teams.some((team) => team.id === miEquipo.teamId)),
    [miEquipo, state],
  );

  const entrar = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = nombre.replace(/\s+/g, ' ').trim();
    if (value.length < NAME_MIN) {
      setError(`El nombre necesita al menos ${NAME_MIN} caracteres.`);
      return;
    }
    if (!gameId || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const joined = await api.joinGame(gameId, value);
      writeMyTeam(gameId, { teamId: joined.teamId, name: joined.name, color: joined.color });
      router.push(joined.playPath);
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.status === 404) {
        // El enlace de registro aún no está activo en esta partida (despliegue viejo).
        setError(
          'Este enlace aún no está activo: pide a quien monta la partida el enlace directo de tu equipo.',
        );
      } else {
        setError(describeApiError(cause));
      }
      await recargar();
    } finally {
      setEnviando(false);
    }
  };

  if (!env.apiUrl) {
    return (
      <Marco>
        <Tarjeta titulo="Falta configurar la API" icono="cloud_off">
          El registro no está disponible ahora mismo. Avisa a quien monta la partida.
        </Tarjeta>
      </Marco>
    );
  }

  if (!gameId) {
    return (
      <Marco>
        <Tarjeta titulo="Falta la partida" icono="qr_code_scanner">
          Escanea el QR del proyector (o abre el enlace que muestra el Host). Los enlaces tienen
          la forma <code className="text-accent-presupuesto">/join?game=&lt;partida&gt;</code>.
        </Tarjeta>
      </Marco>
    );
  }

  if (cargando && !state) {
    return (
      <Marco>
        <Tarjeta titulo="Conectando con el centro de control…" icono="sync">
          Buscando la partida y sus mesas…
        </Tarjeta>
      </Marco>
    );
  }

  if (!state) {
    return (
      <Marco>
        <Tarjeta titulo="No se pudo abrir el registro" icono="error">
          {errorCarga ?? 'Este enlace no corresponde a ninguna partida.'}
        </Tarjeta>
      </Marco>
    );
  }

  const enLobby = state.phase === 'lobby';

  return (
    <main className="min-h-screen bg-bg-primary text-text-primary flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md flex flex-col gap-5">
        <header className="flex flex-col gap-3 anim-rise">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-accent-eficiencia animate-ping"></span>
            <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-[0.3em]">
              Registro de mesa
            </span>
            <span className="ml-auto px-2 py-0.5 rounded-lg border border-border-subtle bg-surface-container-low font-label-sm text-label-sm font-bold uppercase tracking-wider text-text-primary">
              sala {salaCode(state.gameId)}
            </span>
          </div>
          <h1 className="font-headline-xl text-headline-xl font-bold uppercase tracking-tight leading-none">
            Energía
            <br />
            en Crisis
          </h1>
          <p className="font-body-sm text-body-sm text-text-secondary">
            Ponle nombre a tu equipo: es el que aparecerá en el proyector y en el podio final.
          </p>
          <div className="grid grid-cols-3 gap-2 pt-1">
            {[
              { icono: 'qr_code_scanner', texto: 'Escanea el QR' },
              { icono: 'edit_note', texto: 'Escribe tu nombre' },
              { icono: 'home_work', texto: 'Recibe tu instalación' },
            ].map((paso, indice) => (
              <div
                key={paso.texto}
                className="rounded-xl border border-border-subtle bg-surface-container-low px-2 py-2.5 flex flex-col items-center gap-1 text-center"
                style={{ animationDelay: `${indice * 60}ms` }}
              >
                <span className="material-symbols-outlined text-[20px] text-accent-presupuesto">
                  {paso.icono}
                </span>
                <span className="font-label-sm text-[10px] uppercase tracking-wider text-text-secondary leading-tight">
                  {paso.texto}
                </span>
              </div>
            ))}
          </div>
        </header>

        {isDevelopment && missingConfig.length > 0 && (
          <p className="rounded-lg border border-accent-gas/40 bg-accent-gas/10 px-3 py-2 font-label-sm text-label-sm">
            Aviso de desarrollo: falta {missingConfig.join(', ')}
          </p>
        )}

        {equipoGuardadoSigueVivo && miEquipo && (
          <section className="rounded-xl bg-bg-surface border border-accent-eficiencia/40 p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-accent-eficiencia">
                key
              </span>
              <span className="font-label-md text-label-md font-bold uppercase">
                Este celular ya entró
              </span>
            </div>
            <p className="font-body-sm text-body-sm text-text-secondary">
              Como <strong className="text-text-primary">{miEquipo.name}</strong>.
            </p>
            <button
              type="button"
              onClick={() => router.push(`/play/${miEquipo.teamId}?game=${gameId}`)}
              className="h-12 rounded-xl bg-primary-container text-on-primary-container font-label-lg text-label-lg font-bold uppercase tracking-wider active:scale-95 transition-all"
            >
              Continuar con ese equipo
            </button>
            <button
              type="button"
              onClick={() => {
                clearMyTeam(gameId);
                setMiEquipo(null);
              }}
              className="font-label-sm text-label-sm text-text-secondary uppercase tracking-wider hover:text-text-primary text-left"
            >
              Somos otro equipo
            </button>
          </section>
        )}

        {!enLobby ? (
          <Tarjeta titulo="La partida ya empezó" icono="hourglass_disabled">
            El registro se cierra al abrir la primera ronda. Pide a quien monta la partida que
            añada tu equipo y te pase el enlace.
          </Tarjeta>
        ) : (
          <form
            onSubmit={entrar}
            className="rounded-xl bg-bg-surface border border-border-subtle p-5 flex flex-col gap-4 shadow-lg"
          >
            <label className="flex flex-col gap-2">
              <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
                Nombre del equipo
              </span>
              <div className="flex items-center gap-2 px-3 rounded-xl bg-bg-primary border border-border-subtle focus-within:border-accent-presupuesto">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: miEquipo?.color ?? '#3EC6F0' }}
                ></span>
                <input
                  type="text"
                  value={nombre}
                  onChange={(event) => setNombre(event.target.value)}
                  maxLength={NAME_MAX}
                  autoComplete="off"
                  autoFocus
                  placeholder="Los Tigres"
                  className="flex-1 h-12 bg-transparent border-0 outline-none font-headline-md text-headline-md text-text-primary placeholder:text-text-secondary/40"
                />
                <span className="font-label-sm text-label-sm text-text-secondary tabular-nums">
                  {nombre.length}/{NAME_MAX}
                </span>
              </div>
            </label>

            {error && (
              <p className="rounded-lg border border-accent-crisis/50 bg-accent-crisis/10 px-3 py-2 font-label-sm text-label-sm">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={enviando || nombre.trim().length < NAME_MIN}
              className="min-h-[48px] rounded-xl bg-primary-container text-on-primary-container font-label-lg text-label-lg font-bold uppercase tracking-wider flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[20px]">login</span>
              {enviando ? 'Entrando…' : 'Entrar a la partida'}
            </button>

            <p className="font-label-sm text-label-sm text-text-secondary">
              Al entrar recibes un caso asignado: tu instalación tiene consumos ocultos que
              descubrirás en la primera ronda.
            </p>
          </form>
        )}

        <section className="rounded-xl bg-surface-container border border-border-subtle p-4 flex flex-col gap-3 anim-rise">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
              Mesas dentro
            </span>
            <span className="font-headline-md text-headline-md font-bold text-accent-eficiencia">
              <AnimatedNumber value={state.teams.length} />
            </span>
          </div>
          {state.teams.length === 0 ? (
            <p className="font-body-sm text-body-sm text-text-secondary">
              Todavía no hay equipos registrados. Sé el primero.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2 anim-stagger">
              {state.teams.map((team) => (
                <li
                  key={team.id}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-bg-primary border border-border-subtle font-label-sm text-label-sm"
                  style={{ borderColor: `${team.color}55` }}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: team.color }}
                  ></span>
                  {team.name}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md flex flex-col gap-4">{children}</div>
    </main>
  );
}

function Tarjeta({
  titulo,
  icono,
  children,
}: {
  titulo: string;
  icono: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-bg-surface border border-border-subtle p-5 flex flex-col gap-3">
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
