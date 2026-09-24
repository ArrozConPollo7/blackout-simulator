/**
 * Casos de equipo. Formato tomado de "Familia Duque" del documento del proyecto:
 * un nombre, la lista de electrodomesticos investigables y los problemas ocultos
 * que el equipo debe detectar en la Ronda 1.
 *
 * `hiddenProblems` referencia ids del catalogo de electrodomesticos
 * (`content/decisions.ts`), donde vive la descripcion del problema oculto.
 */

import type { TeamCase } from '../types/game.ts';

export const CASE_CATALOG: TeamCase[] = [
  {
    id: 'familia-duque',
    name: 'Familia Duque',
    appliances: [
      'aire-acondicionado',
      'nevera',
      'computador',
      'iluminacion',
      'televisor',
      'lavadora',
      'estufa-gas',
      'calentador-gas',
    ],
    hiddenProblems: ['iluminacion', 'computador', 'calentador-gas', 'aire-acondicionado'],
  },
  {
    id: 'empresa-x',
    name: 'Empresa X',
    appliances: ['aire-acondicionado', 'computador', 'iluminacion', 'nevera', 'televisor'],
    hiddenProblems: ['aire-acondicionado', 'iluminacion', 'computador'],
  },
  {
    id: 'apartamento-y',
    name: 'Apartamento Y',
    appliances: ['nevera', 'televisor', 'computador', 'lavadora', 'iluminacion'],
    hiddenProblems: ['nevera', 'televisor', 'iluminacion'],
  },
  {
    id: 'panaderia-la-esquina',
    name: 'Panaderia La Esquina',
    appliances: ['estufa-gas', 'calentador-gas', 'nevera', 'iluminacion', 'aire-acondicionado'],
    hiddenProblems: ['estufa-gas', 'calentador-gas', 'nevera'],
  },
  {
    id: 'gimnasio-zona-vital',
    name: 'Gimnasio Zona Vital',
    appliances: ['calentador-gas', 'lavadora', 'aire-acondicionado', 'iluminacion', 'computador'],
    hiddenProblems: ['calentador-gas', 'lavadora', 'aire-acondicionado'],
  },
  {
    id: 'oficina-norte',
    name: 'Oficina Norte',
    appliances: ['computador', 'iluminacion', 'aire-acondicionado', 'nevera'],
    hiddenProblems: ['computador', 'iluminacion'],
  },
];

/** Colores de identidad de equipo, tomados de la paleta de Design.md. */
export const TEAM_COLORS: string[] = [
  '#3ECF8E', // accent-eficiencia
  '#F5B942', // accent-electricidad
  '#3EC6F0', // accent-presupuesto
  '#F2622E', // accent-gas
  '#FFB77A', // tertiary
  '#8BDFFF', // primary
];

export const CASE_BY_ID: Record<string, TeamCase> = Object.fromEntries(
  CASE_CATALOG.map((c) => [c.id, c]),
);

/** Casos a usar en una partida segun el numero de equipos pedido (4-6). */
export function casesForTeamCount(count: number): TeamCase[] {
  const n = Math.max(1, Math.min(CASE_CATALOG.length, Math.trunc(count) || CASE_CATALOG.length));
  return CASE_CATALOG.slice(0, n);
}
