/**
 * Contrato de tipos del cliente. La aritmética vive en `@/shared/rules`
 * (CommonJS, compartido con `server.js`); aquí solo se tipa el estado que
 * viaja por WebSocket y se re-exportan los datos de reglas.
 */
import {
  SECTOR_SPECS as RAW_SECTOR_SPECS,
  SECTOR_ORDER as RAW_SECTOR_ORDER,
  DISTRICTS as RAW_DISTRICTS,
  CRISIS_PRESETS as RAW_CRISIS_PRESETS,
  INCIDENT_POOL as RAW_INCIDENT_POOL,
  incidentTags as RAW_INCIDENT_TAGS,
  VERSION as RAW_VERSION,
  BASE_DEMAND_MW_PER_DISTRICT as RAW_BASE_MW,
  BASE_DEMAND_GAS_PER_DISTRICT as RAW_BASE_GAS,
  ANNOUNCE_SECONDS as RAW_ANNOUNCE,
  NEGOTIATION_SECONDS as RAW_NEGOTIATION,
  ANNOUNCE_SECONDS,
  NEGOTIATION_SECONDS,
  INITIAL_WELFARE,
  INITIAL_BUDGET,
  MAX_WELFARE,
  MIN_WELFARE,
  MAX_BLACKOUTS,
  TOTAL_ROUNDS,
  BLACKOUT_WELFARE_HIT,
  STABLE_WELFARE_BONUS,
  MIN_DISTRICTS,
  MAX_DISTRICTS,
} from "@/shared/rules";

export type SectorKey = "industry" | "residential" | "critical";

export type GamePhase = "LOBBY" | "CRISIS_ANNOUNCE" | "CRISIS_ACTIVE" | "RESOLUTION" | "GAME_OVER";

export interface SectorsState {
  industry: boolean;
  residential: boolean;
  critical: boolean;
}

export interface SectorSpec {
  key: SectorKey;
  label: string;
  short: string;
  sublabel: string;
  tag: string;
  demandMW: number;
  demandGas: number;
  revenueOn: number;
  revenueOff: number;
  gridFee: number;
  welfareOff: number;
  icon: string;
  accent: "green" | "cyan" | "red" | "magenta";
}

export interface DistrictInfo {
  id: string;
  name: string;
  code: string;
  tag: string;
}

export interface DistrictTeam {
  id: string;
  districtId: string;
  name: string;
  code: string;
  operator: string | null;
  /** true = una mesa con teléfono tomó el distrito; false = reservado sin operador. */
  claimed: boolean;
  welfare: number;
  budget: number;
  sectors: SectorsState;
  welfareSacrificed: number;
  industryRoundsOn: number;
  roundsPlayed: number;
  connected: boolean;
}

export interface Capacity {
  districts: number;
  baseMW: number;
  baseGas: number;
  /** Multiplicador combinado (crisis x incidentes) que ve el proyector. */
  electricMultiplier: number;
  gasMultiplier: number;
  maxMW: number;
  maxGas: number;
}

export interface Demand {
  mw: number;
  gas: number;
  perTeam: Record<string, { mw: number; gas: number }>;
}

export interface CrisisEvent {
  id: string;
  round: number;
  name: string;
  tagline: string;
  description: string;
  electricMultiplier: number;
  gasMultiplier: number;
  residentialDemandMultiplier: number;
  hexCode: string;
  icon: string;
  objective: string;
}

export type IncidentFamily = "capacity" | "demand" | "economy" | "lock" | "boost";

export interface IncidentEffects {
  electricMultiplier: number;
  gasMultiplier: number;
  demand: { industry: number; residential: number; critical: number };
  welfareAll: number;
  budgetAll: number;
  blackoutWelfareExtra: number;
  blackoutBudgetExtra: number;
  stableWelfareBonus: number;
  stableBudgetBonus: number;
  industryRevenueBonus: number;
  lockSectors: SectorKey[];
}

/**
 * Incidente aleatorio: se sortea sobre la crisis de la ronda. `effects` es
 * parcial; el motor lo normaliza (lo ausente vale neutro).
 */
export interface IncidentEvent {
  id: string;
  family: IncidentFamily;
  severity: 1 | 2 | 3;
  minRound: number;
  name: string;
  tagline: string;
  icon: string;
  hexCode: string;
  description: string;
  objective: string;
  effects: Partial<IncidentEffects>;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  type: "WARN" | "ALERT" | "TEAM" | "SYS" | "HOST";
  message: string;
}

export interface ResolutionLine {
  kind: "bonus" | "penalty";
  text: string;
}

export interface TeamResolution {
  teamId: string;
  teamName: string;
  districtId: string;
  claimed: boolean;
  demandMW: number;
  demandGas: number;
  budgetDelta: number;
  welfareDelta: number;
  budgetBefore: number;
  welfareBefore: number;
  budgetAfter: number;
  welfareAfter: number;
  lines: ResolutionLine[];
}

export interface ResolutionData {
  round: number;
  outcome: "BLACKOUT" | "STABLE";
  cause: "ELECTRICIDAD" | "GAS" | "AMBAS" | null;
  totalMW: number;
  totalGas: number;
  capacityMW: number;
  capacityGas: number;
  marginMW: number;
  marginGas: number;
  blackoutCount: number;
  irreversible: boolean;
  /** Incidentes que estaban vigentes cuando se resolvió la ronda. */
  incidents: { id: string; name: string }[];
  lockedSectors: SectorsState;
  teamResults: TeamResolution[];
}

export interface FinalRankingEntry {
  teamId: string;
  teamName: string;
  districtId: string;
  claimed: boolean;
  welfare: number;
  budget: number;
  pef: number;
  welfareSacrificed: number;
  industryRoundsOn: number;
  roundsPlayed: number;
}

export interface FinalResults {
  irreversible: boolean;
  blackoutCount: number;
  roundsPlayed: number;
  seed: number;
  incidentsPlayed: string[];
  ranking: FinalRankingEntry[];
  mentions: { exemplary: string | null; martyr: string | null; parasite: string | null };
}

export interface RoomState {
  pin: string;
  version: string;
  phase: GamePhase;
  currentRound: number;
  totalRounds: number;
  announceSeconds: number;
  negotiationSeconds: number;
  timeRemaining: number;
  deadlineTs: number | null;
  timerRunning: boolean;
  activeCrisis: CrisisEvent | null;
  /** Semilla del sorteo: dos salas con la misma semilla juegan el mismo guion. */
  seed: number;
  /** false = partida con la aritmética del documento, sin incidentes. */
  incidentsEnabled: boolean;
  /** Incidentes sorteados para la ronda vigente (vacío en el vestíbulo). */
  incidents: IncidentEvent[];
  usedIncidentIds: string[];
  /** Palancas que un incidente impide cortar en esta ronda. */
  lockedSectors: SectorsState;
  capacity: Capacity;
  demand: Demand;
  blackoutCount: number;
  teams: Record<string, DistrictTeam>;
  logs: LogEntry[];
  lastResolution: ResolutionData | null;
  finalResults: FinalResults | null;
  hostConnected: boolean;
}

export type ClientMessage =
  | { type: "HOST_OPEN_ROOM"; pin: string; passcode?: string }
  | { type: "WATCH_ROOM"; pin: string }
  | { type: "JOIN_DISTRICT"; pin: string; districtId: string; operator?: string; teamId?: string }
  | { type: "LEAVE_DISTRICT"; teamId?: string }
  | { type: "TOGGLE_SECTOR"; sector: SectorKey; state: boolean }
  | { type: "SCRAM" }
  | { type: "HOST_TOGGLE_SECTOR"; teamId: string; sector: SectorKey; state: boolean }
  | { type: "HOST_SEED_DISTRICTS"; count: number }
  | { type: "HOST_REMOVE_UNCLAIMED" }
  | { type: "HOST_START_GAME" }
  | { type: "HOST_SKIP_ANNOUNCE" }
  | { type: "HOST_RESOLVE_NOW" }
  | { type: "HOST_NEXT_ROUND" }
  | { type: "HOST_RESET_GAME" }
  | { type: "PING" };

export type ServerMessage =
  | { type: "SYNC_STATE"; state: RoomState }
  | { type: "JOIN_SUCCESS"; teamId: string; pin: string }
  | { type: "SESSION_EXPIRED" }
  | { type: "JOIN_REJECTED"; reason: string; teamId?: string }
  | { type: "ROOM_NOT_FOUND"; pin: string }
  | { type: "ERROR"; message: string }
  | { type: "ALERT"; message: string };

export const VERSION = RAW_VERSION as string;
export const SECTOR_ORDER = RAW_SECTOR_ORDER as SectorKey[];
export const SECTOR_SPECS = RAW_SECTOR_SPECS as Record<SectorKey, SectorSpec>;
export const DISTRICTS = RAW_DISTRICTS as DistrictInfo[];
export const CRISIS_PRESETS = RAW_CRISIS_PRESETS as CrisisEvent[];
export const INCIDENT_POOL = RAW_INCIDENT_POOL as IncidentEvent[];
/** Etiquetas cortas de un incidente (las genera el motor, no la vista). */
export const incidentTags = RAW_INCIDENT_TAGS as (incident: IncidentEvent) => string[];
export const BASE_DEMAND_MW_PER_DISTRICT = RAW_BASE_MW as number;
export const BASE_DEMAND_GAS_PER_DISTRICT = RAW_BASE_GAS as number;

export {
  ANNOUNCE_SECONDS,
  NEGOTIATION_SECONDS,
  INITIAL_WELFARE,
  INITIAL_BUDGET,
  MAX_WELFARE,
  MIN_WELFARE,
  MAX_BLACKOUTS,
  TOTAL_ROUNDS,
  BLACKOUT_WELFARE_HIT,
  STABLE_WELFARE_BONUS,
  MIN_DISTRICTS,
  MAX_DISTRICTS,
};

export const versionLabel = `GRID_SIM // v${VERSION}`;