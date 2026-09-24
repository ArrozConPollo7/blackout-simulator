/** Etiquetas y formato de la interfaz (es-CO). Sin lógica de juego: eso vive en el Worker. */

import type { DecisionEffect, Phase } from '@/types/game';
import { PHASE_BY_NAME, PHASE_ORDER, nextPhaseOf } from '@/content/phases';
import { formatNumber } from '@/engine/decisions';
import type { RealtimeStatus } from './useGameState';

export { formatNumber };

/** Fase de la vista Host del cascarón (4 pantallas) a partir de la fase del motor. */
export type HostPhase = 'lobby' | 'en_juego' | 'crisis' | 'resultados';

export function hostPhaseOf(phase: Phase | undefined): HostPhase {
  switch (phase) {
    case 'lobby':
      return 'lobby';
    case 'crisis':
      return 'crisis';
    case 'resultados':
      return 'resultados';
    default:
      return 'en_juego';
  }
}

export function phaseCode(phase: Phase | undefined): string {
  return phase ? PHASE_BY_NAME[phase].code : PHASE_BY_NAME.lobby.code;
}

export function phaseLabel(phase: Phase | undefined): string {
  return phase ? PHASE_BY_NAME[phase].label : PHASE_BY_NAME.lobby.label;
}

export function followingPhase(phase: Phase | undefined): Phase | null {
  return phase ? nextPhaseOf(phase) : null;
}

/** Siguiente fase con la etiqueta del botón del Host, o null si ya es la última. */
export interface PhaseStep {
  phase: Phase | undefined;
  next: { phase: Phase; label: string } | null;
}

const ETIQUETA_TRANSICION: Record<Phase, string> = {
  lobby: 'Iniciar investigación',
  investigar: 'Abrir decisiones',
  decidir: 'Abrir crisis',
  crisis: 'Últimas decisiones',
  decidir_2: 'Ver resultados',
  resultados: '',
};

export function siguienteEtiqueta(
  phase: Phase | undefined,
): { phase: Phase; label: string } | null {
  const siguiente = followingPhase(phase);
  if (!phase || !siguiente) return null;
  return { phase: siguiente, label: ETIQUETA_TRANSICION[phase] };
}

export function stepIndex(phase: Phase | undefined): number {
  return phase ? PHASE_ORDER.indexOf(phase) : 0;
}

/** '03:42' o '--:--' cuando la fase no lleva cronómetro. */
export function formatRemaining(ms: number | null): string {
  if (ms === null) return '--:--';
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export const kwh = (value: number) => `${formatNumber(value, 2)} kWh`;
export const m3 = (value: number) => `${formatNumber(value, 2)} m³`;
export const dinero = (value: number) => `$ ${formatNumber(value, 0)}`;
export const porcentaje = (value: number) => `${formatNumber(value, 2)} %`;

/**
 * Lectura cualitativa de una opción ANTES de decidir: el número exacto del ahorro
 * aparece después, en el feedback del Worker (así el aprendizaje llega al confirmar).
 */
export interface ImpactHint {
  consumo: 'ahorro_alto' | 'ahorro' | 'igual';
  confort: 'mejora' | 'igual' | 'baja';
}

export function impactHint(effect: DecisionEffect): ImpactHint {
  const ahorro = -(effect.electricidad ?? 0);
  const gas = -(effect.gas ?? 0);
  const total = ahorro + gas * 3; // el m³ de gas pesa más por su poder calorífico
  const confort = effect.eficiencia ?? 0;
  return {
    consumo: total > 4 ? 'ahorro_alto' : total > 0.4 ? 'ahorro' : 'igual',
    confort: confort > 0 ? 'mejora' : confort < 0 ? 'baja' : 'igual',
  };
}

export const CONSUMO_LABEL: Record<ImpactHint['consumo'], string> = {
  ahorro_alto: 'Ahorro alto',
  ahorro: 'Ahorro',
  igual: 'Sin cambio',
};

export const CONFORT_LABEL: Record<ImpactHint['confort'], string> = {
  mejora: 'Confort: mejora',
  igual: 'Confort: igual',
  baja: 'Confort: baja',
};

export function realtimeLabel(status: RealtimeStatus): string {
  switch (status) {
    case 'suscrito':
      return 'SEÑAL EN VIVO';
    case 'conectando':
      return 'RECONECTANDO…';
    case 'error':
      return 'SEÑAL DÉBIL';
    default:
      return 'SIN SEÑAL';
  }
}

export function realtimeIcon(status: RealtimeStatus): string {
  switch (status) {
    case 'suscrito':
      return 'sensors';
    case 'conectando':
      return 'sync';
    case 'error':
      return 'sync_problem';
    default:
      return 'sensors_off';
  }
}

export function formatSyncAge(lastSyncAt: number | null): string {
  if (!lastSyncAt) return 'sin sincronizar';
  const seconds = Math.max(0, Math.round((Date.now() - lastSyncAt) / 1000));
  return seconds <= 1 ? 'sincronizado ahora' : `sincronizado hace ${seconds} s`;
}

/**
 * Código corto de sala: los equipos lo leen en el proyector y lo dicen en voz alta.
 * Es el prefijo del identificador de la partida, no un dato inventado.
 */
export const salaCode = (gameId: string | null | undefined): string =>
  gameId ? gameId.slice(0, 4).toUpperCase() : '----';
