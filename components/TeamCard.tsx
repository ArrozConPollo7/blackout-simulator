'use client';

import React from 'react';
import { TeamState, RankingTrend } from '@/types/game';
import RankingIndicator from './RankingIndicator';

interface TeamCardProps {
  team: TeamState;
  rank: number;
  variant?: 'default' | 'crisis' | 'podium';
  isLeader?: boolean;
  className?: string;
}

export default function TeamCard({
  team,
  rank,
  variant = 'default',
  isLeader = false,
  className = '',
}: TeamCardProps) {
  const maxElec = 280;
  const maxGas = 45;
  const maxPpto = 60000;

  const elecPercent = Math.min(100, Math.round((team.electricidad / maxElec) * 100));
  const gasPercent = Math.min(100, Math.round((team.gas / maxGas) * 100));
  const pptoPercent = Math.min(100, Math.round((team.presupuesto / maxPpto) * 100));

  const trend: RankingTrend =
    rank === 1 ? 'up' : team.eficiencia < 50 ? 'down' : 'flat';

  // Variant: PODIUM (Used in Host Resultados)
  if (variant === 'podium') {
    const isFirst = rank === 1;
    const isSecond = rank === 2;
    const isThird = rank === 3;

    const rankTitle = isFirst ? '1º Puesto' : isSecond ? '2º Puesto' : '3º Puesto';
    const rankGrade = isFirst ? 'RANGO A+' : isSecond ? 'RANGO B+' : 'RANGO B';
    const accentColor = isFirst
      ? 'text-accent-eficiencia'
      : isSecond
      ? 'text-accent-presupuesto'
      : 'text-secondary';

    return (
      <div
        className={`flex flex-col bg-surface-container rounded-xl overflow-hidden hover:bg-surface-container-high transition-colors border border-border-subtle shadow-xl ${
          isFirst ? 'ring-2 ring-accent-eficiencia/40' : ''
        } ${className}`}
      >
        <div className="p-space-md bg-surface-container-high flex items-center justify-between border-b border-border-subtle">
          <div className="flex items-center gap-space-xs">
            <span className={`material-symbols-outlined ${accentColor} text-[26px]`}>
              {isFirst ? 'emoji_events' : 'workspace_premium'}
            </span>
            <div>
              <span className={`font-label-sm text-label-sm uppercase ${accentColor} tracking-widest block font-bold`}>
                {rankTitle}
              </span>
              <h3 className="font-headline-md text-headline-md text-text-primary tracking-wide uppercase font-bold">
                {team.name}
              </h3>
            </div>
          </div>
          <span className={`px-2.5 py-1 rounded bg-surface-container-lowest font-label-md text-label-md ${accentColor} font-semibold`}>
            {rankGrade}
          </span>
        </div>

        <div className="p-space-md flex flex-col gap-space-md">
          <div className="grid grid-cols-2 gap-space-sm">
            <div className="bg-surface-container-lowest p-space-sm rounded-lg border border-border-subtle/50">
              <span className="font-label-sm text-label-sm text-text-secondary uppercase flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px] text-accent-presupuesto">account_balance_wallet</span>
                Presupuesto
              </span>
              <span className="font-metric-display-mobile text-metric-display-mobile text-text-primary font-bold block mt-1 tabular-nums">
                ${team.presupuesto.toLocaleString()}
              </span>
            </div>
            <div className="bg-surface-container-lowest p-space-sm rounded-lg border border-border-subtle/50">
              <span className="font-label-sm text-label-sm text-text-secondary uppercase flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px] text-accent-eficiencia">speed</span>
                Eficiencia
              </span>
              <span className="font-metric-display-mobile text-metric-display-mobile text-accent-eficiencia font-bold block mt-1 tabular-nums">
                {team.eficiencia}%
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-space-sm">
            <div className="bg-surface-container-lowest p-space-sm rounded-lg border border-border-subtle/50">
              <span className="font-label-sm text-label-sm text-text-secondary uppercase flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px] text-accent-electricidad">bolt</span>
                Electricidad
              </span>
              <span className="font-label-md text-label-md text-text-primary font-bold block mt-1 tabular-nums">
                {team.electricidad} kWh
              </span>
            </div>
            <div className="bg-surface-container-lowest p-space-sm rounded-lg border border-border-subtle/50">
              <span className="font-label-sm text-label-sm text-text-secondary uppercase flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px] text-accent-gas">local_fire_department</span>
                Gas Natural
              </span>
              <span className="font-label-md text-label-md text-text-primary font-bold block mt-1 tabular-nums">
                {team.gas} m³
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Variant: CRISIS (Used in Host Crisis)
  if (variant === 'crisis') {
    return (
      <div
        className={`rounded-xl bg-surface-container-low shadow-xl p-space-md flex flex-col justify-between transition-all hover:bg-surface-container border border-border-subtle ${
          isLeader ? 'ring-1 ring-accent-eficiencia/40' : team.eficiencia < 50 ? 'border-accent-crisis/40 bg-accent-crisis/5' : ''
        } ${className}`}
      >
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center justify-between pb-1 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              <span className="font-label-lg text-label-lg font-bold text-accent-presupuesto">
                #{String(rank).padStart(2, '0')}
              </span>
              <span className="font-headline-md text-headline-md text-text-primary font-bold uppercase">
                {team.name}
              </span>
            </div>
            <RankingIndicator rank={rank} trend={trend} />
          </div>

          <div className="flex items-center gap-2 mt-1">
            <span className="font-label-sm text-label-sm text-text-secondary">GAS: {team.gas} m³</span>
            <span className="text-outline-variant">|</span>
            <span className="font-label-sm text-label-sm text-text-secondary">
              ESTADO: {team.eficiencia >= 60 ? 'RESISTENCIA NOMINAL' : 'ESTRÉS TÉRMICO'}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 my-space-md bg-surface-container-lowest/60 p-space-sm rounded-lg border border-border-subtle">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-text-secondary flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px] text-accent-presupuesto">account_balance_wallet</span>
              PRESUPUESTO
            </span>
            <span className="font-label-lg text-label-lg font-bold text-accent-presupuesto tabular-nums">
              ${team.presupuesto.toLocaleString()}
            </span>
          </div>
          <div className="w-full bg-surface-container h-1.5 rounded-full overflow-hidden">
            <div className="bg-accent-presupuesto h-full rounded-full" style={{ width: `${pptoPercent}%` }}></div>
          </div>
          <span className="font-label-sm text-label-sm text-accent-gas text-right">
            {team.eficiencia >= 70 ? 'Respaldo activo ante sobrecosto' : '-30% aplicado sobre gasto de red'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border-subtle">
          <div>
            <span className="font-label-sm text-label-sm text-text-secondary block">EFICIENCIA</span>
            <span className={`font-label-lg text-label-lg font-bold tabular-nums ${team.eficiencia >= 70 ? 'text-accent-eficiencia' : 'text-accent-crisis'}`}>
              {team.eficiencia}%
            </span>
          </div>
          <div className="text-right">
            <span className="font-label-sm text-label-sm text-text-secondary block">CONSUMO</span>
            <span className="font-label-lg text-label-lg font-bold text-accent-electricidad tabular-nums">
              {team.electricidad} kWh
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Variant: DEFAULT (Used in Host En Juego / General Telemetry)
  return (
    <div
      className={`bg-bg-surface rounded-xl p-space-sm flex flex-col gap-space-sm shadow-md transition-all duration-200 hover:shadow-lg border border-border-subtle ${
        isLeader ? 'ring-1 ring-accent-eficiencia/40' : ''
      } ${className}`}
    >
      {/* Card Header */}
      <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
        <div className="flex items-center gap-space-xs">
          <span className="font-label-lg text-label-lg font-bold text-accent-presupuesto">#{rank}</span>
          <span className="font-headline-sm font-bold text-text-primary uppercase tracking-wide">
            {team.name}
          </span>
        </div>
        <RankingIndicator rank={rank} trend={trend} />
      </div>

      {/* 4 Telemetry Rows with JetBrains Mono & Progress Bars */}
      <div className="flex flex-col gap-2.5">
        {/* 1. Electricidad (Zap) */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between font-label-sm text-label-sm">
            <span className="flex items-center gap-1.5 text-text-secondary">
              <span className="material-symbols-outlined text-[16px] text-accent-electricidad">bolt</span>
              ELECTRICIDAD
            </span>
            <span className="font-label-md text-label-md font-bold text-text-primary tabular-nums">
              {team.electricidad} <span className="text-text-secondary font-normal">/ {maxElec} kWh</span>
            </span>
          </div>
          <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
            <div
              className="bg-accent-electricidad h-full rounded-full transition-all duration-500"
              style={{ width: `${elecPercent}%` }}
            ></div>
          </div>
        </div>

        {/* 2. Gas (Flame) */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between font-label-sm text-label-sm">
            <span className="flex items-center gap-1.5 text-text-secondary">
              <span className="material-symbols-outlined text-[16px] text-accent-gas">local_fire_department</span>
              GAS NATURAL
            </span>
            <span className="font-label-md text-label-md font-bold text-text-primary tabular-nums">
              {team.gas} <span className="text-text-secondary font-normal">/ {maxGas} m³</span>
            </span>
          </div>
          <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
            <div
              className="bg-accent-gas h-full rounded-full transition-all duration-500"
              style={{ width: `${gasPercent}%` }}
            ></div>
          </div>
        </div>

        {/* 3. Presupuesto (Wallet) */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between font-label-sm text-label-sm">
            <span className="flex items-center gap-1.5 text-text-secondary">
              <span className="material-symbols-outlined text-[16px] text-accent-presupuesto">account_balance_wallet</span>
              PRESUPUESTO
            </span>
            <span className="font-label-md text-label-md font-bold text-accent-presupuesto tabular-nums">
              ${team.presupuesto.toLocaleString()} <span className="text-text-secondary font-normal">/ $60k</span>
            </span>
          </div>
          <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
            <div
              className="bg-accent-presupuesto h-full rounded-full transition-all duration-500"
              style={{ width: `${pptoPercent}%` }}
            ></div>
          </div>
        </div>

        {/* 4. Eficiencia (Gauge) */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between font-label-sm text-label-sm">
            <span className="flex items-center gap-1.5 text-text-secondary">
              <span className="material-symbols-outlined text-[16px] text-accent-eficiencia">speed</span>
              EFICIENCIA
            </span>
            <span className="font-label-md text-label-md font-bold text-accent-eficiencia tabular-nums">
              {team.eficiencia}%
            </span>
          </div>
          <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
            <div
              className="bg-accent-eficiencia h-full rounded-full transition-all duration-500"
              style={{ width: `${team.eficiencia}%` }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
}
