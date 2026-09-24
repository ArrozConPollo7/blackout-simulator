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

/** Evento sorpresa: "el precio de la electricidad aumento un 30%". */
export const CRISIS_PRICE_MULTIPLIER = 1.3;
export const CRISIS_SURCHARGE_RATE = CRISIS_PRICE_MULTIPLIER - 1; // 0.3

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
 * Sobrecosto del evento sorpresa: el +30% de tarifa se aplica sobre el consumo
 * electrico ACUMULADO de cada equipo, no de forma pareja. Un equipo que ya redujo
 * (70 kWh) paga 30% de 70 kWh y uno que dejo todo encendido (104 kWh) paga 30% de 104 kWh.
 */
export function sobrecostoCrisis(electricidadAcumulada: number): number {
  return Math.round(costoElectricidad(Math.max(0, electricidadAcumulada)) * CRISIS_SURCHARGE_RATE);
}
