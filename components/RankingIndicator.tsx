'use client';

import React, { useEffect, useRef, useState } from 'react';
import { RankingTrend } from '@/types/game';

interface RankingIndicatorProps {
  rank?: number;
  trend?: RankingTrend;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Indicador de tendencia del ranking. `trend` es SIEMPRE el dato real que calcula el
 * Host comparando el orden anterior con el actual, así que los rótulos describen ese
 * hecho ('SUBE' / 'BAJA' / 'ESTABLE') y no una interpretación decorativa.
 */
export default function RankingIndicator({
  rank,
  trend = 'flat',
  label,
  size = 'md',
  className = '',
}: RankingIndicatorProps) {
  const [pop, setPop] = useState(false);
  const anterior = useRef(trend);

  // Un golpe corto cuando la tendencia cambia: informa el porte nuevo sin bucle continuo.
  useEffect(() => {
    if (anterior.current === trend) return;
    anterior.current = trend;
    setPop(true);
    const id = setTimeout(() => setPop(false), 700);
    return () => clearTimeout(id);
  }, [trend]);

  const config =
    trend === 'up'
      ? {
          icon: 'trending_up',
          colorClass: 'text-accent-eficiencia',
          defaultLabel: 'SUBE',
          bgClass: 'bg-accent-eficiencia/10 border-accent-eficiencia/30',
          descripcion: 'Ganó puestos en el ranking',
        }
      : trend === 'down'
        ? {
            icon: 'trending_down',
            colorClass: 'text-accent-crisis',
            defaultLabel: 'BAJA',
            bgClass: 'bg-accent-crisis/10 border-accent-crisis/30',
            descripcion: 'Perdió puestos en el ranking',
          }
        : {
            icon: 'trending_flat',
            colorClass: 'text-secondary',
            defaultLabel: 'ESTABLE',
            bgClass: 'bg-secondary/10 border-secondary/30',
            descripcion: 'Mantiene el puesto',
          };

  const displayLabel = label || config.defaultLabel;
  const tamano =
    size === 'sm'
      ? { caja: 'gap-1 px-1.5 py-0.5 text-[10px]', icono: 'text-[13px]' }
      : size === 'lg'
        ? { caja: 'gap-2 px-3 py-1 text-label-md', icono: 'text-[20px]' }
        : { caja: 'gap-1.5 px-2 py-0.5 text-label-md', icono: 'text-[16px]' };

  return (
    <div
      className={`relative inline-flex items-center rounded border font-label-md font-semibold tracking-wide uppercase whitespace-nowrap ${tamano.caja} ${
        config.bgClass
      } ${config.colorClass} ${pop ? 'eec-rank-pop' : ''} ${className}`}
      title={config.descripcion}
    >
      <span className={`material-symbols-outlined ${tamano.icono}`}>{config.icon}</span>
      <span>{displayLabel}</span>
      {rank !== undefined && <span className="opacity-80 font-bold ml-0.5">#{rank}</span>}

      <style jsx>{`
        .eec-rank-pop {
          animation: eecRankPop 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) 1 both;
        }
        @keyframes eecRankPop {
          0% {
            transform: translate3d(0, -4px, 0) scale(0.94);
          }
          60% {
            transform: translate3d(0, 0, 0) scale(1.04);
          }
          100% {
            transform: translate3d(0, 0, 0) scale(1);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .eec-rank-pop {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
