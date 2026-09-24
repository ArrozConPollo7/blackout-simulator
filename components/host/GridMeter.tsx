'use client';

import React from 'react';
import AnimatedNumber from '@/components/play/AnimatedNumber';
import { formatNumber } from '@/lib/ui';

interface GridMeterProps {
  /**
   * Carga real de la red en % de la referencia del caso (consumo acumulado del aula
   * sobre la referencia). `null` = todavía no hay lectura: la aguja queda en cero.
   */
  cargaPct: number | null;
  isCrisis?: boolean;
  className?: string;
}

/* Geometría del medidor (semicírculo; la referencia del caso es el 100 % de la escala). */
const CX = 120;
const CY = 124;
const R = 92;
const LARGO_ARCO = Math.PI * R;

/**
 * Zonas del medidor: presentación, no dato. La referencia del caso es el 100 %,
 * así que el verde es margen de red, el ámbar es acercarse y el rojo es tocar la
 * referencia o pasarla.
 */
const ZONA_VERDE_HASTA = 70;
const ZONA_AMBAR_HASTA = 90;

const VERDE = '#3ECF8E';
const AMBAR = '#F5B942';
const ROJO = '#FF3B4E';
const RIEL = '#303638';
const AGUJA = '#E7ECF5';

function arco(desdePct: number, hastaPct: number) {
  return {
    strokeDasharray: `${(LARGO_ARCO * (hastaPct - desdePct)) / 100} ${LARGO_ARCO}`,
    strokeDashoffset: `${-(LARGO_ARCO * desdePct) / 100}`,
  };
}

function zonaDe(cargaPct: number): {
  nombre: string;
  color: string;
  texto: string;
} {
  if (cargaPct > 100) {
    return { nombre: 'SOBRE LA REFERENCIA', color: ROJO, texto: 'text-accent-crisis' };
  }
  if (cargaPct >= ZONA_AMBAR_HASTA) {
    return { nombre: 'AL BORDE DE LA REFERENCIA', color: ROJO, texto: 'text-accent-crisis' };
  }
  if (cargaPct >= ZONA_VERDE_HASTA) {
    return { nombre: 'CERCA DE LA REFERENCIA', color: AMBAR, texto: 'text-accent-electricidad' };
  }
  return { nombre: 'MARGEN DE RED', color: VERDE, texto: 'text-accent-eficiencia' };
}

/**
 * Medidor de aguja de la carga de la red del aula, para el proyector. Solo se mueve
 * con `transform` sobre el grupo de la aguja (transición, nunca bucle) y el número
 * cuenta con `AnimatedNumber`. No calcula nada: pinta el `cargaPct` que le pasa el Host.
 */
export default function GridMeter({ cargaPct, isCrisis = false, className = '' }: GridMeterProps) {
  const tieneLectura = cargaPct !== null && Number.isFinite(cargaPct);
  const lectura = tieneLectura ? (cargaPct as number) : 0;
  const enEscala = Math.max(0, Math.min(100, lectura));
  const zona = zonaDe(lectura);
  // 0 % a la izquierda (-90°), 100 % a la derecha (+90°).
  const angulo = (enEscala - 50) * 1.8;
  const colorAguja = tieneLectura && enEscala >= ZONA_AMBAR_HASTA ? ROJO : AGUJA;

  return (
    <section
      className={`relative bg-bg-surface border rounded-xl p-space-sm shadow-md flex flex-col gap-2 ${
        isCrisis ? 'eec-grid-crisis border-accent-crisis' : 'border-border-subtle'
      } ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-label-sm text-label-sm text-text-secondary uppercase tracking-widest">
          <span
            className={`material-symbols-outlined text-[16px] ${
              isCrisis ? 'text-accent-crisis' : 'text-accent-presupuesto'
            }`}
          >
            electric_meter
          </span>
          Carga de la red
        </span>
        <span
          className={`px-1.5 py-0.5 rounded border font-label-sm text-label-sm font-bold uppercase whitespace-nowrap ${zona.texto}`}
          style={{ borderColor: `${zona.color}55` }}
        >
          {tieneLectura ? zona.nombre : 'SIN LECTURA'}
        </span>
      </div>

      <svg viewBox="0 0 240 150" className="w-full h-auto" role="img" aria-label="Carga de la red">
        <path
          d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
          fill="none"
          stroke={RIEL}
          strokeWidth={14}
        />
        <path
          d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
          fill="none"
          stroke={VERDE}
          strokeWidth={12}
          opacity={0.85}
          style={arco(0, ZONA_VERDE_HASTA)}
        />
        <path
          d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
          fill="none"
          stroke={AMBAR}
          strokeWidth={12}
          opacity={0.85}
          style={arco(ZONA_VERDE_HASTA, ZONA_AMBAR_HASTA)}
        />
        <path
          d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
          fill="none"
          stroke={ROJO}
          strokeWidth={12}
          style={arco(ZONA_AMBAR_HASTA, 100)}
        />

        {/* Marcas de escala: 0 %, verdes... hasta la referencia (100 % del caso). */}
        {[0, ZONA_VERDE_HASTA, ZONA_AMBAR_HASTA, 100].map((marca) => {
          const rad = ((180 - marca * 1.8) * Math.PI) / 180;
          const x1 = CX + Math.cos(rad) * (R - 12);
          const y1 = CY - Math.sin(rad) * (R - 12);
          const x2 = CX + Math.cos(rad) * (R - 19);
          const y2 = CY - Math.sin(rad) * (R - 19);
          return (
            <line
              key={marca}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#8792A8"
              strokeWidth={1.5}
              opacity={0.7}
            />
          );
        })}

        <g className="eec-grid-needle" style={{ transform: `rotate(${angulo}deg)` }}>
          <line
            x1={CX}
            y1={CY}
            x2={CX}
            y2={CY - (R - 24)}
            stroke={colorAguja}
            strokeWidth={3.5}
            strokeLinecap="round"
          />
          <polygon
            points={`${CX},${CY - (R - 16)} ${CX - 5},${CY - (R - 26)} ${CX + 5},${CY - (R - 26)}`}
            fill={colorAguja}
          />
        </g>
        <circle cx={CX} cy={CY} r={8} fill="#1b2023" stroke={RIEL} strokeWidth={2} />
        <circle cx={CX} cy={CY} r={3} fill={colorAguja} />
      </svg>

      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-label-sm text-[10px] text-text-secondary uppercase">
            Consumo del aula
          </span>
          <span className={`font-metric-display text-metric-display font-bold leading-none tabular-nums ${zona.texto}`}>
            {tieneLectura ? (
              <>
                <AnimatedNumber value={lectura} format={(valor) => formatNumber(valor, 0)} /> %
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="font-label-sm text-[10px] text-text-secondary uppercase">
            Referencia del caso
          </span>
          <span className="font-label-lg text-label-lg text-text-primary font-bold tabular-nums">
            100 %
          </span>
        </div>
      </div>

      <style jsx>{`
        /* La aguja solo se mueve con transform: transición finita, sin bucles. */
        .eec-grid-needle {
          transform-box: view-box;
          transform-origin: ${CX}px ${CY}px;
          transition: transform 900ms cubic-bezier(0.2, 0.8, 0.2, 1);
          will-change: transform;
        }

        /* En crisis el marco late: es el efecto continuo de la pantalla durante el evento. */
        .eec-grid-crisis {
          animation: eecGridCrisis 1.9s ease-in-out infinite;
        }

        @keyframes eecGridCrisis {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgba(255, 59, 78, 0.15);
          }
          50% {
            box-shadow: 0 0 22px 0 rgba(255, 59, 78, 0.4);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .eec-grid-needle {
            transition: none !important;
          }
          .eec-grid-crisis {
            animation: none !important;
          }
        }
      `}</style>
    </section>
  );
}
