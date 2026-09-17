#!/usr/bin/env node
"use strict";

/**
 * Partida de referencia sin interfaz: juega las 4 rondas con el MISMO motor que
 * usan el servidor Node y el Durable Object, aplicando una estrategia sencilla
 * y explicable (la que se espera de un salón que se coordina):
 *
 *   1. Anota el techo de la ronda (crisis x incidentes).
 *   2. Recorta industria primero y, si aún no cabe, zona residencial.
 *   3. Nunca corta servicios críticos si puede evitarlo.
 *   4. Los distritos se reparten el recorte de forma pareja (todos ceden lo
 *      mismo), respetando las palancas bloqueadas por incidentes.
 *
 * Uso:
 *   node scripts/reference-game.js                 # semilla al azar, 4 distritos
 *   node scripts/reference-game.js --seed 4200     # partida reproducible
 *   node scripts/reference-game.js --districts 6 --seed 7 --verbose
 *
 * Sirve para tres cosas: enseñar números reales en el manual, comprobar que una
 * ronda tiene salida antes de clase y probar el balance con muchas semillas
 * (`--scan 500`).
 */

const rules = require("../src/shared/rules.js");

function parseArgs(argv) {
  const args = { seed: null, districts: 4, verbose: false, scan: 0, rounds: rules.TOTAL_ROUNDS };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--verbose" || key === "-v") args.verbose = true;
    else if (key === "--seed") args.seed = Number(argv[++i]);
    else if (key === "--districts") args.districts = Number(argv[++i]);
    else if (key === "--scan") args.scan = Number(argv[++i]);
    else if (key === "--rounds") args.rounds = Number(argv[++i]);
  }
  return args;
}

function buildRoom(districts, seed) {
  const room = rules.createRoom("REFS", { seed });
  for (const district of rules.DISTRICTS.slice(0, districts)) {
    const team = rules.createDistrictTeam({
      id: `district-${district.id}`,
      districtId: district.id,
      operator: `MESA ${district.id.slice(-2)}`,
      claimed: true,
    });
    room.teams[team.id] = team;
  }
  rules.recomputeDerived(room);
  return room;
}

/** Reparto simétrico: los N distritos apagan el mismo conjunto de sectores. */
function cutPlan(sectors) {
  return { ...sectors };
}

/**
 * Busca el corte más suave que salva la red: primero sin tocar lo civil, luego
 * apagando industria, después residencial. Los críticos solo caen si no queda
 * ninguna otra opción (y nunca si un incidente los bloquea).
 */
function chooseCut(room) {
  const crisis = room.activeCrisis;
  const incidents = room.incidents;
  const n = rules.districtCount(room);
  const cap = rules.regionalCapacity(n, crisis, incidents);
  const locks = rules.incidentMultipliers(incidents).lockSectors;

  const candidates = [];
  for (let mask = 0; mask < 8; mask += 1) {
    const sectors = { industry: !!(mask & 1), residential: !!(mask & 2), critical: !!(mask & 4) };
    if (locks.some((key) => !sectors[key])) continue;
    const demand = rules.districtDemand(sectors, crisis, incidents);
    const fits = demand.mw * n <= cap.maxMW && demand.gas * n <= cap.maxGas;
    // Preferencia: conservar críticos > conservar residencial > conservar industria.
    const civilScore = (sectors.critical ? 400 : 0) + (sectors.residential ? 200 : 0);
    candidates.push({ sectors, demand, fits, civilScore, liveSectors: Object.values(sectors).filter(Boolean).length });
  }

  const fitting = candidates.filter((c) => c.fits).sort((a, b) => b.civilScore - a.civilScore || b.liveSectors - a.liveSectors);
  return fitting[0] || null;
}

function playGame({ seed, districts, verbose }) {
  const room = buildRoom(districts, seed);
  const n = districts;
  const lines = [];
  const log = (text) => {
    lines.push(text);
    if (verbose) console.log(text);
  };

  log(`PARTIDA DE REFERENCIA // semilla ${seed} // ${n} distritos // ${rules.VERSION}`);
  log(`Capacidad base del panel: ${360 * n} MW y ${750 * n} m3 (igual a la demanda base)`);

  let survived = true;

  for (let round = 1; round <= room.totalRounds; round += 1) {
    const crisis = rules.startRound(room, round);
    const incidentNames = room.incidents.map((i) => i.name).join(" + ") || "sin incidentes";
    const cap = room.capacity;

    log("");
    log(`=== RONDA ${round} // ${crisis.name} (${crisis.tagline}) ===`);
    log(`  incidentes: ${incidentNames}`);
    for (const incident of room.incidents) {
      log(`    - ${incident.name}: ${rules.incidentTags(incident).join(" · ")}`);
    }
    log(
      `  techo: ${cap.maxMW} MW (x${cap.electricMultiplier}) / ${cap.maxGas} m3 (x${cap.gasMultiplier})`
    );
    log(`  demanda si nadie cede: ${room.demand.mw} MW / ${room.demand.gas} m3`);

    const plan = chooseCut(room);

    if (!plan) {
      log("  NO HAY CORTE POSIBLE: la ronda es irresoluble (no debería pasar)");
      return { lines, room, survived: false, plan: null };
    }

    const perDistrict = plan.demand;
    log(
      `  plan: cada distrito apaga [${Object.entries(plan.sectors)
        .filter(([, on]) => !on)
        .map(([key]) => rules.SECTOR_SPECS[key].short)
        .join(", ") || "nada"}] -> ${perDistrict.mw} MW / ${perDistrict.gas} m3 por distrito`
    );
    log(`  total: ${perDistrict.mw * n} MW / ${perDistrict.gas * n} m3 contra ${cap.maxMW} MW / ${cap.maxGas} m3`);

    for (const team of Object.values(room.teams)) {
      team.sectors = { ...plan.sectors };
    }
    rules.recomputeDerived(room);

    const result = rules.resolveRound(room);
    const team = result.teamResults[0];

    log(
      `  RESOLUCIÓN: ${result.outcome}${result.cause ? ` (${result.cause})` : ""} // margen ${result.marginMW} MW / ${result.marginGas} m3`
    );
    log(
      `  distrito tipo: Bienestar ${team.welfareBefore} -> ${team.welfareAfter} (${team.welfareDelta >= 0 ? "+" : ""}${team.welfareDelta}) // Tesorería ${team.budgetBefore} -> ${team.budgetAfter} (${team.budgetDelta >= 0 ? "+" : ""}${team.budgetDelta})`
    );
    log(`  fallos acumulados: ${room.blackoutCount}/${rules.MAX_BLACKOUTS}`);

    if (room.blackoutCount >= rules.MAX_BLACKOUTS) {
      survived = false;
      break;
    }
  }

  if (survived) {
    room.finalResults = rules.finalResults(room, { irreversible: false });
    log("");
    log("=== CLASIFICACIÓN FINAL ===");
    for (const [index, entry] of room.finalResults.ranking.entries()) {
      log(
        `  ${index + 1}. ${entry.teamName}: PEF ${entry.pef} (Bienestar ${entry.welfare} + Tesorería ${entry.budget}/100) // sacrificó ${entry.welfareSacrificed} de Bienestar // industrias encendidas ${entry.industryRoundsOn}/${entry.roundsPlayed}`
      );
    }
    const name = (id) => (id ? room.finalResults.ranking.find((r) => r.teamId === id).teamName : "—");
    log(`  Operador de Red Ejemplar: ${name(room.finalResults.mentions.exemplary)}`);
    log(`  Distrito Mártir: ${name(room.finalResults.mentions.martyr)}`);
    log(`  Distrito Parásito: ${name(room.finalResults.mentions.parasite)}`);
  } else {
    log("");
    log("FALLO REGIONAL IRREVERSIBLE — NO HAY GANADORES");
  }
  log(`Semilla jugada: ${room.seed} // incidentes: ${room.usedIncidentIds.join(", ") || "ninguno"}`);

  return { lines, room, survived, rounds: room.currentRound };
}

/** Barrido de semillas: cuántas partidas aguanta la estrategia de referencia. */
function scan(seeds, districts) {
  let survived = 0;
  const deck = new Map();
  for (let seed = 1; seed <= seeds; seed += 1) {
    const { survived: ok, room } = playGame({ seed, districts, verbose: false });
    if (ok) survived += 1;
    for (const id of room.usedIncidentIds) deck.set(id, (deck.get(id) || 0) + 1);
  }
  console.log(`Barrido de ${seeds} semillas con ${districts} distritos: ${survived} sobrevivieron (${Math.round((survived / seeds) * 100)}%)`);
  console.log("Incidentes vistos:");
  for (const incident of rules.INCIDENT_POOL) {
    console.log(`  ${incident.id.padEnd(18)} ${String(deck.get(incident.id) || 0).padStart(4)} veces`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.scan > 0) {
    scan(args.scan, args.districts);
    return;
  }

  const seed = Number.isFinite(args.seed) ? args.seed : undefined;
  const { lines, room } = playGame({ seed, districts: args.districts, verbose: false });
  console.log(lines.join("\n"));
  console.log("");
  console.log(`(semilla real: ${room.seed})`);
}

if (require.main === module) main();

module.exports = { playGame, chooseCut, buildRoom };
