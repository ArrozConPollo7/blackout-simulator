/**
 * Repositorio en memoria: misma interfaz que SupabaseRepo, sin red.
 * Lo usan los tests del Worker y `scripts/simulate-game.ts` (flujo de partida simulada).
 */

import type { Phase } from '../../types/game.ts';
import { randomUUID } from 'node:crypto';
import type {
  DecisionLogInput,
  DecisionRow,
  GameRepo,
  GameRow,
  TeamRow,
} from './repo.ts';

interface InMemoryState {
  games: Map<string, GameRow>;
  teams: Map<string, TeamRow>;
  decisions: DecisionRow[];
}

export class InMemoryRepo implements GameRepo {
  private readonly state: InMemoryState = {
    games: new Map(),
    teams: new Map(),
    decisions: [],
  };

  /** Cuenta de escrituras, para verificar en tests que todo pasa por el Worker. */
  readonly writes: { games: number; teams: number; decisions: number } = {
    games: 0,
    teams: 0,
    decisions: 0,
  };

  async createGame(input: {
    phase: Phase;
    timerEndsAt: string;
    crisisTriggered: boolean;
  }): Promise<GameRow> {
    const row: GameRow = {
      id: randomUUID(),
      phase: input.phase,
      timer_ends_at: input.timerEndsAt,
      crisis_triggered: input.crisisTriggered,
    };
    this.state.games.set(row.id, row);
    this.writes.games += 1;
    return { ...row };
  }

  async createTeams(rows: Array<Omit<TeamRow, 'id'>>): Promise<TeamRow[]> {
    const created = rows.map((row) => {
      const full: TeamRow = { id: randomUUID(), ...row };
      this.state.teams.set(full.id, full);
      return { ...full };
    });
    this.writes.teams += created.length;
    return created;
  }

  async getGame(id: string): Promise<GameRow | null> {
    const row = this.state.games.get(id);
    return row ? { ...row } : null;
  }

  async listTeams(gameId: string): Promise<TeamRow[]> {
    return [...this.state.teams.values()]
      .filter((t) => t.game_id === gameId)
      .map((t) => ({ ...t }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getTeam(id: string): Promise<TeamRow | null> {
    const row = this.state.teams.get(id);
    return row ? { ...row } : null;
  }

  async updateTeam(id: string, patch: Partial<Omit<TeamRow, 'id' | 'game_id'>>): Promise<TeamRow> {
    const current = this.state.teams.get(id);
    if (!current) throw new Error(`equipo inexistente: ${id}`);
    const next = { ...current, ...patch };
    this.state.teams.set(id, next);
    this.writes.teams += 1;
    return { ...next };
  }

  async updateGame(
    id: string,
    patch: Partial<Pick<GameRow, 'phase' | 'timer_ends_at' | 'crisis_triggered'>>,
  ): Promise<GameRow> {
    const current = this.state.games.get(id);
    if (!current) throw new Error(`partida inexistente: ${id}`);
    const next = { ...current, ...patch };
    this.state.games.set(id, next);
    this.writes.games += 1;
    return { ...next };
  }

  async logDecision(input: DecisionLogInput): Promise<void> {
    this.state.decisions.push({
      id: randomUUID(),
      team_id: input.teamId,
      round: input.round,
      choice: input.choice,
      delta_electricidad: input.effect.electricidad ?? 0,
      delta_gas: input.effect.gas ?? 0,
      delta_presupuesto: input.effect.presupuesto ?? 0,
      delta_eficiencia: input.effect.eficiencia ?? 0,
      created_at: new Date().toISOString(),
    });
    this.writes.decisions += 1;
  }

  async listDecisions(teamId: string): Promise<Array<Pick<DecisionRow, 'round' | 'choice'>>> {
    return this.state.decisions
      .filter((d) => d.team_id === teamId)
      .map((d) => ({ round: d.round, choice: d.choice }));
  }

  /** Solo para tests: inspeccionar el historial completo. */
  allDecisions(): DecisionRow[] {
    return this.state.decisions.map((d) => ({ ...d }));
  }
}
