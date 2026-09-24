'use client';

import React from 'react';
import { CRISIS_PRICE_MULTIPLIER } from '@/content/economy';

interface CrisisOverlayProps {
  onDismiss?: () => void;
  className?: string;
  /** Carga real de la red: consumo acumulado del aula sobre la referencia del caso. */
  cargaLineaPct?: number | null;
}

/**
 * Banner de crisis. Los números que muestra son reales: el multiplicador sale del
 * motor (`CRISIS_PRICE_MULTIPLIER`) y la carga de línea se calcula con el consumo
 * acumulado que ya reportó el Worker (Design.md: cero datos inventados).
 */
export default function CrisisOverlay({
  onDismiss,
  className = '',
  cargaLineaPct = null,
}: CrisisOverlayProps) {
  const incremento = Math.round((CRISIS_PRICE_MULTIPLIER - 1) * 100);

  return (
    <div
      className={`w-full rounded-xl bg-gradient-to-r from-accent-crisis/20 via-bg-surface to-accent-crisis/10 border-2 border-accent-crisis p-space-md shadow-2xl relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-4 ${className}`}
    >
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
              TARIFA +{incremento}%
            </span>
          </div>
          <h2 className="font-headline-sm font-bold text-text-primary uppercase tracking-tight mt-0.5">
            ¡Crisis energética!
          </h2>
          <p className="font-body-sm text-body-sm text-text-secondary max-w-2xl">
            Debido a una alta demanda, el precio de la electricidad aumentó un {incremento}%. El
            recargo se aplica sobre el consumo acumulado de cada equipo: quien ya redujo, paga menos.
          </p>
        </div>
      </div>

      <div className="relative z-10 flex items-center gap-3 shrink-0">
        <div className="flex flex-col items-end px-3 py-1.5 rounded bg-surface border border-border-subtle">
          <span className="font-label-sm text-[10px] text-text-secondary uppercase">
            CONSUMO DEL AULA
          </span>
          <span className="font-metric-display-mobile text-metric-display-mobile text-accent-crisis font-bold leading-none tabular-nums">
            {cargaLineaPct === null ? '—' : `${cargaLineaPct.toFixed(0)}%`}
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
