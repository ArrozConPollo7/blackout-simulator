/**
 * Plan 1.1: el sorteo de situaciones de la Ronda 2.
 *
 * Antes cada caso jugaba todas sus situaciones jugables, siempre las mismas y en el mismo
 * orden: a la segunda partida el guion ya era memorizable. Ahora se sortean 3 o 4.
 *
 * Lo que hay que blindar es que el sorteo sea (a) determinista, (b) un subconjunto de lo que
 * el caso puede jugar, (c) con el mismo techo de puntos para todos y (d) **reproducible a
 * partir de (semilla, caso)**, sin depender del id del equipo: ese id es un UUID nuevo en
 * cada partida y colgarlo del sorteo rompia el "repetir el guion con GAME_SEED".
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CASE_CATALOG } from '../content/cases.ts';
import {
  ROUND2_DRAW_MAX,
  ROUND2_DRAW_MIN,
  ROUND2_SCENARIOS,
  SCENARIOS_BY_ID,
  pesoEficienciaR2,
  scenariosForCase,
} from '../content/decisions.ts';
import {
  drawnScenarioIds,
  drawnScenarioIdsForCase,
  drawnScenariosForCase,
  pesoForTeam,
  teamPlaysScenario,
} from '../engine/draw.ts';
import { ROUND2_EFICIENCIA_TOTAL } from '../content/economy.ts';

const SEMILLAS = Array.from({ length: 80 }, (_, i) => i + 1);

describe('sorteo de situaciones de Ronda 2', () => {
  it('cada caso recibe entre 3 y 4 situaciones, todas jugables por sus aparatos', () => {
    for (const caso of CASE_CATALOG) {
      const jugables = scenariosForCase('decidir', caso.appliances).map((s) => s.id);
      for (const seed of SEMILLAS) {
        const sorteadas = drawnScenarioIds(seed, caso.id);
        assert.ok(
          sorteadas.length >= ROUND2_DRAW_MIN && sorteadas.length <= ROUND2_DRAW_MAX,
          `${caso.id}/${seed}: ${sorteadas.length} situaciones`,
        );
        assert.equal(new Set(sorteadas).size, sorteadas.length, 'sin repetidas');
        for (const id of sorteadas) {
          assert.ok(jugables.includes(id), `${caso.id} recibio ${id}, que no juega`);
          assert.ok(SCENARIOS_BY_ID[id], `${id} no existe en el catalogo`);
        }
      }
    }
  });

  it('es determinista: (semilla, caso) da siempre el mismo reparto', () => {
    for (const seed of SEMILLAS.slice(0, 20)) {
      const a = drawnScenarioIdsForCase(seed, 'familia-duque');
      const b = drawnScenarioIdsForCase(seed, 'familia-duque');
      assert.deepEqual(a, b);
    }
  });

  it('no depende del id del equipo: la misma semilla y el mismo caso reparten igual', () => {
    // Es lo que hace reproducible una partida con `GAME_SEED`: los ids de equipo cambian en
    // cada partida (UUID nuevos), pero el reparto de cada caso no.
    for (const seed of SEMILLAS.slice(0, 10)) {
      const familia = drawnScenarioIdsForCase(seed, 'familia-duque');
      const otraPartida = drawnScenarioIds(seed, 'familia-duque', CASE_CATALOG[0].appliances);
      assert.deepEqual(otraPartida, familia);
    }
  });

  it('el reparto cambia con la semilla y con el caso (no es un guion fijo)', () => {
    const porSemilla = SEMILLAS.map((seed) => drawnScenarioIdsForCase(seed, 'familia-duque').join('|'));
    assert.ok(new Set(porSemilla).size > 20, `solo ${new Set(porSemilla).size} repartos distintos en 80 semillas`);

    const porCaso = CASE_CATALOG.map((caso) => drawnScenarioIdsForCase(11, caso.id).join('|'));
    assert.ok(new Set(porCaso).size > 1, 'seis casos distintos no pueden recibir todos lo mismo');
  });

  it('nunca reparte mas situaciones de las que el caso puede jugar', () => {
    // Oficina Norte solo juega 6 de las 14: el sorteo se mueve dentro de esas 6.
    const oficina = CASE_CATALOG.find((c) => c.id === 'oficina-norte')!;
    const jugables = scenariosForCase('decidir', oficina.appliances).map((s) => s.id);
    assert.ok(jugables.length >= ROUND2_DRAW_MAX, `oficina-norte juega ${jugables.length}`);
    for (const seed of SEMILLAS) {
      for (const id of drawnScenarioIds(seed, oficina.id)) {
        assert.ok(jugables.includes(id));
      }
    }
  });

  it('el peso se calcula sobre lo sorteado, no sobre lo jugable: el techo son 24 puntos', () => {
    assert.equal(pesoEficienciaR2(3), 2);
    assert.equal(pesoEficienciaR2(4), 1.5);
    for (const caso of CASE_CATALOG) {
      for (const seed of SEMILLAS.slice(0, 25)) {
        const peso = pesoForTeam(seed, caso.id);
        const n = drawnScenarioIdsForCase(seed, caso.id).length;
        assert.equal(peso, pesoEficienciaR2(n));
        const techo = 4 * n * peso; // la mejor opcion de cada situacion da +4
        assert.ok(
          Math.abs(techo - ROUND2_EFICIENCIA_TOTAL) < 1e-9,
          `${caso.id}/${seed}: techo ${techo}`,
        );
      }
    }
  });

  it('teamPlaysScenario coincide con el reparto (es la validacion del Worker)', () => {
    for (const seed of SEMILLAS.slice(0, 15)) {
      const sorteadas = drawnScenarioIdsForCase(seed, 'gimnasio-zona-vital');
      for (const scenario of ROUND2_SCENARIOS) {
        assert.equal(
          teamPlaysScenario(seed, 'gimnasio-zona-vital', scenario.id),
          sorteadas.includes(scenario.id),
          `${scenario.id}`,
        );
      }
    }
  });

  it('sin aparatos declarados el sorteo trabaja sobre el catalogo completo', () => {
    // Un caso fuera del catalogo no aporta aparatos: se juega contra el pool entero.
    const sorteadas = drawnScenariosForCase(1, 'caso-inexistente');
    assert.ok(sorteadas.length >= ROUND2_DRAW_MIN && sorteadas.length <= ROUND2_DRAW_MAX);
    for (const s of sorteadas) assert.ok(ROUND2_SCENARIOS.includes(s));

    const todas = drawnScenarioIds(1, null);
    assert.ok(todas.length >= ROUND2_DRAW_MIN && todas.length <= ROUND2_DRAW_MAX);
    // Un caso sin aparatos (lista vacia) no tiene nada que jugar y el sorteo devuelve vacio.
    assert.deepEqual(drawnScenarioIds(1, 'familia-duque', []), []);
  });
});
