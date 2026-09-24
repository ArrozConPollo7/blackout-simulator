/**
 * Contenido del juego como DATOS (no como logica dispersa).
 *
 * Todo numero de este archivo se deriva de las tarifas de `content/economy.ts`
 * mediante `makeEffect()`: cada opcion declara el consumo NETO que deja activo y su
 * inversion, y el efecto (deltas de electricidad/gas/presupuesto/eficiencia) se calcula.
 * Para rebalancear el juego solo hay que editar consumos e inversiones aqui.
 *
 * Referencias de consumo (`referencia`) = lo que el caso haria HOY sin intervenir.
 * Por eso:
 *   delta_electricidad = consumo_neto_de_la_opcion - consumo_de_referencia
 *   delta_presupuesto   = -(costo del consumo neto + inversion)
 *
 * Ronda 1 (investigar): diagnostico por electrodomestico. Sus efectos NO tocan
 * eficiencia (el documento dice que la Ronda 1 "no afecta el puntaje directamente");
 * mueven kWh/m3/$ y alimentan el resumen educativo.
 */

import type { DecisionEffect, DecisionOption } from '../types/game.ts';
import { CASE_BY_ID } from './cases.ts';
import { TARIFA_ELECTRICIDAD, TARIFA_GAS, costoElectricidad, costoGas } from './economy.ts';

export interface ConsumptionRef {
  electricidad: number; // kWh
  gas: number; // m3
}

interface OptionSeed {
  id: string;
  label: string;
  neto: Partial<ConsumptionRef>; // consumo que deja activo
  inversion?: number; // $ de equipo / mano de obra
  eficiencia?: number; // delta de eficiencia (solo Ronda 2)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function makeEffect(ref: ConsumptionRef, seed: OptionSeed): DecisionEffect {
  const netoE = seed.neto.electricidad ?? 0;
  const netoG = seed.neto.gas ?? 0;
  const costo = costoElectricidad(netoE) + costoGas(netoG) + (seed.inversion ?? 0);
  return {
    electricidad: round2(netoE - ref.electricidad),
    gas: round2(netoG - ref.gas),
    presupuesto: -Math.round(costo),
    eficiencia: seed.eficiencia ?? 0,
  };
}

function build(ref: ConsumptionRef, seeds: OptionSeed[]): DecisionOption[] {
  return seeds.map((seed) => ({ id: seed.id, label: seed.label, effect: makeEffect(ref, seed) }));
}

// ---------------------------------------------------------------------------
// Catalogo de electrodomesticos (Ronda 1)
// ---------------------------------------------------------------------------

export interface ApplianceProfile {
  id: string;
  name: string;
  icon: string; // Material Symbols Outlined (ver Design.md)
  category: string;
  potenciaText: string;
  usoText: string;
  consumoText: string;
  referencia: ConsumptionRef;
  /** Problema oculto que el equipo debe descubrir en la Ronda 1. */
  problemaOculto: string;
  options: DecisionOption[];
}

interface DiagnoseVariants {
  completa: { label: string; neto: Partial<ConsumptionRef>; inversion?: number };
  parcial: { label: string; neto: Partial<ConsumptionRef>; inversion?: number };
  ninguna: { label: string; neto: Partial<ConsumptionRef> };
}

/** Construye un electrodomestico con sus 3 opciones de diagnostico `r1:<aparato>:<variante>`. */
function makeAppliance(
  base: Omit<ApplianceProfile, 'options' | 'referencia'>,
  referencia: ConsumptionRef,
  variants: DiagnoseVariants,
): ApplianceProfile {
  return {
    ...base,
    referencia,
    options: build(referencia, [
      { id: `r1:${base.id}:completa`, ...variants.completa },
      { id: `r1:${base.id}:parcial`, ...variants.parcial },
      { id: `r1:${base.id}:ninguna`, ...variants.ninguna },
    ]),
  };
}

const AIRE: ApplianceProfile = makeAppliance(
  {
    id: 'aire-acondicionado',
    name: 'Aire acondicionado',
    icon: 'ac_unit',
    category: 'Climatización',
    potenciaText: '1.500 W',
    usoText: '8 h / dia',
    consumoText: '12 kWh / dia',
    problemaOculto:
      'Está configurado a 18 °C, muy por debajo del rango de confort (24 °C), y no usa modo ECO.',
  },
  { electricidad: 12, gas: 0 },
  {
    completa: {
      label: 'Ajustar el termostato a 24 °C y activar modo ECO',
      neto: { electricidad: 6 },
      inversion: 1200,
    },
    parcial: { label: 'Ajustar el termostato a 22 °C (sin modo ECO)', neto: { electricidad: 8.4 } },
    ninguna: { label: 'Dejarlo como está: 18 °C, 8 h y sin modo ECO', neto: { electricidad: 12 } },
  },
);

const NEVERA: ApplianceProfile = makeAppliance(
  {
    id: 'nevera',
    name: 'Nevera No-Frost',
    icon: 'kitchen',
    category: 'Refrigeración',
    potenciaText: '150 W promedio',
    usoText: '24 h / dia',
    consumoText: '3,6 kWh / dia',
    problemaOculto:
      'Está a 2 °C (más frío del necesario) y pegada a la pared: el compresor trabaja de más.',
  },
  { electricidad: 3.6, gas: 0 },
  {
    completa: {
      label: 'Termostato a 4 °C y separarla 10 cm de la pared',
      neto: { electricidad: 2.4 },
      inversion: 1200,
    },
    parcial: { label: 'Termostato a 3 °C', neto: { electricidad: 3 } },
    ninguna: { label: 'Sin intervenir: 2 °C y junto a la pared', neto: { electricidad: 3.6 } },
  },
);

const COMPUTADOR: ApplianceProfile = makeAppliance(
  {
    id: 'computador',
    name: 'Computador de escritorio',
    icon: 'computer',
    category: 'Equipamiento',
    potenciaText: '150 W',
    usoText: '12 h / dia',
    consumoText: '1,8 kWh / dia',
    problemaOculto: 'Permanece encendido 12 horas, incluso cuando nadie lo está usando.',
  },
  { electricidad: 1.8, gas: 0 },
  {
    completa: { label: 'Suspensión automática: queda activo 4 h', neto: { electricidad: 0.6 } },
    parcial: { label: 'Apagarlo al mediodía: queda activo 7 h', neto: { electricidad: 1.05 } },
    ninguna: { label: 'Dejarlo encendido 12 h', neto: { electricidad: 1.8 } },
  },
);

const ILUMINACION: ApplianceProfile = makeAppliance(
  {
    id: 'iluminacion',
    name: 'Alumbrado halógeno',
    icon: 'lightbulb',
    category: 'Iluminación',
    potenciaText: '8 bombillas x 60 W',
    usoText: '6 h / dia',
    consumoText: '2,88 kWh / dia',
    problemaOculto: '4 de las 8 luces permanecen encendidas en zonas vacías.',
  },
  { electricidad: 2.88, gas: 0 },
  {
    completa: {
      label: 'Cambiar a LED de 9 W y apagar las 4 luces innecesarias',
      neto: { electricidad: 0.29 },
      inversion: 1200,
    },
    parcial: { label: 'Apagar las 4 innecesarias (siguen halógenas)', neto: { electricidad: 1.44 } },
    ninguna: { label: 'Las 8 halógenas encendidas 6 h', neto: { electricidad: 2.88 } },
  },
);

const TELEVISOR: ApplianceProfile = makeAppliance(
  {
    id: 'televisor',
    name: 'Televisor',
    icon: 'tv',
    category: 'Entretenimiento',
    potenciaText: '120 W',
    usoText: '5 h / dia',
    consumoText: '0,6 kWh / dia',
    problemaOculto: 'Queda encendido de fondo aunque nadie lo esté mirando.',
  },
  { electricidad: 0.6, gas: 0 },
  {
    completa: { label: 'Verlo 3 h y apagarlo al terminar', neto: { electricidad: 0.36 } },
    parcial: { label: 'Verlo 4 h', neto: { electricidad: 0.48 } },
    ninguna: { label: '5 h de fondo', neto: { electricidad: 0.6 } },
  },
);

const LAVADORA: ApplianceProfile = makeAppliance(
  {
    id: 'lavadora',
    name: 'Lavadora',
    icon: 'local_laundry_service',
    category: 'Lavado',
    potenciaText: '2.200 W',
    usoText: '1,2 h / ciclo',
    consumoText: '2,64 kWh / ciclo',
    problemaOculto: 'Se usa un ciclo completo a 60 °C con la carga a medias.',
  },
  { electricidad: 2.64, gas: 0 },
  {
    completa: { label: 'Un ciclo a 30 °C con carga llena', neto: { electricidad: 1.32 } },
    parcial: { label: 'Un ciclo a 40 °C', neto: { electricidad: 1.9 } },
    ninguna: { label: 'Ciclo de 60 °C a media carga', neto: { electricidad: 2.64 } },
  },
);

const ESTUFA: ApplianceProfile = makeAppliance(
  {
    id: 'estufa-gas',
    name: 'Estufa y horno de gas',
    icon: 'outdoor_grill',
    category: 'Cocción',
    potenciaText: '0,8 m3 / h (quemadores)',
    usoText: '1 h quemadores + 1 h horno',
    consumoText: '2,4 m3 / dia',
    problemaOculto: 'Se cocina a llama alta, sin tapa y con el horno encendido de más.',
  },
  { electricidad: 0, gas: 2.4 },
  {
    completa: { label: '30 min con olla a presión y sin horno', neto: { gas: 1.2 } },
    parcial: { label: '45 min a llama media más 1 h de horno', neto: { gas: 2 } },
    ninguna: { label: 'Como está: 1 h de quemadores y 1 h de horno', neto: { gas: 2.4 } },
  },
);

const CALENTADOR: ApplianceProfile = makeAppliance(
  {
    id: 'calentador-gas',
    name: 'Calentador de agua a gas',
    icon: 'water_heater',
    category: 'Térmico',
    potenciaText: '1,5 m3 / h',
    usoText: '4 h / dia (ducha de 4 personas)',
    consumoText: '6,0 m3 / dia',
    problemaOculto: 'Funciona más tiempo del necesario: mantiene 70 °C todo el día.',
  },
  { electricidad: 0, gas: 6 },
  {
    completa: { label: 'Programarlo 2 h a 55 °C', neto: { gas: 3 }, inversion: 800 },
    parcial: { label: 'Bajar el termostato a 60 °C (sigue 4 h)', neto: { gas: 4.8 } },
    ninguna: { label: 'Como está: 4 h a 70 °C', neto: { gas: 6 } },
  },
);

export const APPLIANCE_CATALOG: ApplianceProfile[] = [
  AIRE,
  NEVERA,
  COMPUTADOR,
  ILUMINACION,
  TELEVISOR,
  LAVADORA,
  ESTUFA,
  CALENTADOR,
];

export const APPLIANCE_BY_ID: Record<string, ApplianceProfile> = Object.fromEntries(
  APPLIANCE_CATALOG.map((a) => [a.id, a]),
);

// ---------------------------------------------------------------------------
// Ronda 2 (decidir) y Ronda 2b (decidir_2, tras el evento sorpresa)
// ---------------------------------------------------------------------------

export interface DecisionScenario {
  id: string;
  round: 'investigar' | 'decidir' | 'decidir_2';
  title: string;
  prompt: string;
  icon: string;
  options: DecisionOption[];
  /**
   * Aparatos que la situación menciona y necesita. Un caso solo juega las situaciones cuyos
   * aparatos tiene todos (ver `scenariosForCase`): antes la Ronda 2 ofrecía a todos los casos
   * "Día de lavado" u "Hora de cocinar" aunque la vivienda no tuviera lavadora ni estufa.
   */
  requires?: string[];
}

const SCENARIO_CALOR: DecisionScenario = {
  id: 'calor',
  round: 'decidir',
  requires: ['aire-acondicionado'],
  title: 'Hoy hace mucho calor',
  prompt: 'La temperatura sube a 36 °C y la familia quiere estar fresca.',
  icon: 'ac_unit',
  options: build({ electricidad: 12, gas: 0 }, [
    {
      id: 'r2:calor:a',
      label: 'Aire acondicionado 8 h a 18 °C',
      neto: { electricidad: 12 },
      eficiencia: -3,
    },
    {
      id: 'r2:calor:b',
      label: 'Aire acondicionado 4 h a 24 °C',
      neto: { electricidad: 6 },
      eficiencia: 4,
    },
    {
      id: 'r2:calor:c',
      label: 'Ventilación natural (solo ventilador)',
      neto: { electricidad: 0.6 },
      eficiencia: -2,
    },
  ]),
};

const SCENARIO_COCINA: DecisionScenario = {
  id: 'cocina',
  round: 'decidir',
  requires: ['estufa-gas', 'calentador-gas'],
  title: 'Hora de cocinar',
  prompt: 'La cena para cuatro personas está sobre la estufa.',
  icon: 'outdoor_grill',
  options: build({ electricidad: 0, gas: 2.4 }, [
    { id: 'r2:cocina:a', label: 'Estufa y horno 60 min', neto: { gas: 2.4 }, eficiencia: -3 },
    {
      id: 'r2:cocina:b',
      label: 'Estufa 30 min con olla a presión, sin horno',
      neto: { gas: 1.2 },
      eficiencia: 4,
    },
    {
      id: 'r2:cocina:c',
      label: 'Comida que requiere menos cocción',
      neto: { gas: 0.4 },
      eficiencia: -3,
    },
  ]),
};

const SCENARIO_NEVERA: DecisionScenario = {
  id: 'nevera',
  round: 'decidir',
  requires: ['nevera'],
  title: 'La nevera no para de zumbar',
  prompt: 'El compresor arranca cada pocos minutos y la cocina está caliente.',
  icon: 'kitchen',
  options: build({ electricidad: 3.6, gas: 0 }, [
    {
      id: 'r2:nevera:a',
      label: 'Dejar el termostato al máximo (2 °C)',
      neto: { electricidad: 4.6 },
      eficiencia: -3,
    },
    {
      id: 'r2:nevera:b',
      label: 'Termostato a 4 °C y separarla de la pared',
      neto: { electricidad: 2.4 },
      eficiencia: 4,
    },
    {
      id: 'r2:nevera:c',
      label: 'Apagarla 6 h al día para ahorrar',
      neto: { electricidad: 1.8 },
      eficiencia: -5,
    },
  ]),
};

const SCENARIO_ENTRETENIMIENTO: DecisionScenario = {
  id: 'entretenimiento',
  round: 'decidir',
  requires: ['televisor', 'computador'],
  title: 'Tarde de series y computador',
  prompt: 'El televisor y el computador compiten por el mismo enchufe.',
  icon: 'tv',
  options: build({ electricidad: 2.4, gas: 0 }, [
    {
      id: 'r2:entretenimiento:a',
      label: 'TV 5 h + computador 12 h encendido',
      neto: { electricidad: 2.4 },
      eficiencia: -3,
    },
    {
      id: 'r2:entretenimiento:b',
      label: 'TV 3 h + computador 4 h con suspensión',
      neto: { electricidad: 0.96 },
      eficiencia: 4,
    },
    {
      id: 'r2:entretenimiento:c',
      label: 'Sin TV y computador solo 1 h',
      neto: { electricidad: 0.15 },
      eficiencia: -3,
    },
  ]),
};

const SCENARIO_LAVADO: DecisionScenario = {
  id: 'lavado',
  round: 'decidir',
  requires: ['lavadora', 'calentador-gas'],
  title: 'Día de lavado',
  prompt: 'Hay dos canastos esperando en el cuarto de ropas.',
  icon: 'local_laundry_service',
  options: build({ electricidad: 2.64, gas: 1.2 }, [
    {
      id: 'r2:lavado:a',
      label: 'Dos ciclos a 60 °C (agua caliente del calentador)',
      neto: { electricidad: 5.28, gas: 2.4 },
      eficiencia: -3,
    },
    {
      id: 'r2:lavado:b',
      label: 'Un ciclo a 30 °C con carga llena',
      neto: { electricidad: 1.32, gas: 0.6 },
      eficiencia: 4,
    },
    {
      id: 'r2:lavado:c',
      label: 'Lavar a mano con agua fría',
      neto: { electricidad: 0.3, gas: 0 },
      eficiencia: -4,
    },
  ]),
};

const SCENARIO_ALUMBRADO: DecisionScenario = {
  id: 'alumbrado',
  round: 'decidir',
  requires: ['iluminacion'],
  title: 'Llegó la noche',
  prompt: 'La casa necesita luz en la sala, la cocina y los cuartos.',
  icon: 'lightbulb',
  options: build({ electricidad: 2.88, gas: 0 }, [
    {
      id: 'r2:alumbrado:a',
      label: 'Todas las luces encendidas 6 h',
      neto: { electricidad: 2.88 },
      eficiencia: -3,
    },
    {
      id: 'r2:alumbrado:b',
      label: 'Solo las zonas ocupadas, 3 h',
      neto: { electricidad: 1.44 },
      eficiencia: 4,
    },
    {
      id: 'r2:alumbrado:c',
      label: 'Sin luz artificial (linternas)',
      neto: { electricidad: 0 },
      eficiencia: -4,
    },
  ]),
};

/** Ronda 2b: se juega DESPUES del evento sorpresa, con el precio ya aumentado. */
const SCENARIO_CRISIS_FINAL: DecisionScenario = {
  id: 'crisis-final',
  round: 'decidir_2',
  title: 'Últimas decisiones bajo crisis',
  prompt:
    'La demanda de la red se disparó y la tarifa sube 30%. Cada kWh que mantengas activo ahora cuesta más caro.',
  icon: 'warning',
  options: build({ electricidad: 14.4, gas: 0 }, [
    {
      id: 'r2b:crisis-final:desconexion',
      label: 'Desconexión de emergencia de los no esenciales',
      neto: { electricidad: 4.8 },
      eficiencia: 3,
    },
    {
      id: 'r2b:crisis-final:minimo',
      label: 'Reducción al mínimo operativo',
      neto: { electricidad: 9.6 },
      eficiencia: -1,
    },
    {
      id: 'r2b:crisis-final:habitual',
      label: 'Mantener la operación habitual',
      neto: { electricidad: 14.4 },
      eficiencia: -5,
    },
  ]),
};

/** Escenarios de Ronda 1: uno por electrodomestico del catalogo. */
export const ROUND1_SCENARIOS: DecisionScenario[] = APPLIANCE_CATALOG.map((a) => ({
  id: `investigar:${a.id}`,
  round: 'investigar',
  title: a.name,
  prompt: a.problemaOculto,
  icon: a.icon,
  options: a.options,
}));

export const ROUND2_SCENARIOS: DecisionScenario[] = [
  SCENARIO_CALOR,
  SCENARIO_COCINA,
  SCENARIO_NEVERA,
  SCENARIO_ENTRETENIMIENTO,
  SCENARIO_LAVADO,
  SCENARIO_ALUMBRADO,
];

export const ROUND2B_SCENARIOS: DecisionScenario[] = [SCENARIO_CRISIS_FINAL];

export const SCENARIOS_BY_ROUND: Record<DecisionScenario['round'], DecisionScenario[]> = {
  investigar: ROUND1_SCENARIOS,
  decidir: ROUND2_SCENARIOS,
  decidir_2: ROUND2B_SCENARIOS,
};

export const SCENARIOS_BY_ID: Record<string, DecisionScenario> = Object.fromEntries(
  [...ROUND1_SCENARIOS, ...ROUND2_SCENARIOS, ...ROUND2B_SCENARIOS].map((s) => [s.id, s]),
);

/** Indice plano id de opcion -> opcion (validacion O(1) en el Worker). */
export const OPTIONS_BY_ID: Record<string, DecisionOption> = Object.fromEntries(
  Object.values(SCENARIOS_BY_ID).flatMap((s) => s.options.map((o) => [o.id, o] as const)),
);

/** Opcion -> clave de escenario ya resuelto (para impedir responder dos veces lo mismo). */
export function scenarioKeyOfOption(optionId: string): string {
  const parts = optionId.split(':');
  if (parts[0] === 'r1') return `r1:${parts[1]}`;
  if (parts[0] === 'r2b') return 'r2b';
  return `r2:${parts[1]}`;
}

/**
 * Escenarios que puede jugar un caso concreto en una ronda dada.
 *   Ronda 1: solo los electrodomesticos que el caso declara investigables.
 *   Ronda 2: solo las situaciones cuyos aparatos el caso tiene TODOS (una vivienda sin
 *            lavadora no juega "Dia de lavado").
 *   Ronda 2b: la crisis es del aula entera, la juegan todos.
 *
 * El numero de situaciones por caso no es el mismo (6 con los 8 aparatos, 3 con 4), asi que
 * el motor reparte el peso de eficiencia de cada situacion segun cuantas juega el caso
 * (`pesoEficienciaR2`): asi todos tienen la misma oportunidad de ganar o perder eficiencia.
 */
export function scenariosForCase(
  round: DecisionScenario['round'],
  applianceIds: string[] | null,
): DecisionScenario[] {
  const all = SCENARIOS_BY_ROUND[round] ?? [];
  if (!applianceIds) return all;
  if (round === 'investigar') {
    return all.filter((s) => applianceIds.includes(s.id.replace('investigar:', '')));
  }
  if (round === 'decidir') {
    return all.filter((s) => (s.requires ?? []).every((a) => applianceIds.includes(a)));
  }
  return all;
}

/**
 * Cuantas situaciones de Ronda 2 juega el caso con esos aparatos.
 * Base del reparto de peso: `situacionesDeRonda2 / jugables`.
 */
export function pesoEficienciaR2(appliances: string[] | null): number {
  const jugables = scenariosForCase('decidir', appliances).length;
  if (!jugables) return 1;
  return ROUND2_SCENARIOS.length / jugables;
}

/** Aparatos que menciona una situacion (los que hay que descontar de la Ronda 1). */
export function appliancesOfScenario(scenarioId: string): string[] {
  return SCENARIOS_BY_ID[scenarioId]?.requires ?? [];
}

/** Busca la opcion dentro de un escenario (valida pertenencia, no solo existencia). */
export function findOptionInScenario(
  scenario: DecisionScenario,
  optionId: string,
): DecisionOption | undefined {
  return scenario.options.find((o) => o.id === optionId);
}

/**
 * Escenario al que pertenece una opcion, segun el prefijo de su id
 * (`r1:<aparato>`, `r2:<situacion>`, `r2b:<variante>`).
 * Si se pasa `caseId`, ademas valida que el aparato pertenezca a ese caso
 * (la Ronda 1 solo permite investigar los aparatos del propio caso).
 */
export function resolveScenarioForOption(
  optionId: string,
  caseId?: string,
): DecisionScenario | undefined {
  const [prefix, key] = optionId.split(':');

  if (prefix === 'r1') {
    if (caseId !== undefined) {
      const caso = CASE_BY_ID[caseId];
      if (!caso || !caso.appliances.includes(key)) return undefined;
    }
    const scenario = SCENARIOS_BY_ID[`investigar:${key}`];
    return scenario && findOptionInScenario(scenario, optionId) ? scenario : undefined;
  }
  if (prefix === 'r2') {
    const scenario = SCENARIOS_BY_ID[key];
    if (!scenario || scenario.round !== 'decidir') return undefined;
    if (!findOptionInScenario(scenario, optionId)) return undefined;
    if (caseId !== undefined) {
      const caso = CASE_BY_ID[caseId];
      if (!caso) return undefined;
      const falta = (scenario.requires ?? []).some((a) => !caso.appliances.includes(a));
      if (falta) return undefined;
    }
    return scenario;
  }
  if (prefix === 'r2b') {
    const scenario = SCENARIOS_BY_ID['crisis-final'];
    return scenario?.round === 'decidir_2' && findOptionInScenario(scenario, optionId)
      ? scenario
      : undefined;
  }
  return undefined;
}
