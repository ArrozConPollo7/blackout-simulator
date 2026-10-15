'use client';

/**
 * Tablero de la votación del aula en el proyector (plan 3.4).
 *
 * Lo que ve la clase mientras se vota: las medidas, cuántas mesas ya votaron (presión social
 * del plan 3.1.3) y, al cerrar la ventana, el revelado de la ganadora con un golpe visual
 * coherente con `PodiumBurst` (la ola de luz del vecindario la dispara el Host al detectar el
 * cambio de medida ganadora).
 *
 * Nunca revela el resultado antes de que cierre la ventana: el proyector está a la vista de
 * todos y esa tensión es medio juego.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { CrisisMeasure, CrisisOutcome, CrisisVote, TeamState } from '@/types/game';
import { useRemainingMs } from '@/lib/useGameState';

interface CrisisVotePanelProps {
  medidas: CrisisMeasure[];
  votos: CrisisVote[];
  equipos: TeamState[];
  resultado: CrisisOutcome | null;
  timerEndsAt?: string | null;
  clockSkewMs?: number;
  /** Se llama UNA vez cuando se revela la medida ganadora (para la ola de luz del vecindario). */
  onReveal?: (outcome: CrisisOutcome) => void;
  className?: string;
}

export default function CrisisVotePanel({
  medidas,
  votos,
  equipos,
  resultado,
  timerEndsAt = null,
  clockSkewMs = 0,
  onReveal,
  className = '',
}: CrisisVotePanelProps) {
  const [revelado, setRevelado] = useState<string | null>(null);
  const revelados = useRef(new Set<string>());

  const restante = useRemainingMs(timerEndsAt, 'crisis_votacion', clockSkewMs);
  const segundos = restante === null ? null : Math.max(0, Math.ceil(restante / 1000));

  const conteo = useMemo(() => {
    const mapa = new Map<string, string[]>();
    for (const medida of medidas) mapa.set(medida.id, []);
    for (const voto of votos) mapa.get(voto.measureId)?.push(voto.teamId);
    return mapa;
  }, [medidas, votos]);

  // El revelado se anuncia una sola vez por medida ganadora, aunque el estado se repita.
  useEffect(() => {
    if (!resultado) return;
    if (revelados.current.has(resultado.measureId)) return;
    revelados.current.add(resultado.measureId);
    setRevelado(resultado.measureId);
    onReveal?.(resultado);
  }, [resultado, onReveal]);

  const votaron = votos.length;
  const total = equipos.length || 1;
  const mesasSinVotar = equipos.filter((t) => !votos.some((v) => v.teamId === t.id));

  return (
    <section className={`flex flex-col gap-3 rounded-2xl border border-accent-crisis/50 bg-error-container/20 p-4 ${className}`}>
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[22px] text-accent-crisis">how_to_vote</span>
          <h2 className="font-headline-md text-headline-md font-bold uppercase tracking-tight text-text-primary">
            {resultado ? 'Medida del aula' : 'El aula está votando'}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-surface-container-high px-2 py-1 font-label-md text-label-md font-bold tabular-nums text-text-primary">
            {votaron}/{total} mesas
          </span>
          {segundos !== null && !resultado && (
            <span
              className={`rounded px-2 py-1 font-label-md text-label-md font-bold tabular-nums ${
                segundos <= 10 ? 'bg-accent-crisis text-white anim-pulse-urgent' : 'bg-bg-primary text-text-primary'
              }`}
            >
              {String(Math.floor(segundos / 60)).padStart(2, '0')}:{String(segundos % 60).padStart(2, '0')}
            </span>
          )}
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        {medidas.map((medida) => {
          const suyos = conteo.get(medida.id) ?? [];
          const gano = resultado?.measureId === medida.id;
          const esRevelada = revelado === medida.id || gano;
          return (
            <article
              key={medida.id}
              className={`flex flex-col gap-2 rounded-xl border p-3 ${esRevelada && resultado ? 'border-accent-eficiencia bg-accent-eficiencia/15 anim-reveal' : 'border-border-subtle bg-bg-surface'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <strong className="font-label-md text-label-md font-bold uppercase tracking-tight text-text-primary">
                  {medida.label}
                </strong>
                <span className="shrink-0 rounded bg-surface-container-high px-2 py-0.5 font-label-md text-label-md font-bold tabular-nums text-text-primary">
                  {resultado ? suyos.length : suyos.length > 0 ? `${suyos.length}` : '·'}
                </span>
              </div>
              <p className="font-body-sm text-[12px] leading-snug text-text-secondary">{medida.description}</p>
              <span className="flex gap-1" aria-hidden>
                {equipos.map((equipo) => (
                  <span
                    key={equipo.id}
                    title={equipo.name}
                    className={`h-2 w-2 rounded-full ${suyos.includes(equipo.id) ? '' : 'opacity-25'}`}
                    style={{ backgroundColor: suyos.includes(equipo.id) ? equipo.color : '#3A4453' }}
                  />
                ))}
              </span>
            </article>
          );
        })}
      </div>

      {resultado ? (
        <div className="flex flex-col gap-1 rounded-xl border border-accent-eficiencia/50 bg-accent-eficiencia/10 p-3 anim-flash-ok">
          <span className="font-label-md text-label-md font-bold uppercase tracking-wide text-text-primary">
            Ganó: {resultado.label}
          </span>
          <span className="font-body-sm text-body-sm text-text-secondary">
            {resultado.tie
              ? 'El aula no se puso de acuerdo: se aplicó la medida más severa.'
              : `${resultado.votes} de ${resultado.totalVotes} votos.`}{' '}
            Ya está aplicada a todas las casas.
          </span>
        </div>
      ) : (
        <span className="font-label-sm text-label-sm text-text-secondary">
          {mesasSinVotar.length === 0
            ? 'Votaron todas las mesas: se está cerrando la ventana…'
            : `Falta el voto de: ${mesasSinVotar.map((t) => t.name).join(', ')}`}
        </span>
      )}
    </section>
  );
}
