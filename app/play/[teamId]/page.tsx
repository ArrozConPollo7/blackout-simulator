'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { mockTeams, mockAppliances, mockDecisions, mockCrisisDecisions } from '@/mock/gameState';
import { Appliance, DecisionOption } from '@/types/game';

type PlayerPhase = 'investigar' | 'decidir' | 'crisis' | 'resultados';

export default function PlayerPage({ params }: { params: { teamId: string } }) {
  const teamId = params.teamId.toLowerCase();
  const team = mockTeams.find((t) => t.id === teamId) || mockTeams[0];

  const [phase, setPhase] = useState<PlayerPhase>('investigar');
  const [selectedAppliance, setSelectedAppliance] = useState<Appliance | null>(null);
  const [selectedDecision, setSelectedDecision] = useState<string>('opt_b');
  const [selectedCrisisDecision, setSelectedCrisisDecision] = useState<string>('crisis_opt_1');
  const [decisionConfirmed, setDecisionConfirmed] = useState(false);

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary flex flex-col items-center">
      {/* Container restricted to mobile viewport for authentic phone ergonomics */}
      <div className="w-full max-w-md min-h-screen flex flex-col bg-bg-primary relative pb-20">
        {/* ========================================================= */}
        {/* PERSISTENT MOBILE HEADER                                  */}
        {/* ========================================================= */}
        <header className="fixed top-0 max-w-md w-full z-50 bg-bg-surface/95 backdrop-blur-xl border-b border-border-subtle shadow-md">
          <div className="px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full animate-pulse"
                  style={{ backgroundColor: team.color }}
                ></span>
                <span className="font-label-md text-label-md uppercase tracking-wider text-text-primary font-bold">
                  {team.name}
                </span>
                <span className="font-body-sm text-body-sm text-text-secondary capitalize">
                  / {phase}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-bg-primary border border-border-subtle">
                  <span className="material-symbols-outlined text-[14px] text-accent-electricidad">
                    timer
                  </span>
                  <span className="font-label-md text-label-md text-accent-electricidad font-bold tabular-nums">
                    03:45
                  </span>
                </div>
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs"
                  style={{ backgroundColor: team.color, color: '#0A0E17' }}
                >
                  <span className="material-symbols-outlined text-[16px]">home</span>
                </div>
              </div>
            </div>

            {/* 4 Miniature Telemetry Badges */}
            <div className="grid grid-cols-4 gap-1.5 pt-0.5">
              <div className="flex items-center gap-1 px-1.5 py-1 rounded bg-bg-primary/80 border border-border-subtle">
                <span className="material-symbols-outlined text-accent-electricidad text-[14px]">bolt</span>
                <div className="flex flex-col min-w-0">
                  <span className="font-label-sm text-[9px] text-text-secondary uppercase leading-none">Elec</span>
                  <span className="font-label-sm text-[11px] text-text-primary truncate font-bold leading-tight tabular-nums">
                    {team.electricidad}k
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 px-1.5 py-1 rounded bg-bg-primary/80 border border-border-subtle">
                <span className="material-symbols-outlined text-accent-gas text-[14px]">local_fire_department</span>
                <div className="flex flex-col min-w-0">
                  <span className="font-label-sm text-[9px] text-text-secondary uppercase leading-none">Gas</span>
                  <span className="font-label-sm text-[11px] text-text-primary truncate font-bold leading-tight tabular-nums">
                    {team.gas}m³
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 px-1.5 py-1 rounded bg-bg-primary/80 border border-border-subtle">
                <span className="material-symbols-outlined text-accent-presupuesto text-[14px]">account_balance_wallet</span>
                <div className="flex flex-col min-w-0">
                  <span className="font-label-sm text-[9px] text-text-secondary uppercase leading-none">Ppto</span>
                  <span className="font-label-sm text-[11px] text-text-primary truncate font-bold leading-tight tabular-nums">
                    ${(team.presupuesto / 1000).toFixed(0)}k
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 px-1.5 py-1 rounded bg-bg-primary/80 border border-border-subtle">
                <span className="material-symbols-outlined text-accent-eficiencia text-[14px]">speed</span>
                <div className="flex flex-col min-w-0">
                  <span className="font-label-sm text-[9px] text-text-secondary uppercase leading-none">Efic</span>
                  <span className="font-label-sm text-[11px] text-accent-eficiencia truncate font-bold leading-tight tabular-nums">
                    {team.eficiencia}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* ========================================================= */}
        {/* MAIN BODY PER PHASE                                       */}
        {/* ========================================================= */}
        <main className="w-full pt-28 px-4 flex-1 flex flex-col gap-4">
          {/* PHASE 1: INVESTIGAR ELECTRODOMÉSTICOS */}
          {phase === 'investigar' && (
            <div className="flex flex-col gap-4 animate-in fade-in duration-200">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-3.5 rounded-full bg-primary-container"></span>
                  <h2 className="font-headline-md text-headline-md tracking-tight text-text-primary font-bold">
                    AUDITORÍA DE ARTEFACTOS
                  </h2>
                </div>
                <p className="font-body-sm text-body-sm text-text-secondary pl-3">
                  Toca un electrodoméstico para inspeccionar su potencia y consumo pasivo.
                </p>
              </div>

              {/* Grid of Appliances */}
              <div className="grid grid-cols-2 gap-3">
                {mockAppliances.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => setSelectedAppliance(app)}
                    className={`p-3 rounded-xl bg-bg-surface border text-left flex flex-col justify-between min-h-[110px] transition-all active:scale-95 ${
                      selectedAppliance?.id === app.id
                        ? 'border-accent-presupuesto ring-1 ring-accent-presupuesto'
                        : 'border-border-subtle hover:border-text-secondary/40'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="material-symbols-outlined text-[24px] text-accent-presupuesto">
                        {app.icon}
                      </span>
                      {app.isHighImpact && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent-gas/20 text-accent-gas font-bold uppercase">
                          ALTO GASTO
                        </span>
                      )}
                    </div>
                    <div>
                      <h4 className="font-label-md text-label-md font-bold text-text-primary leading-tight">
                        {app.name}
                      </h4>
                      <span className="font-label-sm text-[11px] text-accent-electricidad block font-semibold tabular-nums mt-0.5">
                        {app.consumptionText}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Selected Appliance Audit Detail Card */}
              {selectedAppliance && (
                <div className="p-4 rounded-xl bg-surface-container border border-border-subtle shadow-xl flex flex-col gap-2.5 animate-in slide-in-from-bottom-2 duration-200">
                  <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[20px] text-accent-presupuesto">
                        {selectedAppliance.icon}
                      </span>
                      <h3 className="font-headline-sm font-bold text-text-primary">
                        {selectedAppliance.name}
                      </h3>
                    </div>
                    <span className="font-label-sm text-label-sm text-text-secondary uppercase">
                      {selectedAppliance.category}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-label-sm">
                    <div className="bg-surface-container-lowest p-2 rounded">
                      <span className="text-text-secondary text-[10px] uppercase block">Consumo Nominal</span>
                      <span className="text-accent-electricidad font-bold">
                        {selectedAppliance.consumptionText}
                      </span>
                    </div>
                    <div className="bg-surface-container-lowest p-2 rounded">
                      <span className="text-text-secondary text-[10px] uppercase block">Costo Ciclo</span>
                      <span className="text-accent-presupuesto font-bold">
                        {selectedAppliance.costText}
                      </span>
                    </div>
                  </div>

                  <p className="font-body-sm text-body-sm text-text-secondary">
                    Estado Actual: <strong className="text-text-primary">{selectedAppliance.stateText}</strong>
                  </p>
                </div>
              )}

              {/* Bottom Continue CTA */}
              <button
                type="button"
                onClick={() => setPhase('decidir')}
                className="w-full h-12 rounded-xl bg-primary-container text-on-primary-container font-label-md text-label-md font-bold uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-all mt-2"
              >
                <span>IR A TOMAR DECISIÓN</span>
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </button>
            </div>
          )}

          {/* PHASE 2: DECIDIR ESCENARIO */}
          {phase === 'decidir' && (
            <div className="flex flex-col gap-4 animate-in fade-in duration-200">
              {/* Tactical Scenario Box */}
              <section className="flex flex-col gap-2 p-4 rounded-xl bg-bg-surface border border-border-subtle shadow-md">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-container-high w-fit">
                    <span className="material-symbols-outlined text-[14px] text-accent-electricidad">
                      thermostat
                    </span>
                    <span className="font-label-sm text-label-sm text-text-secondary uppercase">
                      TEMPERATURA AMBIENTE: 36°C
                    </span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-accent-gas/20 text-accent-gas font-bold uppercase">
                    OLA DE CALOR
                  </span>
                </div>
                <h2 className="font-headline-md text-headline-md text-text-primary tracking-tight font-bold">
                  Hoy hace mucho calor
                </h2>
                <p className="font-body-sm text-body-sm text-text-secondary">
                  El calor incrementa la demanda de enfriamiento. Selecciona la configuración de tus artefactos para este ciclo de despacho.
                </p>
              </section>

              {/* Stacked Decision Options (min-height 48px tactile requirement) */}
              <div className="flex flex-col gap-3">
                {mockDecisions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setSelectedDecision(opt.id);
                      setDecisionConfirmed(false);
                    }}
                    className={`min-h-[58px] p-3.5 rounded-xl border text-left flex flex-col justify-between gap-2 transition-all active:scale-[0.98] ${
                      selectedDecision === opt.id
                        ? 'bg-surface-container border-accent-presupuesto ring-1 ring-accent-presupuesto shadow-md'
                        : 'bg-bg-surface border-border-subtle hover:border-text-secondary/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                            selectedDecision === opt.id
                              ? 'border-accent-presupuesto bg-accent-presupuesto'
                              : 'border-text-secondary'
                          }`}
                        >
                          {selectedDecision === opt.id && (
                            <span className="w-1.5 h-1.5 rounded-full bg-bg-primary"></span>
                          )}
                        </span>
                        <h4 className="font-label-md text-label-md font-bold text-text-primary">
                          {opt.title}
                        </h4>
                      </div>
                      {opt.recommended && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent-eficiencia/20 text-accent-eficiencia font-bold uppercase">
                          RECOMENDADO
                        </span>
                      )}
                      {opt.isHighRisk && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent-gas/20 text-accent-gas font-bold uppercase">
                          SOBREGASTO
                        </span>
                      )}
                    </div>
                    <p className="font-body-sm text-[12px] text-text-secondary pl-6">
                      {opt.description}
                    </p>
                    <div className="flex items-center gap-3 pl-6 font-label-sm text-[11px] text-text-secondary">
                      <span>Elec: <strong className="text-accent-electricidad">{opt.impactElectricidad}</strong></span>
                      <span>Ppto: <strong className="text-accent-presupuesto">{opt.impactPresupuesto}</strong></span>
                      <span>Confort: <strong className="text-text-primary">{opt.impactComfort}</strong></span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Submit CTA */}
              <button
                type="button"
                onClick={() => setDecisionConfirmed(true)}
                className={`w-full h-12 rounded-xl font-label-md text-label-md font-bold uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-all mt-2 ${
                  decisionConfirmed
                    ? 'bg-accent-eficiencia text-bg-primary'
                    : 'bg-primary-container text-on-primary-container'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {decisionConfirmed ? 'check_circle' : 'send'}
                </span>
                <span>{decisionConfirmed ? 'DECISIÓN REGISTRADA' : 'CONFIRMAR DECISIÓN'}</span>
              </button>
            </div>
          )}

          {/* PHASE 3: ALERTA DE CRISIS */}
          {phase === 'crisis' && (
            <div className="flex flex-col gap-4 animate-in fade-in duration-200">
              {/* Full Mobile Crisis Alert Card */}
              <div className="relative overflow-hidden rounded-xl bg-error-container/40 p-4 shadow-xl border border-accent-crisis">
                <div className="absolute inset-0 bg-gradient-to-b from-accent-crisis/10 to-transparent pointer-events-none"></div>
                <div className="relative flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded bg-accent-crisis text-white font-label-sm text-label-sm font-bold uppercase tracking-wider animate-pulse">
                      ¡ALERTA DE CRISIS!
                    </span>
                    <span className="font-label-md text-label-md text-accent-crisis font-bold">
                      01:30
                    </span>
                  </div>
                  <h1 className="font-headline-md text-headline-md text-text-primary uppercase font-bold tracking-tight">
                    Pico de Demanda en Subestación
                  </h1>
                  <p className="font-body-sm text-body-sm text-text-secondary">
                    La red colapsará si los equipos no reducen su consumo de forma inmediata. La tarifa por kWh subió un 300%.
                  </p>
                </div>
              </div>

              {/* Crisis Decisions */}
              <div className="flex flex-col gap-2.5">
                <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
                  MEDIDAS DE CONTINGENCIA DISPONIBLES:
                </span>
                {mockCrisisDecisions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelectedCrisisDecision(opt.id)}
                    className={`min-h-[58px] p-3.5 rounded-xl border text-left flex flex-col justify-between gap-1.5 transition-all active:scale-[0.98] ${
                      selectedCrisisDecision === opt.id
                        ? 'bg-surface-container border-accent-crisis ring-1 ring-accent-crisis shadow-md'
                        : 'bg-bg-surface border-border-subtle hover:border-text-secondary/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="font-label-md text-label-md font-bold text-text-primary">
                        {opt.title}
                      </h4>
                      {opt.recommended && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent-eficiencia/20 text-accent-eficiencia font-bold uppercase">
                          ÓPTIMO
                        </span>
                      )}
                    </div>
                    <p className="font-body-sm text-[12px] text-text-secondary">
                      {opt.description}
                    </p>
                    <div className="flex items-center gap-3 font-label-sm text-[11px] text-accent-electricidad">
                      <span>Reducción: <strong>{opt.impactElectricidad}</strong></span>
                      <span>Impacto: <strong className="text-text-primary">{opt.impactPresupuesto}</strong></span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Execute Emergency Protocol */}
              <button
                type="button"
                onClick={() => setPhase('resultados')}
                className="w-full h-12 rounded-xl bg-accent-crisis text-white font-label-md text-label-md font-bold uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-all mt-2"
              >
                <span className="material-symbols-outlined text-[18px]">warning</span>
                <span>APLICAR PROTOCOLO DE DESLASTRE</span>
              </button>
            </div>
          )}

          {/* PHASE 4: RESULTADOS Y DESEMPEÑO */}
          {phase === 'resultados' && (
            <div className="flex flex-col gap-4 animate-in fade-in duration-200">
              {/* Status Header Pill */}
              <div className="flex items-center justify-between px-3 py-2 bg-surface-container rounded-lg border border-border-subtle shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-accent-eficiencia animate-pulse"></span>
                  <span className="font-label-sm text-label-sm uppercase tracking-wider text-text-secondary">
                    SIMULACIÓN FINALIZADA
                  </span>
                </div>
                <span className="font-label-sm text-label-sm text-accent-eficiencia font-bold">
                  {team.puntos} PTS
                </span>
              </div>

              {/* Team Finish Hero Card */}
              <div className="p-5 rounded-xl bg-bg-surface border border-accent-eficiencia/40 shadow-xl flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-label-sm text-accent-eficiencia uppercase font-bold tracking-widest block">
                      POSICIÓN EN EL AULA
                    </span>
                    <h2 className="font-headline-lg text-headline-lg font-bold text-text-primary uppercase">
                      {team.name}
                    </h2>
                  </div>
                  <div className="w-14 h-14 rounded-full bg-accent-eficiencia/20 border border-accent-eficiencia flex flex-col items-center justify-center text-accent-eficiencia font-bold">
                    <span className="material-symbols-outlined text-[20px]">emoji_events</span>
                    <span className="text-[12px] leading-none">#1</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border-subtle font-label-sm">
                  <div className="bg-surface-container-lowest p-2.5 rounded">
                    <span className="text-text-secondary text-[10px] uppercase block">Presupuesto Remanente</span>
                    <span className="font-metric-display-mobile text-metric-display-mobile text-text-primary font-bold tabular-nums">
                      ${team.presupuesto.toLocaleString()}
                    </span>
                  </div>
                  <div className="bg-surface-container-lowest p-2.5 rounded">
                    <span className="text-text-secondary text-[10px] uppercase block">Eficiencia Final</span>
                    <span className="font-metric-display-mobile text-metric-display-mobile text-accent-eficiencia font-bold tabular-nums">
                      {team.eficiencia}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Benchmark Comparison with Classroom Average */}
              <div className="p-4 rounded-xl bg-bg-surface border border-border-subtle shadow-md flex flex-col gap-3">
                <h3 className="font-headline-sm font-bold text-text-primary uppercase">
                  Comparativa vs Promedio del Aula
                </h3>

                {/* Metric 1: Electricidad */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between font-label-sm text-label-sm">
                    <span className="text-text-secondary">Electricidad consumida</span>
                    <span className="text-text-primary font-bold">
                      {team.electricidad} kWh <span className="text-text-secondary font-normal">(Prom: 215 kWh)</span>
                    </span>
                  </div>
                  <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
                    <div className="bg-accent-electricidad h-full rounded-full" style={{ width: '51%' }}></div>
                  </div>
                </div>

                {/* Metric 2: Gas */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between font-label-sm text-label-sm">
                    <span className="text-text-secondary">Gas Natural utilizado</span>
                    <span className="text-text-primary font-bold">
                      {team.gas} m³ <span className="text-text-secondary font-normal">(Prom: 28 m³)</span>
                    </span>
                  </div>
                  <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
                    <div className="bg-accent-gas h-full rounded-full" style={{ width: '40%' }}></div>
                  </div>
                </div>

                {/* Metric 3: Presupuesto */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between font-label-sm text-label-sm">
                    <span className="text-text-secondary">Ahorro de presupuesto</span>
                    <span className="text-accent-presupuesto font-bold">
                      ${team.presupuesto.toLocaleString()} <span className="text-text-secondary font-normal">(Prom: $31,500)</span>
                    </span>
                  </div>
                  <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
                    <div className="bg-accent-presupuesto h-full rounded-full" style={{ width: '81%' }}></div>
                  </div>
                </div>
              </div>

              {/* Educational Takeaway */}
              <div className="p-4 rounded-xl bg-surface-container border border-accent-presupuesto/30">
                <span className="font-label-sm text-[10px] text-accent-presupuesto uppercase font-bold tracking-widest block mb-1">
                  LECCIÓN PEDAGÓGICA
                </span>
                <p className="font-body-sm text-body-sm text-text-primary leading-relaxed">
                  “Tu equipo logró el balance óptimo al reducir cargas superfluas durante la ola de calor sin comprometer las necesidades básicas de la vivienda.”
                </p>
              </div>

              <Link
                href="/host?phase=resultados"
                className="w-full h-12 rounded-xl bg-surface-container-high hover:bg-surface-bright text-text-primary border border-border-subtle font-label-md text-label-md font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all mt-2"
              >
                <span className="material-symbols-outlined text-[18px]">desktop_windows</span>
                <span>VER PODIO EN PANTALLA PRINCIPAL</span>
              </Link>
            </div>
          )}
        </main>

        {/* ========================================================= */}
        {/* PERSISTENT MOBILE BOTTOM DOCK                             */}
        {/* ========================================================= */}
        <nav className="fixed bottom-0 max-w-md w-full z-50 bg-bg-surface/95 backdrop-blur-xl border-t border-border-subtle shadow-[0_-2px_12px_rgba(0,0,0,0.4)]">
          <div className="flex justify-around items-center h-16 px-2">
            <button
              type="button"
              onClick={() => setPhase('investigar')}
              className={`flex flex-col items-center justify-center min-w-[48px] min-h-[48px] transition-colors ${
                phase === 'investigar'
                  ? 'text-primary-container font-bold'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">search</span>
              <span className="font-label-sm text-[10px] tracking-tight">Investigar</span>
            </button>
            <button
              type="button"
              onClick={() => setPhase('decidir')}
              className={`flex flex-col items-center justify-center min-w-[48px] min-h-[48px] transition-colors ${
                phase === 'decidir'
                  ? 'text-primary-container font-bold'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">tune</span>
              <span className="font-label-sm text-[10px] tracking-tight">Decidir</span>
            </button>
            <button
              type="button"
              onClick={() => setPhase('crisis')}
              className={`flex flex-col items-center justify-center min-w-[48px] min-h-[48px] transition-colors ${
                phase === 'crisis'
                  ? 'text-accent-crisis font-bold'
                  : 'text-accent-crisis/70 hover:text-accent-crisis'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">warning</span>
              <span className="font-label-sm text-[10px] tracking-tight">Crisis</span>
            </button>
            <button
              type="button"
              onClick={() => setPhase('resultados')}
              className={`flex flex-col items-center justify-center min-w-[48px] min-h-[48px] transition-colors ${
                phase === 'resultados'
                  ? 'text-primary-container font-bold'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">leaderboard</span>
              <span className="font-label-sm text-[10px] tracking-tight">Resultados</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
