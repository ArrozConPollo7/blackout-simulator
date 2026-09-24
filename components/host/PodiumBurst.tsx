'use client';

import React from 'react';

interface PodiumBurstProps {
  /** Cuando está activo, lanza la celebración; al apagarlo y volver a encenderlo se relanza. */
  active: boolean;
  className?: string;
}

const PARTÍCULAS = 44;
/** Paleta de Design.md: nada de colores fuera del sistema. */
const COLORES = ['#F5B942', '#F2622E', '#3ECF8E', '#3EC6F0', '#E7ECF5'];

/**
 * Dispersión determinista por índice (nada de `Math.random`): el servidor y el cliente
 * pintan exactamente la misma celebración, así que no hay desajuste al hidratar.
 */
function particula(indice: number) {
  const r = (indice * 0.6180339887) % 1;
  return {
    izquierda: (indice * 37) % 100,
    retardoMs: Math.round(r * 1_100),
    duracionMs: Math.round(2_100 + r * 1_600),
    derivaPx: ((indice % 7) - 3) * 26,
    giroDeg: 540 + (indice % 4) * 220,
    color: COLORES[indice % COLORES.length],
    anchoPx: indice % 3 === 0 ? 7 : 4,
    altoPx: indice % 3 === 0 ? 13 : 8,
    radioPx: indice % 5 === 0 ? 4 : 1,
  };
}

/**
 * Celebración CSS de la pantalla de resultados: partículas que caen con deriva y giro.
 * Es una sola pasada por partícula (presupuesto de movimiento del proyector) y el
 * contenedor nunca recibe clics. Requiere que quien lo use le dé un padre posicionado
 * (`relative`), o pasarle un `className` con `absolute inset-0` y su propio contenedor.
 */
export default function PodiumBurst({ active, className = '' }: PodiumBurstProps) {
  if (!active) return null;

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {Array.from({ length: PARTÍCULAS }, (_, indice) => {
        const p = particula(indice);
        return (
          <span
            key={`burst-${indice}`}
            className="eec-burst-particle"
            style={
              {
                left: `${p.izquierda}%`,
                width: `${p.anchoPx}px`,
                height: `${p.altoPx}px`,
                borderRadius: `${p.radioPx}px`,
                backgroundColor: p.color,
                animationDelay: `${p.retardoMs}ms`,
                animationDuration: `${p.duracionMs}ms`,
                '--eec-drift': `${p.derivaPx}px`,
                '--eec-spin': `${p.giroDeg}deg`,
              } as React.CSSProperties
            }
          />
        );
      })}

      <style jsx>{`
        .eec-burst-particle {
          position: absolute;
          top: -10%;
          opacity: 0;
          animation-name: eecPodiumFall;
          animation-timing-function: cubic-bezier(0.32, 0.5, 0.72, 1);
          animation-fill-mode: both;
          animation-iteration-count: 1;
          will-change: transform, opacity;
        }

        @keyframes eecPodiumFall {
          0% {
            opacity: 0;
            transform: translate3d(0, 0, 0) rotate(0deg);
          }
          10% {
            opacity: 1;
          }
          85% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translate3d(var(--eec-drift, 0px), 108vh, 0) rotate(var(--eec-spin, 540deg));
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .eec-burst-particle {
            animation: none !important;
            opacity: 0 !important;
          }
        }
      `}</style>
    </div>
  );
}
