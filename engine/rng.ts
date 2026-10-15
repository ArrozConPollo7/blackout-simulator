/**
 * Aleatoriedad determinista de la partida (plan, seccion 2.1).
 *
 * Patron portado de `blackout-simulator` (`mulberry32`): un PRNG de 32 bits, rapido y
 * reproducible. Misma semilla -> misma secuencia, siempre, en el Worker y en los tests.
 *
 * DOS FORMAS DE USARLO, a proposito:
 *
 *  - `createRng(seed)` devuelve la secuencia cruda. Sirve cuando un unico consumidor juega
 *    la partida de principio a fin (tests, simulador).
 *  - `rngFor(seed, ...clave)` devuelve una secuencia DERIVADA de una clave. El Worker es
 *    sin estado: lee el estado de Postgres en cada peticion, asi que no puede llevar un
 *    contador de llamadas en memoria. Derivando la secuencia de la clave (semilla de la
 *    partida + sitio de sorteo + identidad afectada), el sorteo es reproducible sin guardar
 *    nada: la MISMA partida con LA MISMA semilla vuelve a repartir lo mismo.
 *
 * El contrato es la semilla y el nombre de la clave, no el orden de llamadas: cada sitio de
 * sorteo documenta su clave (ver `content/decisions.ts`, `content/events.ts`,
 * `content/crisis.ts`) para que nadie reutilice una y cambie un guion ya auditado.
 */

/** Secuencia pseudoaleatoria en [0, 1). */
export type Rng = () => number;

/** mulberry32: 32 bits de estado, calidad de sobra para repartir contenido de aula. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a de 32 bits: mezcla cadenas y numeros en una semilla estable. */
export function hashSeed(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    // Separador explicito: ("a","bc") y ("ab","c") no pueden chocar.
    h ^= 0x1f;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Secuencia derivada de la semilla de la partida y de la clave del sitio de sorteo. */
export function rngFor(seed: number, ...key: Array<string | number>): Rng {
  return createRng(hashSeed(seed, ...key));
}

/** Semilla de una partida: la fija `GAME_SEED` o, si no, el id de la partida. */
export function seedForGame(gameId: string, fixedSeed?: number | null): number {
  if (typeof fixedSeed === 'number' && Number.isFinite(fixedSeed)) return fixedSeed >>> 0;
  return hashSeed(gameId);
}

/** Entero en [min, max], ambos incluidos. */
export function intBetween(rng: Rng, min: number, max: number): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  if (hi <= lo) return lo;
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Elemento al azar de una lista (la lista debe tener al menos un elemento). */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() sobre una lista vacia');
  return items[Math.floor(rng() * items.length)] as T;
}

/** Copia mezclada (Fisher-Yates) sin mutar la entrada. */
export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Hasta `count` elementos distintos, manteniendo el orden mezclado. */
export function sample<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const n = Math.max(0, Math.min(Math.trunc(count), items.length));
  return shuffled(rng, items).slice(0, n);
}

/** Moneda al aire con probabilidad `p` (por defecto 0,5). */
export function chance(rng: Rng, p = 0.5): boolean {
  return rng() < p;
}
