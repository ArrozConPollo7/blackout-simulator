/**
 * Acceso a datos. El Worker es el unico escritor: usa la clave de servicio,
 * que salta RLS. El navegador solo tiene la clave publica con permiso de SELECT
 * (necesario para las suscripciones Postgres Changes de Realtime).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { DecisionEffect, Phase } from '../../types/game.ts';
import type { WorkerConfig } from './env.ts';

export interface GameRow {
  id: string;
  phase: Phase;
  timer_ends_at: string | null;
  crisis_triggered: boolean;
}

export interface TeamRow {
  id: string;
  game_id: string;
  name: string;
  case_id: string;
  color: string;
  electricidad: number;
  gas: number;
  presupuesto: number;
  eficiencia: number;
  puntos: number;
}

export interface DecisionRow {
  id: string;
  team_id: string;
  round: string;
  choice: string;
  delta_electricidad: number | null;
  delta_gas: number | null;
  delta_presupuesto: number | null;
  delta_eficiencia: number | null;
  created_at: string;
}

export interface DecisionLogInput {
  teamId: string;
  round: string;
  choice: string;
  effect: DecisionEffect;
}

export interface GameRepo {
  createGame(input: { phase: Phase; timerEndsAt: string; crisisTriggered: boolean }): Promise<GameRow>;
  createTeams(rows: Array<Omit<TeamRow, 'id'>>): Promise<TeamRow[]>;
  getGame(id: string): Promise<GameRow | null>;
  listTeams(gameId: string): Promise<TeamRow[]>;
  getTeam(id: string): Promise<TeamRow | null>;
  updateTeam(id: string, patch: Partial<Omit<TeamRow, 'id' | 'game_id'>>): Promise<TeamRow>;
  updateGame(
    id: string,
    patch: Partial<Pick<GameRow, 'phase' | 'timer_ends_at' | 'crisis_triggered'>>,
  ): Promise<GameRow>;
  logDecision(input: DecisionLogInput): Promise<void>;
  listDecisions(teamId: string): Promise<Array<Pick<DecisionRow, 'round' | 'choice'>>>;
}

export class RepoError extends Error {
  readonly cause_: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'RepoError';
    this.cause_ = cause;
  }
}

/**
 * Cliente sin esquema generado: las filas se tipan con las interfaces de este archivo
 * (GameRow/TeamRow/DecisionRow), que son el contrato real con Postgres.
 */
type AnySupabaseClient = SupabaseClient<any>;

/** Implementacion contra Supabase (Postgres + Realtime). */
export class SupabaseRepo implements GameRepo {
  private readonly client: AnySupabaseClient;

  constructor(config: Pick<WorkerConfig, 'supabaseUrl' | 'supabaseKey'>) {
    this.client = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as AnySupabaseClient;
  }

  private unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
    if (result.error) throw new RepoError(result.error.message, result.error);
    if (result.data === null || result.data === undefined) throw new RepoError('Supabase devolvio vacio');
    return result.data;
  }

  async createGame(input: { phase: Phase; timerEndsAt: string; crisisTriggered: boolean }): Promise<GameRow> {
    const data = this.unwrap<GameRow>(
      await this.client
        .from('games')
        .insert({
          phase: input.phase,
          timer_ends_at: input.timerEndsAt,
          crisis_triggered: input.crisisTriggered,
        })
        .select('*')
        .single(),
    );
    return data as GameRow;
  }

  async createTeams(rows: Array<Omit<TeamRow, 'id'>>): Promise<TeamRow[]> {
    if (rows.length === 0) return [];
    const data = this.unwrap<TeamRow[]>(await this.client.from('teams').insert(rows).select('*'));
    return data as TeamRow[];
  }

  async getGame(id: string): Promise<GameRow | null> {
    const { data, error } = await this.client.from('games').select('*').eq('id', id).maybeSingle();
    if (error) throw new RepoError(error.message, error);
    return (data as GameRow | null) ?? null;
  }

  async listTeams(gameId: string): Promise<TeamRow[]> {
    const { data, error } = await this.client
      .from('teams')
      .select('*')
      .eq('game_id', gameId)
      .order('name', { ascending: true });
    if (error) throw new RepoError(error.message, error);
    return (data as TeamRow[]) ?? [];
  }

  async getTeam(id: string): Promise<TeamRow | null> {
    const { data, error } = await this.client.from('teams').select('*').eq('id', id).maybeSingle();
    if (error) throw new RepoError(error.message, error);
    return (data as TeamRow | null) ?? null;
  }

  async updateTeam(id: string, patch: Partial<Omit<TeamRow, 'id' | 'game_id'>>): Promise<TeamRow> {
    const data = this.unwrap<TeamRow>(
      await this.client.from('teams').update(patch).eq('id', id).select('*').single(),
    );
    return data as TeamRow;
  }

  async updateGame(
    id: string,
    patch: Partial<Pick<GameRow, 'phase' | 'timer_ends_at' | 'crisis_triggered'>>,
  ): Promise<GameRow> {
    const data = this.unwrap<GameRow>(
      await this.client.from('games').update(patch).eq('id', id).select('*').single(),
    );
    return data as GameRow;
  }

  async logDecision(input: DecisionLogInput): Promise<void> {
    const { error } = await this.client.from('decisions').insert({
      team_id: input.teamId,
      round: input.round,
      choice: input.choice,
      delta_electricidad: input.effect.electricidad ?? 0,
      delta_gas: input.effect.gas ?? 0,
      delta_presupuesto: input.effect.presupuesto ?? 0,
      delta_eficiencia: input.effect.eficiencia ?? 0,
    });
    if (error) throw new RepoError(error.message, error);
  }

  async listDecisions(teamId: string): Promise<Array<Pick<DecisionRow, 'round' | 'choice'>>> {
    const { data, error } = await this.client
      .from('decisions')
      .select('round, choice')
      .eq('team_id', teamId);
    if (error) throw new RepoError(error.message, error);
    return (data as Array<Pick<DecisionRow, 'round' | 'choice'>>) ?? [];
  }
}
