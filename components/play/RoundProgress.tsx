'use client';

/**
 * Progreso de la ronda activa: "x de N" con segmentos que se encienden al decidir.
 * Solo se anima `transform` (scaleX) y el número entra con el contador compartido.
 *
 * N y el resuelto salen del estado que devuelve el centro de control (`answered`), nunca de
 * una cuenta local.
 */

import React from 'react';

import AnimatedNumber from './AnimatedNumber';

interface RoundProgressProps {
  /** Etiqueta de lo que se cuenta (aparatos auditados o situaciones resueltas). */
  etiqueta: string;
  resolved: number;
  total: number;
  /** Color de los segmentos ya resueltos. */
  tono: 'electricidad' | 'eficiencia';
  /** Sube con cada decisión confirmada: reinicia el golpe visual de la barra. */
  pulso: number;
}

function RoundProgress({ etiqueta, resolved, total, tono, pulso }: RoundProgressProps) {
  if (total <= 0) return null;
  const seguro = Math.max(0, Math.min(resolved, total));
  const color = tono === 'eficiencia' ? 'bg-accent-eficiencia' : 'bg-accent-presupuesto';

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-bg-surface/90 px-3 py-2">
      <div className="flex items-center justify-between font-label-sm text-[10px] uppercase tracking-wider">
        <span className="text-text-secondary">{etiqueta}</span>
        <span className="text-text-primary font-bold tabular-nums">
          <AnimatedNumber value={seguro} format={(valor) => String(Math.round(valor))} duration={420} />
          <span className="text-text-secondary"> de {total}</span>
        </span>
      </div>
      <div key={pulso} className={`flex gap-1 ${pulso > 0 ? 'anim-bump' : ''}`}>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-border-subtle"
          >
            <span
              className={`block h-full w-full origin-left rounded-full ${color} ${
                i < seguro ? 'anim-seg-fill' : 'scale-x-0'
              }`}
            />
          </span>
        ))}
      </div>
    </div>
  );
}

export default React.memo(RoundProgress);
