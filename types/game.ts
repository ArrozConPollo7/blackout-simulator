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

export interface DecisionOption {
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
