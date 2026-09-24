# Energía en Crisis — Motor, API y Frontend

Juego web multijugador en tiempo real para una clase de 15 minutos: 4-6 equipos convierten
una instalación derrochadora en una eficiente. Stack: **Next.js + TypeScript + Tailwind**
(frontend), **Cloudflare Worker** (motor + API, única fuente de verdad), **Supabase**
(Postgres + Realtime).

La documentación fundacional del proyecto son `documento-proyecto-energia-en-crisis.md`
(narrativa, modelo de datos, reglas) y `Design.md` (paleta, tipografía, iconografía).
Todo el código respeta esos dos documentos; los comentarios del código citan la sección
de la que sale cada decisión.

---

## Estado por fases

| Fase | Alcance | Estado |
|---|---|---|
| 0 | Cascarón visual (Antigravity) | ✅ compilado |
| 1 | Tipos, esquema Supabase, contenido, motor puro, Worker API, flujo simulado | ✅ verificado |
| 2 | Realtime, decisiones por Worker, timer absoluto, vecindario 3D reactivo | ✅ verificado en navegador |

Verificación real de la Fase 1 y 2: 83 tests (`npm test`), `npm run typecheck`,
`npm run build`, `npm run sim` (partida completa sin UI) y una partida jugada de punta a
punta en el navegador (lobby → investigar → decidir → crisis → decidir_2 → resultados).

---

## Estructura

```
types/game.ts              TeamState, GameState, Appliance + DecisionEffect, DecisionOption, TeamCase (motor)
types/api.ts               Contratos HTTP (estado, decisiones, crisis, fases)
content/                   El juego como DATOS
  economy.ts               Tarifas, límites y regla del +30% de la crisis
  cases.ts                 6 casos de equipo (Familia Duque como plantilla del documento)
  decisions.ts             Ronda 1 por aparato, 6 situaciones de Ronda 2 y la Ronda 2b
  phases.ts                Secuencia y duración de las fases (fuente única también para la UI)
engine/                    Motor puro (sin UI ni red)
  state.ts                 initialTeamState, advancePhase (máquina de fases + timer absoluto)
  decisions.ts             applyDecision, describeEffect (microcopy con números reales)
  crisis.ts                triggerCrisis (+30% sobre el consumo acumulado, idempotente)
  results.ts               calculateFinalResults (eficiencia; desempate por presupuesto)
worker/                    Cloudflare Worker: la única fuente de verdad
  src/index.ts             Router: /game/start, /game/:id/{state,decision,crisis,phase}, /health
  src/game-service.ts      Casos de uso (validación, aplicación, persistencia)
  src/repo.ts              SupabaseRepo (clave de servicio) · src/repo-memory.ts para tests
  wrangler.toml            Config del despliegue (var SUPABASE_URL; secretos aparte)
supabase/migrations/       Esquema exacto del documento + Realtime + RLS
app/                       Vistas (Host y Player) + portal
lib/                       Cliente del Worker, Realtime, timer, formato y estado local
components/                NeighborhoodStage (react-three-fiber), TeamCard, GameHeader…
tests/                     83 tests con `node --test` (sin dependencias extra)
scripts/simulate-game.ts   Partida completa sin UI   ·  scripts/dev-api.ts  API local en memoria
```

---

## Cómo ejecutarlo

### Todo local, sin Supabase (ensayo de clase)

```bash
npm install
npm run dev:api      # API en http://127.0.0.1:8787 (repositorio en memoria)
npm run dev          # frontend en http://localhost:3000
```

Abre `/host`, pulsa **6 equipos** y reparte los enlaces de cada equipo. Sin Supabase no hay
Realtime: el cliente refresca cada 5 s con `GET /game/:id/state`. La partida se pierde al
reiniciar `dev:api`.

### Con Supabase (persistencia + Realtime de verdad)

1. Migración: `supabase/migrations/20260924060000_init_energia_en_crisis.sql` ya está
   aplicada en el proyecto **Juego** (`tbwtphcydwhpeqmdfmlo`). Reaplicarla en otro proyecto:
   pegar el archivo en el SQL Editor o `supabase db push`.
2. Copia `.env.example` a `.env.local` (URL del Worker, URL y clave pública de Supabase,
   `NEXT_PUBLIC_HOST_TOKEN`).
3. Worker: copia `worker/.dev.vars.example` a `worker/.dev.vars` y rellena
   `SUPABASE_SERVICE_ROLE_KEY` (Dashboard → Settings → API). Después:
   ```bash
   cd worker && npx wrangler dev          # API real en http://127.0.0.1:8787
   npx wrangler deploy                    # producción
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   npx wrangler secret put HOST_TOKEN
   ```

### Variables de entorno

| Variable | Dónde | Para qué |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Frontend | URL del Worker |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Frontend | Solo Realtime (valores públicos) |
| `NEXT_PUBLIC_HOST_TOKEN` | Frontend | Token de las acciones de Host (guardia de aula) |
| `SUPABASE_URL` | Worker (`vars`) | Proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker (`secret`) | Escrituras: es el único que escribe |
| `HOST_TOKEN` | Worker (`secret`) | Debe coincidir con `NEXT_PUBLIC_HOST_TOKEN` |

---

## Decisiones de arquitectura

- **El Worker calcula todo.** El cliente envía intenciones y pinta el estado que recibe;
  nunca muta `TeamState` por su cuenta ni calcula consecuencias.
- **Realtime = aviso, no verdad.** El cliente se suscribe a `games` y `teams`
  (Postgres Changes) y ante cualquier evento vuelve a pedir `GET /game/:id/state`. Un evento
  perdido no deja el estado desincronizado, y la reconexión (o volver a la pestaña) también
  dispara un refetch completo. Si Realtime no está disponible, hay sondeo lento de respaldo.
- **Timer absoluto.** `games.timer_ends_at` es la única fuente de tiempo; el tick del cliente
  solo resta contra esa marca, corregida con el desfase medido contra `serverTime`.
- **RLS cerrado a escrituras.** `games`, `teams` y `decisions` son de lectura pública (lo que
  Realtime necesita) y no tienen ninguna política de INSERT/UPDATE/DELETE para la clave
  pública: aunque alguien la copie, no puede tocar la partida.
- **Contenido como datos.** Rebalancear el juego es editar `content/decisions.ts`: cada opción
  declara su consumo neto y sus inversiones, y los efectos se derivan de las tarifas. Un test
  audita esa derivación y otro juega la partida con tres estrategias para exigir que la
  equilibrada gane y que la que menos gasta no sea la que gana.
- **Cero datos inventados** (Design.md): los números en pantalla salen del estado real
  (consumo del aula, gasto acumulado, eficiencia media, carga de línea). El cascarón traía
  latencias, voltajes y porcentajes de ejemplo que se sustituyeron por métricas reales.
- **Sin post-procesamiento en el vecindario.** El bloom se emula con materiales brillantes,
  planos aditivos, luces puntuales por casa y niebla: menos pases de render para el portátil
  que se lleva al aula.

## Correcciones aplicadas al cascarón

- Tildes y ñ corruptas (secuencias U+FFFD) en `app/layout.tsx` y `mock/gameState.ts`,
  más `<meta charSet="utf-8" />` explícito. Un test (`tests/encoding.test.ts`) impide que
  vuelvan a colarse texto roto o mojibake.
- `components/GameHeader.tsx` tenía su propio `setInterval` contando segundos: ahora deriva el
  tiempo de `timerEndsAt`.
- `types/game.ts` tenía un `DecisionOption` de presentación que chocaba con el del motor: se
  renombró a `DecisionCardOption` (mismo shape, cero cambios visuales).
- `components/DemoNav.tsx` inventaba equipos (`/play/alfa`): ahora lista la partida activa real.
- El bloque 3D de la Fase 0 (imagen estática) se reemplazó por `react-three-fiber` con el
  `TeamState` real de cada equipo. **Solo en el Host**: la vista Player sigue sin WebGL.
