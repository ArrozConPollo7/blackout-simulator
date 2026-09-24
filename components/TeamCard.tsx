'use client';

import React, { useEffect, useRef, useState } from 'react';
import { TeamState, RankingTrend } from '@/types/game';
import RankingIndicator from './RankingIndicator';
import AnimatedNumber from '@/components/play/AnimatedNumber';
import { formatNumber, dinero, kwh, m3 } from '@/lib/ui';
import {
  CONSUMO_REFERENCIA_ELECTRICIDAD,
  CONSUMO_REFERENCIA_GAS,
  CRISIS_SURCHARGE_RATE,
  EFICIENCIA_INICIAL,
  PRESUPUESTO_INICIAL,
  sobrecostoCrisis,
} from '@/content/economy';

interface TeamCardProps {
  team: TeamState;
  rank: number;
  variant?: 'default' | 'crisis' | 'podium';
  isLeader?: boolean;
  className?: string;
  /**
   * Tendencia REAL del ranking: la calcula el Host comparando el orden anterior con el
   * actual (`trends` en `app/host/page.tsx`). Antes esta tarjeta la deducía sola con una
   * regla inventada (`rank === 1 ? 'up' : ...`). Opcional y por defecto 'flat' (estable),
   * así que la firma de props existente no cambia.
   */
  trend?: RankingTrend;
}

/* ---------------------------------------------------------------------------
 * Escala de las barras = constantes REALES del motor (`content/economy.ts`).
 * La referencia del caso (100 kWh / 100 m³ / $100.000) es el 100 % de la barra:
 * por encima de ella el equipo va en derroche y la tarjeta lo dice con un dato.
 * ------------------------------------------------------------------------ */
const REF_ELECTRICIDAD = CONSUMO_REFERENCIA_ELECTRICIDAD; // 100 kWh
const REF_GAS = CONSUMO_REFERENCIA_GAS; // 100 m³
const REF_PRESUPUESTO = PRESUPUESTO_INICIAL; // $100.000

/** Por debajo del 70 % del arranque (50 %) el equipo ya está peor que sin intervenir. */
const EFICIENCIA_ALARMA = Math.round(EFICIENCIA_INICIAL * 0.7); // 35 %
/** Menos del 20 % del presupuesto restante: la tarjeta avisa antes de quedarse sin margen. */
const FONDOS_BAJOS_PCT = 20;
/** Recargo del evento de crisis, en % (constante del motor, no un rótulo). */
const RECARGO_CRISIS_PCT = Math.round(CRISIS_SURCHARGE_RATE * 100);

function porcentajeBarra(valor: number, maximo: number): number {
  if (!Number.isFinite(valor) || maximo <= 0) return 0;
  return Math.max(0, Math.min(100, (valor / maximo) * 100));
}

function colorEficiencia(eficiencia: number): string {
  if (eficiencia >= EFICIENCIA_INICIAL) return 'bg-accent-eficiencia';
  if (eficiencia >= EFICIENCIA_ALARMA) return 'bg-accent-electricidad';
  return 'bg-accent-crisis';
}

function textoEficiencia(eficiencia: number): string {
  if (eficiencia >= EFICIENCIA_INICIAL) return 'text-accent-eficiencia';
  if (eficiencia >= EFICIENCIA_ALARMA) return 'text-accent-electricidad';
  return 'text-accent-crisis';
}

function colorPresupuesto(pct: number): string {
  if (pct >= 50) return 'bg-accent-presupuesto';
  if (pct >= FONDOS_BAJOS_PCT) return 'bg-accent-electricidad';
  return 'bg-accent-crisis';
}

/**
 * Marca que cambia cuando el valor cambia: se usa como `key` del destello de la barra
 * para reiniciar una animación FINITA. El proyector no admite más de dos animaciones
 * continuas (Design.md §9): el brillo barre la barra solo cuando la lectura se mueve.
 */
function useMarcaCambio(valor: number): number {
  const [marca, setMarca] = useState(0);
  const anterior = useRef(valor);
  useEffect(() => {
    if (anterior.current === valor) return;
    anterior.current = valor;
    setMarca((actual) => actual + 1);
  }, [valor]);
  return marca;
}

/**
 * Grito de puesto: se enciende cuando cambia el puesto y se apaga solo a los ~1,3 s.
 * Usa la tendencia real que envía el Host; si llega 'flat' con el puesto cambiado,
 * la dirección se deduce del salto de posición (hecho, no rótulo decorativo).
 */
function useRankShout(rank: number, trend: RankingTrend): RankingTrend | null {
  const anterior = useRef(rank);
  const [grito, setGrito] = useState<RankingTrend | null>(null);

  useEffect(() => {
    const previo = anterior.current;
    anterior.current = rank;
    if (previo === rank) return;
    setGrito(trend !== 'flat' ? trend : previo > rank ? 'up' : 'down');
  }, [rank, trend]);

  useEffect(() => {
    if (!grito) return;
    const id = setTimeout(() => setGrito(null), 1_300);
    return () => clearTimeout(id);
  }, [grito]);

  return grito;
}

export default function TeamCard({
  team,
  rank,
  variant = 'default',
  isLeader = false,
  trend = 'flat',
  className = '',
}: TeamCardProps) {
  const elecPct = porcentajeBarra(team.electricidad, REF_ELECTRICIDAD);
  const gasPct = porcentajeBarra(team.gas, REF_GAS);
  const pptoPct = porcentajeBarra(team.presupuesto, REF_PRESUPUESTO);
  const eficPct = porcentajeBarra(team.eficiencia, 100);

  // Exceso sobre la referencia del caso: el derroche del equipo, en % (dato derivado).
  const excesoElecPct = ((team.electricidad - REF_ELECTRICIDAD) / REF_ELECTRICIDAD) * 100;
  const excesoGasPct = ((team.gas - REF_GAS) / REF_GAS) * 100;
  const ahorroElec = REF_ELECTRICIDAD - team.electricidad;
  const alarma = team.eficiencia < EFICIENCIA_ALARMA;

  const grito = useRankShout(rank, trend);
  const marcaElec = useMarcaCambio(team.electricidad);
  const marcaGas = useMarcaCambio(team.gas);
  const marcaPpto = useMarcaCambio(team.presupuesto);
  const marcaEfic = useMarcaCambio(team.eficiencia);

  const tarjetaGrito = grito === 'up' ? 'eec-card-up' : grito === 'down' ? 'eec-card-down' : '';

  const etiquetaGrito = grito ? (
    <span
      className={`eec-shout font-label-md text-label-md font-bold uppercase px-1.5 rounded whitespace-nowrap ${
        grito === 'up'
          ? 'text-accent-eficiencia bg-accent-eficiencia/15'
          : 'text-accent-crisis bg-accent-crisis/15'
      }`}
    >
      {grito === 'up' ? '▲ SUBE' : '▼ BAJA'}
    </span>
  ) : null;

  // Podio: el puesto es real; el rótulo de rango inventado se reemplazó por el ahorro
  // real contra la referencia del caso.
  const isFirst = rank === 1;
  const isSecond = rank === 2;
  const rankTitle = isFirst ? '1º Puesto' : isSecond ? '2º Puesto' : '3º Puesto';
  const accentPodio = isFirst
    ? 'text-accent-eficiencia'
    : isSecond
      ? 'text-accent-presupuesto'
      : 'text-secondary';
  const recargoCrisis = sobrecostoCrisis(team.electricidad); // función real del motor

  return (
    <>
      {variant === 'podium' ? (
        <div
          className={`eec-card relative flex flex-col bg-surface-container rounded-xl overflow-hidden border border-border-subtle shadow-xl ${
            isFirst ? 'ring-2 ring-accent-eficiencia/40' : ''
          } ${tarjetaGrito} ${className}`}
        >
          {isFirst && (
            <span
              aria-hidden="true"
              className="eec-leader-glow pointer-events-none absolute inset-0 rounded-xl border-2 border-accent-eficiencia"
            />
          )}

          <div className="relative p-space-md bg-surface-container-high flex items-center justify-between gap-2 border-b border-border-subtle">
            <div className="flex items-center gap-space-xs min-w-0">
              <span className={`material-symbols-outlined ${accentPodio} text-[26px]`}>
                {isFirst ? 'emoji_events' : 'workspace_premium'}
              </span>
              <div className="min-w-0">
                <span
                  className={`font-label-sm text-label-sm uppercase ${accentPodio} tracking-widest block font-bold`}
                >
                  {rankTitle}
                </span>
                <h3 className="font-headline-md text-headline-md text-text-primary tracking-wide uppercase font-bold truncate">
                  {team.name}
                </h3>
              </div>
            </div>
            <span
              className={`px-2.5 py-1 rounded bg-surface-container-lowest font-label-md text-label-md font-bold tabular-nums whitespace-nowrap ${
                ahorroElec >= 0 ? 'text-accent-eficiencia' : 'text-accent-crisis'
              }`}
              title={`Referencia del caso: ${formatNumber(REF_ELECTRICIDAD, 0)} kWh de electricidad`}
            >
              {ahorroElec >= 0 ? 'AHORRO ' : 'EXCESO '}
              {kwh(Math.abs(ahorroElec))}
            </span>
          </div>

          <div className="relative p-space-md flex flex-col gap-space-md">
            <div className="grid grid-cols-2 gap-space-sm">
              <div className="bg-surface-container-lowest p-space-sm rounded-lg border border-border-subtle/50">
                <span className="font-label-sm text-label-sm text-text-secondary uppercase flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px] text-accent-presupuesto">
                    account_balance_wallet
                  </span>
                  Presupuesto
                </span>
                <span className="font-metric-display-mobile text-metric-display-mobile text-text-primary font-bold block mt-1 tabular-nums">
                  <AnimatedNumber
                    value={team.presupuesto}
                    format={(valor) => dinero(valor)}
                    contarDesdeCero
                  />
                </span>
              </div>
              <div className="bg-surface-container-lowest p-space-sm rounded-lg border border-border-subtle/50">
                <span className="font-label-sm text-label-sm text-text-secondary uppercase flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px] text-accent-eficiencia">
                    speed
                  </span>
                  Eficiencia
                </span>
                <span className="font-metric-display-mobile text-metric-display-mobile text-accent-eficiencia font-bold block mt-1 tabular-nums">
                  <AnimatedNumber
                    value={team.eficiencia}
                    format={(valor) => `${formatNumber(valor, 0)} %`}
                    contarDesdeCero
                  />
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-space-sm">
              <div className="bg-surface-container-lowest p-space-sm rounded-lg border border-border-subtle/50">
                <span className="font-label-sm text-label-sm text-text-secondary uppercase flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px] text-accent-electricidad">
                    bolt
                  </span>
                  Electricidad
                </span>
                <span className="font-label-md text-label-md text-text-primary font-bold block mt-1 tabular-nums">
                  {kwh(team.electricidad)}
                </span>
              </div>
              <div className="bg-surface-container-lowest p-space-sm rounded-lg border border-border-subtle/50">
                <span className="font-label-sm text-label-sm text-text-secondary uppercase flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px] text-accent-gas">
                    local_fire_department
                  </span>
                  Gas Natural
                </span>
                <span className="font-label-md text-label-md text-text-primary font-bold block mt-1 tabular-nums">
                  {m3(team.gas)}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between font-label-sm text-label-sm text-text-secondary">
                <span className="uppercase">Presupuesto restante sobre el inicial</span>
                <span className="tabular-nums font-bold text-text-primary">
                  {formatNumber(pptoPct, 0)} %
                </span>
              </div>
              <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
                <div
                  className={`${colorPresupuesto(pptoPct)} relative h-full w-full rounded-full origin-left transition-transform duration-500 ease-out overflow-hidden`}
                  style={{ transform: `scaleX(${pptoPct / 100})` }}
                >
                  <span key={`ppto-podio-${marcaPpto}`} className="eec-sheen" aria-hidden="true" />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : variant === 'crisis' ? (
        <div
          className={`eec-card relative rounded-xl bg-surface-container-low shadow-xl p-space-md flex flex-col justify-between border ${
            isLeader ? 'border-accent-eficiencia/50' : alarma ? 'border-accent-crisis/50' : 'border-border-subtle'
          } ${alarma ? 'eec-card-alarm' : ''} ${tarjetaGrito} ${className}`}
        >
          {isLeader && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-xl border border-accent-eficiencia/40"
            />
          )}

          <div className="relative flex flex-col gap-space-xs">
            <div className="flex items-center justify-between gap-2 pb-1 border-b border-border-subtle">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-label-lg text-label-lg font-bold text-accent-presupuesto tabular-nums">
                  #{rank}
                </span>
                {etiquetaGrito}
                <span className="font-headline-md text-headline-md text-text-primary font-bold uppercase truncate">
                  {team.name}
                </span>
              </div>
              <RankingIndicator rank={rank} trend={trend} size="sm" />
            </div>

            {/* Hechos verificables en vez de 'ESTADO: RESISTENCIA NOMINAL / ESTRÉS TÉRMICO'. */}
            <div className="flex flex-wrap items-center gap-2 mt-1 font-label-sm text-label-sm text-text-secondary">
              <span className="tabular-nums text-accent-electricidad">{kwh(team.electricidad)}</span>
              <span className="text-border-subtle">|</span>
              <span className="tabular-nums text-accent-gas">{m3(team.gas)}</span>
              <span className="text-border-subtle">|</span>
              <span className={`tabular-nums font-bold ${textoEficiencia(team.eficiencia)}`}>
                {formatNumber(team.eficiencia, 0)} % de eficiencia
              </span>
            </div>
          </div>

          <div className="relative flex flex-col gap-2 my-space-md bg-surface-container-lowest/60 p-space-sm rounded-lg border border-border-subtle">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm text-text-secondary flex items-center gap-1">
                <span className="material-symbols-outlined text-[16px] text-accent-presupuesto">
                  account_balance_wallet
                </span>
                PRESUPUESTO
              </span>
              <span className="font-label-lg text-label-lg font-bold text-accent-presupuesto tabular-nums">
                <AnimatedNumber value={team.presupuesto} format={(valor) => dinero(valor)} />
              </span>
            </div>
            <div className="w-full bg-surface-container h-1.5 rounded-full overflow-hidden">
              <div
                className={`${colorPresupuesto(pptoPct)} relative h-full w-full rounded-full origin-left transition-transform duration-500 ease-out overflow-hidden`}
                style={{ transform: `scaleX(${pptoPct / 100})` }}
              >
                <span key={`ppto-crisis-${marcaPpto}`} className="eec-sheen" aria-hidden="true" />
              </div>
            </div>
            {/* Reemplaza 'Respaldo activo ante sobrecosto / -30% aplicado sobre gasto de red':
                aquí va el recargo real que el motor aplica al consumo acumulado. */}
            <span className="font-label-sm text-label-sm text-accent-crisis font-bold text-right tabular-nums">
              RECARGO +{RECARGO_CRISIS_PCT} % SOBRE {kwh(team.electricidad)} = {dinero(recargoCrisis)}
            </span>
          </div>

          <div className="relative grid grid-cols-2 gap-2 pt-2 border-t border-border-subtle">
            <div>
              <span className="font-label-sm text-label-sm text-text-secondary block uppercase">
                EFICIENCIA
              </span>
              <span
                className={`font-label-lg text-label-lg font-bold tabular-nums ${textoEficiencia(team.eficiencia)}`}
              >
                {formatNumber(team.eficiencia, 0)} %
              </span>
            </div>
            <div className="text-right">
              <span className="font-label-sm text-label-sm text-text-secondary block uppercase">
                {ahorroElec >= 0 ? 'AHORRO VS REFERENCIA' : 'EXCESO VS REFERENCIA'}
              </span>
              <span
                className={`font-label-lg text-label-lg font-bold tabular-nums ${
                  ahorroElec >= 0 ? 'text-accent-eficiencia' : 'text-accent-crisis'
                }`}
              >
                {kwh(Math.abs(ahorroElec))}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`eec-card relative bg-bg-surface rounded-xl p-space-sm flex flex-col gap-space-sm shadow-md border transition-colors duration-200 ${
            isLeader ? 'border-accent-eficiencia/60' : 'border-border-subtle'
          } ${alarma ? 'eec-card-alarm border-accent-crisis/50' : ''} ${tarjetaGrito} ${className}`}
        >
          {isLeader && (
            <span
              aria-hidden="true"
              className="eec-leader-glow pointer-events-none absolute inset-0 rounded-xl border-2 border-accent-eficiencia"
            />
          )}

          {/* Cabecera: puesto real + grito de puesto + tendencia real */}
          <div className="relative flex items-center justify-between gap-2 pb-2 border-b border-border-subtle">
            <div className="flex items-center gap-space-xs min-w-0">
              <span className="font-label-lg text-label-lg font-bold text-accent-presupuesto tabular-nums">
                #{rank}
              </span>
              {etiquetaGrito}
              <span className="font-headline-md text-headline-md font-bold text-text-primary uppercase tracking-wide truncate">
                {team.name}
              </span>
              {isLeader && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent-eficiencia/15 border border-accent-eficiencia/40 text-accent-eficiencia font-label-sm text-label-sm font-bold uppercase whitespace-nowrap">
                  <span className="material-symbols-outlined text-[14px]">emoji_events</span>
                  LÍDER
                </span>
              )}
            </div>
            <RankingIndicator rank={rank} trend={trend} size="sm" />
          </div>

          {/* 4 lecturas: la barra es la referencia real del caso (100 kWh / 100 m³ / $100.000) */}
          <div className="relative flex flex-col gap-2.5">
            {/* 1. Electricidad */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 font-label-sm text-label-sm">
                <span className="flex items-center gap-1.5 text-text-secondary">
                  <span className="material-symbols-outlined text-[16px] text-accent-electricidad">
                    bolt
                  </span>
                  ELECTRICIDAD
                </span>
                <span className="font-label-md text-label-md font-bold text-text-primary tabular-nums">
                  <AnimatedNumber value={team.electricidad} format={(valor) => formatNumber(valor, 2)} />
                  <span className="text-text-secondary font-normal">
                    {' '}
                    / {formatNumber(REF_ELECTRICIDAD, 0)} kWh
                  </span>
                </span>
              </div>
              <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
                <div
                  className={`${
                    excesoElecPct > 0 ? 'bg-accent-crisis' : 'bg-accent-electricidad'
                  } relative h-full w-full rounded-full origin-left transition-transform duration-500 ease-out overflow-hidden`}
                  style={{ transform: `scaleX(${elecPct / 100})` }}
                >
                  <span key={`elec-${marcaElec}`} className="eec-sheen" aria-hidden="true" />
                </div>
              </div>
              {excesoElecPct > 0.05 && (
                <span className="font-label-sm text-label-sm font-bold uppercase text-accent-crisis tabular-nums">
                  +{formatNumber(excesoElecPct, 0)} % sobre la referencia del caso
                </span>
              )}
            </div>

            {/* 2. Gas */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 font-label-sm text-label-sm">
                <span className="flex items-center gap-1.5 text-text-secondary">
                  <span className="material-symbols-outlined text-[16px] text-accent-gas">
                    local_fire_department
                  </span>
                  GAS NATURAL
                </span>
                <span className="font-label-md text-label-md font-bold text-text-primary tabular-nums">
                  <AnimatedNumber value={team.gas} format={(valor) => formatNumber(valor, 2)} />
                  <span className="text-text-secondary font-normal"> / {formatNumber(REF_GAS, 0)} m³</span>
                </span>
              </div>
              <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
                <div
                  className={`${
                    excesoGasPct > 0 ? 'bg-accent-crisis' : 'bg-accent-gas'
                  } relative h-full w-full rounded-full origin-left transition-transform duration-500 ease-out overflow-hidden`}
                  style={{ transform: `scaleX(${gasPct / 100})` }}
                >
                  <span key={`gas-${marcaGas}`} className="eec-sheen" aria-hidden="true" />
                </div>
              </div>
              {excesoGasPct > 0.05 && (
                <span className="font-label-sm text-label-sm font-bold uppercase text-accent-crisis tabular-nums">
                  +{formatNumber(excesoGasPct, 0)} % sobre la referencia del caso
                </span>
              )}
            </div>

            {/* 3. Presupuesto */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 font-label-sm text-label-sm">
                <span className="flex items-center gap-1.5 text-text-secondary">
                  <span className="material-symbols-outlined text-[16px] text-accent-presupuesto">
                    account_balance_wallet
                  </span>
                  PRESUPUESTO
                </span>
                <span className="font-label-md text-label-md font-bold text-accent-presupuesto tabular-nums">
                  <AnimatedNumber value={team.presupuesto} format={(valor) => dinero(valor)} />
                  <span className="text-text-secondary font-normal"> / {dinero(REF_PRESUPUESTO)}</span>
                </span>
              </div>
              <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
                <div
                  className={`${colorPresupuesto(pptoPct)} relative h-full w-full rounded-full origin-left transition-transform duration-500 ease-out overflow-hidden`}
                  style={{ transform: `scaleX(${pptoPct / 100})` }}
                >
                  <span key={`ppto-${marcaPpto}`} className="eec-sheen" aria-hidden="true" />
                </div>
              </div>
              {pptoPct < FONDOS_BAJOS_PCT && (
                <span className="font-label-sm text-label-sm font-bold uppercase text-accent-crisis">
                  Queda menos del {formatNumber(FONDOS_BAJOS_PCT, 0)} % del presupuesto inicial
                </span>
              )}
            </div>

            {/* 4. Eficiencia */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 font-label-sm text-label-sm">
                <span className="flex items-center gap-1.5 text-text-secondary">
                  <span className="material-symbols-outlined text-[16px] text-accent-eficiencia">
                    speed
                  </span>
                  EFICIENCIA
                </span>
                <span
                  className={`font-label-md text-label-md font-bold tabular-nums ${textoEficiencia(team.eficiencia)}`}
                >
                  <AnimatedNumber
                    value={team.eficiencia}
                    format={(valor) => `${formatNumber(valor, 0)} %`}
                  />
                </span>
              </div>
              <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
                <div
                  className={`${colorEficiencia(
                    team.eficiencia,
                  )} relative h-full w-full rounded-full origin-left transition-transform duration-500 ease-out overflow-hidden`}
                  style={{ transform: `scaleX(${eficPct / 100})` }}
                >
                  <span key={`efic-${marcaEfic}`} className="eec-sheen" aria-hidden="true" />
                </div>
              </div>
              {team.eficiencia < EFICIENCIA_INICIAL && (
                <span
                  className={`flex items-center gap-1 font-label-sm text-label-sm font-bold uppercase ${
                    alarma ? 'text-accent-crisis' : 'text-accent-electricidad'
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">warning</span>
                  {alarma ? 'Zona crítica: ' : ''}
                  por debajo del arranque ({formatNumber(EFICIENCIA_INICIAL, 0)} %)
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        /* Brillo que barre la barra al cambiar el valor: animación FINITA (una pasada). */
        .eec-sheen {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          width: 32%;
          pointer-events: none;
          will-change: transform, opacity;
          background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0) 0%,
            rgba(255, 255, 255, 0.6) 50%,
            rgba(255, 255, 255, 0) 100%
          );
          animation: eecTeamSheen 1.05s cubic-bezier(0.2, 0.8, 0.2, 1) 1 both;
        }

        @keyframes eecTeamSheen {
          0% {
            opacity: 0;
            transform: translate3d(-120%, 0, 0);
          }
          15% {
            opacity: 0.9;
          }
          100% {
            opacity: 0;
            transform: translate3d(420%, 0, 0);
          }
        }

        /* El líder pulsa: una de las dos animaciones continuas del proyector. */
        .eec-leader-glow {
          animation: eecLeaderGlow 1.9s ease-in-out infinite;
        }

        @keyframes eecLeaderGlow {
          0%,
          100% {
            opacity: 0.2;
          }
          50% {
            opacity: 0.75;
          }
        }

        /* La alarma se declara antes: si un equipo cambia de puesto y además entra en zona
           crítica, en pantalla gana el grito (misma especificidad: decide el orden del archivo). */
        .eec-card-alarm {
          animation: eecCardAlarm 1.5s ease-in-out 3;
        }

        @keyframes eecCardAlarm {
          0%,
          60%,
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
          20% {
            opacity: 0.6;
            transform: translate3d(-3px, 0, 0);
          }
          40% {
            opacity: 0.85;
            transform: translate3d(3px, 0, 0);
          }
          80% {
            opacity: 0.9;
            transform: translate3d(-1px, 0, 0);
          }
        }

        /* Grito de puesto: desplazamiento breve y con peso (finita). */
        .eec-card-up {
          animation: eecCardUp 0.55s cubic-bezier(0.22, 0.7, 0.3, 1) 1 both;
        }
        .eec-card-down {
          animation: eecCardDown 0.55s cubic-bezier(0.22, 0.7, 0.3, 1) 1 both;
        }

        @keyframes eecCardUp {
          0% {
            transform: translate3d(0, 8px, 0);
          }
          60% {
            transform: translate3d(0, -3px, 0);
          }
          100% {
            transform: translate3d(0, 0, 0);
          }
        }
        @keyframes eecCardDown {
          0% {
            transform: translate3d(0, -7px, 0);
          }
          60% {
            transform: translate3d(0, 3px, 0);
          }
          100% {
            transform: translate3d(0, 0, 0);
          }
        }

        .eec-shout {
          animation: eecShout 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) 1 both;
        }

        @keyframes eecShout {
          0% {
            opacity: 0;
            transform: translate3d(0, -8px, 0) scale(0.9);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .eec-sheen,
          .eec-leader-glow,
          .eec-card-up,
          .eec-card-down,
          .eec-shout,
          .eec-card-alarm {
            animation: none !important;
          }
          .eec-sheen {
            opacity: 0 !important;
          }
        }
      `}</style>
    </>
  );
}
