-- Energia en Crisis — esquema inicial (Fase 1.2)
-- Tablas exactas del documento del proyecto + Realtime + permisos.
--
-- Politica de acceso:
--   * El Worker escribe con la clave de servicio (salta RLS).
--   * El navegador usa la clave publica y SOLO puede leer games/teams/decisions:
--     eso es lo que necesita para las suscripciones Postgres Changes de Realtime.
--     No existe ninguna politica de INSERT/UPDATE/DELETE para anon.

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  phase text not null default 'lobby',
  timer_ends_at timestamptz,
  crisis_triggered boolean default false
);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id),
  name text not null,
  case_id text not null,
  color text not null,
  electricidad numeric default 100,
  gas numeric default 100,
  presupuesto numeric default 100000,
  eficiencia numeric default 50,
  puntos numeric default 0
);

create table if not exists decisions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id),
  round text not null,
  choice text not null,
  delta_electricidad numeric,
  delta_gas numeric,
  delta_presupuesto numeric,
  delta_eficiencia numeric,
  created_at timestamptz default now()
);

-- Indices: el Worker consulta equipos por partida y decisiones por equipo.
create index if not exists teams_game_id_idx on teams (game_id);
create index if not exists decisions_team_id_idx on decisions (team_id);

-- Realtime por Postgres Changes sobre games y teams.
-- El cliente solo usa el evento como aviso de "algo cambio": siempre vuelve a pedir
-- GET /game/:id/state, asi que un evento perdido no deja el estado desincronizado.
alter table games replica identity full;
alter table teams replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'games'
  ) then
    execute 'alter publication supabase_realtime add table public.games';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'teams'
  ) then
    execute 'alter publication supabase_realtime add table public.teams';
  end if;
end $$;

-- RLS: lectura publica, escritura solo desde el Worker (clave de servicio).
alter table games enable row level security;
alter table teams enable row level security;
alter table decisions enable row level security;

drop policy if exists "games_public_read" on games;
create policy "games_public_read" on games for select to anon, authenticated using (true);

drop policy if exists "teams_public_read" on teams;
create policy "teams_public_read" on teams for select to anon, authenticated using (true);

drop policy if exists "decisions_public_read" on decisions;
create policy "decisions_public_read" on decisions for select to anon, authenticated using (true);
