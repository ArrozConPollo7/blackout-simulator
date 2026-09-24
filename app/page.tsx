import React from 'react';
import Link from 'next/link';
import { mockTeams } from '@/mock/gameState';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary flex flex-col">
      {/* Header */}
      <header className="w-full bg-bg-surface border-b border-border-subtle h-20 px-margin-desktop flex items-center justify-between">
        <div className="flex items-center gap-space-sm">
          <div className="w-3 h-3 rounded-full bg-accent-eficiencia animate-pulse"></div>
          <span className="font-headline-md text-headline-md tracking-wider text-text-primary uppercase font-bold">
            Energía en Crisis
          </span>
          <span className="hidden sm:inline-block text-border-subtle">|</span>
          <span className="hidden sm:inline-block font-label-sm text-label-sm text-text-secondary uppercase tracking-widest">
            SCADA TELEMETRY & GRID RESILIENCE
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-label-sm text-label-sm px-2.5 py-1 rounded bg-surface border border-accent-eficiencia/30 text-accent-eficiencia font-semibold uppercase">
            CASSCARÓN VISUAL FRONTEND
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-12 flex flex-col gap-10">
        {/* Hero Section */}
        <section className="bg-bg-surface p-8 lg:p-10 rounded-2xl border border-border-subtle relative overflow-hidden shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-r from-accent-presupuesto/10 via-transparent to-accent-eficiencia/10 pointer-events-none"></div>
          <div className="relative z-10 flex flex-col gap-4 max-w-3xl">
            <div className="flex items-center gap-2 font-label-sm text-label-sm text-accent-presupuesto uppercase tracking-wider font-bold">
              <span className="material-symbols-outlined text-[18px]">terminal</span>
              PORTAL DE NAVEGACIÓN Y REVISIÓN VISUAL
            </div>
            <h1 className="font-headline-xl text-headline-xl lg:text-5xl font-bold uppercase tracking-tight text-text-primary">
              Simulador SCADA de Micro-Red Eléctrica
            </h1>
            <p className="font-body-lg text-body-lg text-text-secondary leading-relaxed">
              Cascarón de interfaz pura basada fielmente en las pantallas diseñadas en Stitch. Diseñado para centros de control en pantalla grande (Host) y dispositivos móviles de los participantes (Player).
            </p>
          </div>
        </section>

        {/* 2 Main Portals */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Card 1: Host Dashboard */}
          <div className="bg-bg-surface p-8 rounded-2xl border border-border-subtle shadow-xl flex flex-col justify-between gap-6 hover:border-accent-presupuesto/50 transition-all">
            <div className="flex flex-col gap-4">
              <div className="w-12 h-12 rounded-xl bg-accent-presupuesto/20 border border-accent-presupuesto flex items-center justify-center text-accent-presupuesto">
                <span className="material-symbols-outlined text-[28px]">desktop_windows</span>
              </div>
              <div>
                <span className="font-label-sm text-accent-presupuesto uppercase font-bold tracking-widest block">
                  PANTALLA COMPLETA / PROYECTOR
                </span>
                <h2 className="font-headline-lg text-headline-lg font-bold uppercase text-text-primary mt-1">
                  Vista Host (Centro de Control)
                </h2>
                <p className="font-body-md text-body-md text-text-secondary mt-2">
                  Tablero SCADA con el vecindario reactivo 3D, matriz de telemetría de todos los equipos en tiempo real, eventos de crisis y podio final.
                </p>
              </div>

              {/* Host Phase Links */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <Link
                  href="/host?phase=lobby"
                  className="p-3 rounded-lg bg-surface border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent-presupuesto transition-colors font-label-sm text-label-sm flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[16px]">group</span>
                  <span>1. Lobby</span>
                </Link>
                <Link
                  href="/host?phase=en_juego"
                  className="p-3 rounded-lg bg-surface border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent-presupuesto transition-colors font-label-sm text-label-sm flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[16px]">speed</span>
                  <span>2. En Juego</span>
                </Link>
                <Link
                  href="/host?phase=crisis"
                  className="p-3 rounded-lg bg-surface border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent-crisis transition-colors font-label-sm text-label-sm flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[16px] text-accent-crisis">warning</span>
                  <span>3. Crisis</span>
                </Link>
                <Link
                  href="/host?phase=resultados"
                  className="p-3 rounded-lg bg-surface border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent-eficiencia transition-colors font-label-sm text-label-sm flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[16px] text-accent-eficiencia">emoji_events</span>
                  <span>4. Resultados</span>
                </Link>
              </div>
            </div>

            <Link
              href="/host?phase=en_juego"
              className="h-12 w-full rounded-xl bg-primary-container text-on-primary-container font-label-md text-label-md font-bold uppercase tracking-wider flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all shadow-md"
            >
              <span>ABRIR VISTA HOST</span>
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </Link>
          </div>

          {/* Card 2: Player Terminals */}
          <div className="bg-bg-surface p-8 rounded-2xl border border-border-subtle shadow-xl flex flex-col justify-between gap-6 hover:border-accent-electricidad/50 transition-all">
            <div className="flex flex-col gap-4">
              <div className="w-12 h-12 rounded-xl bg-accent-electricidad/20 border border-accent-electricidad flex items-center justify-center text-accent-electricidad">
                <span className="material-symbols-outlined text-[28px]">smartphone</span>
              </div>
              <div>
                <span className="font-label-sm text-accent-electricidad uppercase font-bold tracking-widest block">
                  DISPOSITIVO MÓVIL POR EQUIPO
                </span>
                <h2 className="font-headline-lg text-headline-lg font-bold uppercase text-text-primary mt-1">
                  Vista Player (Participantes)
                </h2>
                <p className="font-body-md text-body-md text-text-secondary mt-2">
                  Interfaz móvil táctil para investigar electrodomésticos, tomar decisiones tácticas bajo calor extremo, responder a la crisis y comparar métricas contra el aula.
                </p>
              </div>

              {/* Player Team Links */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2">
                {mockTeams.map((team, idx) => (
                  <Link
                    key={team.id}
                    href={`/play/${team.id}`}
                    className="p-3 rounded-lg bg-surface border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent-electricidad transition-colors font-label-sm text-label-sm flex flex-col gap-0.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: team.color }}
                      ></span>
                      <strong className="text-text-primary uppercase font-bold">{team.name}</strong>
                    </div>
                    <span className="text-[10px] text-text-secondary">
                      {idx === 0 ? 'Líder (88% Efic)' : idx === 3 ? 'Gasto Alto (41%)' : 'Intermedio'}
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            <Link
              href="/play/alfa"
              className="h-12 w-full rounded-xl bg-surface-container-high hover:bg-surface-bright text-text-primary border border-border-subtle font-label-md text-label-md font-bold uppercase tracking-wider flex items-center justify-center gap-2 active:scale-95 transition-all shadow-md"
            >
              <span>PROBAR PLAYER (EQUIPO ALFA)</span>
              <span className="material-symbols-outlined text-[18px]">phone_iphone</span>
            </Link>
          </div>
        </div>

        {/* Technical Architecture Specs */}
        <section className="bg-surface-container rounded-xl p-6 border border-border-subtle flex flex-col md:flex-row items-center justify-between gap-4 font-label-sm text-label-sm text-text-secondary">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-accent-eficiencia text-[24px]">verified_user</span>
            <span>Next.js App Router + TypeScript + Tailwind CSS tokens oficiales de Stitch SCADA</span>
          </div>
          <div className="flex items-center gap-4">
            <span>Zero Emojis</span>
            <span>•</span>
            <span>Material Symbols Outlined</span>
            <span>•</span>
            <span>Datos Mock Tipados</span>
          </div>
        </section>
      </main>
    </div>
  );
}
