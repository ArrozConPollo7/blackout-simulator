# Energía en Crisis — Plan de mejoras (Lógica, Aleatoriedad, Interacción, Visual)

> **Estado:** ✅ **EJECUTADO** (2026-10-15). Las secciones 1 a 4 están implementadas, con sus
> tests y con el barrido de auditoría. Verificación real: **154 tests** (`npm test`),
> `npm run typecheck`, `npm run build` y `npm run sim -- --scan 120` (120 partidas completas,
> ninguna semilla injugable, la semilla reproduce la partida).
> El despliegue (Vercel por push a `main` y `wrangler deploy` del Worker) queda pendiente de
> autorización explícita de JuanD: **no** se ha tocado producción.
>
> **Desviaciones respecto al borrador (y por qué):**
> 1. **Semilla sin columna nueva.** En lugar de `games.seed` (migración + despliegue de esquema),
>    la semilla se deriva del id de la partida y `GAME_SEED` la puede fijar. El Worker es sin
>    estado y todo sorteo se recalcula; el acta muestra la semilla igual.
> 2. **`assignedScenarioIds` no vive en `TeamState`** (que es un espejo de la tabla `teams`):
>    viaja en la respuesta como `assignedScenarios[teamId]`, calculado de (semilla + caso).
>    La clave del sorteo es el CASO, no el id del equipo: el id es un UUID nuevo en cada partida
>    y colgarlo del sorteo rompía el «repetir el guion con `GAME_SEED`» (lo detectó el barrido).
> 3. **Los votos de la crisis y los eventos se registran en `decisions`** (`round = 'crisis_vote'`
>    y `round = 'event'`), que ya existía: el historial es el libro mayor y no hace falta esquema
>    nuevo ni migración.
> 4. **El evento aleatorio es de aula (uno por partida), no uno por equipo**, y el sorteo filtra
>    de antemano los candidatos que dejarían a alguien sin situación jugable (invariante con test).
> 5. **`content/crisis.ts` es nuevo** (no estaba en la tabla de la sección 5): alberga el alza
>    sorteada, la variante acompañante y las 4 medidas colectivas, en vez de meterlas en
>    `economy.ts` (calibración) o `events.ts` (eventos de ronda).
> 6. **El sorteo usa claves derivadas** (`rngFor(semilla, clave)`) además del PRNG secuencial:
>    sin estado que persistir, mismo resultado, y el contrato pasa a ser la clave documentada de
>    cada sitio de sorteo.
> 7. **La ventana de votación no se cierra sola al expirar el cronómetro.** Se cierra cuando vota
>    el último equipo o cuando el Host avanza de fase (ahí decide el recuento parcial). Es la
>    misma convención que el resto del juego: `timerEndsAt` informa y presiona, pero el ritmo de
>    la clase lo lleva el anfitrión, y un GET no debe escribir en la base.
> 8. **El recuento en vivo del proyector se refresca con el estado** (Realtime avisa de juegos y
>    equipos, no de la tabla `decisions`), así que va con la cadencia del cliente (≤5 s). Meter
>    `decisions` en la publicación de Realtime es una migración pequeña que queda anotada como
>    mejora, no como parte de este plan (habría que tocar el esquema de producción).
>
> **Decisión tomada en sesión (15-oct-2026):**
> 1. Lógica: se mantiene el flujo de fases actual (lobby → investigar → decidir → crisis →
>    decidir_2 → resultados); se varía el **contenido** (pools más grandes, sorteo).
> 2. Aleatoriedad: sorteo de escenarios por equipo, eventos aleatorios extra, y momento/
>    intensidad de la crisis variable — todo con semilla reproducible.
> 3. Interacción entre equipos: **votación colectiva** durante el evento de crisis, con una
>    medida ganadora que aplica a todos los equipos por igual.
> 4. Visual: pulido parejo entre el vecindario 3D del Host y la vista Player (móvil).
> 5. Tests: cada cambio lista qué suites tocar y qué suites nuevas crear.

---

## 0. Diagnóstico (por qué "se siente básico" hoy)

Basado en la lectura de `documento-proyecto-energia-en-crisis.md`, `README.md`,
`content/*.ts`, `engine/*.ts`, `types/game.ts` y `tests/*.ts`:

| Eje | Estado actual | Problema |
|---|---|---|
| Lógica | 3 opciones fijas por escenario (completa/parcial/ninguna), mismo texto siempre | Cero variación entre partidas: a la segunda vez que alguien juega, ya sabe el guion completo |
| Aleatoriedad | Prácticamente nula: casos se asignan en orden fijo del catálogo (`casesForTeamCount`), escenarios de Ronda 2 son siempre los mismos 6, la crisis es siempre +30% al minuto 9 | No hay ningún `Math.random()` con semilla ni variación reproducible en el motor |
| Interacción entre equipos | Ninguna: cada equipo juega su propia casa en paralelo (`GameState.teams[]`), sin ver estado del resto hasta el podio | La "competencia" es solo una tabla final; no hay momento de negociación o decisión conjunta como pide el usuario |
| Visual | Ya hay vecindario 3D reactivo (`react-three-fiber`, Host-only), sonido sintetizado, feedback inmediato en Player | Correcto pero puede profundizarse: la crisis hoy es un evento silencioso en el estado, sin un momento de tensión compartida en pantalla |

---

## 1. Lógica del juego: pools de contenido más grandes

### 1.1 Más escenarios de Ronda 2 (pool ampliado + sorteo de subconjunto)

**Hoy:** `ROUND2_SCENARIOS` en `content/decisions.ts` tiene 6 escenarios fijos
(`calor`, `cocina`, `nevera`, `entretenimiento`, `lavado`, `alumbrado`). `scenariosForCase`
filtra por los aparatos que tiene el caso, pero **todo caso juega siempre los mismos
escenarios en el mismo orden** si tiene los aparatos.

**Propuesta:**
- Ampliar el pool a ~12-14 escenarios (duplicar variantes: ej. "Calor" con dos sabores
  distintos según la época del año — "Ola de calor" vs. "Tarde soleada normal" —, "Cocina"
  con variante de electrodoméstico distinto, nuevo escenario para combinaciones de aparatos
  no cubiertas hoy).
- Cada equipo, al entrar a la fase `decidir`, recibe un **subconjunto sorteado** (3-4 de los
  N escenarios jugables según sus aparatos), en **orden sorteado**, en vez de "todos los
  jugables en orden fijo".
- Mantener `pesoEficienciaR2` (reparto de peso de eficiencia) pero recalculado sobre el
  número de escenarios efectivamente sorteados, no sobre el total jugable.

**Archivos a tocar:**
- `content/decisions.ts`: nuevo catálogo ampliado + función `drawRound2Scenarios(rng, caseId, count)`.
- `engine/state.ts` o nuevo `engine/draw.ts`: función de sorteo determinista (ver sección 2.1 para el PRNG).
- `types/game.ts`: el `TeamState` necesita guardar qué escenarios le tocaron (`assignedScenarioIds: string[]`) para que el Worker valide que el equipo solo responde a LOS SUYOS, no a cualquier escenario del pool global.

### 1.2 Más de 3 opciones por escenario (donde tenga sentido pedagógico)

**Propuesta:** en vez de forzar siempre 3 opciones (completa/parcial/ninguna), permitir
escenarios con 4 opciones (añadir un matiz intermedio, ej. "parcial con inversión barata").
No es obligatorio en todos — algunos escenarios se benefician de la simplicidad de 3 — pero
el tipo `DecisionScenario.options` ya es un array, así que no hay cambio de tipo, solo de
contenido. Donde se agregue una 4ª opción, revisar `makeEffect`/`build` en `content/decisions.ts`
para que siga derivando todo de `economy.ts` (no inventar números sueltos).

**Archivos a tocar:** `content/decisions.ts` (contenido), ningún cambio de tipos.

### 1.3 Eventos aleatorios extra (más allá de la crisis fija)

Ver sección 2.2 (es la misma mecánica vista desde el ángulo de aleatoriedad).

---

## 2. Aleatoriedad: todo con semilla reproducible

Tomamos como referencia el patrón ya probado en `blackout-simulator/src/shared/rules.js`
(PRNG `mulberry32`, semilla en `room.rngState`, reproducible y auditable). Se porta la misma
idea a este proyecto.

### 2.1 PRNG determinista por partida

**Nuevo módulo:** `engine/rng.ts`
```ts
export function createRng(seed: number): () => number { /* mulberry32, igual que blackout-simulator */ }
```
- `GameState` gana un campo `seed: number` (se genera al crear la partida, o se fija con
  variable de entorno `GAME_SEED` para repetir un guion en clase, igual que en el otro proyecto).
- Todo sorteo de la partida (escenarios, eventos, momento/intensidad de la crisis) consume
  este único PRNG, en un orden de llamadas documentado (mismo criterio que
  `blackout-simulator`: "el orden de llamadas es parte del contrato").
- El acta final (fase `resultados`) debe mostrar la semilla, para poder auditar/repetir la
  partida igual que hace `blackout-simulator` en su `finalResults`.

### 2.2 Catálogo de eventos aleatorios extra (independientes de la crisis central)

**Propuesta:** un nuevo catálogo `content/events.ts` con eventos cortos que se disparan en
momentos no fijos durante `investigar` o `decidir` (no solo la crisis central):
- **Apagón parcial:** un aparato aleatorio queda "bloqueado" temporalmente (no se puede
  intervenir esa ronda) — inspirado directamente en la familia `lock` de `blackout-simulator`.
- **Subsidio sorpresa:** +$ presupuesto a todos los equipos (alivio, para que no todo sea
  castigo).
- **Falla de aparato:** un aparato del caso sube su consumo de referencia temporalmente
  (ej. nevera con fuga de gas, sube 20% su consumo hasta que el equipo decide sobre ella).

Reglas de sorteo (análogas a `INCIDENT_COUNT_BY_ROUND` / `INCIDENT_MAX_SEVERITY` del otro
proyecto):
- 0 eventos en `investigar` (fase tutorial, como la ronda 1 de blackout-simulator).
- 1 evento en `decidir`.
- Eventos nunca se repiten en la misma partida.
- Invariante de balance: ningún evento puede dejar a un equipo sin ninguna opción viable
  (test dedicado, ver sección 6).

**Archivos nuevos:** `content/events.ts`, `engine/events.ts` (aplicación de efectos).
**Archivos a tocar:** `engine/state.ts` (disparo de eventos al transicionar de fase),
`types/game.ts` (`GameState.activeEvents: GameEvent[]`), `worker/src/game-service.ts`
(persistir y transmitir eventos activos).

### 2.3 Momento e intensidad de la crisis variable

**Hoy:** `engine/crisis.ts` aplica siempre +30% sobre el consumo acumulado, disparada
manualmente por el Host "en el minuto indicado" (fijo en el documento: minuto ~9).

**Propuesta:**
- La **intensidad** del aumento de tarifa se sortea dentro de un rango (ej. 20%-45%) al
  iniciar la partida (con la semilla), en vez de ser siempre 30%. Se mantiene visible en
  pantalla apenas se dispara (no es un secreto, solo deja de ser siempre el mismo número).
- El **momento** sigue siendo gatillado manualmente por el Host (es una decisión pedagógica
  de ritmo de clase, no tiene sentido randomizarla — igual que `blackout-simulator` deja el
  ritmo de ronda en manos del anfitrión). Lo que se sortea es la intensidad y, opcionalmente,
  un segundo efecto acompañante (ej. "la crisis también sube el gas 15%", sorteado de un
  pool corto de variantes de crisis).

**Archivos a tocar:** `engine/crisis.ts` (parámetro de intensidad en vez de constante),
`content/economy.ts` (rango válido), `types/api.ts` (el endpoint de crisis ya no necesita
parámetro porque el servidor decide la intensidad con su RNG, no el cliente).

---

## 3. Interacción entre equipos: votación colectiva en la crisis

Esta es la pieza central para la "discusión entre equipos" que pediste. Diseño:

### 3.1 Mecánica

Al disparar la crisis, en vez de aplicar directamente el +X% a todos, el juego entra en una
**sub-fase de votación** (nueva fase `crisis_votacion`, insertada entre `crisis` y
`decidir_2` en `PHASE_PLAN`):

1. El Host anuncia la crisis y presenta **2-3 medidas colectivas** (sorteadas del pool de
   variantes de crisis, sección 2.3) con sus efectos y trade-offs explicados en pantalla
   (ej. "A. Racionamiento parejo: -15% consumo a todos, -$0 extra" / "B. Tarifa de
   emergencia: tarifa +40% pero sin racionamiento" / "C. Fondo de ayuda mutua: los equipos
   con más presupuesto subsidian a los que tienen menos").
2. Cada equipo vota **una sola vez** desde su móvil (`/play/[teamId]`), con una ventana de
   tiempo corta (30-45s) — es intencional que sea corta para forzar la discusión verbal en
   el aula antes de tocar el botón, igual que la negociación de 60s de `blackout-simulator`.
3. El Host muestra en vivo cuántos equipos ya votaron y por cuál opción (sin revelar el
   resultado ganador hasta que cierra la ventana), para generar presión social y debate.
4. Al cerrar la ventana (o si todos votaron antes), el Worker calcula la opción ganadora
   (mayoría simple; empate → la medida más severa gana, con mensaje explícito de "el aula no
   se puso de acuerdo") y aplica su efecto a **todos los equipos por igual**, entrando
   después a `decidir_2` con ese efecto ya vigente.

### 3.2 Por qué esta mecánica y no otras

Se descartaron (por decisión del usuario) el mercado de presupuesto entre equipos y la red
eléctrica compartida — quedan anotadas aquí como **extensiones futuras posibles** si se
quiere profundizar más adelante, pero no entran en este plan.

### 3.3 Modelo de datos

**Nuevo tipo en `types/game.ts`:**
```ts
export interface CrisisMeasure {
  id: string;
  label: string;
  description: string;
  effect: DecisionEffect; // aplicado a TODOS los equipos si gana
}

export interface CrisisVote {
  teamId: string;
  measureId: string;
  votedAt: string;
}

// Se añade a GameState:
crisisMeasures: CrisisMeasure[];   // las 2-3 opciones sorteadas para esta partida
crisisVotes: CrisisVote[];        // votos recibidos hasta el momento
crisisResolvedMeasureId: string | null; // null hasta que se resuelve la votación
```

**Nuevo endpoint HTTP** (`worker/src/index.ts`, junto a `/game/:id/decision`):
`POST /game/:id/crisis-vote` — body `{ teamId, measureId }`. Reglas de validación
(`worker/src/game-service.ts`):
- Solo válido en fase `crisis_votacion`.
- Un equipo no puede votar dos veces (igual que las decisiones normales, reusar el patrón
  de `scenarioKeyOfOption` para "ya respondido").
- Al recibir el último voto posible (todos los equipos) o al expirar `timerEndsAt`, el
  Worker resuelve automáticamente (mismo patrón de timer absoluto que ya usa el proyecto).

**Nueva función del motor:** `engine/crisis-vote.ts` con `resolveCrisisVote(state, rng)` que
decide ganador y aplica el efecto a cada `TeamState`.

### 3.4 Frontend

- **Host** (`app/host/page.tsx` + nuevo componente `components/host/CrisisVotePanel.tsx`):
  tablero con las medidas, conteo de votos en vivo, cuenta regresiva, anuncio del resultado
  con un momento de "revelado" (animación/sonido, coherente con `PodiumBurst.tsx` ya
  existente para el podio final).
- **Player** (`app/play/[teamId]/page.tsx` + nuevo `components/play/CrisisVoteCard.tsx`):
  pantalla de votación con las medidas explicadas en lenguaje de jugador (no jerga técnica,
  respetando la convención ya establecida del proyecto), botón grande por opción, estado
  "ya votaste, esperando al resto".

---

## 4. Visual: pulido parejo Host (3D) + Player (móvil)

### 4.1 Vecindario 3D (Host) — `components/neighborhood/*`

- **Reacción a la votación de crisis:** mientras la sub-fase `crisis_votacion` está activa,
  el ambiente del vecindario entra en un estado de "tensión" distinto al "crisis ya resuelta"
  actual (hoy el documento solo describe "tono rojo-anaranjado con parpadeo" para la crisis
  ya aplicada). Propuesta: parpadeo de postes de luz más errático mientras se vota, y un
  efecto de "resolución" claro (ola de luz o apagón breve sincronizado) en el momento en que
  se anuncia la medida ganadora.
- **Partículas de crisis más dramáticas:** intensificar humo/chispa en las casas con peor
  eficiencia durante la crisis (ya existe la reacción de "aura verde→ámbar→rojo"; se añade
  densidad de partícula proporcional al mismo valor, no un sistema nuevo).
- Mantener la regla ya establecida en el proyecto: **sin post-procesamiento**, todo con
  materiales emisivos y luces puntuales (coherente con la nota de rendimiento del README).

### 4.2 Vista Player (móvil) — `components/play/*`

- **CrisisVoteCard** (nuevo, sección 3.4): feedback táctil inmediato al tocar una opción
  (reusar el patrón de "5 estados del toque" que ya describe el README en `ChoiceButton.tsx`).
- **Feedback de eventos aleatorios** (sección 2.2): cuando un evento afecta al equipo
  (apagón parcial, falla de aparato), mostrar un chip/alerta inline reusando
  `EffectChips.tsx`, con el mismo lenguaje no-técnico ya exigido por el proyecto.
- Vibración háptica (`play/haptics.ts`, ya existe) extendida al momento de votar y al
  revelado del resultado de la votación.

---

## 5. Resumen de archivos nuevos y modificados

| Archivo | Tipo | Qué cambia |
|---|---|---|
| `engine/rng.ts` | nuevo | PRNG determinista (mulberry32), semilla de partida |
| `engine/events.ts` | nuevo | catálogo y aplicación de eventos aleatorios extra |
| `engine/crisis-vote.ts` | nuevo | resolución de la votación colectiva |
| `content/events.ts` | nuevo | catálogo de eventos (apagón parcial, subsidio, falla de aparato) |
| `content/decisions.ts` | modificado | pool ampliado de escenarios R2, función de sorteo, posible 4ª opción |
| `content/economy.ts` | modificado | rango de intensidad de crisis (en vez de constante +30%) |
| `content/phases.ts` | modificado | nueva fase `crisis_votacion` en `PHASE_PLAN` |
| `engine/crisis.ts` | modificado | intensidad variable en vez de fija |
| `engine/state.ts` | modificado | disparo de eventos y transición a `crisis_votacion` |
| `types/game.ts` | modificado | `seed`, `assignedScenarioIds`, `activeEvents`, `CrisisMeasure`, `CrisisVote`, nueva fase en `Phase` |
| `types/api.ts` | modificado | contrato de `POST /game/:id/crisis-vote` |
| `worker/src/index.ts` | modificado | nueva ruta `crisis-vote` |
| `worker/src/game-service.ts` | modificado | validación y resolución de voto, aplicación de eventos |
| `components/host/CrisisVotePanel.tsx` | nuevo | panel de votación en vivo (Host) |
| `components/play/CrisisVoteCard.tsx` | nuevo | tarjeta de votación (Player) |
| `components/neighborhood/*` | modificado | parpadeo de tensión, partículas de crisis, revelado de resultado |
| `components/play/EffectChips.tsx` | modificado | soporte para chips de eventos aleatorios |
| `app/host/page.tsx`, `app/play/[teamId]/page.tsx` | modificado | integrar nuevos paneles/fases |

---

## 6. Impacto en tests (93 actuales + nuevos)

| Suite existente | Qué revisar/actualizar |
|---|---|
| `tests/engine.test.ts` | Casos que asumen los 6 escenarios fijos de R2 deben parametrizarse sobre el pool ampliado; añadir casos para `assignedScenarioIds` |
| `tests/balance.test.ts` | Las 3 estrategias de prueba (la que gana, la que menos gasta, etc.) deben seguir cumpliéndose con cualquier subconjunto sorteado de escenarios y con intensidad de crisis variable — esto requiere ampliar el test a un barrido (estilo `--scan 300` de `blackout-simulator`) en vez de un solo camino fijo |
| `tests/content.test.ts` | Validar que el catálogo ampliado de escenarios y el nuevo catálogo de eventos derivan correctamente de `economy.ts` (ningún número suelto) |
| `tests/encoding.test.ts` | Sin cambios de alcance, pero correr igual sobre los nuevos textos (medidas de crisis, eventos) para que no se cuelen tildes rotas |
| `tests/worker-api.test.ts` | Nuevo endpoint `crisis-vote`: casos de voto válido, voto duplicado, voto fuera de fase, resolución por mayoría, resolución por empate, resolución por timeout |

**Suites nuevas a crear:**

| Suite nueva | Qué cubre |
|---|---|
| `tests/rng.test.ts` | El PRNG es determinista por semilla (misma semilla → misma secuencia); dos semillas distintas dan secuencias distintas |
| `tests/events.test.ts` | Sorteo de eventos nunca repite dentro de una partida; invariante "ningún evento deja al equipo sin opción viable" (análogo al invariante de `blackout-simulator`, recorriendo combinaciones de caso × evento) |
| `tests/crisis-vote.test.ts` | Resolución de empates, aplicación del efecto ganador a todos los equipos por igual, rechazo de doble voto, resolución automática al expirar el timer |
| `tests/e2e-crisis-vote.test.ts` (o ampliar `scripts/simulate-game.ts`) | Partida completa simulada que pasa por `crisis_votacion` con 4-6 equipos votando distinto, verificando que el resultado del podio sigue siendo coherente con el documento (eficiencia decide, consumo/economía pesan hasta 20%) |

**Meta de cobertura:** mantener la filosofía ya establecida en el proyecto (balance
verificado por fuerza bruta, no solo por un camino feliz) — replicar el patrón de
`node scripts/reference-game.js --scan 300` de `blackout-simulator` como un nuevo
`npm run sim -- --scan N` en este proyecto, para auditar que ninguna semilla deja una
partida injugable o un equipo sin salida.

---

## 7. Orden sugerido de implementación (cuando se autorice)

1. **Base de aleatoriedad** (sección 2.1): `engine/rng.ts` + semilla en `GameState`. Sin esto, nada más es reproducible.
2. **Pool ampliado + sorteo de escenarios** (sección 1.1): cambio más contenido, bajo riesgo, no toca el protocolo HTTP.
3. **Eventos aleatorios extra** (sección 2.2): nuevo catálogo + aplicación, aislado del resto.
4. **Intensidad de crisis variable** (sección 2.3): cambio pequeño sobre `engine/crisis.ts`.
5. **Votación colectiva** (sección 3): el cambio más grande — nueva fase, nuevo endpoint, nuevos componentes de Host y Player. Se hace al final porque depende de que el resto del motor (RNG, eventos) ya esté estable.
6. **Visual** (sección 4): se hace en paralelo a los pasos 2-5 según van quedando listos los datos que cada efecto visual necesita mostrar.
7. **Tests**: cada paso anterior se entrega con sus tests (TDD, no al final); el barrido tipo `--scan N` se agrega al cerrar el paso 5, cuando ya hay suficiente superficie para auditar.

---

## 8. Qué NO entra en este plan (alcance descartado, explícito)

- Mercado/comercio de presupuesto entre equipos en tiempo real (descartado a favor de la votación colectiva).
- Red eléctrica compartida tipo `blackout-simulator` (techo regional único) — la base del juego sigue siendo "cada equipo gestiona su propia casa", solo se añade el momento de decisión conjunta de la crisis.
- Cambios de stack (Supabase, Cloudflare Worker, Next.js, Three.js) — ninguno de los cambios de este plan requiere tocar la arquitectura de infraestructura ya decidida en `documento-proyecto-energia-en-crisis.md`.

---

## 9. Cómo quedó implementado (2026-10-15)

| Archivo | Qué entró |
|---|---|
| `engine/rng.ts` | **nuevo** — mulberry32, `hashSeed`, `rngFor(semilla, clave)`, `intBetween/pick/sample/shuffled/chance`, `seedForGame` |
| `engine/draw.ts` | **nuevo** — sorteo de las 3-4 situaciones de Ronda 2 (clave: semilla + caso), peso por equipo, `teamPlaysScenario` |
| `engine/events.ts` | **nuevo** — candidatos, filtro del invariante de jugabilidad, sorteo por ronda y aplicación (subsidio, falla, bloqueo) |
| `engine/crisis-vote.ts` | **nuevo** — recuento (mayoría, empate → la más severa), aplicación de la medida a todos y reparto solidario |
| `engine/crisis.ts` | alza de tarifa sorteada por partida + variante acompañante (el gas también sube, o no) |
| `engine/state.ts` | `initialGameState` con semilla, alza, medidas y eventos |
| `content/decisions.ts` | pool de Ronda 2 de 6 → **14** situaciones; 4ª opción (inversión barata) en dos de ellas; `pesoEficienciaR2(n)` sobre lo sorteado; `scenarioKeyOfOption` ya no confunde eventos/votos con situaciones |
| `content/crisis.ts` | **nuevo** — rango 20-45%, variante, y las 4 medidas colectivas con su severidad |
| `content/events.ts` | **nuevo** — subsidio ($8.000), apagón parcial y falla de aparato (20% de la referencia), con textos de aula |
| `content/economy.ts` | constantes nuevas: rango de crisis, techo de eficiencia de la Ronda 2, subsidio y recargo de falla |
| `content/phases.ts` | fase `crisis_votacion` (45 s) entre `crisis` y `decidir_2` |
| `types/game.ts` | `seed`, `crisisRate`, `crisisVariant`, `activeEvents`, `crisisMeasures`, `crisisVotes`, `crisisResolvedMeasureId`, `CrisisMeasure`, `CrisisVote`, `CrisisOutcome`, `GameEventInstance` |
| `types/api.ts` | esos campos en `GameStateResponse` + `assignedScenarios` + `POST /game/:id/crisis-vote` |
| `worker/src/{index,game-service}.ts` | ruta `crisis-vote`, `GAME_SEED`, liquidación del subsidio, validación del sorteo y del aparato bloqueado, resolución y registro de la votación |
| `components/play/CrisisVoteCard.tsx` | **nuevo** — papeleta del móvil con sus estados de toque y el revelado |
| `components/host/CrisisVotePanel.tsx` | **nuevo** — tablero del proyector (medidas, votos en vivo, cuenta atrás, revelado) |
| `components/play/EffectChips.tsx` | `EventAlert`: chip inline de los eventos aleatorios |
| `components/play/haptics.ts` | háptica del voto y del revelado |
| `components/NeighborhoodStage.tsx`, `neighborhood/{StreetScene,HouseModel}.tsx` | tensión (0-1) en vez de «crisis sí/no»: parpadeo, farolas y densidad de humo proporcionales; ola de luz al revelarse la medida |
| `app/play/[teamId]/page.tsx`, `app/host/page.tsx`, `lib/{api,ui}.ts` | integración: papeleta y tablero, tarifa real en pantalla, eventos, `crisis_votacion` cuenta como crisis en el proyector |
| `scripts/simulate-game.ts` | la partida simulada juega el sorteo y la votación; **`--scan N`** audita N semillas |

**Suites nuevas de tests:** `tests/rng.test.ts`, `tests/draw.test.ts`, `tests/events.test.ts`,
`tests/crisis-vote.test.ts`. **Suites ampliadas:** `tests/engine.test.ts` (crisis con la semilla),
`tests/content.test.ts` (pool, medidas, eventos, peso sobre lo sorteado), `tests/balance.test.ts`
(barrido de 120 semillas + las 4 medidas), `tests/worker-api.test.ts` (sorteo, bloqueo, votación,
flujo completo con la sub-fase).

**Pendiente de despliegue (requiere autorización):** push a `main` (Vercel) y
`cd worker && npx wrangler deploy`. No hay migración de Supabase que aplicar: el esquema no
cambió.
