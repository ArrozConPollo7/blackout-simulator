'use client';

import React, { useState, useEffect } from 'react';

interface GameHeaderProps {
  phaseName?: string;
  phaseCode?: string;
  timerString?: string;
  isCrisis?: boolean;
  onTriggerCrisis?: () => void;
  onPause?: () => void;
}

export default function GameHeader({
  phaseName = 'En Juego — Despacho y Telemetría',
  phaseCode = 'FASE DE OPERACIÓN',
  timerString = '03:42',
  isCrisis = false,
  onTriggerCrisis,
  onPause,
}: GameHeaderProps) {
  const [seconds, setSeconds] = useState(3 * 60 + 42);

  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const formattedTime = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-bg-surface border-b border-border-subtle shadow-lg">
      <div className="h-20 w-full px-margin-desktop flex items-center justify-between">
        {/* Title & System Status */}
        <div className="flex items-center gap-space-md">
          <div className="flex items-center gap-space-xs">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                isCrisis ? 'bg-accent-crisis animate-ping' : 'bg-accent-eficiencia animate-pulse'
              }`}
            ></div>
            <span className="font-headline-md text-headline-md tracking-wider text-text-primary uppercase font-bold">
              Energía en Crisis
            </span>
          </div>

          <div className="h-6 w-px bg-border-subtle hidden sm:block"></div>

          <div className="hidden lg:flex items-center gap-space-xs">
            <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-widest">
              SCADA CORE
            </span>
            <div className="px-2 py-0.5 rounded bg-surface border border-border-subtle font-label-md text-label-md text-accent-presupuesto tracking-wide">
              CENTRO DE CONTROL HOST
            </div>
          </div>

          <div
            className={`px-2.5 py-1 rounded bg-surface border font-label-md text-label-md font-semibold tracking-wider uppercase ${
              isCrisis
                ? 'border-accent-crisis text-accent-crisis bg-accent-crisis/10 animate-pulse'
                : 'border-accent-presupuesto/40 text-accent-presupuesto'
            }`}
          >
            {isCrisis ? 'ALERTA DE CRISIS' : phaseCode}
          </div>
        </div>

        {/* Timer & Host Control Actuators */}
        <div className="flex items-center gap-space-md">
          {/* SCADA Countdown Module */}
          <div
            className={`flex items-center gap-space-xs px-3.5 py-1.5 rounded-lg border shadow-inner ${
              isCrisis
                ? 'bg-accent-crisis/10 border-accent-crisis text-accent-crisis'
                : 'bg-surface border-border-subtle text-accent-electricidad'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">timer</span>
            <div className="flex flex-col">
              <span className="font-label-sm text-[10px] text-text-secondary uppercase leading-none">
                TIEMPO RESTANTE
              </span>
              <span
                id="countdown"
                className="font-metric-display-mobile text-metric-display-mobile font-bold tracking-wider leading-none tabular-nums mt-0.5"
              >
                {formattedTime}
              </span>
            </div>
          </div>

          {/* Quick Simulation Actions */}
          <div className="hidden md:flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-surface rounded-lg font-label-sm text-label-sm text-text-secondary border border-border-subtle">
              <span className="material-symbols-outlined text-[16px] text-accent-eficiencia">sync</span>
              <span>SINCRONÍA HOST: OK</span>
            </div>

            {onTriggerCrisis && (
              <button
                type="button"
                onClick={onTriggerCrisis}
                className={`h-10 px-3.5 rounded-lg font-label-md text-label-md font-bold uppercase tracking-wider transition-all flex items-center gap-2 shadow-sm active:scale-95 ${
                  isCrisis
                    ? 'bg-accent-crisis text-white hover:bg-opacity-90'
                    : 'bg-primary-container text-on-primary-container hover:opacity-90'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {isCrisis ? 'warning' : 'bolt'}
                </span>
                <span>{isCrisis ? 'CRISIS ACTIVA' : 'DISPARAR CRISIS'}</span>
              </button>
            )}

            {onPause && (
              <button
                type="button"
                onClick={onPause}
                className="h-10 px-3.5 rounded-lg bg-surface-container-high text-text-primary font-label-md text-label-md font-bold uppercase tracking-wider transition-colors hover:bg-surface-bright active:scale-95 flex items-center gap-2 shadow-sm border border-border-subtle"
              >
                <span className="material-symbols-outlined text-[18px]">pause</span>
                <span>PAUSAR</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
