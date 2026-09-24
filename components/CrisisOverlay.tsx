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
 * Toma de pantalla de la crisis, en dos capas:
 *
 *  1. Un efecto fijo a pantalla completa (barrido rojo, franjas de estática, glitch y el
 *     rótulo enorme) que es `pointer-events-none` y vive en z-40, POR DEBAJO del header
 *     (z-50): el anfitrión conserva sus controles y puede seguir pulsando.
 *  2. El panel informativo, en el flujo normal de la página, con los números reales del
 *     evento (multiplicador del motor y carga de línea reportada por el servicio).
 */
export default function CrisisOverlay({
  onDismiss,
  className = '',
  cargaLineaPct = null,
}: CrisisOverlayProps) {
  const incremento = Math.round((CRISIS_PRICE_MULTIPLIER - 1) * 100);

  return (
    <>
      {/* Capa de efecto: nunca recibe clics, nunca tapa los controles del anfitrión. */}
      <div
        aria-hidden="true"
        className="eec-crisis-fx pointer-events-none fixed inset-0 z-40 overflow-hidden"
      >
        {/* Franjas de estática (fijas, sin coste de movimiento) */}
        <div className="absolute inset-0 opacity-[0.5] eec-crisis-scanlines" />
        <div className="absolute inset-0 eec-crisis-static" />

        {/* Barrido rojo que recorre la pantalla */}
        <div className="absolute left-0 right-0 top-0 h-[26%] eec-crisis-sweep" />

        {/* Vignette rojo en los bordes */}
        <div className="absolute inset-0 eec-crisis-vignette" />

        {/* Franja de peligro justo debajo del header */}
        <div className="absolute left-0 right-0 top-20 h-2 eec-crisis-hazard" />

        {/* Rótulo enorme, translúcido: se lee a distancia sin ocultar el tablero */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center px-6">
          <span className="eec-crisis-glitch font-headline-xl text-[min(9vw,104px)] font-bold uppercase tracking-tighter text-accent-crisis text-center leading-none">
            ALERTA TARIFARIA
          </span>
        </div>
      </div>

      {/* Panel informativo (en flujo: no tapa nada) */}
      <div
        className={`relative w-full rounded-xl bg-gradient-to-r from-accent-crisis/20 via-bg-surface to-accent-crisis/10 border-2 border-accent-crisis p-space-md shadow-2xl overflow-hidden flex flex-col md:flex-row items-center justify-between gap-4 ${className}`}
      >
        <div className="absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(255,59,78,0.06)_10px,rgba(255,59,78,0.06)_20px)] pointer-events-none"></div>

        <div className="relative z-10 flex items-center gap-space-md">
          <div className="w-12 h-12 rounded-xl bg-accent-crisis/20 border border-accent-crisis flex items-center justify-center shrink-0 text-accent-crisis">
            <span className="material-symbols-outlined text-[28px]">crisis_alert</span>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-accent-crisis text-white font-label-sm text-label-sm font-bold uppercase tracking-wider">
                ALERTA TARIFARIA
              </span>
              <span className="font-label-sm text-label-sm text-accent-crisis uppercase tracking-widest font-bold tabular-nums">
                TARIFA +{incremento} %
              </span>
            </div>
            <h2 className="font-headline-lg text-headline-lg font-bold text-text-primary uppercase tracking-tight mt-0.5">
              Crisis energética en la red del aula
            </h2>
            <p className="font-body-md text-body-md text-text-secondary max-w-2xl">
              La demanda del aula disparó el precio de la electricidad un {incremento} %. El recargo
              se aplica sobre el consumo acumulado de cada equipo: quien ya redujo, paga menos.
            </p>
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-3 shrink-0">
          <div className="flex flex-col items-end px-3 py-1.5 rounded bg-surface border border-border-subtle">
            <span className="font-label-sm text-[10px] text-text-secondary uppercase">
              CONSUMO DEL AULA
            </span>
            <span className="font-metric-display-mobile text-metric-display-mobile text-accent-crisis font-bold leading-none tabular-nums">
              {cargaLineaPct === null ? '—' : `${cargaLineaPct.toFixed(0)} %`}
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

      <style jsx>{`
        /* Barrido rojo: el efecto continuo de la crisis (presupuesto de movimiento del proyector). */
        .eec-crisis-sweep {
          background: linear-gradient(
            to bottom,
            rgba(255, 59, 78, 0) 0%,
            rgba(255, 59, 78, 0.18) 45%,
            rgba(255, 59, 78, 0) 100%
          );
          animation: eecCrisisSweep 3.4s linear infinite;
          will-change: transform;
        }

        @keyframes eecCrisisSweep {
          from {
            transform: translate3d(0, -120%, 0);
          }
          to {
            transform: translate3d(0, 480%, 0);
          }
        }

        .eec-crisis-scanlines {
          background: repeating-linear-gradient(
            to bottom,
            rgba(231, 236, 245, 0.045) 0 1px,
            rgba(10, 14, 23, 0) 1px 3px
          );
        }

        /* Franjas de estática: borde superior de la señal, sin animación. */
        .eec-crisis-static {
          background: repeating-linear-gradient(
            to bottom,
            rgba(255, 59, 78, 0) 0 7%,
            rgba(255, 59, 78, 0.07) 7% 7.6%,
            rgba(255, 59, 78, 0) 7.6% 19%
          );
          mix-blend-mode: screen;
        }

        .eec-crisis-vignette {
          background: radial-gradient(
            120% 90% at 50% 45%,
            rgba(255, 59, 78, 0) 42%,
            rgba(255, 59, 78, 0.2) 100%
          );
        }

        .eec-crisis-hazard {
          background: repeating-linear-gradient(
            45deg,
            #ff3b4e 0 12px,
            rgba(10, 14, 23, 0.85) 12px 24px
          );
          opacity: 0.65;
        }

        /* Glitch del rótulo: seco, corto y repetido. */
        .eec-crisis-glitch {
          opacity: 0.32;
          text-shadow: 0 0 26px rgba(255, 59, 78, 0.55), 3px 0 0 rgba(62, 198, 240, 0.35);
          animation: eecCrisisGlitch 4.2s steps(1, end) infinite;
          will-change: transform;
        }

        @keyframes eecCrisisGlitch {
          0%,
          56%,
          100% {
            transform: translate3d(0, 0, 0) skewX(0deg);
          }
          58% {
            transform: translate3d(-4px, 1px, 0) skewX(-0.7deg);
          }
          60% {
            transform: translate3d(4px, -1px, 0) skewX(0.6deg);
          }
          63% {
            transform: translate3d(-2px, 0, 0) skewX(0deg);
          }
          80% {
            transform: translate3d(3px, -1px, 0) skewX(0.5deg);
          }
          83% {
            transform: translate3d(0, 0, 0) skewX(0deg);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .eec-crisis-sweep,
          .eec-crisis-glitch {
            animation: none !important;
          }
          .eec-crisis-sweep {
            opacity: 0 !important;
          }
        }
      `}</style>
    </>
  );
}
