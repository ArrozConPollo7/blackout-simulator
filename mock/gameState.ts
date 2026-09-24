import { GameState, TeamState, Appliance, DecisionCardOption } from '@/types/game';

/**
 * Datos MOCK del cascarón visual (Fase 0).
 *
 * Desde la Fase 2 la aplicación real NO usa estos datos: el Host y el Player piden el
 * estado completo al Worker (`GET /game/:id/state`) y se suscriben a Supabase Realtime.
 * Este archivo queda como fallback para desarrollo aislado de la UI (por ejemplo,
 * Storybook o una vista sin partida creada) y para el DemoNav del cascarón.
 */

export const mockTeams: TeamState[] = [
  {
    id: 'alfa',
    name: 'Equipo Alfa',
    color: '#3ECF8E',
    electricidad: 142,
    gas: 18,
    presupuesto: 48500,
    eficiencia: 88,
    puntos: 920,
  },
  {
    id: 'gamma',
    name: 'Equipo Gamma',
    color: '#f9bc45',
    electricidad: 198,
    gas: 24,
    presupuesto: 38200,
    eficiencia: 74,
    puntos: 810,
  },
  {
    id: 'delta',
    name: 'Equipo Delta',
    color: '#3EC6F0',
    electricidad: 225,
    gas: 31,
    presupuesto: 29400,
    eficiencia: 62,
    puntos: 730,
  },
  {
    id: 'beta',
    name: 'Equipo Beta',
    color: '#FF3B4E',
    electricidad: 274,
    gas: 42,
    presupuesto: 14800,
    eficiencia: 41,
    puntos: 560,
  },
  {
    id: 'epsilon',
    name: 'Equipo Epsilon',
    color: '#ffb77a',
    electricidad: 175,
    gas: 21,
    presupuesto: 42000,
    eficiencia: 80,
    puntos: 850,
  },
  {
    id: 'zeta',
    name: 'Equipo Zeta',
    color: '#8bdfff',
    electricidad: 215,
    gas: 29,
    presupuesto: 33000,
    eficiencia: 66,
    puntos: 750,
  }
];

export const mockGameState: GameState = {
  phase: 'decidir',
  timerEndsAt: new Date(Date.now() + 3 * 60 * 1000 + 42 * 1000).toISOString(),
  crisisTriggered: false,
  teams: mockTeams,
};

export const mockAppliances: Appliance[] = [
  {
    id: 'ac',
    name: 'Aire Acondicionado Split',
    category: 'Climatización',
    icon: 'mode_fan',
    consumptionText: '1,800 W / h',
    costText: '$14,400 / ciclo',
    stateText: 'Encendido a 21 °C continuo',
    isHighImpact: true,
  },
  {
    id: 'refrigerator',
    name: 'Nevera No-Frost',
    category: 'Refrigeración',
    icon: 'kitchen',
    consumptionText: '350 W / h',
    costText: '$8,200 / ciclo',
    stateText: 'Compresor activo (Ciclo 80%)',
    isHighImpact: false,
  },
  {
    id: 'computer',
    name: 'Estación de Cómputo',
    category: 'Equipamiento',
    icon: 'computer',
    consumptionText: '450 W / h',
    costText: '$4,500 / ciclo',
    stateText: 'Modo Alto Rendimiento',
    isHighImpact: false,
  },
  {
    id: 'lighting',
    name: 'Alumbrado Incandescente',
    category: 'Iluminación',
    icon: 'lightbulb',
    consumptionText: '600 W / h',
    costText: '$5,100 / ciclo',
    stateText: '6 focos halógenos activos',
    isHighImpact: true,
  },
  {
    id: 'gas-heater',
    name: 'Calentador de Agua Gas',
    category: 'Térmico',
    icon: 'mode_heat',
    consumptionText: '0,8 m³ / h',
    costText: '$3,800 / ciclo',
    stateText: 'Piloto continuo + flujo medio',
    isHighImpact: false,
  },
  {
    id: 'stove',
    name: 'Estufa y Horno a Gas',
    category: 'Cocción',
    icon: 'soup_kitchen',
    consumptionText: '1,2 m³ / h',
    costText: '$4,200 / ciclo',
    stateText: '2 quemadores en uso',
    isHighImpact: false,
  }
];

export const mockDecisions: DecisionCardOption[] = [
  {
    id: 'opt_a',
    title: 'Aire Continuo a 19 °C',
    description: 'Máxima potencia de refrigeración durante todo el periodo de calor.',
    impactElectricidad: '+85 kWh',
    impactPresupuesto: '-$18,000',
    impactComfort: 'Máximo',
    isHighRisk: true,
  },
  {
    id: 'opt_b',
    title: 'Climatización Eficiente a 24 °C + Ventilación',
    description: 'Ajuste de termostato a temperatura de confort sostenible con soporte de ventilador.',
    impactElectricidad: '+28 kWh',
    impactPresupuesto: '-$5,200',
    impactComfort: 'Óptimo',
    recommended: true,
  },
  {
    id: 'opt_c',
    title: 'Apagar A/C y Ventilación Natural Pasiva',
    description: 'Bajar persianas, ventilar por corrientes cruzadas y usar solo ventilador de bajo consumo.',
    impactElectricidad: '+6 kWh',
    impactPresupuesto: '-$1,100',
    impactComfort: 'Bajo',
  }
];

export const mockCrisisDecisions: DecisionCardOption[] = [
  {
    id: 'crisis_opt_1',
    title: 'Desconexión de Emergencia de No Esenciales',
    description: 'Apagado inmediato de climatización y equipos de alto amperaje para estabilizar la línea.',
    impactElectricidad: '-60% Inmediato',
    impactPresupuesto: 'Conserva presupuesto',
    impactComfort: 'Servicios esenciales activos',
    recommended: true,
  },
  {
    id: 'crisis_opt_2',
    title: 'Reducción al Mínimo Operativo (Modo Supervivencia)',
    description: 'Ajuste del consumo general al 50% con desconexión progresiva.',
    impactElectricidad: '-30% Inmediato',
    impactPresupuesto: 'Sobrecosto moderado',
    impactComfort: 'Confort parcial',
  },
  {
    id: 'crisis_opt_3',
    title: 'Mantener Operación Habitual (No Intervenir)',
    description: 'Asumir el riesgo de apagón zonal y multas por sobreconsumo en horario pico.',
    impactElectricidad: 'Sin reducción',
    impactPresupuesto: 'Penalización 300% tarifa',
    impactComfort: 'Riesgo crítico de caída',
    isHighRisk: true,
  }
];
