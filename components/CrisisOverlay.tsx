'use client';

import React from 'react';

interface CrisisOverlayProps {
  onDismiss?: () => void;
  className?: string;
}

export default function CrisisOverlay({ onDismiss, className = '' }: CrisisOverlayProps) {
  return (
    <div
      className={`w-full rounded-xl bg-gradient-to-r from-accent-crisis/20 via-bg-surface to-accent-crisis/10 border-2 border-accent-crisis p-space-md shadow-2xl relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-4 ${className}`}
    >
      {/* Background Warning Diagonal Lines */}
      <div className="absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(255,59,78,0.06)_10px,rgba(255,59,78,0.06)_20px)] pointer-events-none"></div>

      <div className="relative z-10 flex items-center gap-space-md">
        <div className="w-12 h-12 rounded-xl bg-accent-crisis/20 border border-accent-crisis flex items-center justify-center shrink-0 animate-pulse text-accent-crisis">
          <span className="material-symbols-outlined text-[28px]">crisis_alert</span>
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-accent-crisis text-white font-label-sm text-label-sm font-bold uppercase tracking-wider animate-bounce">
              ALERTA CRÍTICA
            </span>
            <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-widest">
              DISPERSIÓN TÉRMICA &gt; 92%
            </span>
          </div>
          <h2 className="font-headline-sm font-bold text-text-primary uppercase tracking-tight mt-0.5">
            Pico de Demanda en Subestación Residencial
          </h2>
          <p className="font-body-sm text-body-sm text-text-secondary max-w-2xl">
            Desbalance por sobrecalentamiento en transformador principal. La tarifa se incrementó un 300%. Los equipos deben reducir carga no esencial para evitar desconexión forzada.
          </p>
        </div>
      </div>

      <div className="relative z-10 flex items-center gap-3 shrink-0">
        <div className="flex flex-col items-end px-3 py-1.5 rounded bg-surface border border-border-subtle">
          <span className="font-label-sm text-[10px] text-text-secondary uppercase">CARGA DE LÍNEA</span>
          <span className="font-metric-display-mobile text-metric-display-mobile text-accent-crisis font-bold leading-none tabular-nums">
            96.4%
          </span>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="h-10 px-4 rounded-lg bg-surface-container-high hover:bg-surface-bright text-text-primary font-label-md text-label-md font-bold uppercase tracking-wider border border-border-subtle transition-all active:scale-95"
          >
            Estabilizar
          </button>
        )}
      </div>
    </div>
  );
}
