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
  pesoEficienciaR2,
  scenariosForCase,
} from '../content/decisions.ts';
import { TARIFA_ELECTRICIDAD, TARIFA_GAS, FALLA_APARATO_RATE, SUBSIDIO_SORPRESA, CRISIS_RATE_MAX, CRISIS_RATE_MIN } from '../content/economy.ts';
import { PHASE_ORDER } from '../content/phases.ts';
import { CRISIS_MEASURES, CRISIS_MEASURE_COUNT, crisisMeasuresFor } from '../content/crisis.ts';
import { EVENT_BY_ID, EVENT_CATALOG, instantiateEvent } from '../content/events.ts';
import { drawnScenarios, drawnScenarioIds } from '../engine/draw.ts';
import { sample } from '../engine/rng.ts';

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

  it('cada escenario tiene 3 o 4 opciones etiquetadas', () => {
    for (const scenario of Object.values(SCENARIOS_BY_ID)) {
      assert.ok(
        scenario.options.length === 3 || scenario.options.length === 4,
        `${scenario.id} tiene ${scenario.options.length} opciones`,
      );
      for (const o of scenario.options) assert.ok(o.label.trim().length > 0);
    }
  });

  it('cubre Ronda 1 (todos los aparatos), el pool ampliado de Ronda 2 y Ronda 2b', () => {
    assert.equal(ROUND1_SCENARIOS.length, APPLIANCE_CATALOG.length);
    assert.ok(
      ROUND2_SCENARIOS.length >= 12,
      `el pool de Ronda 2 se amplio (plan 1.1); tiene ${ROUND2_SCENARIOS.length}`,
    );
    // Las seis situaciones del documento siguen en el catalogo: el pool se amplia, no se sustituye.
    for (const id of ['alumbrado', 'calor', 'cocina', 'entretenimiento', 'lavado', 'nevera']) {
      assert.ok(ROUND2_SCENARIOS.some((s) => s.id === id), `falta la situacion ${id}`);
    }
    assert.equal(new Set(ROUND2_SCENARIOS.map((s) => s.id)).size, ROUND2_SCENARIOS.length);
    assert.equal(ROUND2B_SCENARIOS.length, 1);
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
      assert.ok(suben.length >= 1, `${scenario.id} no tiene ninguna opcion equilibrada`);
      // Si hay varias opciones que suben eficiencia (el matiz de 4 opciones del plan 1.2),
      // solo una es la mejor: las demas son un punto intermedio con su propio coste.
      const maximos = scenario.options.filter(
        (o) => (o.effect.eficiencia ?? 0) === Math.max(...scenario.options.map((x) => x.effect.eficiencia ?? 0)),
      );
      assert.equal(maximos.length, 1, `${scenario.id} tiene ${maximos.length} opciones de eficiencia maxima`);
      assert.equal(maximos[0].effect.eficiencia, 4, `${scenario.id}: la equilibrada debe dar +4`);
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

  it('scenariosForCase limita cada ronda a los aparatos del caso', () => {
    const duque = CASE_CATALOG[0];
    const scenarios = scenariosForCase('investigar', duque.appliances);
    assert.equal(scenarios.length, duque.appliances.length);
    const empresa = CASE_CATALOG.find((c) => c.id === 'empresa-x')!;
    assert.ok(scenariosForCase('investigar', empresa.appliances).length < duque.appliances.length);
    // Ronda 2: antes se ofrecia el catalogo completo a todos; ahora solo lo que el caso tiene.
    assert.equal(scenariosForCase('decidir', duque.appliances).length, ROUND2_SCENARIOS.length);
    assert.ok(
      scenariosForCase('decidir', empresa.appliances).length < ROUND2_SCENARIOS.length,
      'empresa-x no tiene lavadora ni estufa: no puede jugar esas situaciones',
    );
    // La crisis es del aula entera: la juegan todos los casos.
    assert.equal(scenariosForCase('decidir_2', empresa.appliances).length, 1);
    assert.equal(scenariosForCase('decidir', null).length, ROUND2_SCENARIOS.length);
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
  it('sigue la secuencia del documento, con la votación del aula dentro de la crisis', () => {
    assert.deepEqual(PHASE_ORDER, [
      'lobby',
      'investigar',
      'decidir',
      'crisis',
      'crisis_votacion',
      'decidir_2',
      'resultados',
    ]);
  });

it('cada caso juega solo las situaciones de Ronda 2 que sus aparatos permiten', () => {
    const todas = scenariosForCase('decidir', null);
    assert.equal(todas.length, ROUND2_SCENARIOS.length);
    for (const caso of CASE_CATALOG) {
      const jugables = scenariosForCase('decidir', caso.appliances);
      assert.ok(jugables.length > 0, `${caso.id} se queda sin situaciones`);
      for (const situacion of jugables) {
        for (const aparato of situacion.requires ?? []) {
          assert.ok(
            caso.appliances.includes(aparato),
            `${caso.id} jugaria ${situacion.id} sin tener ${aparato}`,
          );
        }
      }
      // Lo que se descarta es exactamente lo que menciona un aparato ausente.
      for (const situacion of todas.filter((s) => !jugables.includes(s))) {
        assert.ok(
          (situacion.requires ?? []).some((a) => !caso.appliances.includes(a)),
          `${caso.id} descarta ${situacion.id} sin motivo`,
        );
      }
      // Y el motor rechaza la opcion de una situacion que ese caso no juega.
      const ajena = todas.find((s) => !jugables.includes(s));
      if (ajena) {
        assert.equal(
          resolveScenarioForOption(ajena.options[0].id, caso.id),
          undefined,
          `${caso.id} no deberia poder responder ${ajena.options[0].id}`,
        );
      }
    }
  });

  it('el peso reparte las mismas oportunidades: todo equipo puede ganar 24 en Ronda 2, con cualquier sorteo', () => {
    // Plan 1.1: cada equipo recibe 3 o 4 situaciones sorteadas y el peso se calcula sobre
    // LAS QUE LE TOCARON, asi que el maximo en juego es 24 siempre (y el minimo, comparable).
    for (const caso of CASE_CATALOG) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const sorteadas = drawnScenarios(seed, caso.id);
        assert.ok(
          sorteadas.length >= 3 && sorteadas.length <= 4,
          `${caso.id} (semilla ${seed}): ${sorteadas.length} situaciones`,
        );
        const peso = pesoEficienciaR2(sorteadas.length);
        const maximo = sorteadas.reduce(
          (acc, s) => acc + Math.max(...s.options.map((o) => o.effect.eficiencia ?? 0)) * peso,
          0,
        );
        const minimo = sorteadas.reduce(
          (acc, s) => acc + Math.min(...s.options.map((o) => o.effect.eficiencia ?? 0)) * peso,
          0,
        );
        assert.ok(
          Math.abs(maximo - 24) < 0.01,
          `${caso.id} (semilla ${seed}) puede ganar ${maximo}, deberia ganar 24`,
        );
        // El riesgo a la baja ya no es un unico numero: el sorteo decide QUE situaciones
        // juega el equipo y cada una tiene su propia opcion extrema (-2 a -5 por situacion,
        // escaladas por el peso). El rango honesto es [-30, -12]; lo que SI es igual para
        // todos es el techo (+24, arriba).
        assert.ok(
          minimo <= -12 && minimo >= -30,
          `${caso.id} (semilla ${seed}) puede perder ${minimo}`,
        );
      }
    }
  });
});

describe('crisis variable y medidas colectivas (plan 2.3 y 3)', () => {
  it('hay cuatro medidas, cada una con su severidad y sus textos de aula', () => {
    assert.equal(CRISIS_MEASURES.length, 4);
    assert.equal(new Set(CRISIS_MEASURES.map((m) => m.id)).size, 4);
    assert.equal(new Set(CRISIS_MEASURES.map((m) => m.severity)).size, 4);
    for (const medida of CRISIS_MEASURES) {
      assert.ok(medida.label.trim().length > 0, `${medida.id} sin etiqueta`);
      assert.ok(medida.description.length > 40, `${medida.id} sin explicacion para el aula`);
      assert.ok(medida.severity >= 1 && medida.severity <= 4, `${medida.id} severidad fuera de rango`);
    }
  });

  it('cada partida ofrece tres medidas distintas, ordenadas de la mas suave a la mas severa', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const papeleta = crisisMeasuresFor(seed);
      assert.equal(papeleta.length, CRISIS_MEASURE_COUNT);
      assert.equal(new Set(papeleta.map((m) => m.id)).size, CRISIS_MEASURE_COUNT);
      assert.deepEqual(
        papeleta.map((m) => m.severity),
        [...papeleta.map((m) => m.severity)].sort((a, b) => a - b),
      );
      // Determinista: la misma semilla da siempre la misma papeleta.
      assert.deepEqual(crisisMeasuresFor(seed).map((m) => m.id), papeleta.map((m) => m.id));
      for (const medida of papeleta) assert.ok(CRISIS_MEASURES.includes(medida));
    }
  });

  it('las medidas con inversion propia usan las tarifas, no numeros sueltos', () => {
    // Compra comunitaria: $6.000 por equipo y un recorte porcentual del consumo.
    const compra = CRISIS_MEASURES.find((m) => m.id === 'compra-comunitaria');
    assert.ok(compra);
    assert.equal(compra.effect.presupuesto, -6000);
    assert.ok((compra.effect.electricidadPct ?? 0) < 0, 'debe recortar consumo electrico');
    assert.ok((compra.effect.gasPct ?? 0) < 0, 'debe recortar consumo de gas');
    // Tarifa de emergencia: recargo proporcional a la factura, no un monto fijo.
    const tarifa = CRISIS_MEASURES.find((m) => m.id === 'tarifa-emergencia');
    assert.ok(tarifa);
    assert.equal(tarifa.effect.presupuesto, undefined);
    assert.equal(tarifa.effect.facturaElectricidadPct, 40);
  });

  it('el rango de intensidad de la crisis es el del plan (20-45%) y no incluye el 30% fijo de antes', () => {
    assert.equal(CRISIS_RATE_MIN, 0.2);
    assert.equal(CRISIS_RATE_MAX, 0.45);
  });
});

describe('catalogo de eventos aleatorios (plan 2.2)', () => {
  it('tiene las tres familias del plan, con ids unicos y textos de aula', () => {
    assert.equal(EVENT_CATALOG.length, 3);
    assert.equal(new Set(EVENT_CATALOG.map((e) => e.id)).size, 3);
    assert.deepEqual(
      EVENT_CATALOG.map((e) => e.kind).sort(),
      ['fault', 'lock', 'subsidy'],
    );
    for (const evento of EVENT_CATALOG) {
      assert.ok(evento.title.trim().length > 0);
      assert.ok(evento.description('Nevera No-Frost').length > 20, `${evento.id} sin texto`);
      assert.ok(EVENT_BY_ID[evento.id] === evento);
    }
  });

  it('el subsidio reparte el presupuesto de la economia y no toca el consumo', () => {
    const subsidio = instantiateEvent(EVENT_BY_ID['subsidio-sorpresa'], null);
    assert.equal(subsidio.effect.presupuesto, SUBSIDIO_SORPRESA);
    assert.equal(subsidio.effect.electricidad, undefined);
    assert.equal(subsidio.effect.gas, undefined);
  });

  it('el apagon parcial no cobra nada: solo bloquea el aparato', () => {
    const apagon = instantiateEvent(EVENT_BY_ID['apagon-parcial'], APPLIANCE_BY_ID['nevera']);
    assert.equal(apagon.applianceId, 'nevera');
    assert.deepEqual(apagon.effect, {});
    assert.match(apagon.description, /nevera/i);
  });

  it('la falla de aparato cobra el 20% del consumo de referencia, en consumo y en dinero', () => {
    for (const appliance of APPLIANCE_CATALOG) {
      const falla = instantiateEvent(EVENT_BY_ID['falla-de-aparato'], appliance);
      const esperadoE = Math.round(appliance.referencia.electricidad * FALLA_APARATO_RATE * 100) / 100;
      const esperadoG = Math.round(appliance.referencia.gas * FALLA_APARATO_RATE * 100) / 100;
      assert.equal(falla.effect.electricidad, esperadoE, `${appliance.id} electricidad`);
      assert.equal(falla.effect.gas, esperadoG, `${appliance.id} gas`);
      assert.equal(
        falla.effect.presupuesto,
        -Math.round(esperadoE * TARIFA_ELECTRICIDAD + esperadoG * TARIFA_GAS),
        `${appliance.id} costo`,
      );
    }
  });
});
