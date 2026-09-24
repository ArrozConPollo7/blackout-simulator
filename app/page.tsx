'use client';

/** Portal de acceso: abre la consola del Host o entra a la vista de un equipo. */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { readActiveGame, type ActiveGame } from '@/lib/game-store';
import { isApiConfigured, missingConfig } from '@/lib/env';

export default function HomePage() {
  const [partida, setPartida] = useState<ActiveGame | null>(null);

  useEffect(() => {
    setPartida(readActiveGame());
  }, []);

  return (
    <main className="min-h-screen bg-bg-primary text-text-primary flex flex-col items-center px-6 py-14">
      <div className="w-full max-w-3xl flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-accent-eficiencia animate-pulse"></span>
            <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-widest">
              Centro de control de resiliencia energética
            </span>
          </div>
          <h1 className="font-headline-xl text-headline-xl font-bold tracking-tight">
            Energía en Crisis
          </h1>
          <p className="font-body-lg text-body-lg text-text-secondary max-w-2xl">
            Cuatro a seis equipos compiten por convertir una instalación derrochadora en una
            eficiente. Gana quien equilibra economía, consumo y eficiencia, no quien menos consume.
          </p>
        </header>

        {missingConfig.length > 0 && (
          <div className="rounded-lg border border-accent-gas/40 bg-accent-gas/10 px-4 py-3 font-label-md text-label-md">
            Configuración incompleta: falta {missingConfig.join(', ')}. Copia{' '}
            <code>.env.example</code> a <code>.env.local</code> y reinicia el servidor.
          </div>
        )}

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <article className="rounded-xl bg-bg-surface border border-border-subtle p-6 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[24px] text-accent-presupuesto">
                admin_panel_settings
              </span>
              <h2 className="font-headline-md text-headline-md font-bold uppercase">
                Consola del Host
              </h2>
            </div>
            <p className="font-body-sm text-body-sm text-text-secondary">
              Pantalla para el proyector: crea la partida, abre las rondas y dispara la crisis
              energética. El vecindario 3D reacciona al estado real de cada equipo.
            </p>
            <Link
              href={partida?.hostPath ?? '/host'}
              className="h-12 px-5 rounded-xl bg-primary-container text-on-primary-container font-label-lg text-label-lg font-bold uppercase tracking-wider flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-[20px]">play_arrow</span>
              {partida ? 'Abrir partida activa' : 'Crear partida'}
            </Link>
            {partida && (
              <p className="font-label-sm text-label-sm text-text-secondary">
                Partida {partida.gameId.slice(0, 8).toUpperCase()} · {partida.teams.length} equipos
              </p>
            )}
          </article>

          <article className="rounded-xl bg-bg-surface border border-border-subtle p-6 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[24px] text-accent-electricidad">
                smartphone
              </span>
              <h2 className="font-headline-md text-headline-md font-bold uppercase">
                Vista de equipo
              </h2>
            </div>
            <p className="font-body-sm text-body-sm text-text-secondary">
              Un celular por equipo. Cada enlace es único y trae el caso asignado: los equipos
              investigan sus aparatos y deciden sobre ellos.
            </p>
            {partida && partida.teams.length > 0 ? (
              <div className="flex flex-col gap-2">
                {partida.teams.map((team) => (
                  <Link
                    key={team.id}
                    href={team.path}
                    className="p-3 rounded-lg border border-border-subtle bg-surface-container-low flex items-center gap-3 font-label-md text-label-md hover:text-accent-presupuesto transition-colors"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: team.color }}
                    ></span>
                    <span className="truncate">{team.name}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="font-label-sm text-label-sm text-text-secondary">
                Aún no hay partida creada: abre la consola del Host y crea una.
              </p>
            )}
          </article>
        </section>

        <footer className="font-label-sm text-label-sm text-text-secondary uppercase tracking-wider flex flex-wrap gap-4">
          <span>Fuente de verdad: Cloudflare Worker</span>
          <span>·</span>
          <span>Realtime: Supabase Postgres Changes</span>
          <span>·</span>
          <span>{isApiConfigured ? 'API configurada' : 'API sin configurar'}</span>
        </footer>
      </div>
    </main>
  );
}
