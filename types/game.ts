/**
 * Contratos compartidos entre el motor de juego, el Worker y el frontend.
 *
 * NOTA DE RECONCILIACION (Fase 1, 1.1):
 * El cascaron de Antigravity ya definia un `DecisionOption` orientado a presentacion
 * (title/description/impact* en texto). El motor necesita un `DecisionOption` con
 * datos numericos. Para no tener dos simbolos con el mismo nombre en el mismo modulo,
 * el tipo del cascaron se renombro a `DecisionCardOption` (mismo shape exacto, cero
 * cambios de comportamiento en la UI). `TeamState` y `GameState` quedaron intactos.
 */

export interface TeamState {
  id: string;
  name: string;
  color: string;
  electricidad: number;
  gas: number;
  presupuesto: number;
  eficiencia: number;
  puntos: number;
}

export interface GameState {
  phase: 'lobby' | 'investigar' | 'decidir' | 'crisis' | 'decidir_2' | 'resultados';
  timerEndsAt: string;
  crisisTriggered: boolean;
  teams: TeamState[];
}

export type RankingTrend = 'up' | 'down' | 'flat';

export interface Appliance {
  id: string;
  name: string;
  category: string;
  icon: string;
  consumptionText: string;
  costText: string;
  stateText: string;
  isHighImpact?: boolean;
}

/** Tipo de presentacion del cascaron (antes se llamaba `DecisionOption`). */
export interface DecisionCardOption {
  id: string;
  title: string;
  description: string;
  impactElectricidad: string;
  impactGas?: string;
  impactPresupuesto: string;
  impactComfort: string;
  recommended?: boolean;
  isHighRisk?: boolean;
}

// ---------------------------------------------------------------------------
// Motor de juego (Fase 1)
// ---------------------------------------------------------------------------

export type Phase = GameState['phase'];

/** Efectos numericos de una decision. Todas las magnitudes son deltas. */
export interface DecisionEffect {
  electricidad?: number;
  gas?: number;
  presupuesto?: number;
  eficiencia?: number;
}

/** Cada decision posible del juego se define como dato, no como logica dispersa. */
export interface DecisionOption {
  id: string;
  label: string;
  effect: DecisionEffect;
}

/** Caso asignado a un equipo (vivienda, empresa, local...). */
export interface TeamCase {
  id: string;
  name: string; // ej. "Familia Duque"
  appliances: string[]; // ids de electrodomesticos investigables
  hiddenProblems: string[]; // los problemas ocultos de la Ronda 1
}
