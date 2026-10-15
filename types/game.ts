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
  phase:
    | 'lobby'
    | 'investigar'
    | 'decidir'
    | 'crisis'
    | 'crisis_votacion'
    | 'decidir_2'
    | 'resultados';
  timerEndsAt: string;
  crisisTriggered: boolean;
  teams: TeamState[];
  /**
   * Semilla de la partida (plan 2.1). Todo sorteo del motor se deriva de ella, asi que el
   * acta final puede mostrarla y una partida se repite entera tecleando el mismo numero.
   */
  seed: number;
  /**
   * Intensidad del alza de tarifa de la crisis, sorteada al iniciar la partida (20-45%).
   * Antes era siempre 30%: visible en pantalla, pero nunca la misma dos veces.
   */
  crisisRate: number;
  /** Efecto que acompaña al alza en esta partida (plan 2.3). */
  crisisVariant: CrisisVariantInfo;
  /** Eventos aleatorios vigentes en la fase actual (0 o 1 por ronda; ver `content/events.ts`). */
  activeEvents: GameEventInstance[];
  /** Medidas colectivas que esta partida ofrece en la votacion de la crisis. */
  crisisMeasures: CrisisMeasure[];
  /** Votos recibidos; se resuelven al cerrar la ventana o al votar el ultimo equipo. */
  crisisVotes: CrisisVote[];
  /** Medida ganadora ya aplicada a todos los equipos (null mientras no se resuelva). */
  crisisResolvedMeasureId: string | null;
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

// ---------------------------------------------------------------------------
// Aleatoriedad: eventos, crisis variable y votacion colectiva (plan 2 y 3)
// ---------------------------------------------------------------------------

/** Familias de efecto de un evento aleatorio o de una medida colectiva. */
export type GameEventKind = 'lock' | 'subsidy' | 'fault';

/** Efecto que acompaña a la crisis en esta partida (el gas sube con la luz, o no). */
export interface CrisisVariantInfo {
  id: string;
  label: string;
  /** Recargo extra, en tanto por uno, sobre la factura de gas (0 = la crisis es solo eléctrica). */
  gasSurchargeRate: number;
}

/**
 * Efecto de una medida colectiva de crisis. Ademas de los deltas de `DecisionEffect`
 * (que valen para todos los equipos por igual) admite partes proporcionales: la medida
 * habla de porcentajes ("racionamiento del 15%"), no de un numero fijo de kWh.
 */
export interface CrisisMeasureEffect extends DecisionEffect {
  /** Porcentaje del consumo ELECTRICO acumulado que se recorta (negativo = ahorro). */
  electricidadPct?: number;
  /** Porcentaje del consumo de gas acumulado que se recorta. */
  gasPct?: number;
  /** Recargo porcentual sobre la factura electrica ya acumulada (tarifa de emergencia). */
  facturaElectricidadPct?: number;
  /**
   * Reparto solidario: los equipos por encima del presupuesto promedio del aula aportan
   * este porcentaje de su excedente, y el fondo se reparte a partes iguales entre los
   * equipos por debajo del promedio.
   */
  fondoSolidarioPct?: number;
}

/** Medida colectiva que el aula vota durante la crisis (plan 3.1). */
export interface CrisisMeasure {
  id: string;
  label: string;
  description: string;
  /** Cuanto duele si sale (1 suave - 4 severa). Desempata la votacion. */
  severity: number;
  effect: CrisisMeasureEffect;
}

export interface CrisisVote {
  teamId: string;
  measureId: string;
  votedAt: string;
}

/** Resultado de la votacion, ya aplicado a todos los equipos. */
export interface CrisisOutcome {
  measureId: string;
  label: string;
  description: string;
  effect: CrisisMeasureEffect;
  votes: number;
  totalVotes: number;
  /** true cuando el aula no se puso de acuerdo y decidio la medida mas severa. */
  tie: boolean;
}

/** Evento aleatorio vigente (plan 2.2), ya instanciado para esta partida. */
export interface GameEventInstance {
  id: string;
  kind: GameEventKind;
  title: string;
  /** Texto en lenguaje de jugador (sin jerga tecnica, convencion del proyecto). */
  description: string;
  icon: string;
  /** Aparato afectado (apagon parcial y falla de aparato), null si el evento es del aula. */
  applianceId: string | null;
  /** Efecto ya aplicado a los equipos, si el evento cobra algo. */
  effect: DecisionEffect;
  /** true cuando el efecto ya quedo registrado en el historial (nunca se cobra dos veces). */
  applied: boolean;
}

