'use client';

/**
 * Chips de impacto de una decisión YA resuelta por el centro de control.
 *
 * Los números entran contando desde cero (el golpe se siente al registrarse) y salen
 * exclusivamente del `effect` que devolvió el centro de control: aquí no se calcula nada.
 */

import React from 'react';

import type { DecisionEffect } from '@/types/game';
import { dinero, formatNumber, kwh, m3, porcentaje } from '@/lib/ui';
import AnimatedNumber from './AnimatedNumber';

interface ChipProps {
  icono: string;
  /** Color del ícono (color de acento del proyecto, nunca uno nuevo). */
  color: string;
  /** El signo va fuera del contador para que el conmutador se lea siempre. */
  signo: string;
  valor: number;
  formato: (value: number) => string;
  tono: string;
  contar: boolean;
}

function Chip({ icono, color, signo, valor, formato, tono, contar }: ChipProps) {
  return (
    <span className="flex items-center gap-1">
      <span className={`material-symbols-outlined text-[14px] ${color}`}>{icono}</span>
      <strong className={tono}>
        {signo}
        <AnimatedNumber value={Math.abs(valor)} format={formato} duration={620} contarDesdeCero={contar} />
      </strong>
    </span>
  );
}

export default function EffectChips({
  effect,
  contar = true,
  className,
}: {
  effect: DecisionEffect;
  /** Contar desde cero (nunca se anima antes de que responda el centro de control). */
  contar?: boolean;
  className?: string;
}) {
  const electricidad = effect.electricidad;
  const gas = effect.gas;
  const presupuesto = effect.presupuesto;
  const eficiencia = effect.eficiencia;

  return (
    <span className={`flex flex-wrap gap-3 font-label-sm text-label-sm ${className ?? ''}`}>
      {electricidad !== undefined && electricidad !== 0 && (
        <Chip
          icono="bolt"
          color="text-accent-electricidad"
          signo={electricidad > 0 ? '+' : '-'}
          valor={electricidad}
          formato={kwh}
          tono={electricidad <= 0 ? 'text-accent-eficiencia' : 'text-accent-gas'}
          contar={contar}
        />
      )}
      {gas !== undefined && gas !== 0 && (
        <Chip
          icono="local_fire_department"
          color="text-accent-gas"
          signo={gas > 0 ? '+' : '-'}
          valor={gas}
          formato={m3}
          tono={gas <= 0 ? 'text-accent-eficiencia' : 'text-accent-gas'}
          contar={contar}
        />
      )}
      {presupuesto !== undefined && presupuesto !== 0 && (
        <Chip
          icono="account_balance_wallet"
          color="text-accent-presupuesto"
          signo={presupuesto > 0 ? '+' : '-'}
          valor={presupuesto}
          formato={dinero}
          tono="text-accent-presupuesto"
          contar={contar}
        />
      )}
      {eficiencia !== undefined && eficiencia !== 0 && (
        <Chip
          icono="speed"
          color="text-accent-eficiencia"
          signo={eficiencia > 0 ? '+' : '-'}
          valor={eficiencia}
          formato={porcentaje}
          tono={eficiencia > 0 ? 'text-accent-eficiencia' : 'text-accent-gas'}
          contar={contar}
        />
      )}
    </span>
  );
}
