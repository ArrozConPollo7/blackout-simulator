'use client';

/**
 * Celebración CSS del cierre: confeti de divs, sin librerías ni canvas.
 *
 * Las piezas se calculan una sola vez (pseudoaleatorio determinista) y solo animan
 * `transform`/`opacity`. Con `prefers-reduced-motion: reduce` se ocultan desde CSS.
 */

import React, { useMemo } from 'react';

/** Paleta del proyecto: no se inventa ningún color. */
const COLORES = ['#F5B942', '#3ECF8E', '#3EC6F0', '#F2622E', '#E7ECF5'];

type EstiloConfeti = React.CSSProperties & {
  '--eec-dx': string;
  '--eec-rot': string;
  '--eec-dur': string;
  '--eec-delay': string;
};

interface Pieza {
  estilo: EstiloConfeti;
}

function Celebration({ piezas }: { piezas: number }) {
  const trozos = useMemo<Pieza[]>(() => {
    const total = Math.max(0, Math.min(Math.round(piezas), 28));
    const azar = (i: number, semilla: number) => {
      const x = Math.sin((i + 1) * semilla) * 10000;
      return x - Math.floor(x);
    };
    return Array.from({ length: total }, (_, i) => ({
      estilo: {
        left: `${Math.round(azar(i, 12.9898) * 92)}%`,
        backgroundColor: COLORES[i % COLORES.length],
        width: `${6 + Math.round(azar(i, 2.1) * 6)}px`,
        height: `${9 + Math.round(azar(i, 5.3) * 9)}px`,
        borderRadius: azar(i, 3.3) > 0.72 ? '9999px' : '2px',
        '--eec-dx': `${Math.round((azar(i, 78.233) - 0.5) * 190)}px`,
        '--eec-rot': `${Math.round(420 + azar(i, 37.719) * 900)}deg`,
        '--eec-dur': `${(2.2 + azar(i, 9.131) * 1.7).toFixed(2)}s`,
        '--eec-delay': `${Math.round(azar(i, 4.777) * 620)}ms`,
      },
    }));
  }, [piezas]);

  if (trozos.length === 0) return null;

  return (
    <div className="eec-celebration" aria-hidden>
      {trozos.map((trozo, i) => (
        <span key={i} className="eec-confetti-piece" style={trozo.estilo} />
      ))}
    </div>
  );
}

export default React.memo(Celebration);
