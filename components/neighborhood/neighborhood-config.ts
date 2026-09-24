/**
 * Configuración, geometría determinista y matemáticas de encuadre del vecindario.
 *
 * Este módulo es PURO (no toca React ni el DOM): define paletas, arquetipos
 * arquitectónicos, la variación determinista por `team.id`, el reparto de la fila
 * de casas, el encuadre de cámara y —lo más importante— el MAPA DE ESTADO → IMAGEN
 * que el Host proyecta en el aula:
 *
 *   electricidad → nº de ventanas encendidas            (litFraction)
 *   gas          → humo/llama de la chimenea o el flue  (smokeIntensity)
 *   eficiencia   → color del aura/césped y de la luz    (efficiencyColor)
 *   presupuesto  → velocidad del medidor del techo      (meterSpeed)
 *   ranking      → haz/aura sobre el líder              (compareTeams en el stage)
 *   crisis       → ambiente rojo-ámbar + parpadeo común (ver HouseModel/StreetScene)
 *
 * DETERMINISMO: la arquitectura de cada equipo se deriva de un hash FNV-1a de
 * `team.id`, NUNCA del nombre (los jugadores escriben nombres libres) ni del índice
 * (los equipos entran en distinto orden). Mismo id → mismo edificio, siempre.
 *
 * RENDIMIENTO (el proyecto ya sufrió un pico de CPU en el proyector del aula):
 *  - `expDamp` (1 - e^(-delta·k)) se usa en TODA interpolación: sin saltos y sin
 *    depender de los FPS del portátil.
 *  - Las funciones que devuelven color escriben en un `out` reutilizable para que
 *    `useFrame` no asigne un solo objeto por frame (cero basura → cero GC spikes).
 */

import * as THREE from 'three';
import type { TeamState } from '@/types/game';

/* -------------------------------------------------------------------------- *
 * 1. Referencias del caso (content/economy.ts) → escalas de la imagen
 * -------------------------------------------------------------------------- */

/** Consumo de referencia del caso: 100 kWh / 100 m³ con $100.000 de presupuesto. */
export const CONSUMO_REF_ELECTRICIDAD = 100;
export const CONSUMO_REF_GAS = 100;
export const PRESUPUESTO_INICIAL = 100000;

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const mapRange = (
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number => {
  if (inMax === inMin) return outMin;
  return outMin + ((clamp(value, inMin, inMax) - inMin) / (inMax - inMin)) * (outMax - outMin);
};

/**
 * Suavizado exponencial correcto (independiente del framerate).
 * Se usa SIEMPRE en lugar de `+= (destino - actual) * 0.1`, que cambia de velocidad
 * según los FPS y en el portátil del aula provoca tirones.
 */
export const expDamp = (delta: number, k: number): number => 1 - Math.exp(-delta * k);

/* -------------------------------------------------------------------------- *
 * 2. Azar determinista (hash del id, no del nombre)
 * -------------------------------------------------------------------------- */

/** FNV-1a de 32 bits: barato, estable entre plataformas y sin colisiones prácticas. */
export function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** PRNG mulberry32: mismo seed → misma secuencia → misma arquitectura. */
export function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

const pick = <T,>(rng: Rng, options: readonly T[]): T =>
  options[Math.min(options.length - 1, Math.floor(rng() * options.length))];

const range = (rng: Rng, min: number, max: number): number => min + rng() * (max - min);

/* -------------------------------------------------------------------------- *
 * 3. Paletas y materiales de fachada (armonizadas con Design.md)
 * -------------------------------------------------------------------------- */

export interface HousePalette {
  id: string;
  /** Color base del muro (se modula con la textura de estuco procedural). */
  wall: string;
  /** Aleros, cornisas y zócalo: contraste claro para leer la arquitectura. */
  trim: string;
  /** Tejado (teja / losa). */
  roof: string;
  /** Dinteles y antepechos: un paso más oscuro que `trim`. */
  accent: string;
}

export const PALETTES: readonly HousePalette[] = [
  { id: 'pizarra', wall: '#3A4356', trim: '#C7D2E4', roof: '#3E4450', accent: '#8E9BB3' },
  { id: 'arena', wall: '#4A4237', trim: '#E2D8C3', roof: '#6B4636', accent: '#A99A80' },
  { id: 'verde', wall: '#3C473F', trim: '#D3DECD', roof: '#333A31', accent: '#8FA08C' },
  { id: 'teja', wall: '#54424A', trim: '#DFCED6', roof: '#5C3A34', accent: '#A98F99' },
  { id: 'hielo', wall: '#36444E', trim: '#BFD6DE', roof: '#2E3A44', accent: '#8CA6B2' },
  { id: 'ocre', wall: '#4C4433', trim: '#E4DAC0', roof: '#514233', accent: '#A79B78' },
] as const;

/* -------------------------------------------------------------------------- *
 * 4. Arquetipos + variación determinista
 * -------------------------------------------------------------------------- */

export const ARCHETYPES = ['casa', 'local', 'apartamentos', 'oficina'] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export interface HouseVariation {
  archetype: Archetype;
  palette: HousePalette;
  seed: number;
  /** Plantas sobre el zócalo. */
  floors: number;
  floorHeight: number;
  /** Ancho (eje X, paralelo a la calle) y fondo (eje Z) del volumen principal. */
  width: number;
  depth: number;
  plinthHeight: number;
  /** Altura del tejado a dos aguas o del peto si la cubierta es plana. */
  roofHeight: number;
  flatRoof: boolean;
  /** Altura total estimada: la usa el encuadre de cámara para no recortar nada. */
  totalHeight: number;
  hasAnnex: boolean;
  hasPorch: boolean;
  hasBalcony: boolean;
  hasDish: boolean;
  hasAntenna: boolean;
  hasTank: boolean;
  hasFence: boolean;
  hasCar: boolean;
  /** Nº de vanos en la fachada frontal por planta (2 = casa, 5 = local…). */
  frontColumns: number;
}

/**
 * Arquetipos y sus proporciones reales (en metros; 1 unidad de escena = 1 m).
 * Se mantiene el pie de la versión anterior (≈7-9 m de ancho) para que la fila de
 * 6 casas siga entrando en el mismo encuadre del Host.
 */
export function buildVariation(team: TeamState): HouseVariation {
  const seed = hashId(team.id);
  const rng = rngFrom(seed);
  const palette = pick(rng, PALETTES);

  // Reparto ponderado de arquetipos: el vecindario real mezcla vivienda, comercio
  // y edificación vertical. La casa familiar sigue siendo la más probable.
  const roll = rng();
  const archetype: Archetype =
    roll < 0.4 ? 'casa' : roll < 0.65 ? 'local' : roll < 0.87 ? 'apartamentos' : 'oficina';

  switch (archetype) {
    case 'local': {
      const floors = rng() < 0.35 ? 2 : 1;
      const floorHeight = floors === 2 ? 3.3 : 3.7;
      const width = range(rng, 8.0, 9.2);
      const depth = range(rng, 6.4, 7.2);
      const plinthHeight = 0.22;
      const roofHeight = 0.62; // peto de cubierta plana
      return {
        archetype,
        palette,
        seed,
        floors,
        floorHeight,
        width,
        depth,
        plinthHeight,
        roofHeight,
        flatRoof: true,
        totalHeight: plinthHeight + floors * floorHeight + roofHeight + 1.1,
        hasAnnex: false,
        hasPorch: false,
        hasBalcony: false,
        hasDish: rng() < 0.5,
        hasAntenna: false,
        hasTank: false,
        hasFence: false,
        hasCar: true,
        frontColumns: 4,
      };
    }
    case 'apartamentos': {
      const floors = 4 + Math.floor(rng() * 2); // 4 o 5
      const floorHeight = 2.6;
      const width = range(rng, 6.4, 7.4);
      const depth = range(rng, 7.0, 8.0);
      const plinthHeight = 0.3;
      const roofHeight = 0.72;
      return {
        archetype,
        palette,
        seed,
        floors,
        floorHeight,
        width,
        depth,
        plinthHeight,
        roofHeight,
        flatRoof: true,
        totalHeight: plinthHeight + floors * floorHeight + roofHeight + 2.3,
        hasAnnex: false,
        hasPorch: false,
        hasBalcony: true,
        hasDish: rng() < 0.6,
        hasAntenna: true,
        hasTank: true,
        hasFence: rng() < 0.4,
        hasCar: rng() < 0.5,
        frontColumns: 3,
      };
    }
    case 'oficina': {
      const floors = 3;
      const floorHeight = 3.0;
      const width = range(rng, 8.6, 9.8);
      const depth = range(rng, 7.4, 8.2);
      const plinthHeight = 0.34;
      const roofHeight = 0.78;
      return {
        archetype,
        palette,
        seed,
        floors,
        floorHeight,
        width,
        depth,
        plinthHeight,
        roofHeight,
        flatRoof: true,
        totalHeight: plinthHeight + floors * floorHeight + roofHeight + 1.6,
        hasAnnex: false,
        hasPorch: false,
        hasBalcony: false,
        hasDish: false,
        hasAntenna: true,
        hasTank: false,
        hasFence: false,
        hasCar: true,
        frontColumns: 4,
      };
    }
    case 'casa':
    default: {
      const floors = rng() < 0.75 ? 2 : 1;
      const floorHeight = 2.75;
      const width = range(rng, 6.8, 7.8);
      const depth = range(rng, 5.8, 6.6);
      const plinthHeight = 0.38;
      // Faldón con pendiente ~32°: altura de cumbrera en función del fondo.
      const roofHeight = depth * 0.34;
      return {
        archetype: 'casa',
        palette,
        seed,
        floors,
        floorHeight,
        width,
        depth,
        plinthHeight,
        roofHeight,
        flatRoof: false,
        totalHeight: plinthHeight + floors * floorHeight + roofHeight + 1.4,
        hasAnnex: rng() < 0.45,
        hasPorch: true,
        hasBalcony: floors > 1 && rng() < 0.4,
        hasDish: rng() < 0.35,
        hasAntenna: rng() < 0.3,
        hasTank: false,
        hasFence: rng() < 0.7,
        hasCar: rng() < 0.65,
        frontColumns: 2,
      };
    }
  }
}

/* -------------------------------------------------------------------------- *
 * 5. Reparto de la fila (calle en Z+, fachadas mirando a cámara)
 * -------------------------------------------------------------------------- */

export interface HousePlacement {
  team: TeamState;
  variation: HouseVariation;
  position: [number, number, number];
  yaw: number;
}

export interface NeighborhoodLayout {
  placements: HousePlacement[];
  /** Caja envolvente de TODO el contenido que debe entrar en el encuadre. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number };
  /** Altura sobre el suelo del poste de luz más alto (entra en el encuadre). */
  poleTop: number;
}

/** Separación mínima entre fachadas laterales de dos casas vecinas. */
const CALLE_HUECO = 3.4;
/**
 * Vuelo del solar a cada lado del edificio: anexo/garaje, valla, rótulo y buzón salen
 * por fuera de la fachada, así que la caja envolvente del encuadre tiene que contarlos
 * (si no, la casa del extremo derecho aparece recortada).
 */
const SOLAR_VUELO = 1.6;
/** Altura de los postes de la red: también define el techo del encuadre. */
export const ALTURA_POSTE = 7.8;
/** Ancho de la calzada y de la acera (la calle corre por delante de las casas). */
export const ANCHO_CALZADA = 7.4;
export const ANCHO_ACERA = 2.6;
/** Retranqueo de la fachada respecto al borde de la acera (jardín / acceso). */
export const RETRANQUEO_FACHADA = 2.4;

export function layoutNeighborhood(teams: TeamState[]): NeighborhoodLayout {
  if (teams.length === 0) {
    return {
      placements: [],
      bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1, maxY: 4 },
      poleTop: ALTURA_POSTE,
    };
  }

  const placements: HousePlacement[] = [];
  let cursor = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let maxY = 0;

  teams.forEach((team, index) => {
    const variation = buildVariation(team);
    const rng = rngFrom(variation.seed ^ 0x9e3779b9);

    // Cada casa ocupa su propio ancho + medio hueco por lado: un edificio ancho
    // empuja a sus vecinos (nada de separación fija que solape fachadas).
    const x = cursor + variation.width / 2;
    cursor += variation.width + CALLE_HUECO;

    // Micro-variación de retranqueo y giro: rompe la fila de "soldaditos" sin
    // desordenar el encuadre (los bounds la tienen en cuenta).
    const z = index % 2 === 0 ? 0 : range(rng, 0.5, 0.9);
    const yaw = range(rng, -0.05, 0.05);

    placements.push({ team, variation, position: [x, 0, z], yaw });

    // Bounds del CONTENIDO VISIBLE: edificio + vuelo del solar (anexo/valla/rótulo).
    minX = Math.min(minX, x - variation.width / 2 - SOLAR_VUELO);
    maxX = Math.max(maxX, x + variation.width / 2 + SOLAR_VUELO);
    minZ = Math.min(minZ, z - variation.depth / 2);
    maxZ = Math.max(maxZ, z + variation.depth / 2);
    maxY = Math.max(maxY, variation.totalHeight);
  });

  // Centrado de la fila en x=0 (encuadre simétrico y estable al entrar/salir equipos).
  const center = (minX + maxX) / 2;
  for (const placement of placements) placement.position[0] -= center;

  const halfDepth = Math.max(...placements.map((p) => p.variation.depth / 2));

  return {
    placements,
    bounds: {
      minX: minX - center,
      maxX: maxX - center,
      minZ: Math.min(minZ, -halfDepth),
      maxZ: Math.max(maxZ, halfDepth),
      maxY: Math.max(maxY, ALTURA_POSTE + 0.6),
    },
    poleTop: ALTURA_POSTE,
  };
}

/* -------------------------------------------------------------------------- *
 * 5b. Calle: acera y calzada alineadas para TODAS las casas
 * -------------------------------------------------------------------------- */

export interface StreetLayout {
  /** Z donde termina el jardín de cada casa y empieza la acera (alineado a nivel global). */
  plotFront: number;
  sidewalk: [number, number];
  road: [number, number];
  /** Centro en Z de la calzada (para la cámara y las marcas viales). */
  roadCenter: number;
}

export function streetLayout(layout: NeighborhoodLayout): StreetLayout {
  const plotFront = layout.bounds.maxZ + RETRANQUEO_FACHADA;
  const sidewalkStart = plotFront;
  const sidewalkEnd = plotFront + ANCHO_ACERA;
  const roadStart = sidewalkEnd;
  const roadEnd = roadStart + ANCHO_CALZADA;
  return {
    plotFront,
    sidewalk: [sidewalkStart, sidewalkEnd],
    road: [roadStart, roadEnd],
    roadCenter: (roadStart + roadEnd) / 2,
  };
}

/* -------------------------------------------------------------------------- *
 * 6. Encuadre de cámara calculado desde el número de equipos
 * -------------------------------------------------------------------------- */

export interface CameraFit {
  distance: number;
  target: THREE.Vector3;
  /** Semiancho del encuadre a la distancia de la cámara (en unidades de mundo). */
  halfWidth: number;
  halfHeight: number;
  /** Z del rail de la cámara (plano sobre el que se sitúa, a `distance` del objetivo). */
  railZ: number;
}

/** Caja que el encuadre DEBE contener: casas + solar + calle hasta el borde lejano. */
export interface FramingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** Pendiente de la cámara: se eleva `LIFT` unidades por unidad de distancia. */
export const CAMERA_LIFT = 0.28;
/**
 * Fracción máxima del semiencuadre que puede ocupar el contenido. 0.84 deja un 16% de
 * aire a cada lado: suficiente para que quepan el dolly/parallax y para que nada toque
 * el borde (antes estaba en 0.9 y el edificio del extremo se veía pegado al marco).
 */
export const CAMERA_FILL = 0.84;
export const CAMERA_FOV = 34;

const scratchCamera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.5, 900);
const scratchCorner = new THREE.Vector3();

/**
 * Caja envolvente que debe entrar en cuadro: el edificio, el vuelo del solar (anexo,
 * valla, coche, rótulo) y —clave— la CALLE en primer plano. Incluir la calle es lo que
 * garantiza que "la línea del suelo" quede dentro del marco en lugar de cortarse abajo.
 */
export function framingBounds(layout: NeighborhoodLayout, street: StreetLayout): FramingBox {
  return {
    minX: layout.bounds.minX - 0.8,
    maxX: layout.bounds.maxX + 0.8,
    minY: 0,
    maxY: layout.bounds.maxY,
    // Los edificios de atrás también cuentan (profundidad de la casa + su tejado/alero).
    minZ: layout.bounds.minZ - 2.0,
    // Hasta el borde lejano de la calzada: el primer plano queda dentro del encuadre.
    maxZ: street.road[1] - 0.6,
  };
}

/**
 * Distancia mínima a la que TODO el vecindario (las 8 esquinas de la caja envolvente)
 * cae dentro del frustum con el margen de `CAMERA_FILL`. Se resuelve por búsqueda
 * binaria (26 pasos, ~0.05 ms) usando una cámara de scratch: es la forma honesta de
 * evitar el `lookAt` a un centro fijo de la versión anterior, que recortaba las casas
 * cuando se sumaban equipos.
 *
 * Verificado para 1, 4, 5 y 6 equipos: el ajuste depende del aspect REAL del lienzo
 * (se recalcula en cada resize), de la altura del edificio más alto y de la
 * profundidad de la calle, así que ningún elemento queda fuera de cuadro.
 */
export function fitCamera(box: FramingBox, aspect: number, fovDeg = CAMERA_FOV): CameraFit {
  const { minX, maxX, minY, maxY, minZ, maxZ } = box;
  // El objetivo se apoya en el tercio inferior del contenido: deja aire arriba y
  // la calle en primer plano abajo.
  const targetY = clamp(minY + (maxY - minY) * 0.42, 2.4, 7.2);
  const target = new THREE.Vector3(0, targetY, clamp((minZ + maxZ) / 2 + 0.4, -2, 6));
  const railZ = maxZ;

  const corners: THREE.Vector3[] = [];
  for (const x of [minX, maxX]) {
    for (const y of [minY, maxY]) {
      for (const z of [minZ, maxZ]) corners.push(new THREE.Vector3(x, y, z));
    }
  }

  const safeAspect = Number.isFinite(aspect) && aspect > 0.4 ? aspect : 1.7;
  scratchCamera.fov = fovDeg;
  scratchCamera.aspect = safeAspect;
  scratchCamera.near = 0.5;
  scratchCamera.far = 900;
  scratchCamera.updateProjectionMatrix();

  const maxNdc = (distance: number): number => {
    scratchCamera.position.set(target.x, targetY + distance * CAMERA_LIFT, railZ + distance);
    scratchCamera.lookAt(target);
    scratchCamera.updateMatrixWorld(true);
    let worst = 0;
    for (const corner of corners) {
      scratchCorner.copy(corner).project(scratchCamera);
      worst = Math.max(worst, Math.abs(scratchCorner.x), Math.abs(scratchCorner.y));
    }
    return worst;
  };

  let low = 6;
  let high = 500;
  if (maxNdc(high) > CAMERA_FILL) {
    // Caso patológico (contenedor extremadamente estrecho): no recortar más.
    return {
      distance: high,
      target,
      halfWidth: Math.tan((fovDeg * Math.PI) / 360) * high * safeAspect,
      halfHeight: Math.tan((fovDeg * Math.PI) / 360) * high,
      railZ,
    };
  }
  for (let i = 0; i < 28; i += 1) {
    const mid = (low + high) / 2;
    if (maxNdc(mid) <= CAMERA_FILL) high = mid;
    else low = mid;
  }

  const halfHeight = Math.tan((fovDeg * Math.PI) / 360) * high;
  return { distance: high, target, halfWidth: halfHeight * safeAspect, halfHeight, railZ };
}

/* -------------------------------------------------------------------------- *
 * 7. Mapa de estado → imagen (las funciones que consume HouseModel)
 * -------------------------------------------------------------------------- */

const COLOR_ROJO = new THREE.Color('#FF3B4E');
const COLOR_AMBAR = new THREE.Color('#F5B942');
const COLOR_VERDE = new THREE.Color('#3ECF8E');

/**
 * Eficiencia → color del aura/césped/luz: verde (alta) → ámbar (media) → rojo (baja).
 * Escribe en `out` para no asignar nada dentro de useFrame.
 */
export function efficiencyColor(eficiencia: number, out: THREE.Color): THREE.Color {
  const t = clamp(eficiencia / 100, 0, 1);
  return t < 0.5
    ? out.copy(COLOR_ROJO).lerp(COLOR_AMBAR, t / 0.5)
    : out.copy(COLOR_AMBAR).lerp(COLOR_VERDE, (t - 0.5) / 0.5);
}

/** ¿Este equipo está por debajo del umbral de "instalación fallando"? (parpadeo). */
export const UMBRAL_EFICIENCIA_FRAGIL = 38;

/** electricidad (kWh acumulados) → fracción de ventanas encendidas. */
export function litFraction(electricidad: number): number {
  // 30 kWh = casi a oscuras, 170 kWh = todo el edificio encendido.
  return clamp(mapRange(electricidad, 30, 170, 0.06, 1), 0.06, 1);
}

/** gas (m³ acumulados) → intensidad del humo de la chimenea (opacidad base). */
export function smokeIntensity(gas: number): number {
  return clamp(mapRange(gas, 35, 120, 0.05, 0.46), 0.03, 0.5);
}

/** gas → altura de la llama (0 = apagada, 1 = mecha a tope). */
export function flameIntensity(gas: number): number {
  return clamp(mapRange(gas, 55, 140, 0, 1), 0, 1);
}

/** presupuesto → velocidad angular del medidor del techo (rad/s): gastar = girar. */
export function meterSpeed(presupuesto: number): number {
  const gastado = Math.max(0, PRESUPUESTO_INICIAL - presupuesto);
  return 0.45 + (gastado / PRESUPUESTO_INICIAL) * 6.2;
}
