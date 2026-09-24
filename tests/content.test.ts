/** Invariantes del contenido: el balanceo es editable, pero no puede quedar inconsistente. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CASE_CATALOG, TEAM_COLORS, casesForTeamCount } from '../content/cases.ts';
import {
  APPLIANCE_CATALOG,
  APPLIANCE_BY_ID,
  OPTIONS_BY_ID,
  ROUND1_SCENARIOS,
  ROUND2B_SCENARIOS,
  ROUND2_SCENARIOS,
  SCENARIOS_BY_ID,
  findOptionInScenario,
  resolveScenarioForOption,
  scenarioKeyOfOption,
  scenariosForCase,
} from '../content/decisions.ts';
import { TARIFA_ELECTRICIDAD, TARIFA_GAS } from '../content/economy.ts';
import { PHASE_ORDER } from '../content/phases.ts';

const INVERSIONES_VALIDAS = [0, 800, 1200];

/** Compara con tolerancia de 1 peso: los costos se redondean a pesos enteros. */
function esUnaInversion(valor: number): boolean {
  return INVERSIONES_VALIDAS.some((inversion) => Math.abs(Math.abs(valor) - inversion) <= 1);
}

describe('casos de equipo', () => {
  it('hay entre 4 y 6 casos, con al menos los 4 del documento', () => {
    assert.ok(CASE_CATALOG.length >= 4 && CASE_CATALOG.length <= 6);
  });

  it('"Familia Duque" respeta el formato del documento (aparatos y 4 problemas ocultos)', () => {
    const duque = CASE_CATALOG.find((c) => c.name === 'Familia Duque');
    assert.ok(duque, 'debe existir el caso Familia Duque');
    assert.deepEqual(duque.hiddenProblems, [
      'iluminacion',
      'computador',
      'calentador-gas',
      'aire-acondicionado',
    ]);
    for (const appliance of ['nevera', 'televisor', 'computador', 'aire-acondicionado', 'estufa-gas', 'calentador-gas', 'lavadora', 'iluminacion']) {
      assert.ok(duque.appliances.includes(appliance), `Falta ${appliance} en Familia Duque`);
    }
  });

  it('cada caso solo referencia electrodomesticos existentes y problemas ocultos propios', () => {
    for (const caso of CASE_CATALOG) {
      assert.ok(caso.appliances.length > 0, `${caso.id} sin aparatos`);
      for (const id of caso.appliances) {
        assert.ok(APPLIANCE_BY_ID[id], `${caso.id} referencia aparato inexistente: ${id}`);
      }
      for (const problema of caso.hiddenProblems) {
        assert.ok(
          caso.appliances.includes(problema),
          `${caso.id}: problema oculto ${problema} no esta en sus aparatos`,
        );
        assert.ok(APPLIANCE_BY_ID[problema].problemaOculto.length > 0);
      }
    }
  });

  it('cada caso recibe una combinacion distinta de problemas ocultos', () => {
    const firmas = CASE_CATALOG.map((c) => [...c.hiddenProblems].sort().join('|'));
    assert.equal(new Set(firmas).size, firmas.length);
  });

  it('los equipos usan colores unicos de la paleta', () => {
    assert.equal(new Set(TEAM_COLORS).size, TEAM_COLORS.length);
    assert.ok(TEAM_COLORS.length >= CASE_CATALOG.length);
  });

  it('casesForTeamCount respeta el rango 4-6 del documento', () => {
    assert.equal(casesForTeamCount(4).length, 4);
    assert.equal(casesForTeamCount(99).length, CASE_CATALOG.length);
    assert.equal(casesForTeamCount(0).length, CASE_CATALOG.length);
  });
});

describe('catalogo de decisiones', () => {
  it('los ids de opcion son unicos en todo el contenido', () => {
    const ids = Object.values(SCENARIOS_BY_ID).flatMap((s) => s.options.map((o) => o.id));
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, Object.keys(OPTIONS_BY_ID).length);
  });

  it('cada escenario tiene exactamente 3 opciones etiquetadas', () => {
    for (const scenario of Object.values(SCENARIOS_BY_ID)) {
      assert.equal(scenario.options.length, 3, `${scenario.id} no tiene 3 opciones`);
      for (const o of scenario.options) assert.ok(o.label.trim().length > 0);
    }
  });

  it('cubre Ronda 1 (todos los aparatos), Ronda 2 (6 situaciones) y Ronda 2b', () => {
    assert.equal(ROUND1_SCENARIOS.length, APPLIANCE_CATALOG.length);
    assert.ok(ROUND2_SCENARIOS.length >= 6, 'el documento lista nevera, TV, lavadora e iluminacion ademas de A/A y cocina');
    assert.equal(ROUND2B_SCENARIOS.length, 1);
    assert.deepEqual(
      ROUND2_SCENARIOS.map((s) => s.id).sort(),
      ['alumbrado', 'calor', 'cocina', 'entretenimiento', 'lavado', 'nevera'],
    );
  });

  it('la derivacion tarifaria de la Ronda 1 es exacta (costo del consumo neto + inversion)', () => {
    for (const appliance of APPLIANCE_CATALOG) {
      for (const o of appliance.options) {
        const e = o.effect;
        const costoNeto =
          (appliance.referencia.electricidad + (e.electricidad ?? 0)) * TARIFA_ELECTRICIDAD +
          (appliance.referencia.gas + (e.gas ?? 0)) * TARIFA_GAS;
        const delta = -((e.presupuesto ?? 0)) - costoNeto;
        assert.ok(
          esUnaInversion(delta),
          `${o.id}: presupuesto no derivado de las tarifas (residuo ${delta})`,
        );
      }
    }
  });

  it('dentro de cada escenario de Ronda 2 el presupuesto difiere solo por consumo e inversion', () => {
    for (const scenario of [...ROUND2_SCENARIOS, ...ROUND2B_SCENARIOS]) {
      for (const a of scenario.options) {
        for (const b of scenario.options) {
          const residuo =
            -((b.effect.presupuesto ?? 0)) +
            (a.effect.presupuesto ?? 0) -
            ((b.effect.electricidad ?? 0) - (a.effect.electricidad ?? 0)) * TARIFA_ELECTRICIDAD -
            ((b.effect.gas ?? 0) - (a.effect.gas ?? 0)) * TARIFA_GAS;
          assert.ok(
            esUnaInversion(residuo),
            `${scenario.id}: ${a.id} vs ${b.id} inconsistente (residuo ${residuo})`,
          );
        }
      }
    }
  });

  it('ninguna opcion regala dinero: todas cuestan presupuesto', () => {
    for (const o of Object.values(OPTIONS_BY_ID)) {
      assert.ok((o.effect.presupuesto ?? 0) <= 0, `${o.id} suma presupuesto`);
    }
  });

  it('la Ronda 1 no toca eficiencia (el documento dice que no afecta el puntaje directo)', () => {
    for (const scenario of ROUND1_SCENARIOS) {
      for (const o of scenario.options) assert.equal(o.effect.eficiencia, 0, `${o.id} mueve eficiencia`);
    }
  });

  it('en la Ronda 2 cada escenario tiene una opcion equilibrada y ninguna es dominante', () => {
    for (const scenario of ROUND2_SCENARIOS) {
      const suben = scenario.options.filter((o) => (o.effect.eficiencia ?? 0) > 0);
      assert.equal(suben.length, 1, `${scenario.id} deberia tener una sola opcion equilibrada`);
      const mejorConsumo = scenario.options.reduce((best, o) => {
        const costo = (o.effect.electricidad ?? 0) * TARIFA_ELECTRICIDAD + (o.effect.gas ?? 0) * TARIFA_GAS;
        return costo < best.costo ? { id: o.id, costo } : best;
      }, { id: '', costo: Number.POSITIVE_INFINITY });
      assert.notEqual(
        mejorConsumo.id,
        suben[0].id,
        `${scenario.id}: la opcion de mayor ahorro no puede ser tambien la de mejor confort (seria dominante)`,
      );
    }
  });

  it('la Ronda 2b (crisis) si tiene una opcion dominante: es el protocolo de emergencia', () => {
    const [crisis] = ROUND2B_SCENARIOS;
    const [primera] = crisis.options;
    const esLaMasBarata = crisis.options.every(
      (o) => (o.effect.presupuesto ?? 0) <= (primera.effect.presupuesto ?? 0),
    );
    const esLaMasEficiente = crisis.options.every(
      (o) => (o.effect.eficiencia ?? 0) <= (primera.effect.eficiencia ?? 0),
    );
    assert.ok(esLaMasBarata && esLaMasEficiente, 'desconectar no esenciales debe ser la mejor opcion');
    assert.match(primera.id, /desconexion$/);
  });

  it('scenariosForCase limita la Ronda 1 a los aparatos del caso', () => {
    const duque = CASE_CATALOG[0];
    const scenarios = scenariosForCase('investigar', duque.appliances);
    assert.equal(scenarios.length, duque.appliances.length);
    const empresa = CASE_CATALOG.find((c) => c.id === 'empresa-x')!;
    assert.ok(scenariosForCase('investigar', empresa.appliances).length < duque.appliances.length);
    assert.equal(scenariosForCase('decidir', empresa.appliances).length, ROUND2_SCENARIOS.length);
  });

  it('la clave de escenario agrupa las opciones del mismo aparato/situacion', () => {
    assert.equal(scenarioKeyOfOption('r1:nevera:completa'), 'r1:nevera');
    assert.equal(scenarioKeyOfOption('r1:nevera:ninguna'), 'r1:nevera');
    assert.equal(scenarioKeyOfOption('r2:calor:a'), 'r2:calor');
    assert.equal(scenarioKeyOfOption('r2b:crisis-final:minimo'), 'r2b');
  });

  it('el prefijo de cada id de opcion resuelve a su escenario', () => {
    for (const [id, option] of Object.entries(OPTIONS_BY_ID)) {
      const scenario = resolveScenarioForOption(id);
      assert.ok(scenario, `${id} no resuelve a ningun escenario`);
      assert.ok(findOptionInScenario(scenario, id), `${id} no esta dentro de ${scenario.id}`);
      assert.equal(findOptionInScenario(scenario, id), option);
    }
  });

  it('la Ronda 1 solo resuelve para los aparatos del caso consultado', () => {
    const empresa = CASE_CATALOG.find((c) => c.id === 'empresa-x')!;
    assert.ok(resolveScenarioForOption('r1:computador:completa', empresa.id));
    assert.equal(resolveScenarioForOption('r1:estufa-gas:completa', empresa.id), undefined);
    assert.equal(resolveScenarioForOption('r1:computador:completa', 'caso-inexistente'), undefined);
    assert.equal(resolveScenarioForOption('r3:lo-que-sea:a'), undefined);
  });
});

describe('plan de fases', () => {
  it('sigue la secuencia del documento', () => {
    assert.deepEqual(PHASE_ORDER, [
      'lobby',
      'investigar',
      'decidir',
      'crisis',
      'decidir_2',
      'resultados',
    ]);
  });
});
