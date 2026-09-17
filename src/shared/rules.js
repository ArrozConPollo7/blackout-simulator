"use strict";

/**
 * BLACKOUT: GRID COLLAPSE — Motor de reglas (fuente única de verdad).
 *
 * Este módulo es CommonJS a propósito: lo consumen el servidor de sockets
 * (`server.js`, Node) y las vistas de Next (`@/shared/rules`), y también la
 * suite de pruebas con `node --test`. Toda la aritmética del juego vive aquí,
 * sin I/O, para poder verificarla de forma aislada.
 *
 * Reglas según "Juego - NFI.md" (Obsidian):
 *  - Cada distrito arranca con 1.000 pts de Bienestar (0..1.200) y $10.000.
 *  - Sectores: industrial (180 MW / 400 m3), residencial (120 MW / 250 m3) y
 *    servicios críticos (60 MW / 100 m3)  =>  360 MW / 750 m3 por distrito.
 *  - La red regional se resuelve al expirar el cronómetro: si la demanda total
 *    de MW O la de gas supera la capacidad de la ronda => BLACKOUT colectivo.
 *  - 2 blackouts => fallo regional irreversible, sin ganadores.
 *  - PEF = Bienestar final + (Tesorería final / 100).
 */

const VERSION = "5.0";

/** @typedef {"industry" | "residential" | "critical"} SectorKey */
/** @typedef {"LOBBY" | "CRISIS_ANNOUNCE" | "CRISIS_ACTIVE" | "RESOLUTION" | "GAME_OVER"} GamePhase */

const SECTOR_ORDER = /** @type {SectorKey[]} */ (["industry", "residential", "critical"]);

/**
 * Especificación de cada sector (documento §3).
 * `revenueOn` / `revenueOff`: impacto económico del turno.
 * `gridFee`: gasto fijo de red que se cobra siempre (esté encendido o no).
 * `welfareOff`: penalización de Bienestar si la red se resolvió con el sector apagado.
 */
const SECTOR_SPECS = {
  industry: {
    key: "industry",
    label: "ZONA INDUSTRIAL",
    short: "IND",
    sublabel: "FUNDICIONES, TINAJAS Y LÍNEA DE ENSAMBLE",
    tag: "BUS 01 // CARGA PESADA",
    demandMW: 180,
    demandGas: 400,
    revenueOn: 3000,
    revenueOff: -1000,
    gridFee: 0,
    welfareOff: 0,
    icon: "factory",
    accent: "green",
  },
  residential: {
    key: "residential",
    label: "ZONA RESIDENCIAL",
    short: "RES",
    sublabel: "ARCOLOGÍAS, CALEFACCIÓN Y AGUA CALIENTE",
    tag: "BUS 02 // CARGA CIVIL",
    demandMW: 120,
    demandGas: 250,
    revenueOn: 0,
    revenueOff: 0,
    gridFee: -500,
    welfareOff: -150,
    icon: "home",
    accent: "cyan",
  },
  critical: {
    key: "critical",
    label: "SERVICIOS CRÍTICOS",
    short: "CRIT",
    sublabel: "SALAS DE TRAUMA, OXÍGENO Y BOMBEO",
    tag: "BUS 03 // VIDA CRÍTICA",
    demandMW: 60,
    demandGas: 100,
    revenueOn: 0,
    revenueOff: 0,
    gridFee: -300,
    welfareOff: -450,
    icon: "local_hospital",
    accent: "red",
  },
};

/** Demanda base de un distrito con los tres sectores encendidos (doc §3). */
const BASE_DEMAND_MW_PER_DISTRICT =
  SECTOR_SPECS.industry.demandMW + SECTOR_SPECS.residential.demandMW + SECTOR_SPECS.critical.demandMW;
const BASE_DEMAND_GAS_PER_DISTRICT =
  SECTOR_SPECS.industry.demandGas + SECTOR_SPECS.residential.demandGas + SECTOR_SPECS.critical.demandGas;

const INITIAL_WELFARE = 1000;
const MAX_WELFARE = 1200;
const MIN_WELFARE = 0;
const INITIAL_BUDGET = 10000;
const BLACKOUT_WELFARE_HIT = -300;
const STABLE_WELFARE_BONUS = 100;
const MAX_BLACKOUTS = 2; // 2 apagones => fallo irreversible (doc §7)
const TOTAL_ROUNDS = 4;
const ANNOUNCE_SECONDS = 10; // Fase 1: anuncio de crisis (doc §4)
const NEGOTIATION_SECONDS = 60; // Fase 2: negociación en vivo (doc §4)
const MIN_DISTRICTS = 3;
const MAX_DISTRICTS = 6;

/**
 * Distritos del salón. Cada mesa toma uno; el anfitrión puede reservar
 * hasta 6 para fijar el tamaño del panel.
 */
const DISTRICTS = [
  { id: "D-01", name: "NEO-DOWNTOWN", code: "0x1A4_CORE", tag: "CENTRO FINANCIERO" },
  { id: "D-02", name: "BAHÍA DE FUNDICIÓN", code: "0x2B8_IND", tag: "FUNDICIÓN PESADA" },
  { id: "D-03", name: "RIVER REACH", code: "0x3C9_HIDRO", tag: "MUELLE FLUVIAL" },
  { id: "D-04", name: "VALLE DE ESCORIA", code: "0x4D0_SINT", tag: "HORNO DE ARCO" },
  { id: "D-05", name: "PÁRAMO NORTE", code: "0x5E1_ALTA", tag: "PARQUE EÓLICO" },
  { id: "D-06", name: "DELTA SUR", code: "0x6F2_PORT", tag: "PUERTO Y DIQUE SECO" },
];

/**
 * Pool de crisis oficiales (doc §6). Los multiplicadores se aplican sobre la
 * capacidad regional base, que es igual a la demanda base del panel: la red
 * arranca sin margen, así que cualquier crisis exige ceder carga.
 */
const CRISIS_PRESETS = [
  {
    id: "crisis-1",
    round: 1,
    name: "MANTENIMIENTO DE GASODUCTO TRONCAL",
    tagline: "TUTORIAL",
    description:
      "Fuga de presión en la válvula regional de gas natural. El gasoducto troncal queda en mantenimiento y la red pierde un 20% de capacidad de gas. La capacidad eléctrica se mantiene al 100%.",
    electricMultiplier: 1.0,
    gasMultiplier: 0.8,
    residentialDemandMultiplier: 1,
    hexCode: "0x4F9_GASODUCTO // VALVULA_20",
    icon: "warning",
    objective: "Solo 1 o 2 industrias deben apagarse para salvar la red.",
  },
  {
    id: "crisis-2",
    round: 2,
    name: "SEQUÍA HIDROLÓGICA EXTREMA",
    tagline: "DÉFICIT SEVERO DE MW",
    description:
      "Los embalses caen a niveles críticos y la generación hidroeléctrica colapsa. La capacidad eléctrica cae un 35% manteniéndose el gas al 100%.",
    electricMultiplier: 0.65,
    gasMultiplier: 1.0,
    residentialDemandMultiplier: 1,
    hexCode: "0x7F2_HIDRO // EMBALSE_SECO",
    icon: "water_drop",
    objective: "Al menos el 60% de las industrias del salón deben ceder.",
  },
  {
    id: "crisis-3",
    round: 3,
    name: "ONDA POLAR Y CONGELAMIENTO",
    tagline: "PICO DE DEMANDA CIVIL",
    description:
      "Pico masivo por frío: la demanda de calefacción y agua caliente duplica el consumo residencial (+120 MW y +250 m3 por distrito). La capacidad regional no aumenta.",
    electricMultiplier: 1.0,
    gasMultiplier: 1.0,
    residentialDemandMultiplier: 2,
    hexCode: "0x9E1_POLAR // CALEFACCION_X2",
    icon: "ac_unit",
    objective: "El consumo civil se come casi todo el margen: mantener industrias activas es casi imposible.",
  },
  {
    id: "crisis-4",
    round: 4,
    name: "COLAPSO EN CADENA DE SUBESTACIONES",
    tagline: "FINAL",
    description:
      "Falla sincronizada en las líneas de alta tensión interregionales y baja presión crítica de gas. Capacidad eléctrica y de gas reducidas al 50%.",
    electricMultiplier: 0.5,
    gasMultiplier: 0.5,
    residentialDemandMultiplier: 1,
    hexCode: "0x0F0_CADENA // SUBESTACION_50",
    icon: "flash_on",
    objective: "Todas las industrias deben apagarse; varios distritos tendrán que asumir cortes selectivos.",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @returns {{industry: boolean, residential: boolean, critical: boolean}} */
function emptySectors(value = true) {
  return { industry: value, residential: value, critical: value };
}

/**
 * Demanda de un distrito según el estado de sus sectores y la crisis vigente.
 * @param {{industry: boolean, residential: boolean, critical: boolean}} sectors
 * @param {object | null} crisis
 */
function districtDemand(sectors, crisis) {
  const resMultiplier = crisis && crisis.residentialDemandMultiplier ? crisis.residentialDemandMultiplier : 1;
  let mw = 0;
  let gas = 0;

  for (const key of SECTOR_ORDER) {
    if (!sectors || !sectors[key]) continue;
    const spec = SECTOR_SPECS[key];
    const factor = key === "residential" ? resMultiplier : 1;
    mw += spec.demandMW * factor;
    gas += spec.demandGas * factor;
  }

  return { mw, gas };
}

/**
 * Demanda agregada del panel. Se cuentan TODOS los distritos presentes en la
 * sala (con o sin operador conectado): una mesa sin teléfono sigue consumiendo.
 */
function totalDemand(teams, crisis) {
  const list = Array.isArray(teams) ? teams : Object.values(teams || {});
  const total = { mw: 0, gas: 0, perTeam: {} };

  for (const team of list) {
    const d = districtDemand(team.sectors, crisis);
    total.mw += d.mw;
    total.gas += d.gas;
    total.perTeam[team.id] = d;
  }

  return total;
}

/**
 * Capacidad regional de la ronda: la base es igual a la demanda base del panel
 * (360 MW / 750 m3 por distrito) y la crisis aplica sus multiplicadores.
 * @param {number} districtCount
 * @param {object | null} crisis
 */
function regionalCapacity(districtCount, crisis) {
  const n = Math.max(1, districtCount);
  const baseMW = BASE_DEMAND_MW_PER_DISTRICT * n;
  const baseGas = BASE_DEMAND_GAS_PER_DISTRICT * n;

  return {
    districts: n,
    baseMW,
    baseGas,
    maxMW: Math.round(baseMW * (crisis ? crisis.electricMultiplier : 1)),
    maxGas: Math.round(baseGas * (crisis ? crisis.gasMultiplier : 1)),
  };
}

/** @param {number} welfare */
function clampWelfare(welfare) {
  return Math.max(MIN_WELFARE, Math.min(MAX_WELFARE, Math.round(welfare)));
}

/** Puntaje de Eficiencia Final (doc §7): Bienestar + (Tesorería / 100). */
function efficiencyScore(team) {
  return Math.round((team.welfare + team.budget / 100) * 10) / 10;
}

/**
 * Segundos restantes reales de la fase. Deriva de `deadlineTs`, así que el
 * cliente puede dibujar la cuenta atrás sin que el servidor lata cada segundo.
 */
function remainingSeconds(room, now = Date.now()) {
  if (!room || !room.deadlineTs) return Math.max(0, (room && room.timeRemaining) || 0);
  return Math.max(0, Math.ceil((room.deadlineTs - now) / 1000));
}

function districtOf(districtId) {
  return DISTRICTS.find((d) => d.id === districtId) || null;
}

function crisisForRound(round) {
  return CRISIS_PRESETS.find((c) => c.round === round) || CRISIS_PRESETS[CRISIS_PRESETS.length - 1];
}

// ---------------------------------------------------------------------------
// Construcción de estado
// ---------------------------------------------------------------------------

/**
 * Distrito del panel. `claimed` = hay una mesa con teléfono controlando.
 * Un distrito reservado pero sin operador sigue consumiendo (el anfitrión
 * puede cortarle sectores a mano desde el proyector).
 */
function createDistrictTeam({ id, districtId, operator = null, claimed = false }) {
  const info = districtOf(districtId);
  return {
    id,
    districtId,
    name: info ? info.name : districtId,
    code: info ? info.code : "",
    operator,
    claimed,
    welfare: INITIAL_WELFARE,
    budget: INITIAL_BUDGET,
    sectors: emptySectors(true),
    welfareSacrificed: 0,
    industryRoundsOn: 0,
    roundsPlayed: 0,
    connected: false,
  };
}

function createRoom(pin) {
  return {
    pin,
    version: VERSION,
    phase: /** @type {GamePhase} */ ("LOBBY"),
    currentRound: 0,
    totalRounds: TOTAL_ROUNDS,
    announceSeconds: ANNOUNCE_SECONDS,
    negotiationSeconds: NEGOTIATION_SECONDS,
    timeRemaining: 0,
    /**
     * Instante (epoch ms) en que expira la fase con reloj. Es la fuente de
     * verdad de la cuenta atrás: los clientes la dibujan por su cuenta y el
     * servidor solo necesita despertarse una vez, en la fecha límite.
     */
    deadlineTs: null,
    timerRunning: false,
    activeCrisis: null,
    capacity: regionalCapacity(0, null),
    demand: totalDemand([], null),
    blackoutCount: 0,
    teams: {},
    logs: [
      {
        id: `log-${Date.now()}`,
        timestamp: "00:00:00",
        type: "SYS",
        message: `BLACKOUT: GRID COLLAPSE v${VERSION} INICIALIZADO // SALA #${pin}`,
      },
    ],
    lastResolution: null,
    finalResults: null,
    hostConnected: false,
  };
}

// ---------------------------------------------------------------------------
// Ciclo de ronda (doc §4)
// ---------------------------------------------------------------------------

function districtCount(room) {
  return Object.keys(room.teams).length;
}

/** Fase 1: anuncio de crisis (10 s). La capacidad ya aparece recortada. */
function startRound(room, round = room.currentRound + 1) {
  room.currentRound = round;
  room.activeCrisis = crisisForRound(round);
  room.capacity = regionalCapacity(districtCount(room), room.activeCrisis);

  // Cada ronda arranca con las palancas rearmadas: la negociación decide de
  // nuevo qué se corta (el documento narra cada ronda sobre la red completa).
  for (const team of Object.values(room.teams)) {
    team.sectors = emptySectors(true);
  }

  room.demand = totalDemand(Object.values(room.teams), room.activeCrisis);
  room.phase = "CRISIS_ANNOUNCE";
  room.timeRemaining = room.announceSeconds;
  room.deadlineTs = Date.now() + room.announceSeconds * 1000;
  room.timerRunning = true;
  room.lastResolution = null;
  room.finalResults = null;
  return room.activeCrisis;
}

/** Fase 2: 60 s de negociación con las palancas en vivo. */
function openNegotiation(room) {
  room.phase = "CRISIS_ACTIVE";
  room.timeRemaining = room.negotiationSeconds;
  room.deadlineTs = Date.now() + room.negotiationSeconds * 1000;
  room.timerRunning = true;
  return room;
}

function recomputeDerived(room) {
  room.demand = totalDemand(Object.values(room.teams), room.activeCrisis);
  return room.demand;
}

/**
 * Fase 3: resolución automática (doc §5). Muta los equipos y devuelve el parte
 * de la ronda. Un fallo colectivo es un BLACKOUT; si se acumulan 2, la partida
 * termina en fallo regional irreversible.
 */
function resolveRound(room) {
  const crisis = room.activeCrisis;
  const teams = Object.values(room.teams);

  // La capacidad se fijó al anunciar la crisis; si un distrito se sumó en la
  // ronda, su demanda cuenta pero la red no gana capacidad.
  if (!room.capacity || !room.capacity.maxMW) {
    room.capacity = regionalCapacity(teams.length, crisis);
  }

  const demand = totalDemand(teams, crisis);
  room.demand = demand;

  const overloadMW = demand.mw > room.capacity.maxMW;
  const overloadGas = demand.gas > room.capacity.maxGas;
  const isBlackout = overloadMW || overloadGas;

  if (isBlackout) {
    room.blackoutCount += 1;
  }

  const teamResults = teams.map((team) => {
    const spec = SECTOR_SPECS;
    const before = { welfare: team.welfare, budget: team.budget };
    const lines = [];
    let budgetDelta = 0;
    let welfareDelta = 0;

    if (isBlackout) {
      welfareDelta += BLACKOUT_WELFARE_HIT;
      lines.push({ kind: "penalty", text: `APAGÓN MASIVO GENERAL: ${BLACKOUT_WELFARE_HIT} Bienestar` });

      if (team.sectors.industry) {
        lines.push({ kind: "penalty", text: "INGRESOS INDUSTRIALES ANULADOS: $0 (sin suministro para operar)" });
      } else {
        budgetDelta += spec.industry.revenueOff;
        lines.push({ kind: "penalty", text: `PARO TÉCNICO INDUSTRIAL: ${spec.industry.revenueOff} $` });
      }

      budgetDelta += spec.residential.gridFee;
      lines.push({ kind: "penalty", text: `GASTO FIJO DE RED RESIDENCIAL: ${spec.residential.gridFee} $` });
      budgetDelta += spec.critical.gridFee;
      lines.push({ kind: "penalty", text: `GASTO FIJO DE RED CRÍTICA: ${spec.critical.gridFee} $` });
    } else {
      welfareDelta += STABLE_WELFARE_BONUS;
      lines.push({ kind: "bonus", text: `RED ESTABLE: +${STABLE_WELFARE_BONUS} Bienestar` });

      if (team.sectors.industry) {
        budgetDelta += spec.industry.revenueOn;
        lines.push({ kind: "bonus", text: `PRODUCCIÓN INDUSTRIAL ACTIVA: +${spec.industry.revenueOn} $` });
      } else {
        budgetDelta += spec.industry.revenueOff;
        lines.push({ kind: "penalty", text: `PARO TÉCNICO INDUSTRIAL: ${spec.industry.revenueOff} $` });
      }

      budgetDelta += spec.residential.gridFee;
      lines.push({ kind: "penalty", text: `MANTENIMIENTO DE RED RESIDENCIAL: ${spec.residential.gridFee} $` });
      budgetDelta += spec.critical.gridFee;
      lines.push({ kind: "penalty", text: `MANTENIMIENTO DE RED CRÍTICA: ${spec.critical.gridFee} $` });
    }

    // Penalizaciones individuales por tener sectores civiles apagados al resolver.
    for (const key of ["residential", "critical"]) {
      if (!team.sectors[key]) {
        welfareDelta += spec[key].welfareOff;
        lines.push({ kind: "penalty", text: `${spec[key].label} APAGADA: ${spec[key].welfareOff} Bienestar` });
        team.welfareSacrificed += Math.abs(spec[key].welfareOff);
      }
    }

    if (team.sectors.industry) {
      team.industryRoundsOn += 1;
    }
    team.roundsPlayed += 1;

    team.budget = Math.max(0, team.budget + budgetDelta);
    team.welfare = clampWelfare(team.welfare + welfareDelta);

    return {
      teamId: team.id,
      teamName: team.name,
      districtId: team.districtId,
      claimed: team.claimed,
      demandMW: demand.perTeam[team.id] ? demand.perTeam[team.id].mw : 0,
      demandGas: demand.perTeam[team.id] ? demand.perTeam[team.id].gas : 0,
      budgetDelta,
      welfareDelta,
      budgetBefore: before.budget,
      welfareBefore: before.welfare,
      budgetAfter: team.budget,
      welfareAfter: team.welfare,
      lines,
    };
  });

  room.lastResolution = {
    round: room.currentRound,
    outcome: isBlackout ? "BLACKOUT" : "STABLE",
    cause: overloadMW && overloadGas ? "AMBAS" : overloadMW ? "ELECTRICIDAD" : overloadGas ? "GAS" : null,
    totalMW: demand.mw,
    totalGas: demand.gas,
    capacityMW: room.capacity.maxMW,
    capacityGas: room.capacity.maxGas,
    marginMW: room.capacity.maxMW - demand.mw,
    marginGas: room.capacity.maxGas - demand.gas,
    blackoutCount: room.blackoutCount,
    irreversible: room.blackoutCount >= MAX_BLACKOUTS,
    teamResults,
  };

  room.timerRunning = false;
  room.deadlineTs = null;

  if (room.blackoutCount >= MAX_BLACKOUTS) {
    // Derrota general: no se juega más, la red no se levanta.
    room.finalResults = finalResults(room, { irreversible: true });
    room.phase = "GAME_OVER";
  } else {
    room.phase = "RESOLUTION";
  }

  return room.lastResolution;
}

/**
 * Cierre de la partida (doc §7): PEF por distrito, Operador de Red Ejemplar,
 * Distrito Mártir y Distrito Parásito.
 */
function finalResults(room, { irreversible = false } = {}) {
  const teams = Object.values(room.teams);

  const ranking = teams
    .map((team) => ({
      teamId: team.id,
      teamName: team.name,
      districtId: team.districtId,
      claimed: team.claimed,
      welfare: team.welfare,
      budget: team.budget,
      pef: efficiencyScore(team),
      welfareSacrificed: team.welfareSacrificed,
      industryRoundsOn: team.industryRoundsOn,
      roundsPlayed: team.roundsPlayed,
    }))
    .sort((a, b) => b.pef - a.pef);

  let mentions = { exemplary: null, martyr: null, parasite: null };

  if (!irreversible && ranking.length > 0) {
    mentions.exemplary = ranking[0].teamId;

    const martyr = [...ranking].sort(
      (a, b) => b.welfareSacrificed - a.welfareSacrificed || b.industryRoundsOn - a.industryRoundsOn
    )[0];
    mentions.martyr = martyr.welfareSacrificed > 0 ? martyr.teamId : null;

    const parasite = [...ranking].sort(
      (a, b) => b.industryRoundsOn - a.industryRoundsOn || a.welfareSacrificed - b.welfareSacrificed
    )[0];
    mentions.parasite = parasite.industryRoundsOn > 0 ? parasite.teamId : null;
  }

  return {
    irreversible,
    blackoutCount: room.blackoutCount,
    roundsPlayed: room.currentRound,
    ranking,
    mentions,
  };
}

module.exports = {
  VERSION,
  SECTOR_ORDER,
  SECTOR_SPECS,
  BASE_DEMAND_MW_PER_DISTRICT,
  BASE_DEMAND_GAS_PER_DISTRICT,
  INITIAL_WELFARE,
  MAX_WELFARE,
  MIN_WELFARE,
  INITIAL_BUDGET,
  BLACKOUT_WELFARE_HIT,
  STABLE_WELFARE_BONUS,
  MAX_BLACKOUTS,
  TOTAL_ROUNDS,
  ANNOUNCE_SECONDS,
  NEGOTIATION_SECONDS,
  MIN_DISTRICTS,
  MAX_DISTRICTS,
  DISTRICTS,
  CRISIS_PRESETS,
  emptySectors,
  districtDemand,
  totalDemand,
  regionalCapacity,
  clampWelfare,
  efficiencyScore,
  remainingSeconds,
  districtOf,
  crisisForRound,
  createDistrictTeam,
  createRoom,
  districtCount,
  startRound,
  openNegotiation,
  recomputeDerived,
  resolveRound,
  finalResults,
};
