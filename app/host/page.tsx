'use client';

import React, { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import GameHeader from '@/components/GameHeader';
import NeighborhoodStage from '@/components/NeighborhoodStage';
import TeamCard from '@/components/TeamCard';
import CrisisOverlay from '@/components/CrisisOverlay';
import { mockTeams } from '@/mock/gameState';

type HostPhase = 'lobby' | 'en_juego' | 'crisis' | 'resultados';

function HostContent() {
  const searchParams = useSearchParams();
  const initialPhase = (searchParams.get('phase') as HostPhase) || 'en_juego';
  const [phase, setPhase] = useState<HostPhase>(initialPhase);
  const [isPaused, setIsPaused] = useState(false);

  // Sync state if search params change
  React.useEffect(() => {
    const p = searchParams.get('phase') as HostPhase;
    if (p && ['lobby', 'en_juego', 'crisis', 'resultados'].includes(p)) {
      setPhase(p);
    }
  }, [searchParams]);

  // Phase labels and configs
  const getPhaseConfig = () => {
    switch (phase) {
      case 'lobby':
        return {
          title: 'Lobby — Registro y Sincronía de Equipos',
          code: 'FASE 1: LOBBY',
          isCrisis: false,
        };
      case 'crisis':
        return {
          title: 'Alerta de Crisis — Contingencia de Red Eléctrica',
          code: 'FASE 3: CRISIS DE RED',
          isCrisis: true,
        };
      case 'resultados':
        return {
          title: 'Resultados Finales — Podio y Resiliencia Energética',
          code: 'FASE 4: RESULTADOS',
          isCrisis: false,
        };
      case 'en_juego':
      default:
        return {
          title: 'En Juego — Despacho y Telemetría Industrial',
          code: 'FASE 2: EN JUEGO',
          isCrisis: false,
        };
    }
  };

  const config = getPhaseConfig();

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary flex flex-col">
      {/* Persistent Game Header */}
      <GameHeader
        phaseName={config.title}
        phaseCode={config.code}
        isCrisis={config.isCrisis}
        onTriggerCrisis={() => setPhase(phase === 'crisis' ? 'en_juego' : 'crisis')}
        onPause={() => setIsPaused(!isPaused)}
      />

      {/* Main Content Area */}
      <main className="w-full pt-24 pb-16 px-margin-desktop flex-1 flex flex-col max-w-[1920px] mx-auto">
        {/* Phase Debug Quick Bar */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-border-subtle flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="font-label-sm text-label-sm text-text-secondary uppercase">
              FASE HOST ACTUAL:
            </span>
            <span className="px-2.5 py-0.5 rounded bg-surface border border-accent-presupuesto/40 text-accent-presupuesto font-label-md text-label-md font-bold uppercase">
              {phase}
            </span>
            {isPaused && (
              <span className="px-2 py-0.5 rounded bg-accent-gas/20 text-accent-gas border border-accent-gas/40 font-label-sm text-label-sm font-bold uppercase">
                PAUSADO
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 font-label-sm text-label-sm">
            <button
              type="button"
              onClick={() => setPhase('lobby')}
              className={`px-3 py-1 rounded border transition-colors ${
                phase === 'lobby'
                  ? 'bg-primary-container text-on-primary-container font-bold border-transparent'
                  : 'bg-surface border-border-subtle text-text-secondary hover:text-text-primary'
              }`}
            >
              1. Lobby
            </button>
            <button
              type="button"
              onClick={() => setPhase('en_juego')}
              className={`px-3 py-1 rounded border transition-colors ${
                phase === 'en_juego'
                  ? 'bg-primary-container text-on-primary-container font-bold border-transparent'
                  : 'bg-surface border-border-subtle text-text-secondary hover:text-text-primary'
              }`}
            >
              2. En Juego
            </button>
            <button
              type="button"
              onClick={() => setPhase('crisis')}
              className={`px-3 py-1 rounded border transition-colors ${
                phase === 'crisis'
                  ? 'bg-accent-crisis text-white font-bold border-transparent'
                  : 'bg-surface border-border-subtle text-text-secondary hover:text-text-primary'
              }`}
            >
              3. Crisis
            </button>
            <button
              type="button"
              onClick={() => setPhase('resultados')}
              className={`px-3 py-1 rounded border transition-colors ${
                phase === 'resultados'
                  ? 'bg-primary-container text-on-primary-container font-bold border-transparent'
                  : 'bg-surface border-border-subtle text-text-secondary hover:text-text-primary'
              }`}
            >
              4. Resultados
            </button>
          </div>
        </div>

        {/* ========================================================= */}
        {/* PHASE 1: LOBBY DE EQUIPOS                                */}
        {/* ========================================================= */}
        {phase === 'lobby' && (
          <div className="flex flex-col gap-6 w-full flex-1 justify-between">
            {/* Top Instruction Banner */}
            <section className="w-full bg-bg-surface rounded-xl p-6 lg:p-8 shadow-md border border-border-subtle relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-accent-eficiencia/5 pointer-events-none"></div>
              <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full bg-accent-eficiencia animate-ping"></span>
                    <span className="font-label-sm text-label-sm text-text-secondary tracking-widest uppercase">
                      ENLACE DE RED OPERATIVO
                    </span>
                  </div>
                  <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight uppercase font-bold">
                    CENTRO DE TELEMETRÍA — ESPERANDO CONEXIÓN DE EQUIPOS
                  </h1>
                  <p className="font-body-md text-body-md text-text-secondary max-w-2xl">
                    Verificación de terminales remotas para despliegue de simulación de despacho eléctrico y contingencia.
                  </p>
                </div>

                <div className="flex items-center gap-4 bg-surface-container-lowest px-6 py-4 rounded-xl border border-border-subtle shadow-inner">
                  <div className="flex flex-col items-end">
                    <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
                      ESTADO DE QUÓRUM
                    </span>
                    <span className="font-metric-display text-metric-display text-accent-eficiencia tabular-nums font-bold leading-none mt-1">
                      {mockTeams.length} / {mockTeams.length}
                    </span>
                  </div>
                  <div className="h-10 w-px bg-surface-container-highest"></div>
                  <div className="flex flex-col">
                    <span className="font-label-md text-label-md text-text-primary font-semibold uppercase">
                      EQUIPOS
                    </span>
                    <span className="font-label-sm text-label-sm text-accent-eficiencia tracking-wide uppercase">
                      SINCRONIZADOS
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* Teams Connected Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {mockTeams.map((team, idx) => (
                <div
                  key={team.id}
                  className="bg-bg-surface rounded-xl p-5 border border-border-subtle shadow-lg flex flex-col justify-between gap-4"
                >
                  <div className="flex items-center justify-between pb-3 border-b border-border-subtle">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-3.5 h-3.5 rounded-full"
                        style={{ backgroundColor: team.color }}
                      ></div>
                      <div>
                        <span className="font-label-sm text-[11px] text-text-secondary uppercase block">
                          NODO SCADA #0{idx + 1}
                        </span>
                        <h2 className="font-headline-sm font-bold text-text-primary uppercase">
                          {team.name}
                        </h2>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-accent-eficiencia/10 border border-accent-eficiencia/30 text-accent-eficiencia font-label-sm text-label-sm font-bold uppercase">
                      LISTO
                    </span>
                  </div>

                  <div className="bg-surface-container-lowest p-3 rounded-lg flex flex-col gap-1 border border-border-subtle">
                    <div className="flex items-center justify-between font-label-sm text-label-sm text-text-secondary">
                      <span>PRESUPUESTO ASIGNADO:</span>
                      <span className="text-text-primary font-bold tabular-nums">
                        ${team.presupuesto.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between font-label-sm text-label-sm text-text-secondary">
                      <span>EFICIENCIA BASE:</span>
                      <span className="text-accent-eficiencia font-bold tabular-nums">
                        {team.eficiencia}%
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between font-label-sm text-[11px] text-text-secondary">
                    <span className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[14px] text-accent-eficiencia">
                        wifi
                      </span>
                      LATENCIA 12ms
                    </span>
                    <span>TERMINAL ACTIVA</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Launch Simulation CTA */}
            <div className="flex items-center justify-between bg-bg-surface p-6 rounded-xl border border-border-subtle shadow-lg flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[28px] text-accent-presupuesto">
                  settings_ethernet
                </span>
                <div>
                  <h3 className="font-headline-sm font-bold text-text-primary uppercase">
                    Quórum Completo — Red en Estado Nominal
                  </h3>
                  <p className="font-body-sm text-body-sm text-text-secondary">
                    Todas las terminales han cargado los parámetros iniciales de micro-red.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPhase('en_juego')}
                className="h-12 px-8 rounded-xl bg-primary-container text-on-primary-container font-label-lg text-label-lg font-bold uppercase tracking-wider shadow-lg hover:opacity-90 active:scale-95 transition-all flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[20px]">play_arrow</span>
                <span>INICIAR SIMULACIÓN DE DESPACHO</span>
              </button>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* PHASE 2: EN JUEGO                                         */}
        {/* ========================================================= */}
        {phase === 'en_juego' && (
          <div className="flex flex-col gap-6 w-full">
            {/* Real-Time Grid Status Bar */}
            <div className="w-full bg-bg-surface border border-border-subtle rounded-xl px-4 py-2.5 flex items-center justify-between shadow-md">
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-accent-eficiencia animate-pulse"></span>
                <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-wider font-semibold">
                  ESTADO DE EVENTO DE RED:
                </span>
                <span className="font-body-md text-body-md text-text-primary">
                  Consumo residencial nominal en Sector Alfa/Gamma. Dispersión térmica sobre 48%.
                </span>
              </div>
              <div className="hidden sm:flex items-center gap-2 font-label-sm text-label-sm text-text-secondary">
                <span>VOLTAJE: 220V NOMINAL</span>
                <span>•</span>
                <span>CARGA TOTAL: 789 kWh</span>
              </div>
            </div>

            {/* Neighborhood Stage (Isometric low-poly block) */}
            <NeighborhoodStage teams={mockTeams} isCrisis={false} />

            {/* Telemetry Cards Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-gutter-desktop w-full">
              {mockTeams.slice(0, 4).map((team, idx) => (
                <TeamCard
                  key={team.id}
                  team={team}
                  rank={idx + 1}
                  variant="default"
                  isLeader={idx === 0}
                />
              ))}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* PHASE 3: CRISIS DE RED                                    */}
        {/* ========================================================= */}
        {phase === 'crisis' && (
          <div className="flex flex-col gap-6 w-full">
            {/* Crisis Alert Banner */}
            <CrisisOverlay onDismiss={() => setPhase('en_juego')} />

            {/* Neighborhood Stage in Crisis Mode */}
            <NeighborhoodStage teams={mockTeams} isCrisis={true} />

            {/* Telemetry Cards with Crisis Impact */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-gutter-desktop w-full">
              {mockTeams.slice(0, 4).map((team, idx) => (
                <TeamCard
                  key={team.id}
                  team={team}
                  rank={idx + 1}
                  variant="crisis"
                  isLeader={idx === 0}
                />
              ))}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* PHASE 4: RESULTADOS Y PODIO                               */}
        {/* ========================================================= */}
        {phase === 'resultados' && (
          <div className="flex flex-col gap-8 w-full">
            {/* Header of Podium */}
            <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[32px] text-accent-eficiencia">
                  military_tech
                </span>
                <div>
                  <h1 className="font-headline-lg text-headline-lg font-bold uppercase tracking-tight text-text-primary">
                    Desempeño Final y Podio de Resiliencia
                  </h1>
                  <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-widest">
                    ANÁLISIS COMPARATIVO DE CONSUMO Y EFICIENCIA ENERGÉTICA
                  </span>
                </div>
              </div>
              <span className="px-3 py-1 rounded bg-accent-eficiencia/10 border border-accent-eficiencia/30 text-accent-eficiencia font-label-md text-label-md font-bold uppercase">
                SIMULACIÓN CONCLUIDA
              </span>
            </div>

            {/* 3-Column SCADA Podium Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-md items-end">
              {/* 2nd Place: Gamma (Left Column) */}
              <div className="lg:col-span-4 order-2 lg:order-1">
                <TeamCard team={mockTeams[1]} rank={2} variant="podium" />
              </div>

              {/* 1st Place: Alfa (Center Column - Elevated) */}
              <div className="lg:col-span-4 order-1 lg:order-2 lg:-translate-y-4">
                <TeamCard team={mockTeams[0]} rank={1} variant="podium" isLeader={true} />
              </div>

              {/* 3rd Place: Delta (Right Column) */}
              <div className="lg:col-span-4 order-3">
                <TeamCard team={mockTeams[2]} rank={3} variant="podium" />
              </div>
            </div>

            {/* 4th Place / Rest of Teams Summary Row */}
            <div className="w-full bg-surface-container rounded-xl p-4 border border-border-subtle flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <span className="font-label-lg text-label-lg font-bold text-accent-crisis">#4</span>
                <span className="font-headline-sm font-bold uppercase text-text-primary">
                  {mockTeams[3].name}
                </span>
                <span className="px-2 py-0.5 rounded bg-accent-crisis/10 text-accent-crisis font-label-sm text-label-sm font-bold uppercase">
                  SOBRECONSUMO CRÍTICO
                </span>
              </div>
              <div className="flex items-center gap-6 font-label-sm text-label-sm text-text-secondary">
                <span>
                  ELECTRICIDAD: <strong className="text-text-primary">{mockTeams[3].electricidad} kWh</strong>
                </span>
                <span>
                  GAS: <strong className="text-text-primary">{mockTeams[3].gas} m³</strong>
                </span>
                <span>
                  PRESUPUESTO: <strong className="text-text-primary">${mockTeams[3].presupuesto.toLocaleString()}</strong>
                </span>
                <span>
                  EFICIENCIA: <strong className="text-accent-crisis">{mockTeams[3].eficiencia}%</strong>
                </span>
              </div>
            </div>

            {/* Verbatim Educational Conclusion Block from Stitch */}
            <section className="w-full bg-surface-container rounded-xl p-space-lg lg:p-space-xl relative overflow-hidden shadow-xl border border-border-subtle">
              <div className="absolute top-0 left-0 bottom-0 w-2 bg-accent-presupuesto"></div>
              <div className="flex flex-col gap-space-md pl-space-xs md:pl-space-sm">
                <div className="flex items-center justify-between flex-wrap gap-space-sm">
                  <div className="flex items-center gap-space-xs">
                    <span className="material-symbols-outlined text-accent-presupuesto text-[24px]">
                      speed
                    </span>
                    <h2 className="font-label-lg text-label-lg uppercase tracking-widest text-accent-presupuesto font-bold">
                      Conclusión Educativa
                    </h2>
                  </div>
                  <div className="flex items-center gap-space-xs font-label-sm text-label-sm text-text-secondary uppercase">
                    <span>Síntesis Conceptual</span>
                    <span>•</span>
                    <span>Simulador de Resiliencia Energética</span>
                  </div>
                </div>

                <blockquote className="font-headline-lg text-headline-lg lg:text-headline-xl text-text-primary font-bold tracking-tight leading-snug">
                  “El equipo que consiguió el mejor resultado no fue necesariamente el que dejó de consumir, sino el que eliminó los consumos innecesarios manteniendo las necesidades básicas.”
                </blockquote>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md pt-space-xs">
                  <div className="bg-surface-container-lowest p-space-md rounded-lg border border-border-subtle">
                    <div className="flex items-center gap-2 mb-2 text-accent-eficiencia">
                      <span className="material-symbols-outlined text-[18px]">verified</span>
                      <h4 className="font-label-md text-label-md font-bold uppercase">
                        Gestión Pasiva vs Apagón
                      </h4>
                    </div>
                    <p className="font-body-sm text-body-sm text-text-secondary">
                      Apagar todos los servicios esenciales genera pérdidas de bienestar innecesarias. El control térmico inteligente mantiene la comodidad reduciendo picos de demanda.
                    </p>
                  </div>

                  <div className="bg-surface-container-lowest p-space-md rounded-lg border border-border-subtle">
                    <div className="flex items-center gap-2 mb-2 text-accent-presupuesto">
                      <span className="material-symbols-outlined text-[18px]">account_balance_wallet</span>
                      <h4 className="font-label-md text-label-md font-bold uppercase">
                        Presupuesto Sostenible
                      </h4>
                    </div>
                    <p className="font-body-sm text-body-sm text-text-secondary">
                      Prevenir consumos parásitos deja margen financiero para absorber aumentos tarifarios imprevistos durante contingencias de red.
                    </p>
                  </div>

                  <div className="bg-surface-container-lowest p-space-md rounded-lg border border-border-subtle">
                    <div className="flex items-center gap-2 mb-2 text-secondary">
                      <span className="material-symbols-outlined text-[18px]">share</span>
                      <h4 className="font-label-md text-label-md font-bold uppercase">
                        Impacto Colectivo en Red
                      </h4>
                    </div>
                    <p className="font-body-sm text-body-sm text-text-secondary">
                      El comportamiento de un usuario individual repercute en la estabilidad de toda la micro-red comunitaria. La resiliencia es compartida.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Persistent SCADA Footer */}
      <footer className="w-full bg-bg-surface border-t border-border-subtle mt-auto">
        <div className="w-full h-12 px-margin-desktop flex items-center justify-between font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
          <div className="flex items-center gap-space-md">
            <span>TELEMETRÍA INDUSTRIAL DE RED</span>
            <span className="text-border-subtle">/</span>
            <span>FRECUENCIA 50.00 HZ</span>
            <span className="text-border-subtle">/</span>
            <span>RED DISTRIBUIDA SCADA</span>
          </div>
          <div className="flex items-center gap-space-sm">
            <span
              className={`w-2 h-2 rounded-full ${
                phase === 'crisis' ? 'bg-accent-crisis animate-ping' : 'bg-accent-eficiencia'
              }`}
            ></span>
            <span>{phase === 'crisis' ? 'ALERTA DE DESLASTRE' : 'SISTEMA NOMINAL EN LÍNEA'}</span>
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
          CARGANDO MATRIZ HOST SCADA...
        </div>
      }
    >
      <HostContent />
    </Suspense>
  );
}
