'use client';

import React, { useEffect, useState } from 'react';

/** Suceso real de la partida, tal como lo cuenta el Host (una línea por decisión/entrada). */
export interface DecisionFeedEvent {
  id: string;
  team: string;
  /** Color real del equipo (`TeamState.color`). */
  color: string;
  texto: string;
  /** Marca de tiempo real del suceso (ms epoch). */
  at: number;
}

interface DecisionFeedProps {
  eventos: DecisionFeedEvent[];
  className?: string;
}

/** El proyector muestra los últimos cinco: más abajo no se lee a distancia. */
const VISIBLES = 5;

function dosDigitos(valor: number): string {
  return String(valor).padStart(2, '0');
}

/**
 * Lista animada de sucesos reales. No ordena ni interpreta nada: se queda con los
 * últimos `VISIBLES` (se asume orden cronológico ascendente) y los pinta del más
 * reciente al más antiguo, entrando cada uno con un deslizamiento corto.
 */
export default function DecisionFeed({ eventos, className = '' }: DecisionFeedProps) {
  // La hora se pinta solo en el cliente: en el servidor la zona horaria no es la del aula.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  const visibles = [...eventos].slice(-VISIBLES).reverse();

  return (
    <section
      className={`bg-bg-surface border border-border-subtle rounded-xl p-space-sm shadow-md flex flex-col gap-2 ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-label-sm text-label-sm text-text-secondary uppercase tracking-widest">
          <span className="material-symbols-outlined text-[16px] text-accent-presupuesto">history</span>
          Últimos sucesos
        </span>
        <span className="px-1.5 py-0.5 rounded bg-surface-container border border-border-subtle font-label-sm text-label-sm font-bold uppercase text-text-secondary tabular-nums">
          {eventos.length} en total
        </span>
      </div>

      {visibles.length === 0 ? (
        <p className="font-label-md text-label-md text-text-secondary uppercase py-6 text-center">
          Sin sucesos registrados todavía
        </p>
      ) : (
        <ul className="flex flex-col">
          {visibles.map((evento, indice) => {
            const hora = new Date(evento.at);
            const sello = `${dosDigitos(hora.getHours())}:${dosDigitos(hora.getMinutes())}:${dosDigitos(
              hora.getSeconds(),
            )}`;
            return (
              <li
                key={evento.id}
                className="eec-feed-row flex items-center gap-3 py-2 border-b border-border-subtle/60 last:border-b-0"
                style={{ borderLeftColor: evento.color, animationDelay: `${indice * 40}ms` }}
              >
                <span className="font-label-sm text-label-sm text-text-secondary tabular-nums shrink-0">
                  {montado ? sello : '--:--:--'}
                </span>
                <span
                  aria-hidden="true"
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: evento.color }}
                />
                <span className="font-label-md text-label-md font-bold uppercase text-text-primary tracking-wide truncate max-w-[10rem] shrink-0">
                  {evento.team}
                </span>
                <span className="font-body-md text-body-md text-text-secondary truncate">
                  {evento.texto}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <style jsx>{`
        /* Entrada deslizante y corta: cada suceso nuevo aparece, no parpadea. */
        .eec-feed-row {
          border-left-width: 2px;
          border-left-style: solid;
          padding-left: 0.5rem;
          animation: eecFeedIn 0.34s cubic-bezier(0.22, 0.7, 0.3, 1) 1 both;
          will-change: transform, opacity;
        }

        @keyframes eecFeedIn {
          from {
            opacity: 0;
            transform: translate3d(-16px, 0, 0);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .eec-feed-row {
            animation: none !important;
          }
        }
      `}</style>
    </section>
  );
}
