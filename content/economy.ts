/**
 * Calibracion economica del juego.
 *
 * Reglas (fijadas junto con `documento-proyecto-energia-en-crisis.md`, seccion 3):
 *
 *  - Estado inicial de TODO equipo: electricidad 100 kWh, gas 100 m3,
 *    presupuesto $100.000, eficiencia 50%. Es la situacion de partida descrita en el
 *    documento; los casos comparten esos valores, solo cambia el contenido.
 *  - `presupuesto` es dinero RESTANTE. Cada opcion de decision cuesta el consumo que
 *    deja activo (kWh x tarifa + m3 x tarifa) mas, si aplica, una inversion puntual.
 *    Ninguna opcion suma dinero: elegir bien solo cuesta menos.
 *  - `electricidad` / `gas` son el consumo acumulado del caso en unidades fisicas
 *    (kWh, m3). El 100 inicial es el consumo de referencia del caso (lo que gastaria
 *    hoy, sin intervenir); cada opcion declara su consumo neto y el motor aplica la
 *    diferencia contra esa referencia. Por eso un equipo derrochador puede terminar
 *    por encima de 100 y uno eficiente por debajo (el documento usa 72 kWh como
 *    ejemplo de resultado final).
 *  - `eficiencia` (0-100) es el criterio de ranking: mide confort/servicio mantenido
 *    por unidad de consumo. Cortar consumo bajando confort la BAJA.
 *
 * Las tarifas estan calibradas para que el consumo de referencia del caso
 * (100 kWh + 100 m3) valga aproximadamente el presupuesto completo:
 *   100 x 550 + 100 x 450 = $100.000
 */

export const TARIFA_ELECTRICIDAD = 550; // $ por kWh
export const TARIFA_GAS = 450; // $ por m3

export const CONSUMO_REFERENCIA_ELECTRICIDAD = 100; // kWh
export const CONSUMO_REFERENCIA_GAS = 100; // m3

export const PRESUPUESTO_INICIAL = 100000; // $
export const EFICIENCIA_INICIAL = 50; // %

/**
 * Evento sorpresa. El alza de tarifa ya no es siempre +30% (plan 2.3): al iniciar la
 * partida se sortea un porcentaje entre `CRISIS_RATE_MIN` y `CRISIS_RATE_MAX` con la semilla.
 * `CRISIS_PRICE_MULTIPLIER` / `CRISIS_SURCHARGE_RATE` quedan como el valor central de la
 * calibracion (el que usa el balanceo de referencia y los ejemplos del documento).
 */
export const CRISIS_PRICE_MULTIPLIER = 1.3;
export const CRISIS_SURCHARGE_RATE = CRISIS_PRICE_MULTIPLIER - 1; // 0.3
export const CRISIS_RATE_MIN = 0.2;
export const CRISIS_RATE_MAX = 0.45;
/** Paso del sorteo: la tarifa sube en saltos de 1%, no en porcentajes con decimales. */
export const CRISIS_RATE_STEP = 0.01;

/**
 * Puntos de eficiencia que reparte la Ronda 2 entre todos los equipos, jueguen las
 * situaciones que jueguen (ver `pesoEficienciaR2`). Es el invariante que hace comparable
 * una partida con 3 situaciones sorteadas y otra con 4.
 */
export const ROUND2_EFICIENCIA_TOTAL = 24;

/** Presupuesto que reparte el evento "subsidio sorpresa" a cada equipo (plan 2.2). */
export const SUBSIDIO_SORPRESA = 8000;

/** Recargo de consumo que deja una falla de aparato, en tanto por uno (plan 2.2). */
export const FALLA_APARATO_RATE = 0.2;

export const LIMITES = {
  electricidad: { min: 0, max: 220 },
  gas: { min: 0, max: 220 },
  eficiencia: { min: 0, max: 100 },
} as const;

/** Costo del consumo electrico acumulado (a la tarifa vigente). */
export function costoElectricidad(kwh: number): number {
  return kwh * TARIFA_ELECTRICIDAD;
}

/** Costo del consumo de gas acumulado. */
export function costoGas(m3: number): number {
  return m3 * TARIFA_GAS;
}

/** Costo total del consumo acumulado de un equipo. */
export function costoConsumo(consumo: { electricidad: number; gas: number }): number {
  return costoElectricidad(consumo.electricidad) + costoGas(consumo.gas);
}

/**
 * Sobrecosto del evento sorpresa: el alza de tarifa se aplica sobre el consumo
 * electrico ACUMULADO de cada equipo, no de forma pareja. Un equipo que ya redujo
 * (70 kWh) paga el alza de 70 kWh y uno que dejo todo encendido (104 kWh) la paga de 104.
 *
 * `rate` es la intensidad sorteada para esta partida (20-45%); sin argumento vale el
 * 30% central de la calibracion.
 */
export function sobrecostoCrisis(
  electricidadAcumulada: number,
  rate: number = CRISIS_SURCHARGE_RATE,
): number {
  return Math.round(costoElectricidad(Math.max(0, electricidadAcumulada)) * rate);
}
