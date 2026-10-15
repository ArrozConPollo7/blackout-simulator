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
 * Plan 1.1 y 2.3: ahora cada equipo juega un subconjunto SORTEADO de situaciones y la crisis
 * tiene intensidad variable, asi que las tres exigencias se comprueban en barrido
 * (`SEMILLAS`): un solo camino feliz ya no demuestra nada. Si se rebalancea
 * `content/decisions.ts`, este test es la red que avisa.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { GameState, TeamState } from '../types/game.ts';
import { CASE_CATALOG } from '../content/cases.ts';
import {
  APPLIANCE_BY_ID,
  OPTIONS_BY_ID,
  ROUND2B_SCENARIOS,
  pesoEficienciaR2,
} from '../content/decisions.ts';
import { CRISIS_MEASURES, crisisRateFor, crisisVariantFor } from '../content/crisis.ts';
import {
  advancePhase,
  applyDecision,
  applyMeasure,
  calculateFinalResults,
  drawnScenarios,
  drawEvents,
  eventEffectForDecision,
  initialTeamState,
  markApplied,
  triggerCrisis,
} from '../engine/index.ts';

type Estrategia = 'derroche' | 'equilibrado' | 'extremo';

const VARIANTE: Record<Estrategia, { r1: string; r2: 'a' | 'b' | 'c'; r2b: string }> = {
  derroche: { r1: 'ninguna', r2: 'a', r2b: 'r2b:crisis-final:habitual' },
  equilibrado: { r1: 'completa', r2: 'b', r2b: 'r2b:crisis-final:desconexion' },
  extremo: { r1: 'completa', r2: 'c', r2b: 'r2b:crisis-final:desconexion' },
};

/** Semillas del barrido: cubren muchos sorteos distintos de situaciones y de crisis. */
const SEMILLAS = Array.from({ length: 120 }, (_, i) => i + 1);

/** Juega una partida completa con una estrategia fija y devuelve el estado final. */
function jugar(estrategia: Estrategia, caso = CASE_CATALOG[0], seed = 1): GameState {
  const v = VARIANTE[estrategia];
  const teamId = `equipo-${caso.id}`; // solo para el evento (el sorteo va por caso)
  let state: GameState = {
    phase: 'lobby',
    timerEndsAt: new Date('2026-09-24T10:00:00.000Z').toISOString(),
    crisisTriggered: false,
    teams: [initialTeamState({ id: teamId, name: caso.name, color: '#3ECF8E' })],
    seed,
    crisisRate: crisisRateFor(seed),
    crisisVariant: crisisVariantFor(seed),
    activeEvents: [],
    crisisMeasures: [],
    crisisVotes: [],
    crisisResolvedMeasureId: null,
  };

  const apply = (
    team: TeamState,
    optionId: string,
    ajustes?: Parameters<typeof applyDecision>[2],
  ): TeamState => {
    const option = OPTIONS_BY_ID[optionId];
    assert.ok(option, `opcion inexistente: ${optionId}`);
    return applyDecision(team, option, ajustes);
  };

  // Igual que el Worker: solo las situaciones SORTEADAS para ese equipo, y el peso se reparte
  // entre las que le tocaron (no entre todas las jugables).
  const situaciones = drawnScenarios(seed, caso.id);
  const peso = pesoEficienciaR2(situaciones.length);
  const ahorroR1 = (team: TeamState, aparatos: string[]): { electricidad: number; gas: number } =>
    aparatos.reduce<{ electricidad: number; gas: number }>(
      (acc, aparato) => {
        const efecto = OPTIONS_BY_ID[`r1:${aparato}:${v.r1}`]?.effect;
        return {
          electricidad: acc.electricidad + (efecto?.electricidad ?? 0),
          gas: acc.gas + (efecto?.gas ?? 0),
        };
      },
      { electricidad: 0, gas: 0 },
    );

  // Ronda 1 — investigar: un diagnostico por aparato del caso.
  state = advancePhase(state, 'investigar');
  state = {
    ...state,
    teams: state.teams.map((t) =>
      caso.appliances.reduce((acc, app) => apply(acc, `r1:${app}:${v.r1}`), t),
    ),
  };

  // Ronda 2 — decidir: las situaciones del sorteo, con su peso y descontando el ahorro que ya
  // se capturo en la Ronda 1 sobre esos mismos aparatos, mas el evento aleatorio del aula.
  state = advancePhase(state, 'decidir');
  assert.ok(situaciones.length >= 3 && situaciones.length <= 4, `${caso.id}: ${situaciones.length} situaciones`);
  const eventos = markApplied(
    drawEvents(seed, 'decidir', [{ id: teamId, caseId: caso.id }]),
    state.teams.flatMap((t) => [] as string[]),
  );
  state = {
    ...state,
    activeEvents: eventos,
    teams: state.teams.map((t) =>
      situaciones.reduce((acc, s) => {
        const siguiente = apply(acc, `r2:${s.id}:${v.r2}`, {
          pesoEficiencia: peso,
          descontarAhorro: ahorroR1(acc, s.requires ?? []),
        });
        const falla = eventEffectForDecision(eventos, s);
        return falla
          ? applyDecision(siguiente, { id: 'evento', label: 'evento', effect: falla.effect })
          : siguiente;
      }, t),
    ),
  };

  // Evento sorpresa + votacion del aula + ultimas decisiones.
  state = advancePhase(triggerCrisis(state), 'crisis');
  state = advancePhase(state, 'crisis_votacion');
  state = advancePhase(state, 'decidir_2');
  assert.equal(ROUND2B_SCENARIOS.length, 1);
  state = {
    ...state,
    teams: state.teams.map((t) => apply(t, v.r2b)),
  };

  return advancePhase(state, 'resultados');
}

/** Las tres estrategias jugadas con la misma semilla y el mismo caso. */
function triada(seed: number, caso = CASE_CATALOG[0]) {
  return {
    derroche: jugar('derroche', caso, seed).teams[0],
    equilibrado: jugar('equilibrado', caso, seed).teams[0],
    extremo: jugar('extremo', caso, seed).teams[0],
  };
}

function ordenDe(equipos: Record<Estrategia, TeamState>): Array<Estrategia | undefined> {
  const ranking = calculateFinalResults({
    ...jugar('equilibrado'),
    teams: [equipos.derroche, equipos.equilibrado, equipos.extremo],
  }).ranking;
  const nombrePorEquipo = new Map(
    (Object.keys(equipos) as Estrategia[]).map((e) => [equipos[e], e] as const),
  );
  return ranking.map((r) => nombrePorEquipo.get(r.team));
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

    assert.deepEqual(ordenDe(equipos), ['equilibrado', 'extremo', 'derroche']);
    assert.equal(ranking[0].rank, 1);
    assert.ok(
      ranking.every((r, i) => i === 0 || ranking[i - 1].puntos >= r.puntos),
      'el ranking debe venir ordenado por puntaje (eficiencia + consumo + economía)',
    );
  });

  it('la tesis se sostiene en barrido: 120 semillas, cada una con su sorteo y su crisis', () => {
    for (const seed of SEMILLAS) {
      const equipos = triada(seed);
      assert.deepEqual(
        ordenDe(equipos),
        ['equilibrado', 'extremo', 'derroche'],
        `semilla ${seed}: se rompio el orden del ranking`,
      );
      assert.ok(
        equipos.extremo.presupuesto > equipos.equilibrado.presupuesto,
        `semilla ${seed}: la extremista no ahorro mas dinero que la ganadora`,
      );
      assert.ok(
        equipos.extremo.electricidad <= equipos.equilibrado.electricidad,
        `semilla ${seed}: la extremista consumio mas electricidad`,
      );
      assert.ok(
        equipos.extremo.gas <= equipos.equilibrado.gas,
        `semilla ${seed}: la extremista consumio mas gas`,
      );
      // Con un reparto solo de gas (posible desde el sorteo), los dos consumos electricos
      // EMPATAN: la ventaja de la extremista se ve en el dinero y en el gas, y aun asi pierde.
      assert.ok(equipos.equilibrado.eficiencia > equipos.derroche.eficiencia, `semilla ${seed}`);
      assert.ok(equipos.derroche.electricidad > equipos.equilibrado.electricidad, `semilla ${seed}`);
      assert.ok(equipos.equilibrado.eficiencia >= 70 && equipos.equilibrado.eficiencia <= 95, `semilla ${seed}: ${equipos.equilibrado.eficiencia}`);
      assert.ok(equipos.derroche.eficiencia < 40, `semilla ${seed}: derroche=${equipos.derroche.eficiencia}`);
      for (const t of Object.values(equipos)) {
        assert.ok(t.presupuesto > 0, `semilla ${seed}: un equipo termina en deuda`);
        assert.ok(t.electricidad > 0 && t.electricidad <= 220, `semilla ${seed}`);
        assert.ok(t.gas >= 0 && t.gas <= 220, `semilla ${seed}`);
      }
    }
  });

  it('cada caso del catalogo es jugable con la estrategia equilibrada, en cualquier semilla', () => {
    for (const caso of CASE_CATALOG) {
      for (const seed of SEMILLAS.slice(0, 24)) {
        const final = jugar('equilibrado', caso, seed);
        const t = final.teams[0];
        assert.equal(final.phase, 'resultados');
        assert.ok(t.presupuesto > 0, `${caso.id} (semilla ${seed}) termina en deuda`);
        assert.ok(t.eficiencia >= 70, `${caso.id} (semilla ${seed}) eficiencia=${t.eficiencia}`);
        assert.ok(
          caso.appliances.every((app) => APPLIANCE_BY_ID[app]),
          `${caso.id} con aparato desconocido`,
        );
      }
    }
  });

  it('la medida que vote el aula no da la vuelta al ranking de las estrategias', () => {
    for (const medida of CRISIS_MEASURES) {
      const equipos = triada(5);
      const { teams } = applyMeasure(
        [equipos.derroche, equipos.equilibrado, equipos.extremo],
        medida.effect,
      );
      const [derroche, equilibrado, extremo] = teams;
      assert.deepEqual(
        ordenDe({ derroche, equilibrado, extremo }),
        ['equilibrado', 'extremo', 'derroche'],
        `la medida "${medida.id}" desordena el ranking`,
      );
    }
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

  it('las eficiencias finales caen en rangos jugables (documento: 78% como referencia)', () => {
    assert.ok(kpi('derroche').eficiencia < 40, `derroche=${kpi('derroche').eficiencia}`);
    assert.ok(kpi('extremo').eficiencia > kpi('derroche').eficiencia);
    assert.ok(kpi('extremo').eficiencia < kpi('equilibrado').eficiencia);
    assert.ok(kpi('equilibrado').eficiencia >= 70, `equilibrado=${kpi('equilibrado').eficiencia}`);
    assert.ok(kpi('equilibrado').eficiencia <= 95);
  });

  it('la crisis castiga mas a quien mas consumio cuando el consumo de partida es igual', () => {
    const base = initialTeamState({ id: 'x', name: 'x', color: '#000' });
    const eficiente = triggerCrisis({
      ...finales.equilibrado,
      phase: 'crisis',
      crisisTriggered: false,
      crisisVariant: { id: 'solo-electricidad', label: 'solo luz', gasSurchargeRate: 0 },
      teams: [{ ...base, id: 'e', electricidad: 70 }, { ...base, id: 'd', electricidad: 105 }],
    });
    const [e, d] = eficiente.teams;
    assert.ok(base.presupuesto - d.presupuesto > base.presupuesto - e.presupuesto);
    assert.equal(
      (base.presupuesto - d.presupuesto) / (base.presupuesto - e.presupuesto),
      105 / 70,
    );
  });
});
