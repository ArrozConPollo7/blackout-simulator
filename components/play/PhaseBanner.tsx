'use client';

/**
 * Banner de toma de fase: ~1,5 s a todo lo ancho ('RONDA 2 · HORA DE DECIDIR',
 * '¡CRISIS TARIFARIA!'). Nunca bloquea el toque (`pointer-events-none`) y solo se
 * muestra cuando la fase CAMBIA: en la primera carga no hay nada que anunciar.
 *
 * Va por portal a `document.body`: dentro del árbol de la página cae bajo ancestros con
 * `transform` (animaciones de entrada), y entonces un `position: fixed` se ancla al
 * documento en vez de a la pantalla — la franja acababa tapando el progreso de ronda o
 * directamente fuera de vista en páginas largas.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { Phase } from '@/types/game';

interface TextoBanner {
  titulo: string;
  detalle: string;
  tono: 'normal' | 'crisis' | 'final';
}

const BANNERS: Record<Phase, TextoBanner> = {
  lobby: { titulo: 'PARTIDA EN ESPERA', detalle: 'Esperando que se sumen los equipos', tono: 'normal' },
  investigar: {
    titulo: 'RONDA 1 · AUDITORÍA DE APARATOS',
    detalle: 'Toca cada aparato y decide qué hacer con su consumo',
    tono: 'normal',
  },
  decidir: {
    titulo: 'RONDA 2 · HORA DE DECIDIR',
    detalle: 'Seis situaciones, tres opciones cada una',
    tono: 'normal',
  },
  crisis: { titulo: '¡CRISIS TARIFARIA!', detalle: 'La electricidad sube 30%', tono: 'crisis' },
  decidir_2: {
    titulo: 'RONDA FINAL · ÚLTIMAS DECISIONES',
    detalle: 'Cada kWh cuesta más: decide con la tarifa nueva',
    tono: 'crisis',
  },
  resultados: { titulo: 'RESULTADOS DE LA PARTIDA', detalle: 'Marcador final del aula', tono: 'final' },
};

const VISIBLE_MS = 1500;
const SALIDA_MS = 320;

const TONOS: Record<TextoBanner['tono'], string> = {
  normal: 'border-accent-electricidad/60 bg-bg-surface/95 text-text-primary',
  crisis: 'border-accent-crisis bg-error-container/80 text-text-primary',
  final: 'border-accent-eficiencia/70 bg-bg-surface/95 text-text-primary',
};

const TONO_DETALLE: Record<TextoBanner['tono'], string> = {
  normal: 'text-accent-electricidad',
  crisis: 'text-accent-crisis',
  final: 'text-accent-eficiencia',
};

function PhaseBanner({ phase }: { phase: Phase | undefined }) {
  const previa = useRef<Phase | undefined>(undefined);
  const [visible, setVisible] = useState<Phase | null>(null);
  const [saliendo, setSaliendo] = useState(false);
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    setMontado(true);
  }, []);

  useEffect(() => {
    if (!phase) return;
    if (previa.current === undefined) {
      previa.current = phase; // primera carga: el jugador ya ve su fase en la pantalla
      return;
    }
    if (previa.current === phase) return;
    previa.current = phase;

    setVisible(phase);
    setSaliendo(false);
    const cierre = setTimeout(() => setSaliendo(true), VISIBLE_MS);
    const fin = setTimeout(() => setVisible(null), VISIBLE_MS + SALIDA_MS);
    return () => {
      clearTimeout(cierre);
      clearTimeout(fin);
    };
  }, [phase]);

  if (!visible || !montado) return null;
  const texto = BANNERS[visible];

  return createPortal(
    <div
      className="pointer-events-none fixed left-0 right-0 z-[45] flex justify-center px-0"
      style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      aria-hidden
    >
      <div
        className={`relative w-full max-w-md overflow-hidden border-y rounded-lg shadow-xl ${
          TONOS[texto.tono]
        } ${saliendo ? 'anim-banner-up-out' : 'anim-banner-up-in'}`}
      >
        <span
          className="anim-banner-sheen pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent"
          aria-hidden
        />
        <div className="relative px-4 py-2.5 flex flex-col">
          <span className="text-[17px] leading-tight font-bold uppercase tracking-tight">
            {texto.titulo}
          </span>
          <span
            className={`font-label-sm text-label-sm uppercase tracking-wider ${TONO_DETALLE[texto.tono]}`}
          >
            {texto.detalle}
          </span>
        </div>
        </div>
      </div>,
      document.body,
    );
}

export default React.memo(PhaseBanner);
