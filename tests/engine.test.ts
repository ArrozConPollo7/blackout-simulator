/**
 * Tests unitarios del motor puro (Fase 1.4).
 * Cubren las 4 funciones: advancePhase, applyDecision, triggerCrisis, calculateFinalResults.
 * Corren sin UI, sin red y sin Supabase: `node --test tests/`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { GameState, TeamState } from '../types/game.ts';
import {
  CRISIS_SURCHARGE_RATE,
  PRESUPUESTO_INICIAL,
  TARIFA_ELECTRICIDAD,
  sobrecostoCrisis,
} from '../content/economy.ts';
import { PHASE_ORDER, durationOf } from '../content/phases.ts';
import { OPTIONS_BY_ID } from '../content/decisions.ts';
import {
  PhaseTransitionError,
  advancePhase,
  calculateFinalResults,
  compareTeams,
  crisisSurchargeFor,
  initialGameState,
  initialTeamState,
  formatNumber,
  describeEffect,
  triggerCrisis,
  applyDecision,
} from '../engine/index.ts';

const team = (over: Partial<TeamState> = {}): TeamState => ({
  ...initialTeamState({ id: 't1', name: 'Equipo 1', color: '#3ECF8E' }),
  ...over,
});

const option = (id: string) => {
  const found = OPTIONS_BY_ID[id];
  if (!found) throw new Error(`opcion desconocida en el test: ${id}`);
  return found;
};

// --- advancePhase ----------------------------------------------------------

describe('advancePhase', () => {
  it('avanza un paso y programa timerEndsAt con la duracion de la fase destino', () => {
    const now = new Date('2026-09-24T10:00:00.000Z');
    const state = initialGameState([team()], now);

    const investigating = advancePhase(state, 'investigar', now);
    assert.equal(investigating.phase, 'investigar');
    assert.equal(
      investigating.timerEndsAt,
      new Date(now.getTime() + durationOf('investigar')!).toISOString(),
    );

    const deciding = advancePhase(investigating, 'decidir', now);
    assert.equal(deciding.phase, 'decidir');
    assert.equal(deciding.timerEndsAt, new Date(now.getTime() + durationOf('decidir')!).toISOString());
  });

  it('recorre la secuencia completa de fases sin saltarse ninguna', () => {
    let state = initialGameState([team()]);
    for (const phase of PHASE_ORDER.slice(1)) {
      state = advancePhase(state, phase);
      assert.equal(state.phase, phase);
    }
    assert.equal(state.phase, 'resultados');
  });

  it('rechaza retroceder o saltar fases', () => {
    const state = initialGameState([team()]);
    assert.throws(() => advancePhase(state, 'decidir'), PhaseTransitionError);
    assert.throws(() => advancePhase(state, 'lobby'), PhaseTransitionError);

    const deciding = advancePhase(advancePhase(state, 'investigar'), 'decidir');
    assert.throws(() => advancePhase(deciding, 'investigar'), PhaseTransitionError);
  });

  it('no muta el estado original ni altera los equipos', () => {
    const state = initialGameState([team({ electricidad: 90 })]);
    const next = advancePhase(state, 'investigar');
    assert.equal(state.phase, 'lobby');
    assert.equal(next.teams[0].electricidad, 90);
    assert.equal(next.teams, state.teams);
  });

  it('en fases sin cronometro deja la marca en el instante actual', () => {
    const now = new Date('2026-09-24T10:00:00.000Z');
    const resultados = advancePhase(
      { ...initialGameState([team()], now), phase: 'decidir_2' },
      'resultados',
      now,
    );
    assert.equal(resultados.timerEndsAt, now.toISOString());
  });
});

// --- applyDecision ---------------------------------------------------------

describe('applyDecision', () => {
  it('aplica los 4 deltas del DecisionEffect', () => {
    const before = team({ electricidad: 100, gas: 100, presupuesto: 100000, eficiencia: 50 });
    const after = applyDecision(before, option('r2:calor:b'));

    const effect = option('r2:calor:b').effect;
    assert.equal(after.electricidad, 100 + (effect.electricidad ?? 0));
    assert.equal(after.gas, 100 + (effect.gas ?? 0));
    assert.equal(after.presupuesto, 100000 + (effect.presupuesto ?? 0));
    assert.equal(after.eficiencia, 50 + (effect.eficiencia ?? 0));
  });

  it('es puro: no muta el TeamState recibido', () => {
    const before = team();
    const snapshot = { ...before };
    applyDecision(before, option('r2:calor:a'));
    assert.deepEqual(before, snapshot);
  });

  it('es acumulativo: dos decisiones aplican los dos efectos', () => {
    const before = team();
    const once = applyDecision(before, option('r2:calor:b'));
    const twice = applyDecision(once, option('r2:cocina:b'));
    const expected =
      (option('r2:calor:b').effect.electricidad ?? 0) + (option('r2:cocina:b').effect.electricidad ?? 0);
    assert.equal(twice.electricidad, 100 + expected);
  });

  it('respeta los limites fisicos (nunca electricidad negativa ni eficiencia > 100)', () => {
    const drowned = applyDecision(
      team({ electricidad: 1, gas: 1, eficiencia: 99 }),
      { id: 'fake', label: 'fake', effect: { electricidad: -50, gas: -50, eficiencia: 50 } },
    );
    assert.equal(drowned.electricidad, 0);
    assert.equal(drowned.gas, 0);
    assert.equal(drowned.eficiencia, 100);
  });

  it('el presupuesto puede quedar en negativo (deuda), sin recortes silenciosos', () => {
    const broke = applyDecision(team({ presupuesto: 500 }), {
      id: 'fake',
      label: 'fake',
      effect: { presupuesto: -9000 },
    });
    assert.equal(broke.presupuesto, -8500);
  });

  it('descuenta el ahorro ya capturado en la Ronda 1 (el aparato vuelve a su consumo real)', () => {
    const base = team();
    const trasR1 = applyDecision(base, option('r1:aire-acondicionado:completa')); // -6 kWh
    assert.equal(trasR1.electricidad, base.electricidad - 6);

    // Sin descuento, elegir en R2 "8 h a 18 °C" salía gratis: el ahorro se conservaba.
    const gratis = applyDecision(trasR1, option('r2:calor:a'));
    assert.equal(gratis.electricidad, trasR1.electricidad);

    // Con el descuento, el aparato vuelve a su consumo real (el de la referencia).
    const real = applyDecision(trasR1, option('r2:calor:a'), {
      descontarAhorro: { electricidad: -6 },
    });
    assert.equal(real.electricidad, base.electricidad);
    assert.ok(real.electricidad > gratis.electricidad, 'desperdiciar tiene que costar');

    // Y si mantiene el arreglo, tampoco se cuenta dos veces el ahorro.
    const mantiene = applyDecision(trasR1, option('r2:calor:b'), {
      descontarAhorro: { electricidad: -6 },
    });
    assert.equal(mantiene.electricidad, base.electricidad - 6);
  });

  it('el peso de eficiencia escala el delta completo (casos con menos situaciones)', () => {
    const sinPeso = applyDecision(team(), option('r2:calor:b'));
    const conPeso = applyDecision(team(), option('r2:calor:b'), { pesoEficiencia: 2 });
    const delta = sinPeso.eficiencia - team().eficiencia;
    assert.equal(conPeso.eficiencia - team().eficiencia, delta * 2);
  });

  it('la eficiencia se mueve con las decisiones de confort, no con el ahorro extremo', () => {
    const balanced = applyDecision(team(), option('r2:calor:b'));
    const extreme = applyDecision(team(), option('r2:calor:c'));
    assert.ok(balanced.eficiencia > initialTeamState({ id: 'x', name: 'x', color: '#000' }).eficiencia);
    assert.ok(extreme.eficiencia < balanced.eficiencia);
    assert.ok(extreme.electricidad < balanced.electricidad, 'el extremo consume menos');
  });
});

// --- triggerCrisis --------------------------------------------------------

describe('triggerCrisis', () => {
  it('aplica el +30% sobre el consumo acumulado de CADA equipo, no en parejo', () => {
    const state: GameState = {
      phase: 'decidir',
      timerEndsAt: new Date().toISOString(),
      crisisTriggered: false,
      teams: [team({ id: 'eficiente', electricidad: 72 }), team({ id: 'derrochador', electricidad: 104 })],
    };

    const crisis = triggerCrisis(state);
    const [eficiente, derrochador] = crisis.teams;

    assert.equal(crisis.crisisTriggered, true);
    assert.equal(
      eficiente.presupuesto,
      PRESUPUESTO_INICIAL - Math.round(72 * TARIFA_ELECTRICIDAD * CRISIS_SURCHARGE_RATE),
    );
    assert.equal(
      derrochador.presupuesto,
      PRESUPUESTO_INICIAL - Math.round(104 * TARIFA_ELECTRICIDAD * CRISIS_SURCHARGE_RATE),
    );

    // El sobrecosto es proporcional al consumo: no es un valor fijo por equipo.
    const castigoEficiente = PRESUPUESTO_INICIAL - eficiente.presupuesto;
    const castigoDerrochador = PRESUPUESTO_INICIAL - derrochador.presupuesto;
    assert.notEqual(castigoEficiente, castigoDerrochador);
    assert.ok(castigoDerrochador > castigoEficiente);
    assert.equal(castigoDerrochador / castigoEficiente, 104 / 72);
    assert.equal(crisisSurchargeFor({ ...eficiente, electricidad: 72 }), castigoEficiente);
  });

  it('es idempotente: disparar dos veces no cobra dos veces', () => {
    const state: GameState = {
      phase: 'crisis',
      timerEndsAt: new Date().toISOString(),
      crisisTriggered: false,
      teams: [team({ electricidad: 90 })],
    };
    const once = triggerCrisis(state);
    const twice = triggerCrisis(once);
    assert.equal(twice, once);
    assert.equal(twice.teams[0].presupuesto, once.teams[0].presupuesto);
  });

  it('no toca el consumo ni la eficiencia, solo el presupuesto', () => {
    const state: GameState = {
      phase: 'crisis',
      timerEndsAt: new Date().toISOString(),
      crisisTriggered: false,
      teams: [team({ electricidad: 80, gas: 40, eficiencia: 70 })],
    };
    const crisis = triggerCrisis(state);
    const before = state.teams[0];
    const after = crisis.teams[0];
    assert.equal(after.electricidad, before.electricidad);
    assert.equal(after.gas, before.gas);
    assert.equal(after.eficiencia, before.eficiencia);
    assert.ok(after.presupuesto < before.presupuesto);
  });

  it('el sobrecosto se calcula sobre el consumo acumulado, no sobre la referencia', () => {
    assert.equal(sobrecostoCrisis(0), 0);
    assert.equal(sobrecostoCrisis(100), Math.round(100 * TARIFA_ELECTRICIDAD * 0.3));
    assert.equal(sobrecostoCrisis(200) / sobrecostoCrisis(100), 2);
  });
});

// --- calculateFinalResults ------------------------------------------------

describe('calculateFinalResults', () => {
  it('ordena por eficiencia de mayor a menor', () => {
    const state: GameState = {
      phase: 'resultados',
      timerEndsAt: new Date().toISOString(),
      crisisTriggered: true,
      teams: [
        team({ id: 'b', name: 'Beta', eficiencia: 41, presupuesto: 20000 }),
        team({ id: 'a', name: 'Alfa', eficiencia: 88, presupuesto: 30000 }),
        team({ id: 'c', name: 'Gamma', eficiencia: 62, presupuesto: 90000 }),
      ],
    };
    const results = calculateFinalResults(state);
    assert.deepEqual(
      results.ranking.map((r) => r.team.name),
      ['Alfa', 'Gamma', 'Beta'],
    );
    assert.deepEqual(
      results.ranking.map((r) => r.rank),
      [1, 2, 3],
    );
    assert.equal(results.leaderId, 'a');
  });

  it('resuelve empates de eficiencia por presupuesto restante', () => {
    const state: GameState = {
      phase: 'resultados',
      timerEndsAt: new Date().toISOString(),
      crisisTriggered: false,
      teams: [
        team({ id: 'pobre', name: 'Pobre', eficiencia: 70, presupuesto: 10000 }),
        team({ id: 'rico', name: 'Rico', eficiencia: 70, presupuesto: 60000 }),
        team({ id: 'medio', name: 'Medio', eficiencia: 70, presupuesto: 30000 }),
      ],
    };
    const results = calculateFinalResults(state);
    assert.deepEqual(
      results.ranking.map((r) => r.team.name),
      ['Rico', 'Medio', 'Pobre'],
    );
  });

  it('el orden por puntos es identico al orden por (eficiencia, presupuesto)', () => {
    const state: GameState = {
      phase: 'resultados',
      timerEndsAt: new Date().toISOString(),
      crisisTriggered: false,
      teams: [
        team({ id: '1', eficiencia: 74, presupuesto: 64500 }),
        team({ id: '2', eficiencia: 41, presupuesto: 76000 }),
        team({ id: '3', eficiencia: 27, presupuesto: 48000 }),
        team({ id: '4', eficiencia: 74, presupuesto: 64900 }),
      ],
    };

    const ranking = calculateFinalResults(state).ranking;
    const sortedByPuntos = [...ranking].sort((a, b) => b.puntos - a.puntos);

    assert.deepEqual(
      sortedByPuntos.map((r) => r.team.id),
      ranking.map((r) => r.team.id),
      'los puntos deben reproducir el ranking exacto',
    );
    // Segundo criterio real: '4' y '1' empatan en eficiencia y '4' conserva mas dinero.
    assert.deepEqual(
      ranking.map((r) => r.team.id),
      ['4', '1', '2', '3'],
    );
  });

  it('ordena deterministamente cuando eficiencia y presupuesto coinciden', () => {
    const dupla = [team({ id: 'z' }), team({ id: 'a' })];
    assert.ok([...dupla].sort(compareTeams)[0].id === 'a');
  });

  it('reporta promedios y ahorros contra la referencia del caso', () => {
    const state: GameState = {
      phase: 'resultados',
      timerEndsAt: new Date().toISOString(),
      crisisTriggered: true,
      teams: [
        team({ id: 'a', electricidad: 72, gas: 45, eficiencia: 80, presupuesto: 82000 }),
        team({ id: 'b', electricidad: 108, gas: 60, eficiencia: 40, presupuesto: 50000 }),
      ],
    };
    const results = calculateFinalResults(state);
    assert.equal(results.promedioEficiencia, 60);
    assert.equal(results.promedioConsumoElectrico, 90);
    assert.equal(results.promedioPresupuesto, 66000);
    const lider = results.ranking[0];
    assert.equal(lider.ahorroElectricidadKwh, 28);
    assert.equal(lider.ahorroGasM3, 55);
    assert.equal(
      lider.puntos,
      924,
    ); // 80*10 (eficiencia) + 28 kWh (consumo) + 55 m³ (consumo) + 82000/2000 (economía)
    assert.deepEqual(lider.desglose, { eficiencia: 800, consumo: 83, economia: 41, total: 924 });
  });

  it('no muta el estado de la partida', () => {
    const state: GameState = {
      phase: 'resultados',
      timerEndsAt: new Date().toISOString(),
      crisisTriggered: false,
      teams: [team({ id: 'b' }), team({ id: 'a' })],
    };
    const snapshot = JSON.stringify(state);
    calculateFinalResults(state);
    assert.equal(JSON.stringify(state), snapshot);
  });
});

// --- microcopy ------------------------------------------------------------

describe('microcopy con numeros concretos', () => {
  it('usa la convencion es-CO (miles con punto, decimales con coma)', () => {
    assert.equal(formatNumber(1234.5, 1), '1.234,5');
    assert.equal(formatNumber(-6.5, 2), '-6,50');
    assert.equal(formatNumber(100000, 0), '100.000');
  });

  it('reproduce el ejemplo del documento (apagar el computador ahorra 1,2 kWh)', () => {
    const ahorro = option('r1:computador:completa').effect.electricidad!;
    assert.equal(ahorro, -1.2);
    assert.equal(describeEffect({ electricidad: -1.2 }), 'Tu decisión ahorró 1,20 kWh.');
  });

  it('describe el sobrecosto y la eficiencia cuando aplican', () => {
    const texto = describeEffect(option('r2:calor:b').effect);
    assert.match(texto, /ahorró 6,00 kWh/);
    assert.match(texto, /costo 3\.300 \$/);
    assert.match(texto, /eficiencia \+4,00%/);
  });
});
