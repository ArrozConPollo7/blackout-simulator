'use client';

import React from 'react';
import { RankingTrend } from '@/types/game';

interface RankingIndicatorProps {
  rank?: number;
  trend?: RankingTrend;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export default function RankingIndicator({
  rank,
  trend = 'flat',
  label,
  className = '',
}: RankingIndicatorProps) {
  const getTrendConfig = () => {
    switch (trend) {
      case 'up':
        return {
          icon: 'trending_up',
          colorClass: 'text-accent-eficiencia',
          defaultLabel: 'LÍDER',
          bgClass: 'bg-accent-eficiencia/10 border-accent-eficiencia/30',
        };
      case 'down':
        return {
          icon: 'trending_down',
          colorClass: 'text-accent-crisis',
          defaultLabel: 'CRÍTICO',
          bgClass: 'bg-accent-crisis/10 border-accent-crisis/30',
        };
      case 'flat':
      default:
        return {
          icon: 'trending_flat',
          colorClass: 'text-secondary',
          defaultLabel: 'EQUILIBRADO',
          bgClass: 'bg-secondary/10 border-secondary/30',
        };
    }
  };

  const config = getTrendConfig();
  const displayLabel = label || config.defaultLabel;

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border font-label-md text-label-md font-semibold tracking-wide uppercase ${config.bgClass} ${config.colorClass} ${className}`}
    >
      <span className="material-symbols-outlined text-[16px]">{config.icon}</span>
      <span>{displayLabel}</span>
      {rank !== undefined && <span className="opacity-80 font-bold ml-0.5">#{rank}</span>}
    </div>
  );
}
