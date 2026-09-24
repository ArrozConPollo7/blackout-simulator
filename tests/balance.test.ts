/**
 * Test de balanceo: la tesis pedagogica del documento tiene que sostenerse con numeros.
 *
 *   "El equipo que consiguio el mejor resultado no fue necesariamente el que dejo de
 *    consumir, sino el que elimino los consumos innecesarios manteniendo las
 *    necesidades basicas."
 *
 * Se juega la partida completa con 3 estrategias puras y se exige que:
 *   1. la equilibrada gane el ranking,
 *   2. la extremista termine con MAS presupuesto que la ganadora (ahorrar no basta),
 *   3. la derrochadora quede ultima en eficiencia y con la peor factura.
 *
 * Si se rebalancea `content/decisions.ts`, este test es la red que avisa.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { GameState, TeamState } from '../types/game.ts';
import { CASE_CATALOG } from '../content/cases.ts';
import {
  APPLIANCE_BY_ID,
  ROUND2B_SCENARIOS,
  ROUND2_SCENARIOS,
  OPTIONS_BY_ID,
} from '../content/decisions.ts';
import {
  advancePhase,
  applyDecision,
  calculateFinalResults,
  initialTeamState,
  triggerCrisis,
} from '../engine/index.ts';

type Estrategia = 'derroche' | 'equilibrado' | 'extremo';

const VARIANTE: Record<Estrategia, { r1: string; r2: 'a' | 'b' | 'c'; r2b: string }> = {
  derroche: { r1: 'ninguna', r2: 'a', r2b: 'r2b:crisis-final:habitual' },
  equilibrado: { r1: 'completa', r2: 'b', r2b: 'r2b:crisis-final:desconexion' },
  extremo: { r1: 'completa', r2: 'c', r2b: 'r2b:crisis-final:desconexion' },
};

/** Juega una partida completa con una estrategia fija y devuelve el estado final. */
function jugar(estrategia: Estrategia, caso = CASE_CATALOG[0]): GameState {
  const v = VARIANTE[estrategia];
  let state: GameState = {
    phase: 'lobby',
    timerEndsAt: new Date('2026-09-24T10:00:00.000Z').toISOString(),
    crisisTriggered: false,
    teams: [initialTeamState({ id: caso.id, name: caso.name, color: '#3ECF8E' })],
  };

  const apply = (team: TeamState, optionId: string): TeamState => {
    const option = OPTIONS_BY_ID[optionId];
    assert.ok(option, `opcion inexistente: ${optionId}`);
    return applyDecision(team, option);
  };

  // Ronda 1 — investigar: un diagnostico por aparato del caso.
  state = advancePhase(state, 'investigar');
  state = {
    ...state,
    teams: state.teams.map((t) =>
      caso.appliances.reduce((acc, app) => apply(acc, `r1:${app}:${v.r1}`), t),
    ),
  };

  // Ronda 2 — decidir: mismo tamano de decision para las 6 situaciones.
  state = advancePhase(state, 'decidir');
  assert.equal(ROUND2_SCENARIOS.length, 6);
  state = {
    ...state,
    teams: state.teams.map((t) =>
      ROUND2_SCENARIOS.reduce((acc, s) => apply(acc, `r2:${s.id}:${v.r2}`), t),
    ),
  };

  // Evento sorpresa + ultimas decisiones.
  state = advancePhase(triggerCrisis(state), 'crisis');
  state = advancePhase(state, 'decidir_2');
  assert.equal(ROUND2B_SCENARIOS.length, 1);
  state = {
    ...state,
    teams: state.teams.map((t) => apply(t, v.r2b)),
  };

  return advancePhase(state, 'resultados');
}

describe('balanceo de la partida', () => {
  const finales = {
    derroche: jugar('derroche'),
    equilibrado: jugar('equilibrado'),
    extremo: jugar('extremo'),
  } as const;

  const kpi = (e: Estrategia) => finales[e].teams[0];

  it('la estrategia equilibrada gana el ranking', () => {
    const equipos = { derroche: kpi('derroche'), equilibrado: kpi('equilibrado'), extremo: kpi('extremo') };
    const ranking = calculateFinalResults({
      ...finales.equilibrado,
      teams: [equipos.derroche, equipos.equilibrado, equipos.extremo],
    }).ranking;

    const nombrePorEquipo = new Map(
      (Object.keys(equipos) as Estrategia[]).map((e) => [equipos[e], e] as const),
    );
    const orden = ranking.map((r) => nombrePorEquipo.get(r.team));

    assert.deepEqual(orden, ['equilibrado', 'extremo', 'derroche']);
    assert.equal(ranking[0].rank, 1);
    assert.ok(
      ranking.every((r, i) => i === 0 || ranking[i - 1].puntos >= r.puntos),
      'el ranking debe venir ordenado por puntaje (eficiencia + consumo + economía)',
    );
  });

  it('a igual eficiencia, gana quien consumió menos (el consumo sí puntúa)', () => {
    const base = initialTeamState({ id: 'x', name: 'x', color: '#000' });
    const derrochador = { ...base, id: 'a', eficiencia: 70, electricidad: 90, gas: 80, presupuesto: 70000 };
    const austero = { ...base, id: 'b', eficiencia: 70, electricidad: 55, gas: 40, presupuesto: 80000 };
    const ranking = calculateFinalResults({
      ...finales.equilibrado,
      teams: [derrochador, austero],
    }).ranking;
    assert.deepEqual(ranking.map((r) => r.team.id), ['b', 'a']);
    assert.ok(ranking[0].desglose.consumo > ranking[1].desglose.consumo);
  });

  it('ni consumir menos ni gastar menos dan la vuelta a una diferencia grande de eficiencia', () => {
    const base = initialTeamState({ id: 'x', name: 'x', color: '#000' });
    // La extremista consume 27 kWh y 35 m³ menos y tiene $25.000 más, pero 30 puntos menos
    // de eficiencia: el mensaje del juego ("no gana quien menos consume a secas") se sostiene.
    const extremo = { ...base, id: 'e', eficiencia: 45, electricidad: 35, gas: 20, presupuesto: 95000 };
    const equilibrado = { ...base, id: 'q', eficiencia: 75, electricidad: 62, gas: 55, presupuesto: 70000 };
    const ranking = calculateFinalResults({
      ...finales.equilibrado,
      teams: [extremo, equilibrado],
    }).ranking;
    assert.equal(ranking[0].team.id, 'q');
  });

  it('la extremista ahorra mas dinero que la ganadora y aun asi pierde', () => {
    assert.ok(
      kpi('extremo').presupuesto > kpi('equilibrado').presupuesto,
      'la estrategia extrema debe terminar con mas presupuesto',
    );
    assert.ok(
      kpi('extremo').electricidad < kpi('equilibrado').electricidad,
      'la estrategia extrema debe consumir menos kWh',
    );
  });

  it('la derrochadora termina ultima en eficiencia y con la peor factura', () => {
    const derroche = kpi('derroche');
    const equilibrado = kpi('equilibrado');
    assert.ok(equilibrado.eficiencia > derroche.eficiencia);
    assert.ok(equilibrado.presupuesto > derroche.presupuesto);
    assert.ok(derroche.electricidad > equilibrado.electricidad);
  });

  it('las eficiencias finales caen en rangos jugables (documento: 78% como referencia)', () => {
    assert.ok(kpi('derroche').eficiencia < 40, `derroche=${kpi('derroche').eficiencia}`);
    assert.ok(kpi('extremo').eficiencia > kpi('derroche').eficiencia);
    assert.ok(kpi('extremo').eficiencia < kpi('equilibrado').eficiencia);
    assert.ok(kpi('equilibrado').eficiencia >= 70, `equilibrado=${kpi('equilibrado').eficiencia}`);
    assert.ok(kpi('equilibrado').eficiencia <= 95);
  });

  it('ninguna estrategia queda con presupuesto negativo ni con consumo por encima de los limites', () => {
    for (const estrategia of Object.keys(finales) as Estrategia[]) {
      const t = kpi(estrategia);
      assert.ok(t.presupuesto > 0, `${estrategia} en deuda`);
      assert.ok(t.electricidad > 0 && t.electricidad <= 220, `${estrategia} electricidad=${t.electricidad}`);
      assert.ok(t.gas >= 0 && t.gas <= 220);
    }
  });

  it('la crisis castiga mas a quien mas consumio cuando el consumo de partida es igual', () => {
    const base = initialTeamState({ id: 'x', name: 'x', color: '#000' });
    const eficiente = triggerCrisis({
      phase: 'crisis',
      timerEndsAt: new Date().toISOString(),
      crisisTriggered: false,
      teams: [{ ...base, id: 'e', electricidad: 70 }, { ...base, id: 'd', electricidad: 105 }],
    });
    const [e, d] = eficiente.teams;
    assert.ok(base.presupuesto - d.presupuesto > base.presupuesto - e.presupuesto);
    assert.equal(
      (base.presupuesto - d.presupuesto) / (base.presupuesto - e.presupuesto),
      105 / 70,
    );
  });

  it('cada caso del catalogo es jugable con la estrategia equilibrada', () => {
    for (const caso of CASE_CATALOG) {
      const final = jugar('equilibrado', caso);
      const t = final.teams[0];
      assert.equal(final.phase, 'resultados');
      assert.ok(t.presupuesto > 0, `${caso.id} termina en deuda`);
      assert.ok(t.eficiencia >= 70, `${caso.id} eficiencia=${t.eficiencia}`);
      assert.ok(
        caso.appliances.every((app) => APPLIANCE_BY_ID[app]),
        `${caso.id} con aparato desconocido`,
      );
    }
  });
});
