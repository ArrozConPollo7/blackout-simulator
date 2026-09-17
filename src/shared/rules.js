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

const VERSION = "5.1";

/** @typedef {"industry" | "residential" | "critical"} SectorKey */
/** @typedef {"LOBBY" | "PLANNING" | "CRISIS_ANNOUNCE" | "CRISIS_ACTIVE" | "RESOLUTION" | "GAME_OVER"} GamePhase */

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
/** Segundos que suma el botón "+30 s" del anfitrión durante una fase con reloj. */
const EXTRA_SECONDS = 30;
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
// Incidentes aleatorios (variación de ronda)
// ---------------------------------------------------------------------------
/**
 * Sobre la crisis de la ronda se sortean INCIDENTES: sucesos que alteran el
 * techo de la red, la demanda, la economía o el propio mando de las mesas.
 *
 * Reglas del sorteo (ver `drawIncidents`):
 *  - Ronda 1 (tutorial): sin incidentes. La aritmética del documento se
 *    presenta limpia antes de empezar a torcerla.
 *  - Ronda 2 y 3: 1 incidente, severidad máxima 2 y 3 respectivamente.
 *  - Ronda 4: 2 incidentes (el final es el más caótico), severidad máxima 3,
 *    de familias distintas.
 *  - Un incidente nunca se repite dentro de la misma partida.
 *  - El sorteo es determinista para una semilla dada (`room.seed`), así que una
 *    partida se puede reproducir; con otra semilla cambia todo el guion.
 *
 * Familias: `capacity` (techo), `demand` (consumo), `economy` (dinero y
 * bienestar), `lock` (sectores que no se pueden cortar) y `boost` (alivio).
 *
 * Invariante de balance: ninguna combinación de incidentes puede hacer la ronda
 * irresoluble (siempre se puede salvar cortando industria y residencial) ni
 * convertir en ganador al que no toca nada (el techo sigue por debajo de la
 * demanda base). Hay una prueba que lo verifica por fuerza bruta.
 */
const INCIDENT_POOL = [
  // -- capacity: recortan el techo regional ---------------------------------
  {
    id: "inc-valvula",
    family: "capacity",
    severity: 2,
    minRound: 2,
    name: "FUGA EN LA LÍNEA DE DISTRIBUCIÓN",
    tagline: "TECHO DE GAS RECORTADO",
    icon: "leak",
    hexCode: "0xA31_GAS // FUGA_10",
    description:
      "Una junta del anillo de distribución revienta: la red pierde un 10% de capacidad de gas durante la ronda.",
    objective: "El gas vuelve a ser el cuello de botella.",
    effects: { gasMultiplier: 0.9 },
  },
  {
    id: "inc-torre",
    family: "capacity",
    severity: 2,
    minRound: 2,
    name: "TORRE DE ENFRIAMIENTO AL 70%",
    tagline: "TECHO ELÉCTRICO RECORTADO",
    icon: "device_thermostat",
    hexCode: "0xB42_TERMICA // TORRE_70",
    description:
      "El circuito secundario de refrigeración pierde caudal: el parque generador entrega un 10% menos de potencia.",
    objective: "Hay que ceder más MW de los previstos.",
    effects: { electricMultiplier: 0.9 },
  },
  {
    id: "inc-turbina",
    family: "capacity",
    severity: 3,
    minRound: 3,
    name: "TURBINA 3 FUERA DE SERVICIO",
    tagline: "PÉRDIDA SEVERA DE MW",
    icon: "settings_input_component",
    hexCode: "0xC53_TURBINA // TRIP_15",
    description:
      "Disparo de la turbina 3 por sobrevelocidad: se pierde un 15% de la capacidad eléctrica de la región.",
    objective: "La reserva girante se agota: cada MW cuenta.",
    effects: { electricMultiplier: 0.85 },
  },
  {
    id: "inc-compresor",
    family: "capacity",
    severity: 3,
    minRound: 3,
    name: "COMPRESOR TRONCAL EN PARADA",
    tagline: "PÉRDIDA SEVERA DE GAS",
    icon: "compress",
    hexCode: "0xD64_COMPRESOR // STOP_15",
    description:
      "El compresor troncal entra en parada de seguridad: la capacidad de gas de la región cae un 15%.",
    objective: "Sin gas, las calderas y los hornos se apagan.",
    effects: { gasMultiplier: 0.85 },
  },
  {
    id: "inc-anillo",
    family: "capacity",
    severity: 2,
    minRound: 2,
    name: "ROBO DE CABLE EN EL ANILLO SUR",
    tagline: "TECHO RECORTADO Y COSTO EXTRA",
    icon: "cable",
    hexCode: "0xE75_ANILLO // CABLE_8",
    description:
      "Desmantelan 4 km de línea del anillo sur: se pierde un 8% de capacidad eléctrica y la reparación cuesta $200 a cada distrito.",
    objective: "Reparar cuesta dinero; no reparar cuesta la red.",
    effects: { electricMultiplier: 0.92, budgetAll: -200 },
  },

  // -- demand: suben el consumo ---------------------------------------------
  {
    id: "inc-calor",
    family: "demand",
    severity: 2,
    minRound: 2,
    name: "OLEADA DE CALOR EXTREMA",
    tagline: "DEMANDA CIVIL AL ALZA",
    icon: "heat",
    hexCode: "0xF86_CALOR // AACC_115",
    description:
      "40 °C a la sombra: el aire acondicionado dispara la demanda residencial un 15% en toda la región.",
    objective: "La carga civil se come parte del margen.",
    effects: { demand: { residential: 1.15 } },
  },
  {
    id: "inc-turno",
    family: "demand",
    severity: 2,
    minRound: 2,
    name: "TURNO INDUSTRIAL DOBLE POR EXPORTACIÓN",
    tagline: "CONSUMO INDUSTRIAL AL ALZA",
    icon: "precision_manufacturing",
    hexCode: "0x0A7_TURNO // EXPORT_120",
    description:
      "Llega un contrato urgente de exportación: las fábricas encendidas consumen un 20% más, pero pagan $600 extra si aguantan la ronda.",
    objective: "Mantener la industria rinde más... y cuesta más MW.",
    effects: { demand: { industry: 1.2 }, industryRevenueBonus: 600 },
  },
  {
    id: "inc-hospital",
    family: "demand",
    severity: 2,
    minRound: 2,
    name: "TRASLADO MASIVO AL HOSPITAL CENTRAL",
    tagline: "CARGA CRÍTICA AL ALZA",
    icon: "emergency",
    hexCode: "0x1B8_HOSPITAL // UCI_125",
    description:
      "Un accidente múltiple desborda las salas: los servicios críticos consumen un 25% más esta ronda.",
    objective: "Cortar servicios críticos ahora duele más que nunca.",
    effects: { demand: { critical: 1.25 } },
  },
  {
    id: "inc-cadena-frio",
    family: "demand",
    severity: 3,
    minRound: 3,
    name: "CADENA DE FRÍO EN ALERTA SANITARIA",
    tagline: "DEMANDA CIVIL Y CRÍTICA AL ALZA",
    icon: "ac_unit",
    hexCode: "0x2C9_FRIO // SANIT_110",
    description:
      "Alerta sanitaria: residencial y servicios críticos consumen un 10% más cada uno para mantener la cadena de frío.",
    objective: "El consumo civil presiona por los dos lados.",
    effects: { demand: { residential: 1.1, critical: 1.1 } },
  },

  // -- economy: dinero y bienestar ------------------------------------------
  {
    id: "inc-subsidio",
    family: "economy",
    severity: 1,
    minRound: 2,
    name: "SUBSIDIO DE EMERGENCIA DEL ESTADO",
    tagline: "CAJA EXTRA",
    icon: "payments",
    hexCode: "0x3DA_SUBSIDIO // +800",
    description:
      "El gobierno nacional gira un subsidio de emergencia: cada distrito recibe $800 al cerrar la ronda.",
    objective: "Alivio financiero: úsalo para sobrevivir, no para lucrar.",
    effects: { budgetAll: 800 },
  },
  {
    id: "inc-huelga",
    family: "economy",
    severity: 2,
    minRound: 2,
    name: "HUELGA EN LA PLANTA DE BOMBEO",
    tagline: "COSTOS AL ALZA",
    icon: "engineering",
    hexCode: "0x4EB_HUELGA // -400",
    description:
      "Los operarios de bombeo paran: cada distrito paga $400 extra de mantenimiento y otros $400 si además hay apagón.",
    objective: "Sostener la red con la plantilla parada sale carísimo.",
    effects: { budgetAll: -400, blackoutBudgetExtra: -400 },
  },
  {
    id: "inc-saqueo",
    family: "economy",
    severity: 2,
    minRound: 2,
    name: "SAQUEO EN LOS BARRIOS DEL ESTE",
    tagline: "BIENESTAR AL ALZA DEL DESCONTENTO",
    icon: "local_police",
    hexCode: "0x5FC_SAQUEO // -80",
    description:
      "Los cortes acumulados provocan disturbios: cada distrito pierde 80 pts de Bienestar, y 120 más si la red cae en apagón.",
    objective: "La paciencia civil tiene un precio.",
    effects: { welfareAll: -80, blackoutWelfareExtra: -120 },
  },
  {
    id: "inc-empleo",
    family: "economy",
    severity: 1,
    minRound: 2,
    name: "PLAN DE EMPLEO DE EMERGENCIA",
    tagline: "CAJA A CAMBIO DE PACIENCIA",
    icon: "groups",
    hexCode: "0x60D_EMPLEO // +300-40",
    description:
      "El distrito contrata brigadas de choque: +$300 de tesorería y -40 pts de Bienestar por el esfuerzo social.",
    objective: "Dinero hoy, desgaste civil mañana.",
    effects: { budgetAll: 300, welfareAll: -40 },
  },
  {
    id: "inc-auditoria",
    family: "economy",
    severity: 3,
    minRound: 3,
    name: "AUDITORÍA DEL REGULADOR",
    tagline: "SE PAGA POR RESULTADOS",
    icon: "fact_check",
    hexCode: "0x71E_AUDITORIA // CONDICIONAL",
    description:
      "El regulador retiene $600 de garantía a cada distrito, pero devuelve $900 adicionales a quien cierre la ronda con la red estable.",
    objective: "Aquí el apagón colectivo sale el doble de caro.",
    effects: { budgetAll: -600, stableBudgetBonus: 900 },
  },

  // -- lock: el mando se bloquea --------------------------------------------
  {
    id: "inc-cuarentena",
    family: "lock",
    severity: 2,
    minRound: 2,
    name: "CUARENTENA EN LAS SALAS DE TRAUMA",
    tagline: "SERVICIOS CRÍTICOS BLOQUEADOS",
    icon: "lock",
    hexCode: "0x82F_CUARENTENA // LOCK_CRIT",
    description:
      "Aislamiento biológico en el bloque quirúrgico: los SERVICIOS CRÍTICOS no se pueden cortar en esta ronda. Las palancas de esa carga están bloqueadas.",
    objective: "Habrá que sacrificar industria o zonas residenciales en su lugar.",
    effects: { lockSectors: ["critical"] },
  },
  {
    id: "inc-oxigeno",
    family: "lock",
    severity: 3,
    minRound: 3,
    name: "OXÍGENO CRÍTICO EN CUIDADOS INTENSIVOS",
    tagline: "CRÍTICOS BLOQUEADOS Y COSTO EXTRA",
    icon: "pulmonology",
    hexCode: "0x930_OXIGENO // LOCK_CRIT_300",
    description:
      "Los pulmones artificiales están al límite: los SERVICIOS CRÍTICOS quedan bloqueados y el operativo cuesta $300 a cada distrito.",
    objective: "La vida crítica no se negocia; el resto sí.",
    effects: { lockSectors: ["critical"], budgetAll: -300 },
  },

  // -- boost: alivio --------------------------------------------------------
  {
    id: "inc-trasvase",
    family: "boost",
    severity: 1,
    minRound: 2,
    name: "TRASVASE DE EMERGENCIA HABILITADO",
    tagline: "TECHO ELÉCTRICO AL ALZA",
    icon: "water",
    hexCode: "0xA41_TRASVASE // +10",
    description:
      "Se abre el trasvase entre cuencas: la región gana un 10% de capacidad eléctrica durante la ronda.",
    objective: "Margen extra, pero más de una mesa se tentará.",
    effects: { electricMultiplier: 1.1 },
  },
  {
    id: "inc-carga-gas",
    family: "boost",
    severity: 1,
    minRound: 2,
    name: "BUQUE METANERO ATRACADO EN PUERTO",
    tagline: "TECHO DE GAS AL ALZA",
    icon: "directions_boat",
    hexCode: "0xB52_METANERO // +10",
    description:
      "Un metanero descarga de urgencia: la región gana un 10% de capacidad de gas durante la ronda.",
    objective: "Respiro para las calderas.",
    effects: { gasMultiplier: 1.1 },
  },
  {
    id: "inc-mercado",
    family: "boost",
    severity: 3,
    minRound: 3,
    name: "MERCADO SPOT A PRECIO DE RUINA",
    tagline: "MÁS MW, MENOS CAJA",
    icon: "currency_exchange",
    hexCode: "0xC63_SPOT // +10-700",
    description:
      "El operador compra potencia en el mercado spot: +10% de capacidad eléctrica y -$700 para cada distrito.",
    objective: "El margen se compra con dinero, no con coordinación.",
    effects: { electricMultiplier: 1.1, budgetAll: -700 },
  },
];

/** Severidad máxima admisible por ronda (la curva de dificultad del guion). */
const INCIDENT_MAX_SEVERITY = { 1: 0, 2: 2, 3: 3, 4: 3 };
/** Incidentes sorteados por ronda. */
const INCIDENT_COUNT_BY_ROUND = { 1: 0, 2: 1, 3: 1, 4: 2 };

/** Efectos neutros: cualquier campo ausente del incidente vale esto. */
function neutralEffects() {
  return {
    electricMultiplier: 1,
    gasMultiplier: 1,
    demand: { industry: 1, residential: 1, critical: 1 },
    welfareAll: 0,
    budgetAll: 0,
    blackoutWelfareExtra: 0,
    blackoutBudgetExtra: 0,
    stableWelfareBonus: 0,
    stableBudgetBonus: 0,
    industryRevenueBonus: 0,
    lockSectors: [],
  };
}

/** Normaliza los efectos de un incidente (rellena lo ausente). */
function incidentEffects(incident) {
  const base = neutralEffects();
  if (!incident || !incident.effects) return base;
  const e = incident.effects;
  return {
    ...base,
    ...e,
    demand: { ...base.demand, ...(e.demand || {}) },
    lockSectors: Array.isArray(e.lockSectors) ? e.lockSectors.slice() : [],
  };
}

/**
 * PRNG determinista (mulberry32) sobre el estado de la sala. Se guarda el
 * estado en `room.rngState` para que el sorteo sea reproducible con la semilla.
 */
function nextRandom(room) {
  let t = (room.rngState = (room.rngState + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Multiplicadores agregados de los incidentes de la ronda. */
function incidentMultipliers(incidents) {
  const list = Array.isArray(incidents) ? incidents : [];
  const acc = {
    electricMultiplier: 1,
    gasMultiplier: 1,
    demand: { industry: 1, residential: 1, critical: 1 },
    welfareAll: 0,
    budgetAll: 0,
    blackoutWelfareExtra: 0,
    blackoutBudgetExtra: 0,
    stableWelfareBonus: 0,
    stableBudgetBonus: 0,
    industryRevenueBonus: 0,
    lockSectors: [],
  };

  for (const incident of list) {
    const e = incidentEffects(incident);
    acc.electricMultiplier *= e.electricMultiplier;
    acc.gasMultiplier *= e.gasMultiplier;
    acc.demand.industry *= e.demand.industry;
    acc.demand.residential *= e.demand.residential;
    acc.demand.critical *= e.demand.critical;
    acc.welfareAll += e.welfareAll;
    acc.budgetAll += e.budgetAll;
    acc.blackoutWelfareExtra += e.blackoutWelfareExtra;
    acc.blackoutBudgetExtra += e.blackoutBudgetExtra;
    acc.stableWelfareBonus += e.stableWelfareBonus;
    acc.stableBudgetBonus += e.stableBudgetBonus;
    acc.industryRevenueBonus += e.industryRevenueBonus;
    for (const key of e.lockSectors) {
      if (!acc.lockSectors.includes(key)) acc.lockSectors.push(key);
    }
  }

  return acc;
}

/**
 * Sortea los incidentes de una ronda. Consume el PRNG de la sala, así que el
 * orden de llamadas es parte del contrato (una vez por ronda, en startRound).
 */
function drawIncidents(room, round) {
  const count = INCIDENT_COUNT_BY_ROUND[round] !== undefined ? INCIDENT_COUNT_BY_ROUND[round] : 1;
  if (count <= 0) return [];

  const maxSeverity = INCIDENT_MAX_SEVERITY[round] !== undefined ? INCIDENT_MAX_SEVERITY[round] : 3;
  const used = Array.isArray(room.usedIncidentIds) ? room.usedIncidentIds : [];
  const available = INCIDENT_POOL.filter(
    (incident) =>
      !used.includes(incident.id) && incident.severity <= maxSeverity && round >= (incident.minRound || 2)
  );

  const picked = [];
  const families = [];

  // Primera pasada: una sola familia por ronda (diversidad de problemas).
  while (picked.length < count && available.length > 0) {
    const candidate = available.splice(Math.floor(nextRandom(room) * available.length), 1)[0];
    if (families.includes(candidate.family)) continue;
    families.push(candidate.family);
    picked.push(candidate);
  }

  // Segunda pasada (reserva): si el filtro por familia dejó la ronda corta.
  while (picked.length < count && available.length > 0) {
    picked.push(available.splice(Math.floor(nextRandom(room) * available.length), 1)[0]);
  }

  return picked;
}

/** Etiquetas cortas del incidente, para el proyector y los registros. */
function incidentTags(incident) {
  const e = incidentEffects(incident);
  const tags = [];
  const pct = (value) => `${value > 1 ? "+" : "-"}${Math.round(Math.abs(1 - value) * 100)}%`;

  if (e.electricMultiplier !== 1) tags.push(`ELÉCTRICA ${pct(e.electricMultiplier)}`);
  if (e.gasMultiplier !== 1) tags.push(`GAS ${pct(e.gasMultiplier)}`);
  if (e.demand.industry !== 1) tags.push(`DEMANDA INDUSTRIAL x${round2(e.demand.industry)}`);
  if (e.demand.residential !== 1) tags.push(`DEMANDA CIVIL x${round2(e.demand.residential)}`);
  if (e.demand.critical !== 1) tags.push(`CARGA CRÍTICA x${round2(e.demand.critical)}`);
  if (e.welfareAll !== 0) tags.push(`${e.welfareAll > 0 ? "+" : ""}${e.welfareAll} BIENESTAR A TODOS`);
  if (e.budgetAll !== 0) tags.push(`${e.budgetAll > 0 ? "+" : ""}$${e.budgetAll} A TODOS`);
  if (e.stableBudgetBonus !== 0) tags.push(`+$${e.stableBudgetBonus} SI LA RED AGUANTA`);
  if (e.blackoutBudgetExtra !== 0) tags.push(`$${e.blackoutBudgetExtra} EXTRA SI HAY APAGÓN`);
  if (e.blackoutWelfareExtra !== 0) tags.push(`${e.blackoutWelfareExtra} BIENESTAR EXTRA SI HAY APAGÓN`);
  if (e.industryRevenueBonus !== 0) tags.push(`+$${e.industryRevenueBonus} INDUSTRIA ACTIVA`);
  for (const key of e.lockSectors) tags.push(`${SECTOR_SPECS[key] ? SECTOR_SPECS[key].label : key} BLOQUEADA`);

  return tags;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/** ¿Está bloqueada la palanca de este sector en la ronda vigente? */
function isSectorLocked(room, sector) {
  return Boolean(room && room.lockedSectors && room.lockedSectors[sector]);
}

function incidentById(id) {
  return INCIDENT_POOL.find((incident) => incident.id === id) || null;
}

/**
 * Mensajes de registro que produce el sorteo de la ronda. Los usan los dos
 * runtimes (Node y Durable Object) para que el proyector cuente lo mismo.
 */
function incidentLogLines(room) {
  const lines = [];
  for (const incident of room.incidents || []) {
    const tags = incidentTags(incident).join(" · ") || incident.tagline;
    lines.push({ type: "WARN", message: `INCIDENTE: ${incident.name} // ${tags}` });
  }
  const locked = SECTOR_ORDER.filter((key) => isSectorLocked(room, key));
  if (locked.length > 0) {
    lines.push({
      type: "ALERT",
      message: `PALANCAS BLOQUEADAS: ${locked.map((key) => SECTOR_SPECS[key].label).join(" // ")} NO SE PUEDEN CORTAR ESTA RONDA`,
    });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @returns {{industry: boolean, residential: boolean, critical: boolean}} */
function emptySectors(value = true) {
  return { industry: value, residential: value, critical: value };
}

/** Palancas bloqueadas por un incidente de la ronda (no se pueden cortar). */
function emptyLockedSectors() {
  return { industry: false, residential: false, critical: false };
}

/**
 * Demanda de un distrito según el estado de sus sectores, la crisis vigente y
 * los incidentes aleatorios de la ronda. El resultado se redondea por distrito
 * para que el proyector y los mandos muestren enteros.
 * @param {{industry: boolean, residential: boolean, critical: boolean}} sectors
 * @param {object | null} crisis
 * @param {object[]} [incidents]
 */
function districtDemand(sectors, crisis, incidents) {
  const inc = incidentMultipliers(incidents);
  const resMultiplier = crisis && crisis.residentialDemandMultiplier ? crisis.residentialDemandMultiplier : 1;
  let mw = 0;
  let gas = 0;

  for (const key of SECTOR_ORDER) {
    if (!sectors || !sectors[key]) continue;
    const spec = SECTOR_SPECS[key];
    const factor = (key === "residential" ? resMultiplier : 1) * (inc.demand[key] || 1);
    mw += spec.demandMW * factor;
    gas += spec.demandGas * factor;
  }

  return { mw: Math.round(mw), gas: Math.round(gas) };
}

/**
 * Demanda agregada del panel. Se cuentan TODOS los distritos presentes en la
 * sala (con o sin operador conectado): una mesa sin teléfono sigue consumiendo.
 */
function totalDemand(teams, crisis, incidents) {
  const list = Array.isArray(teams) ? teams : Object.values(teams || {});
  const total = { mw: 0, gas: 0, perTeam: {} };

  for (const team of list) {
    const d = districtDemand(team.sectors, crisis, incidents);
    total.mw += d.mw;
    total.gas += d.gas;
    total.perTeam[team.id] = d;
  }

  return total;
}

/**
 * Capacidad regional de la ronda: la base es igual a la demanda base del panel
 * (360 MW / 750 m3 por distrito); la crisis (§6) y los incidentes aleatorios
 * aplican sus multiplicadores de forma multiplicativa.
 * @param {number} districtCount
 * @param {object | null} crisis
 * @param {object[]} [incidents]
 */
function regionalCapacity(districtCount, crisis, incidents) {
  const n = Math.max(1, districtCount);
  const inc = incidentMultipliers(incidents);
  const baseMW = BASE_DEMAND_MW_PER_DISTRICT * n;
  const baseGas = BASE_DEMAND_GAS_PER_DISTRICT * n;
  const electric = (crisis ? crisis.electricMultiplier : 1) * inc.electricMultiplier;
  const gas = (crisis ? crisis.gasMultiplier : 1) * inc.gasMultiplier;

  return {
    districts: n,
    baseMW,
    baseGas,
    /** Multiplicador combinado (crisis x incidentes) que ve el proyector. */
    electricMultiplier: round2(electric),
    gasMultiplier: round2(gas),
    maxMW: Math.round(baseMW * electric),
    maxGas: Math.round(baseGas * gas),
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

function createRoom(pin, { seed, incidents = true } = {}) {
  const resolvedSeed = Number.isFinite(seed)
    ? seed >>> 0
    : (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;

  return {
    pin,
    version: VERSION,
    /** Semilla del sorteo de incidentes: la partida se puede reproducir. */
    seed: resolvedSeed,
    rngState: resolvedSeed,
    /** false = partida con la aritmética del documento, sin incidentes. */
    incidentsEnabled: Boolean(incidents),
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
    /** true = el anfitrión congeló el cronómetro de la fase (deadlineTs queda en null). */
    paused: false,
    activeCrisis: null,
    /** Incidentes aleatorios vigentes en la ronda (vacío fuera de ronda). */
    incidents: [],
    usedIncidentIds: [],
    lockedSectors: emptyLockedSectors(),
    capacity: regionalCapacity(0, null, []),
    demand: totalDemand([], null, []),
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

/**
 * Fase 0: PLANIFICACIÓN (sin reloj). La crisis y los incidentes ya están en
 * pantalla, con la red recortada, pero el cronómetro NO corre: el anfitrión
 * decide cuándo empezar. Es el tiempo que el salón usa para discutir y pactar
 * los cortes antes de que la ronda sea oficial.
 */
function openPlanning(room) {
  room.phase = "PLANNING";
  room.timeRemaining = 0;
  room.deadlineTs = null;
  room.timerRunning = false;
  room.paused = false;
  return room;
}

/** Fase 1: anuncio de crisis (10 s por defecto). La capacidad ya está recortada. */
function beginRound(room) {
  room.phase = "CRISIS_ANNOUNCE";
  room.timeRemaining = room.announceSeconds;
  room.deadlineTs = Date.now() + room.announceSeconds * 1000;
  room.timerRunning = true;
  room.paused = false;
  return room;
}

/** Congela el reloj de la fase: guarda los segundos que quedaban y quita la fecha límite. */
function pauseClock(room) {
  if (!room || !room.timerRunning || room.paused || !room.deadlineTs) return false;
  room.timeRemaining = remainingSeconds(room);
  room.deadlineTs = null;
  room.paused = true;
  return true;
}

/** Reanuda el reloj justo donde estaba. */
function resumeClock(room) {
  if (!room || !room.paused) return false;
  room.paused = false;
  room.deadlineTs = Date.now() + Math.max(1, room.timeRemaining) * 1000;
  room.timerRunning = true;
  return true;
}

/** Suma segundos a la fase con reloj vigente (botón "+30 s" del anfitrión). */
function addTime(room, seconds = EXTRA_SECONDS) {
  if (!room || (room.phase !== "CRISIS_ANNOUNCE" && room.phase !== "CRISIS_ACTIVE")) return false;
  const base = room.paused || !room.deadlineTs ? Math.max(0, room.timeRemaining) : remainingSeconds(room);
  room.timeRemaining = base + seconds;
  if (!room.paused) room.deadlineTs = Date.now() + room.timeRemaining * 1000;
  room.timerRunning = true;
  return true;
}

/**
 * Nueva ronda: sortea crisis e incidentes, rearma las palancas y deja la sala en
 * PLANIFICACIÓN. El reloj no arranca hasta que el anfitrión pulsa "iniciar ronda".
 */
function startRound(room, round = room.currentRound + 1) {
  room.currentRound = round;
  room.activeCrisis = crisisForRound(round);

  // Sorteo de incidentes: consume el PRNG de la sala (una vez por ronda) y
  // nunca repite un incidente dentro de la misma partida.
  if (!Array.isArray(room.usedIncidentIds)) room.usedIncidentIds = [];
  room.incidents = room.incidentsEnabled === false ? [] : drawIncidents(room, round);
  for (const incident of room.incidents) {
    if (!room.usedIncidentIds.includes(incident.id)) room.usedIncidentIds.push(incident.id);
  }

  // Bloqueos de palanca declarados por los incidentes de esta ronda.
  room.lockedSectors = emptyLockedSectors();
  for (const key of incidentMultipliers(room.incidents).lockSectors) {
    if (room.lockedSectors[key] !== undefined) room.lockedSectors[key] = true;
  }

  room.capacity = regionalCapacity(districtCount(room), room.activeCrisis, room.incidents);

  // Cada ronda arranca con las palancas rearmadas: la negociación decide de
  // nuevo qué se corta (el documento narra cada ronda sobre la red completa).
  for (const team of Object.values(room.teams)) {
    team.sectors = emptySectors(true);
  }

  room.demand = totalDemand(Object.values(room.teams), room.activeCrisis, room.incidents);
  openPlanning(room);
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
  room.paused = false;
  return room;
}

function recomputeDerived(room) {
  room.demand = totalDemand(Object.values(room.teams), room.activeCrisis, room.incidents);
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
    room.capacity = regionalCapacity(teams.length, crisis, room.incidents);
  }

  const demand = totalDemand(teams, crisis, room.incidents);
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

    // Incidentes aleatorios: dinero y bienestar que reparte el suceso de la ronda.
    const incidentFx = incidentMultipliers(room.incidents);

    if (incidentFx.welfareAll !== 0) {
      welfareDelta += incidentFx.welfareAll;
      lines.push({
        kind: incidentFx.welfareAll > 0 ? "bonus" : "penalty",
        text: `INCIDENTE // BIENESTAR GENERAL: ${incidentFx.welfareAll > 0 ? "+" : ""}${incidentFx.welfareAll} Bienestar`,
      });
    }

    if (incidentFx.budgetAll !== 0) {
      budgetDelta += incidentFx.budgetAll;
      lines.push({
        kind: incidentFx.budgetAll > 0 ? "bonus" : "penalty",
        text: `INCIDENTE // CAJA GENERAL: ${incidentFx.budgetAll > 0 ? "+" : ""}${incidentFx.budgetAll} $`,
      });
    }

    if (incidentFx.industryRevenueBonus !== 0 && team.sectors.industry) {
      budgetDelta += incidentFx.industryRevenueBonus;
      lines.push({
        kind: "bonus",
        text: `INCIDENTE // NEGOCIO EXTRA DE LA INDUSTRIA ENCENDIDA: +${incidentFx.industryRevenueBonus} $`,
      });
    }

    if (isBlackout) {
      if (incidentFx.blackoutWelfareExtra !== 0) {
        welfareDelta += incidentFx.blackoutWelfareExtra;
        lines.push({
          kind: "penalty",
          text: `INCIDENTE // GOLPE EXTRA POR APAGÓN: ${incidentFx.blackoutWelfareExtra} Bienestar`,
        });
      }
      if (incidentFx.blackoutBudgetExtra !== 0) {
        budgetDelta += incidentFx.blackoutBudgetExtra;
        lines.push({
          kind: "penalty",
          text: `INCIDENTE // GOLPE EXTRA POR APAGÓN: ${incidentFx.blackoutBudgetExtra} $`,
        });
      }
    } else {
      if (incidentFx.stableWelfareBonus !== 0) {
        welfareDelta += incidentFx.stableWelfareBonus;
        lines.push({
          kind: "bonus",
          text: `INCIDENTE // BONO POR RED ESTABLE: +${incidentFx.stableWelfareBonus} Bienestar`,
        });
      }
      if (incidentFx.stableBudgetBonus !== 0) {
        budgetDelta += incidentFx.stableBudgetBonus;
        lines.push({
          kind: "bonus",
          text: `INCIDENTE // BONO POR RED ESTABLE: +${incidentFx.stableBudgetBonus} $`,
        });
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
    incidents: (room.incidents || []).map((incident) => ({ id: incident.id, name: incident.name })),
    lockedSectors: { ...(room.lockedSectors || emptyLockedSectors()) },
    teamResults,
  };

  room.timerRunning = false;
  room.deadlineTs = null;
  room.paused = false;

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
    /** Semilla y guion de la partida: permite repetirla o analizarla. */
    seed: room.seed,
    incidentsPlayed: (room.usedIncidentIds || []).slice(),
    ranking,
    mentions,
  };
}

module.exports = {
  VERSION,
  SECTOR_ORDER,
  SECTOR_SPECS,
  INCIDENT_POOL,
  INCIDENT_MAX_SEVERITY,
  INCIDENT_COUNT_BY_ROUND,
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
  EXTRA_SECONDS,
  MIN_DISTRICTS,
  MAX_DISTRICTS,
  DISTRICTS,
  CRISIS_PRESETS,
  emptySectors,
  emptyLockedSectors,
  neutralEffects,
  incidentEffects,
  incidentMultipliers,
  incidentTags,
  incidentById,
  incidentLogLines,
  drawIncidents,
  isSectorLocked,
  nextRandom,
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
  openPlanning,
  beginRound,
  pauseClock,
  resumeClock,
  addTime,
  openNegotiation,
  recomputeDerived,
  resolveRound,
  finalResults,
};