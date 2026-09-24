'use client';

/**
 * Portal de acceso: la consola del anfitrión (proyector) y el registro de mesas.
 * Sin jerga técnica: aquí entra quien monta la partida y quien va a jugar.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { readActiveGame, type ActiveGame } from '@/lib/game-store';
import { isDevelopment, missingConfig } from '@/lib/env';
import { salaCode } from '@/lib/ui';

export default function HomePage() {
  const [partida, setPartida] = useState<ActiveGame | null>(null);

  useEffect(() => {
    setPartida(readActiveGame());
  }, []);

  return (
    <main className="min-h-screen bg-bg-primary text-text-primary flex flex-col items-center px-6 py-14 relative overflow-hidden">
      {/* Fondo vivo: rejilla de red + halos, sin distraer del contenido. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35] bg-[linear-gradient(rgba(35,43,61,0.55)_1px,transparent_1px),linear-gradient(90deg,rgba(35,43,61,0.55)_1px,transparent_1px)] bg-[size:48px_48px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-32 w-[520px] h-[520px] rounded-full bg-accent-electricidad/10 blur-[120px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-52 -right-24 w-[560px] h-[560px] rounded-full bg-accent-presupuesto/10 blur-[130px]"
      />

      <div className="relative w-full max-w-4xl flex flex-col gap-10">
        <header className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-accent-eficiencia animate-pulse"></span>
            <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-[0.3em]">
              Centro de control de resiliencia energética
            </span>
          </div>
          <h1 className="font-headline-xl text-headline-xl font-bold tracking-tight anim-rise">
            Energía en Crisis
          </h1>
          <p className="font-body-lg text-body-lg text-text-secondary max-w-2xl">
            Cuatro a seis equipos compiten por convertir una instalación derrochadora en una
            eficiente. Gana quien equilibra economía, consumo y eficiencia, no quien menos consume.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 font-label-sm text-label-sm uppercase tracking-wider text-text-secondary">
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-accent-electricidad">bolt</span>
              Consumo
            </span>
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-accent-gas">
                local_fire_department
              </span>
              Gas
            </span>
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-accent-presupuesto">
                account_balance_wallet
              </span>
              Presupuesto
            </span>
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-accent-eficiencia">speed</span>
              Eficiencia
            </span>
          </div>
        </header>

        {isDevelopment && missingConfig.length > 0 && (
          <div className="rounded-lg border border-accent-gas/40 bg-accent-gas/10 px-4 py-3 font-label-md text-label-md">
            Configuración incompleta (aviso solo visible en desarrollo): falta{' '}
            {missingConfig.join(', ')}.
          </div>
        )}

        <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <article className="anim-rise rounded-2xl bg-bg-surface/90 border border-border-subtle p-6 flex flex-col gap-4 shadow-xl backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[26px] text-accent-presupuesto">
                admin_panel_settings
              </span>
              <h2 className="font-headline-md text-headline-md font-bold uppercase">
                Pantalla del anfitrión
              </h2>
            </div>
            <p className="font-body-sm text-body-sm text-text-secondary">
              Para el proyector: pide la contraseña, abre la partida y proyecta el código QR con el
              que cada mesa se registra. El vecindario reacciona al estado real de cada equipo.
            </p>
            <Link
              href={partida?.hostPath ?? '/host'}
              className="h-14 px-5 rounded-xl bg-primary-container text-on-primary-container font-label-lg text-label-lg font-bold uppercase tracking-wider flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all shadow-[0_0_28px_rgba(62,198,240,0.25)]"
            >
              <span className="material-symbols-outlined text-[22px]">play_arrow</span>
              {partida ? 'Abrir la partida' : 'Crear partida'}
            </Link>
            {partida && (
              <p className="font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
                Sala <strong className="text-text-primary">{salaCode(partida.gameId)}</strong> ·{' '}
                {partida.teams.length} {partida.teams.length === 1 ? 'mesa' : 'mesas'}
              </p>
            )}
          </article>

          <article className="anim-rise rounded-2xl bg-bg-surface/90 border border-border-subtle p-6 flex flex-col gap-4 shadow-xl backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[26px] text-accent-electricidad">
                smartphone
              </span>
              <h2 className="font-headline-md text-headline-md font-bold uppercase">
                Soy un equipo
              </h2>
            </div>
            <p className="font-body-sm text-body-sm text-text-secondary">
              Un celular por mesa. Escanea el QR del proyector o entra aquí: escribes el nombre de tu
              equipo y recibes tu instalación con consumos ocultos.
            </p>
            <Link
              href={partida ? `/join?game=${partida.gameId}` : '/join'}
              className="h-14 px-5 rounded-xl bg-surface-container-high border border-border-subtle text-text-primary font-label-lg text-label-lg font-bold uppercase tracking-wider flex items-center justify-center gap-2 hover:border-accent-eficiencia active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-[22px]">qr_code_scanner</span>
              Registrar mi equipo
            </Link>
            {partida && partida.teams.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {partida.teams.map((team) => (
                  <Link
                    key={team.id}
                    href={team.path}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border-subtle bg-surface-container-low font-label-sm text-label-sm hover:border-accent-presupuesto transition-colors"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: team.color }}
                    ></span>
                    <span className="truncate max-w-[10rem]">{team.name}</span>
                  </Link>
                ))}
              </div>
            )}
          </article>
        </section>

        <footer className="font-label-sm text-label-sm text-text-secondary uppercase tracking-[0.25em] flex flex-wrap gap-x-6 gap-y-2">
          <span>4 rondas · 15 minutos</span>
          <span>Coordinación a viva voz</span>
          <span>La red es de todos</span>
        </footer>
      </div>
    </main>
  );
}
