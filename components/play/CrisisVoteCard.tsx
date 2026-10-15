'use client';

/**
 * Papeleta de la mesa durante la crisis (plan 3.4).
 *
 * Reglas del proyecto que se respetan aquí:
 *  - Lenguaje de jugador: ni una palabra técnica. Las medidas llegan del centro de control
 *    ya redactadas (`CrisisMeasure.description`), esto solo las pinta.
 *  - Feedback inmediato al tocar (los "estados del toque" que ya usa `ChoiceButton`):
 *    enviando, votado y rechazado se ven al instante, sin esperar al marcador.
 *  - Una sola papeleta por mesa: después de votar la tarjeta queda cerrada y avisa de que
 *    se espera al resto del aula (la presión social del plan 3.1.3 la lleva el Host).
 *  - El resultado se revela con un golpe visual y háptico distinto del voto.
 */

import React, { useState } from 'react';

import type { CrisisMeasure, CrisisOutcome } from '@/types/game';
import { hapticReveal, hapticTap, hapticVote } from './haptics';

interface CrisisVoteCardProps {
  medidas: CrisisMeasure[];
  /** Medida que votó esta mesa (null si aún no votó). */
  miVoto: string | null;
  equipos: number;
  /** Cuántas mesas ya votaron (lo publica el centro de control). */
  votos: number;
  /** Medida ganadora ya aplicada; null mientras la ventana sigue abierta. */
  resultado: CrisisOutcome | null;
  onVote: (measureId: string) => Promise<void>;
}

export default function CrisisVoteCard({
  medidas,
  miVoto,
  equipos,
  votos,
  resultado,
  onVote,
}: CrisisVoteCardProps) {
  const [enviando, setEnviando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const votar = async (measureId: string) => {
    if (miVoto || enviando) return;
    hapticVote();
    setEnviando(measureId);
    setError(null);
    try {
      await onVote(measureId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo registrar tu voto.');
      setEnviando(null);
    }
  };

  // El revelado mantiene el patrón largo de háptica una sola vez por resultado.
  React.useEffect(() => {
    if (resultado) hapticReveal();
  }, [resultado]);

  if (resultado) {
    return (
      <div className="flex flex-col gap-3 anim-rise">
        <section className="relative overflow-hidden rounded-xl border border-accent-eficiencia/50 bg-accent-eficiencia/10 p-4 shadow-xl anim-reveal anim-flash-ok">
          <span className="anim-banner-sheen pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent" aria-hidden />
          <div className="relative flex flex-col gap-2">
            <span className="w-fit rounded bg-accent-eficiencia/20 px-2 py-0.5 font-label-sm text-label-sm font-bold uppercase tracking-wider text-accent-eficiencia">
              El aula decidió
            </span>
            <h1 className="font-headline-md text-headline-md font-bold uppercase tracking-tight text-text-primary">
              {resultado.label}
            </h1>
            <p className="font-body-sm text-body-sm text-text-secondary">{resultado.description}</p>
            <span className="font-label-sm text-label-sm text-text-secondary">
              {resultado.tie
                ? 'El aula no se puso de acuerdo: decidió la medida más severa.'
                : `Ganó con ${resultado.votes} de ${resultado.totalVotes} votos.`}
            </span>
          </div>
        </section>
        <p className="font-body-sm text-body-sm text-text-secondary">
          La medida ya está aplicada a todas las casas. Las últimas decisiones abren en un momento.
        </p>
      </div>
    );
  }

  const yaVote = miVoto !== null;

  return (
    <div className="flex flex-col gap-3 anim-fade">
      <section className="flex flex-col gap-2 rounded-xl border border-accent-crisis/60 bg-error-container/30 p-4 shadow-xl anim-glitch">
        <span className="w-fit rounded bg-accent-crisis px-2 py-0.5 font-label-sm text-label-sm font-bold uppercase tracking-wider text-white anim-pulse-urgent">
          ¡Vota tu mesa!
        </span>
        <h1 className="font-headline-md text-headline-md font-bold uppercase tracking-tight text-text-primary">
          Una medida para todo el barrio
        </h1>
        <p className="font-body-sm text-body-sm text-text-secondary">
          Habladlo con el aula: la medida que gane se aplica a todas las casas por igual. Cada mesa
          vota una sola vez.
        </p>
        <span className="font-label-sm text-label-sm text-text-secondary">
          Van {votos} de {equipos} mesas.
        </span>
      </section>

      {error && (
        <p className="rounded-lg border border-accent-crisis/50 bg-accent-crisis/10 px-3 py-2 font-label-sm text-label-sm anim-shake">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3 anim-stagger">
        {medidas.map((medida) => {
          const esMia = miVoto === medida.id;
          const bloqueada = yaVote || enviando !== null;
          return (
            <button
              key={medida.id}
              type="button"
              disabled={bloqueada}
              onClick={() => {
                hapticTap();
                void votar(medida.id);
              }}
              className={`anim-tactile flex flex-col gap-1.5 rounded-xl border p-4 text-left shadow-md transition ${
                esMia
                  ? 'border-accent-eficiencia bg-accent-eficiencia/15'
                  : yaVote
                    ? 'border-border-subtle bg-bg-surface opacity-60'
                    : 'border-border-subtle bg-surface-container hover:border-accent-crisis/60'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <strong className="font-label-md text-label-md font-bold uppercase tracking-tight text-text-primary">
                  {medida.label}
                </strong>
                {esMia && (
                  <span className="anim-pop rounded bg-accent-eficiencia/20 px-1.5 py-0.5 font-label-sm text-[9px] font-bold uppercase text-accent-eficiencia">
                    Tu voto
                  </span>
                )}
                {enviando === medida.id && (
                  <span className="material-symbols-outlined text-[16px] text-accent-presupuesto animate-spin">
                    progress_activity
                  </span>
                )}
              </span>
              <span className="font-body-sm text-body-sm text-text-secondary">{medida.description}</span>
            </button>
          );
        })}
      </div>

      {yaVote && (
        <p className="rounded-lg border border-accent-presupuesto/40 bg-accent-presupuesto/10 px-3 py-2 font-label-sm text-label-sm">
          Ya votaste. Espera al resto del aula: cuando cierre la ventana se anuncia la medida ganadora.
        </p>
      )}
    </div>
  );
}
