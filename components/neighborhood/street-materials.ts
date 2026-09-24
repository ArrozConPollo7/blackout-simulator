/**
 * Fachada corta del catálogo de materiales para la calle.
 *
 * Existe por legibilidad: la escena de calle pide "material de calzada", "señal de
 * tráfico"… nombres del dominio urbano, no del dominio del edificio. Todos los
 * materiales salen de ../materials (cacheados por clave, sin assets externos).
 */

import type * as THREE from 'three';

import { glowMaterial, signMaterial, sidewalkMaterial, trimMaterial } from './materials';

export { grassMaterial, grilleMaterial, metalMaterial, trimMaterial } from './materials';

/** Hormigón de la acera/calzada. */
export function concreteRoadMaterial(): THREE.MeshStandardMaterial {
  return sidewalkMaterial();
}

/** Señalética (de calle o de aviso eléctrico). */
export function pavementSignMaterial(
  text: string,
  accent: string,
  variant: 'street' | 'warning',
): THREE.MeshStandardMaterial {
  return signMaterial(text, accent, variant);
}

/** Halo aditivo compartido: charcos de luz, arcos y pulsos de energía. */
export function sharedGlowMaterial(color: string, opacity: number): THREE.MeshBasicMaterial {
  return glowMaterial(color, opacity);
}
