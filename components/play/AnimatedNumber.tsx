'use client';

import React, { useEffect, useRef, useState } from 'react';

/**
 * Contador incremental para los KPI (petición explícita: sin librerías).
 *
 * Regla: la primera pintura muestra el valor real —nada de animar desde 0 al montar— y
 * solo se interpola cuando el número cambia. Con `prefers-reduced-motion: reduce` el
 * valor se aplica de golpe, sin animación.
 */
export function useAnimatedNumber(
  value: number,
  duration = 650,
  contarDesdeCero = false,
): number {
  const [display, setDisplay] = useState(contarDesdeCero ? 0 : value);
  const fromRef = useRef(contarDesdeCero ? 0 : value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced || !Number.isFinite(value) || from === value) {
      fromRef.current = Number.isFinite(value) ? value : from;
      setDisplay(fromRef.current);
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (value - from) * eased;
      fromRef.current = next;
      setDisplay(next);
      if (t < 1) frameRef.current = requestAnimationFrame(step);
      else {
        fromRef.current = value;
        setDisplay(value);
      }
    };
    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [value, duration]);

  return display;
}

interface AnimatedNumberProps {
  value: number;
  /** Formato del número en pantalla (por defecto, entero). */
  format?: (value: number) => string;
  className?: string;
  duration?: number;
  /** Cuenta desde cero al montar (revelado de resultados); por defecto muestra el valor real. */
  contarDesdeCero?: boolean;
}

/** Número que se mueve al cambiar de valor. Solo texto: no toca layout. */
export default function AnimatedNumber({
  value,
  format,
  className,
  duration = 650,
  contarDesdeCero = false,
}: AnimatedNumberProps) {
  const display = useAnimatedNumber(value, duration, contarDesdeCero);
  return <span className={className}>{format ? format(display) : String(Math.round(display))}</span>;
}
