/**
 * Plan 2.1: el PRNG de la partida.
 *
 * Lo que se exige aqui es lo que hace auditable una partida de aula: la misma semilla
 * reproduce la misma secuencia (y por tanto el mismo guion), semillas distintas dan guiones
 * distintos, y las claves de sorteo no se pisan entre si (si dos sitios compartieran clave,
 * cambiar el sorteo de uno moveria el otro sin que nadie lo pidiera).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  chance,
  createRng,
  hashSeed,
  intBetween,
  pick,
  rngFor,
  sample,
  seedForGame,
  shuffled,
} from '../engine/rng.ts';

describe('PRNG determinista (mulberry32)', () => {
  it('la misma semilla da la misma secuencia', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const secuenciaA = Array.from({ length: 8 }, () => a());
    const secuenciaB = Array.from({ length: 8 }, () => b());
    assert.deepEqual(secuenciaA, secuenciaB);
  });

  it('semillas distintas dan secuencias distintas', () => {
    const a = Array.from({ length: 8 }, createRng(1));
    const b = Array.from({ length: 8 }, createRng(2));
    assert.notDeepEqual(a, b);
    assert.equal(new Set(a.map((v) => v.toFixed(10))).size, a.length, 'sin repeticiones en 8 tiradas');
  });

  it('devuelve siempre numeros en [0, 1)', () => {
    const rng = createRng(2026);
    for (let i = 0; i < 500; i += 1) {
      const v = rng();
      assert.ok(v >= 0 && v < 1, `fuera de rango: ${v}`);
    }
  });

  it('la secuencia derivada de una clave es reproducible y distinta por clave', () => {
    const same = [Array.from({ length: 5 }, rngFor(7, 'escenarios', 'equipo-a')), Array.from({ length: 5 }, rngFor(7, 'escenarios', 'equipo-a'))];
    assert.deepEqual(same[0], same[1]);

    const otraClave = Array.from({ length: 5 }, rngFor(7, 'evento', 'decidir'));
    const otroEquipo = Array.from({ length: 5 }, rngFor(7, 'escenarios', 'equipo-b'));
    const otraSemilla = Array.from({ length: 5 }, rngFor(8, 'escenarios', 'equipo-a'));
    assert.notDeepEqual(same[0], otraClave, 'claves distintas no pueden compartir secuencia');
    assert.notDeepEqual(same[0], otroEquipo);
    assert.notDeepEqual(same[0], otraSemilla);
  });

  it('hashSeed separa las partes (no confunde "a"+"bc" con "ab"+"c")', () => {
    assert.notEqual(hashSeed('a', 'bc'), hashSeed('ab', 'c'));
    assert.equal(hashSeed('a', 1), hashSeed('a', 1));
  });

  it('la semilla de la partida es el id, salvo que GAME_SEED la fije', () => {
    assert.equal(seedForGame('partida-1'), hashSeed('partida-1'));
    assert.notEqual(seedForGame('partida-1'), seedForGame('partida-2'));
    assert.equal(seedForGame('partida-1', 4321), 4321);
    assert.equal(seedForGame('partida-2', 4321), 4321, 'con semilla fija, dos partidas repiten guion');
  });
});

describe('utilidades de sorteo', () => {
  it('intBetween respeta los limites, incluidos los dos extremos', () => {
    const rng = createRng(99);
    const vistos = new Set<number>();
    for (let i = 0; i < 400; i += 1) {
      const v = intBetween(rng, 3, 4);
      assert.ok(v === 3 || v === 4, `fuera de rango: ${v}`);
      vistos.add(v);
    }
    assert.equal(vistos.size, 2, 'los dos extremos deben salir alguna vez');
    assert.equal(intBetween(rng, 5, 5), 5);
  });

  it('pick devuelve un elemento de la lista y sample no repite', () => {
    const rng = createRng(5);
    const lista = ['a', 'b', 'c', 'd'] as const;
    for (let i = 0; i < 20; i += 1) assert.ok(lista.includes(pick(rng, lista)));

    const elegidos = sample(rng, lista, 3);
    assert.equal(elegidos.length, 3);
    assert.equal(new Set(elegidos).size, 3);
    assert.equal(sample(rng, lista, 99).length, 4, 'nunca mas que la lista');
    assert.deepEqual(sample(rng, lista, 0), []);
  });

  it('shuffled conserva el multiset y no muta la entrada', () => {
    const original = [1, 2, 3, 4, 5, 6, 7, 8];
    const copia = [...original];
    const mezcla = shuffled(createRng(31), original);
    assert.deepEqual(original, copia, 'la entrada no se toca');
    assert.deepEqual([...mezcla].sort((a, b) => a - b), copia);
  });

  it('chance respeta la probabilidad en los extremos', () => {
    const rng = createRng(17);
    for (let i = 0; i < 50; i += 1) {
      assert.equal(chance(rng, 0), false);
      assert.equal(chance(rng, 1), true);
    }
  });
});
