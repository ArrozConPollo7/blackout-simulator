"use strict";

/**
 * Pruebas de la aritmética del juego contra "Juego - NFI.md".
 * Ejecutar: node --test tests/
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../src/shared/rules.js");

/** Semilla fija de las pruebas: los sorteos son reproducibles. */
const DOC_SEED = 0x5eed1234;

/**
 * Sala de pruebas. Por defecto SIN incidentes: estas pruebas verifican la
 * aritmética del documento §3-§7, que no depende del azar. La semilla se fija
 * para que el sorteo (cuando se activa) sea reproducible.
 */
function makeRoom(districts = 4, { claimed = true, incidents = false, seed = DOC_SEED } = {}) {
  const room = rules.createRoom("TEST", { seed, incidents });
  for (let i = 0; i < districts; i += 1) {
    const district = rules.DISTRICTS[i];
    const team = rules.createDistrictTeam({
      id: `district-${district.id}`,
      districtId: district.id,
      operator: `MESA ${i + 1}`,
      claimed,
    });
    room.teams[team.id] = team;
  }
  rules.recomputeDerived(room);
  return room;
}

function turnOff(room, indexes, sector) {
  const teams = Object.values(room.teams);
  for (const index of indexes) {
    teams[index].sectors[sector] = false;
  }
  rules.recomputeDerived(room);
}

test("tabla de sectores coincide con el documento §3", () => {
  const { industry, residential, critical } = rules.SECTOR_SPECS;

  assert.equal(industry.demandMW, 180);
  assert.equal(industry.demandGas, 400);
  assert.equal(industry.revenueOn, 3000);
  assert.equal(industry.revenueOff, -1000);
  assert.equal(industry.welfareOff, 0);

  assert.equal(residential.demandMW, 120);
  assert.equal(residential.demandGas, 250);
  assert.equal(residential.gridFee, -500);
  assert.equal(residential.welfareOff, -150);

  assert.equal(critical.demandMW, 60);
  assert.equal(critical.demandGas, 100);
  assert.equal(critical.gridFee, -300);
  assert.equal(critical.welfareOff, -450);
});

test("demanda base por distrito y por panel de 4 distritos", () => {
  assert.equal(rules.BASE_DEMAND_MW_PER_DISTRICT, 360);
  assert.equal(rules.BASE_DEMAND_GAS_PER_DISTRICT, 750);

  const room = makeRoom(4);
  assert.equal(room.demand.mw, 1440);
  assert.equal(room.demand.gas, 3000);

  const capacity = rules.regionalCapacity(4, null);
  assert.equal(capacity.maxMW, 1440);
  assert.equal(capacity.maxGas, 3000);
});

test("multiplicadores de crisis del documento §6", () => {
  const [r1, r2, r3, r4] = rules.CRISIS_PRESETS;

  assert.equal(r1.gasMultiplier, 0.8);
  assert.equal(r1.electricMultiplier, 1);
  assert.equal(rules.regionalCapacity(4, r1).maxGas, 2400);
  assert.equal(rules.regionalCapacity(4, r1).maxMW, 1440);

  assert.equal(r2.electricMultiplier, 0.65);
  assert.equal(rules.regionalCapacity(4, r2).maxMW, 936);
  assert.equal(rules.regionalCapacity(4, r2).maxGas, 3000);

  assert.equal(r3.residentialDemandMultiplier, 2);
  const doubled = rules.districtDemand(rules.emptySectors(true), r3);
  assert.equal(doubled.mw, 360 + 120);
  assert.equal(doubled.gas, 750 + 250);

  assert.equal(r4.electricMultiplier, 0.5);
  assert.equal(r4.gasMultiplier, 0.5);
  assert.equal(rules.regionalCapacity(4, r4).maxMW, 720);
  assert.equal(rules.regionalCapacity(4, r4).maxGas, 1500);
});

test("ronda 1: sin ceder carga hay BLACKOUT por gas", () => {
  const room = makeRoom(4);
  rules.startRound(room, 1);

  // La ronda se prepara sin reloj: el anfitrión lo abre cuando quiera.
  assert.equal(room.phase, "PLANNING");
  assert.equal(room.timeRemaining, 0);
  assert.equal(room.deadlineTs, null);
  assert.equal(room.timerRunning, false);

  rules.beginRound(room);
  assert.equal(room.phase, "CRISIS_ANNOUNCE");
  assert.equal(room.timeRemaining, 10);
  assert.equal(room.capacity.maxMW, 1440);
  assert.equal(room.capacity.maxGas, 2400);

  const result = rules.resolveRound(room);

  assert.equal(result.outcome, "BLACKOUT");
  assert.equal(result.cause, "GAS");
  assert.equal(result.totalMW, 1440);
  assert.equal(result.totalGas, 3000);
  assert.equal(room.blackoutCount, 1);
  assert.equal(result.irreversible, false);
  assert.equal(room.phase, "RESOLUTION");

  const team = result.teamResults[0];
  assert.equal(team.welfareDelta, rules.BLACKOUT_WELFARE_HIT);
  assert.equal(team.welfareAfter, 700);
  // Ingresos industriales anulados ($0) + gastos fijos de red residencial y crítica
  assert.equal(team.budgetDelta, -800);
  assert.equal(team.budgetAfter, 9200);
});

test("ronda 1: apagar 2 industrias salva la red (tutorial del documento)", () => {
  const room = makeRoom(4);
  rules.startRound(room, 1);
  turnOff(room, [0, 1], "industry");

  const result = rules.resolveRound(room);

  assert.equal(result.outcome, "STABLE");
  assert.equal(result.totalMW, 1080);
  assert.equal(result.totalGas, 2200);
  assert.equal(result.marginGas, 200);

  // Distritos con industria encendida: +3.000 - 500 - 300 = +2.200
  const onTeam = result.teamResults[2];
  assert.equal(onTeam.welfareDelta, 100);
  assert.equal(onTeam.budgetDelta, 2200);
  assert.equal(onTeam.budgetAfter, 12200);
  assert.equal(onTeam.welfareAfter, 1100);

  // Distritos con industria apagada: -1.000 - 500 - 300 = -1.800
  const offTeam = result.teamResults[0];
  assert.equal(offTeam.welfareDelta, 100);
  assert.equal(offTeam.budgetDelta, -1800);
  assert.equal(offTeam.budgetAfter, 8200);
});

test("cortes civiles: penalizaciones de Bienestar y distrito mártir acumulado", () => {
  const room = makeRoom(4);
  rules.startRound(room, 1);
  turnOff(room, [0, 1], "industry");
  turnOff(room, [0, 1], "residential");
  turnOff(room, [0], "critical");

  const result = rules.resolveRound(room);
  assert.equal(result.outcome, "STABLE");

  const martyr = result.teamResults[0];
  // +100 estable -150 residencial -450 crítico
  assert.equal(martyr.welfareDelta, -500);
  assert.equal(martyr.welfareAfter, 500);
  assert.equal(room.teams["district-D-01"].welfareSacrificed, 600);

  const residentialOnly = result.teamResults[1];
  assert.equal(residentialOnly.welfareDelta, -50);
  assert.equal(room.teams["district-D-02"].welfareSacrificed, 150);

  const untouched = result.teamResults[3];
  assert.equal(untouched.welfareDelta, 100);
  assert.equal(room.teams["district-D-04"].welfareSacrificed, 0);
});

test("blackout penaliza también los cortes civiles previos", () => {
  const room = makeRoom(4);
  rules.startRound(room, 2); // déficit eléctrico: 936 MW de techo
  turnOff(room, [0], "industry");
  turnOff(room, [0], "residential");
  turnOff(room, [0], "critical");

  const result = rules.resolveRound(room);
  assert.equal(result.outcome, "BLACKOUT");
  assert.equal(result.cause, "ELECTRICIDAD");

  const team = result.teamResults[0];
  // -300 apagón -150 residencial -450 crítico
  assert.equal(team.welfareDelta, -900);
  assert.equal(team.welfareAfter, 100);
  // -1.000 paro técnico -500 red residencial -300 red crítica
  assert.equal(team.budgetDelta, -1800);
  assert.equal(team.budgetAfter, 8200);
});

test("ronda 2: el déficit eléctrico obliga a ceder al menos el 60% de las industrias", () => {
  const room = makeRoom(4);
  rules.startRound(room, 2);
  assert.equal(room.capacity.maxMW, 936);

  // 2 industrias apagadas no alcanzan
  turnOff(room, [0, 1], "industry");
  assert.equal(rules.resolveRound(room).outcome, "BLACKOUT");

  // 3 industrias apagadas sí (75% del panel)
  const room2 = makeRoom(4);
  rules.startRound(room2, 2);
  turnOff(room2, [0, 1, 2], "industry");
  const result = rules.resolveRound(room2);
  assert.equal(result.outcome, "STABLE");
  assert.equal(result.totalMW, 900);
  assert.equal(result.totalGas, 1800);
});

test("ronda 3: la demanda residencial se duplica (+120 MW / +250 m3 por distrito)", () => {
  const room = makeRoom(4);
  rules.startRound(room, 3);

  assert.equal(room.demand.mw, 1920);
  assert.equal(room.demand.gas, 4000);
  assert.equal(room.capacity.maxMW, 1440);
  assert.equal(room.capacity.maxGas, 3000);

  turnOff(room, [0, 1, 2], "industry");
  const result = rules.resolveRound(room);
  assert.equal(result.outcome, "STABLE");
  assert.equal(result.totalMW, 1380);
  assert.equal(result.totalGas, 2800);
});

test("ronda 4: con todo apagado la red queda exactamente en el límite", () => {
  const room = makeRoom(4);
  rules.startRound(room, 4);
  turnOff(room, [0, 1, 2, 3], "industry");

  const result = rules.resolveRound(room);
  assert.equal(result.outcome, "STABLE");
  assert.equal(result.totalMW, 720);
  assert.equal(result.capacityMW, 720);
  assert.equal(result.marginMW, 0);
  assert.equal(result.totalGas, 1400);

  // Un solo distrito que vuelva a encender su industria provoca el colapso
  const room2 = makeRoom(4);
  rules.startRound(room2, 4);
  turnOff(room2, [0, 1, 2, 3], "industry");
  Object.values(room2.teams)[0].sectors.industry = true;
  rules.recomputeDerived(room2);
  const second = rules.resolveRound(room2);
  assert.equal(second.outcome, "BLACKOUT");
  assert.equal(second.cause, "AMBAS"); // el MW y el gas se salen del techo a la vez
});

test("dos apagones provocan fallo regional irreversible sin ganadores", () => {
  const room = makeRoom(4);

  rules.startRound(room, 1);
  assert.equal(rules.resolveRound(room).outcome, "BLACKOUT");
  assert.equal(room.phase, "RESOLUTION");

  rules.startRound(room, 2);
  const second = rules.resolveRound(room);
  assert.equal(second.outcome, "BLACKOUT");
  assert.equal(room.blackoutCount, 2);
  assert.equal(room.phase, "GAME_OVER");
  assert.equal(room.finalResults.irreversible, true);
  assert.equal(room.finalResults.mentions.exemplary, null);
  assert.equal(room.finalResults.mentions.martyr, null);
  assert.equal(room.finalResults.mentions.parasite, null);
});

test("PEF = Bienestar + (Tesorería / 100) y menciones finales", () => {
  const room = makeRoom(4, { claimed: true });
  room.currentRound = 4;

  const teams = Object.values(room.teams);
  teams[0].welfare = 950;
  teams[0].budget = 8200; // PEF 1032
  teams[1].welfare = 1100;
  teams[1].budget = 12200; // PEF 1222
  teams[2].welfare = 900;
  teams[2].budget = 5000; // PEF 950
  teams[3].welfare = 1000;
  teams[3].budget = 10000; // PEF 1100

  teams[0].welfareSacrificed = 600;
  teams[0].industryRoundsOn = 0;
  teams[1].welfareSacrificed = 0;
  teams[1].industryRoundsOn = 4;
  teams[2].welfareSacrificed = 150;
  teams[2].industryRoundsOn = 2;
  teams[3].welfareSacrificed = 0;
  teams[3].industryRoundsOn = 1;

  assert.equal(rules.efficiencyScore(teams[0]), 1032);
  assert.equal(rules.efficiencyScore(teams[1]), 1222);

  const finals = rules.finalResults(room, { irreversible: false });

  assert.equal(finals.ranking[0].teamId, teams[1].id);
  assert.equal(finals.ranking[0].pef, 1222);
  assert.equal(finals.mentions.exemplary, teams[1].id);
  assert.equal(finals.mentions.martyr, teams[0].id);
  assert.equal(finals.mentions.parasite, teams[1].id);
});

test("el Bienestar se mantiene en el rango 0..1200", () => {
  const room = makeRoom(4);
  for (const team of Object.values(room.teams)) {
    team.welfare = 1190;
  }

  rules.startRound(room, 1);
  turnOff(room, [0, 1], "industry");
  rules.resolveRound(room);

  for (const team of Object.values(room.teams)) {
    assert.ok(team.welfare <= rules.MAX_WELFARE);
    assert.ok(team.welfare >= rules.MIN_WELFARE);
  }

  const room2 = makeRoom(4);
  for (const team of Object.values(room2.teams)) {
    team.welfare = 200;
  }
  rules.startRound(room2, 1);
  turnOff(room2, [0], "critical");
  turnOff(room2, [0], "residential");
  turnOff(room2, [1, 2], "industry");
  rules.resolveRound(room2);
  assert.equal(Object.values(room2.teams)[0].welfare, 0);
});

test("no se puede bajar de cero en tesorería", () => {
  const room = makeRoom(4);
  for (const team of Object.values(room.teams)) {
    team.budget = 500;
  }
  rules.startRound(room, 1);
  turnOff(room, [0, 1], "industry");
  rules.resolveRound(room);

  for (const team of Object.values(room.teams)) {
    assert.ok(team.budget >= 0);
  }
});

test("la capacidad escala con el número de distritos del panel", () => {
  for (const n of [3, 4, 5, 6]) {
    const capacity = rules.regionalCapacity(n, rules.CRISIS_PRESETS[3]);
    assert.equal(capacity.maxMW, Math.round(360 * n * 0.5));
    assert.equal(capacity.maxGas, Math.round(750 * n * 0.5));
  }
});

test("cada ronda rearma las palancas al 100%", () => {
  const room = makeRoom(4);
  rules.startRound(room, 1);
  turnOff(room, [0, 1], "industry");
  rules.resolveRound(room);

  assert.equal(Object.values(room.teams)[0].sectors.industry, false);

  rules.startRound(room, 2);
  for (const team of Object.values(room.teams)) {
    assert.deepEqual(team.sectors, { industry: true, residential: true, critical: true });
  }
});

test("fases del ciclo de ronda", () => {
  const room = makeRoom(4);

  assert.equal(room.phase, "LOBBY");
  const crisis = rules.startRound(room, 1);
  assert.equal(crisis.round, 1);
  assert.equal(room.phase, "PLANNING");
  assert.equal(room.timerRunning, false);
  assert.equal(room.deadlineTs, null);

  rules.beginRound(room);
  assert.equal(room.phase, "CRISIS_ANNOUNCE");
  assert.equal(room.timeRemaining, rules.ANNOUNCE_SECONDS);
  assert.equal(room.timerRunning, true);

  rules.openNegotiation(room);
  assert.equal(room.phase, "CRISIS_ACTIVE");
  assert.equal(room.timeRemaining, rules.NEGOTIATION_SECONDS);

  rules.resolveRound(room);
  assert.equal(room.timerRunning, false);
  assert.equal(room.phase, "RESOLUTION");
  assert.equal(room.lastResolution.round, 1);
});
// ---------------------------------------------------------------------------
// Incidentes aleatorios (variación de ronda)
// ---------------------------------------------------------------------------

/** Producto de los multiplicadores de capacidad/demanda de los incidentes. */
function incidentProduct(incidents, path) {
  return incidents.reduce((acc, incident) => {
    const value = path(incident.effects || {});
    return acc * (value === undefined ? 1 : value);
  }, 1);
}

/** Demanda esperada del panel completo (todos los sectores encendidos). */
function expectedFullDemand(room, n) {
  const crisis = room.activeCrisis;
  const ind = incidentProduct(room.incidents, (e) => (e.demand || {}).industry);
  const res = incidentProduct(room.incidents, (e) => (e.demand || {}).residential);
  const crit = incidentProduct(room.incidents, (e) => (e.demand || {}).critical);
  const resCrisis = crisis.residentialDemandMultiplier || 1;

  return {
    mw: n * Math.round(180 * ind + 120 * res * resCrisis + 60 * crit),
    gas: n * Math.round(400 * ind + 250 * res * resCrisis + 100 * crit),
  };
}

test("el pool de incidentes tiene las cinco familias y severidades crecientes", () => {
  const families = new Set(rules.INCIDENT_POOL.map((i) => i.family));

  assert.deepEqual([...families].sort(), ["boost", "capacity", "demand", "economy", "lock"]);
  assert.ok(rules.INCIDENT_POOL.length >= 15);

  for (const incident of rules.INCIDENT_POOL) {
    assert.ok([1, 2, 3].includes(incident.severity), `severidad inválida en ${incident.id}`);
    assert.ok(incident.minRound >= 2, `${incident.id} no puede salir en la ronda tutorial`);
    const effects = rules.incidentEffects(incident);
    // Solo se bloquean cargas críticas: el salón siempre conserva una palanca
    // para repartirse el recorte.
    for (const key of effects.lockSectors) {
      assert.equal(key, "critical", `${incident.id} bloquea ${key} y rompe la resolubilidad`);
    }
  }
});

test("la ronda 1 es tutorial: nunca sortea incidentes", () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const room = makeRoom(4, { incidents: true, seed });
    rules.startRound(room, 1);
    assert.deepEqual(room.incidents, []);
    assert.deepEqual(room.lockedSectors, { industry: false, residential: false, critical: false });
  }
});

test("el sorteo es reproducible por semilla y no repite incidentes en la partida", () => {
  const scriptOf = (seed) => {
    const room = makeRoom(4, { incidents: true, seed });
    const rounds = [];
    for (let round = 1; round <= 4; round += 1) {
      rules.startRound(room, round);
      rounds.push(room.incidents.map((i) => i.id));
      rules.resolveRound(room);
    }
    return { rounds, used: room.usedIncidentIds };
  };

  const first = scriptOf(1234);
  const again = scriptOf(1234);
  assert.deepEqual(first, again, "la misma semilla debe jugar el mismo guion");

  assert.equal(first.rounds[1].length, 1, "ronda 2: un incidente");
  assert.equal(first.rounds[2].length, 1, "ronda 3: un incidente");
  assert.equal(first.rounds[3].length, 2, "ronda 4: dos incidentes");

  const flat = first.rounds.flat();
  assert.equal(new Set(flat).size, flat.length, "un incidente no se repite en la partida");
  assert.equal(flat.length, 4);

  // Y con otra semilla el guion cambia.
  const other = scriptOf(987654);
  assert.notDeepEqual(other.rounds, first.rounds);
});

test("los incidentes entran en el techo y en la demanda con la crisis vigente", () => {
  const room = makeRoom(4, { incidents: true, seed: 777 });
  rules.startRound(room, 2);

  assert.ok(room.incidents.length > 0);

  const n = Object.keys(room.teams).length;
  const electric = incidentProduct(room.incidents, (e) => e.electricMultiplier);
  const gas = incidentProduct(room.incidents, (e) => e.gasMultiplier);
  const crisis = room.activeCrisis;

  assert.equal(room.capacity.maxMW, Math.round(360 * n * crisis.electricMultiplier * electric));
  assert.equal(room.capacity.maxGas, Math.round(750 * n * crisis.gasMultiplier * gas));
  assert.equal(room.capacity.electricMultiplier, Math.round(crisis.electricMultiplier * electric * 100) / 100);

  const expected = expectedFullDemand(room, n);
  assert.equal(room.demand.mw, expected.mw);
  assert.equal(room.demand.gas, expected.gas);
});

test("un incidente de bloqueo impide cortar servicios críticos y deja las palancas encendidas", () => {
  const room = makeRoom(4, { incidents: true, seed: 4242 });
  rules.startRound(room, 3);
  room.incidents = [rules.incidentById("inc-cuarentena")];
  room.lockedSectors = rules.emptyLockedSectors();
  for (const key of rules.incidentMultipliers(room.incidents).lockSectors) room.lockedSectors[key] = true;
  room.capacity = rules.regionalCapacity(4, room.activeCrisis, room.incidents);

  assert.equal(rules.isSectorLocked(room, "critical"), true);
  assert.equal(rules.isSectorLocked(room, "industry"), false);
  assert.equal(rules.isSectorLocked(room, "residential"), false);
  assert.equal(rules.incidentTags(room.incidents[0]).includes("SERVICIOS CRÍTICOS BLOQUEADA"), true);

  // El bloqueo no toca la aritmética: solo restringe lo que se puede apagar.
  const before = room.demand.mw;
  const teams = Object.values(room.teams);
  for (const team of teams) team.sectors.industry = false;
  rules.recomputeDerived(room);
  assert.ok(room.demand.mw < before);
});

test("la economía de los incidentes se cobra en la resolución", () => {
  // HUELGA: -$400 a todos y -$400 extra si hay apagón.
  const room = makeRoom(4, { incidents: true, seed: 99 });
  rules.startRound(room, 2);
  room.incidents = [rules.incidentById("inc-huelga")];
  room.capacity = rules.regionalCapacity(4, room.activeCrisis, room.incidents);

  const result = rules.resolveRound(room);
  const team = result.teamResults[0];

  assert.equal(result.outcome, "BLACKOUT");
  assert.equal(team.welfareDelta, rules.BLACKOUT_WELFARE_HIT);
  // Apagón: ingresos industriales anulados ($0) + -500 red residencial + -300 red
  // crítica + -400 del incidente + -400 extra del incidente por apagón.
  assert.equal(team.budgetDelta, -1600);

  // SUBSIDIO: +$800 y sin golpe extra (red estable).
  const room2 = makeRoom(4, { incidents: true, seed: 99 });
  rules.startRound(room2, 2);
  room2.incidents = [rules.incidentById("inc-subsidio"), rules.incidentById("inc-trasvase")];
  room2.capacity = rules.regionalCapacity(4, room2.activeCrisis, room2.incidents);
  for (const t of Object.values(room2.teams)) {
    t.sectors = { industry: false, residential: true, critical: true };
  }
  rules.recomputeDerived(room2);
  const stable = rules.resolveRound(room2);

  assert.equal(stable.outcome, "STABLE");
  const stableTeam = stable.teamResults[0];
  assert.equal(stableTeam.welfareDelta, rules.STABLE_WELFARE_BONUS);
  // -1.000 paro + -500 + -300 + 800 del subsidio
  assert.equal(stableTeam.budgetDelta, -1000);
  assert.equal(stable.incidents.length, 2);
});

test("ningún sorteo hace la ronda irresoluble ni perdona al que no toca nada", () => {
  const pool = rules.INCIDENT_POOL;

  /** Mejor corte posible: los distritos son simétricos, basta evaluar 8 subconjuntos. */
  function feasibleCuts(crisis, incidents, n) {
    const locks = rules.incidentMultipliers(incidents).lockSectors;
    const cap = rules.regionalCapacity(n, crisis, incidents);
    const cuts = [];

    for (let mask = 0; mask < 8; mask += 1) {
      const sectors = { industry: !!(mask & 1), residential: !!(mask & 2), critical: !!(mask & 4) };
      if (locks.some((key) => !sectors[key])) continue;
      const demand = rules.districtDemand(sectors, crisis, incidents);
      if (demand.mw * n <= cap.maxMW && demand.gas * n <= cap.maxGas) {
        cuts.push({ sectors, mw: demand.mw * n, gas: demand.gas * n });
      }
    }

    return { cap, cuts };
  }

  const combos = [];
  for (const incident of pool) combos.push([incident]);
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      // El sorteo real nunca repite familia en la misma ronda.
      if (pool[i].family !== pool[j].family) combos.push([pool[i], pool[j]]);
    }
  }

  let checked = 0;
  for (const round of [1, 2, 3, 4]) {
    const crisis = rules.crisisForRound(round);
    for (const n of [3, 4, 5, 6]) {
      const usable = crisis ? combos : [];
      for (const incidents of usable) {
        const { cap, cuts } = feasibleCuts(crisis, incidents, n);
        const full = rules.districtDemand(rules.emptySectors(true), crisis, incidents);

        // 1) La red arranca sin margen: no decidir nada siempre es un apagón.
        assert.ok(
          full.mw * n > cap.maxMW || full.gas * n > cap.maxGas,
          `ronda ${round}, ${n} distritos, ${incidents.map((i) => i.id)}: no tocar nada salvaba la red`
        );

        // 2) Siempre existe un reparto que salva la red.
        assert.ok(
          cuts.length > 0,
          `ronda ${round}, ${n} distritos, ${incidents.map((i) => i.id)}: ronda irresoluble`
        );

        checked += 1;
      }
    }
  }

  assert.ok(checked > 400, `se esperaban cientos de combinaciones, se revisaron ${checked}`);
});

// ---------------------------------------------------------------------------
// Ritmo de la ronda: planificación, pausa y tiempo extra
// ---------------------------------------------------------------------------

test("la ronda se abre en planificación: el reloj no corre hasta que el anfitrión lo abre", () => {
  const room = makeRoom(4);
  rules.startRound(room, 2);

  assert.equal(room.phase, "PLANNING");
  assert.equal(room.deadlineTs, null);
  assert.equal(room.timerRunning, false);
  assert.equal(room.paused, false);
  assert.equal(rules.remainingSeconds(room), 0);

  rules.beginRound(room);
  assert.equal(room.phase, "CRISIS_ANNOUNCE");
  assert.equal(room.timeRemaining, room.announceSeconds);
  assert.ok(room.deadlineTs > Date.now());
});

test("pausar congela el reloj, +30 s se acumula y reanudar reprograma la fecha límite", () => {
  const room = makeRoom(4);
  rules.startRound(room, 2);
  rules.beginRound(room);

  room.timeRemaining = 7; // queda poco: pausa para la discusión
  room.deadlineTs = Date.now() + 7000;

  assert.equal(rules.pauseClock(room), true);
  assert.equal(room.paused, true);
  assert.equal(room.deadlineTs, null);
  assert.equal(room.timeRemaining, 7);
  assert.equal(rules.remainingSeconds(room), 7, "el cliente dibuja el valor congelado");
  assert.equal(rules.pauseClock(room), false, "no se puede pausar dos veces");

  assert.equal(rules.addTime(room, 30), true);
  assert.equal(room.timeRemaining, 37);
  assert.equal(room.deadlineTs, null, "sumar tiempo no reanuda el reloj");

  assert.equal(rules.resumeClock(room), true);
  assert.equal(room.paused, false);
  const restante = Math.round((room.deadlineTs - Date.now()) / 1000);
  assert.ok(restante >= 36 && restante <= 37, `reanudó con ${restante}s`);
  assert.equal(rules.resumeClock(room), false, "no reanuda si no estaba pausado");
});

test("+30 s solo aplica a las fases con reloj", () => {
  const room = makeRoom(4);
  rules.startRound(room, 2);
  assert.equal(rules.addTime(room, 30), false, "en planificación no hay reloj que sumar");

  rules.beginRound(room);
  room.timeRemaining = 5;
  room.deadlineTs = Date.now() + 5000;
  assert.equal(rules.addTime(room, 30), true);
  assert.equal(room.timeRemaining, 35);
  assert.ok(Math.round((room.deadlineTs - Date.now()) / 1000) >= 34);

  rules.openNegotiation(room);
  assert.equal(room.timeRemaining, rules.NEGOTIATION_SECONDS, "la negociación arranca con su tiempo completo");
  assert.equal(rules.addTime(room, rules.EXTRA_SECONDS), true);
  assert.equal(room.timeRemaining, rules.NEGOTIATION_SECONDS + rules.EXTRA_SECONDS);
});

test("la negociación quita la pausa y la resolución deja el reloj limpio", () => {
  const room = makeRoom(4);
  rules.startRound(room, 2);
  rules.beginRound(room);
  rules.pauseClock(room);

  rules.openNegotiation(room);
  assert.equal(room.paused, false);
  assert.equal(room.phase, "CRISIS_ACTIVE");

  rules.resolveRound(room);
  assert.equal(room.timerRunning, false);
  assert.equal(room.deadlineTs, null);
  assert.equal(room.paused, false);
});
