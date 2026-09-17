"use strict";

/**
 * Pruebas de la aritmética del juego contra "Juego - NFI.md".
 * Ejecutar: node --test tests/
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../src/shared/rules.js");

function makeRoom(districts = 4, { claimed = true } = {}) {
  const room = rules.createRoom("TEST");
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
