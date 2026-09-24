/**
 * Materiales y texturas PROCEDURALES del vecindario.
 *
 * Regla dura del proyecto (aula sin internet fiable): aquí NO se carga ningún asset
 * externo. Ni HDRI, ni fuentes remotas, ni mapas de texturas descargados. Todo lo que
 * se ve se genera con `document.createElement('canvas')` la primera vez que se pide y
 * se cachea en memoria (≈4 texturas de 128-256 px, <1 MB de VRAM).
 *
 * Además todos los materiales se COMPARTEN por clave (color + tipo): 6 casas distintas
 * usan un puñado de materiales, no decenas, así que el coste por fragmento y las
 * compilaciones de shader quedan acotados (el proyector del aula ya se atragantó una vez).
 */

import * as THREE from 'three';

import type { HouseVariation } from './neighborhood-config';

/* -------------------------------------------------------------------------- *
 * Texturas procedurales
 * -------------------------------------------------------------------------- */

type TextureKind =
  | 'estuco'
  | 'teja'
  | 'asfalto'
  | 'acera'
  | 'ladrillo'
  | 'rejilla'
  | 'cesped'
  | 'glow';

const textureCache = new Map<TextureKind, THREE.Texture>();

function createCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D no disponible para generar texturas procedurales');
  return { canvas, ctx };
}

/** Ruido suave por manchas: mucho más barato que un generador de ruido real. */
function splashNoise(
  ctx: CanvasRenderingContext2D,
  size: number,
  count: number,
  alpha: number,
  light: string,
  dark: string,
): void {
  for (let i = 0; i < count; i += 1) {
    const r = 1 + Math.random() * (size * 0.06);
    ctx.globalAlpha = alpha * (0.4 + Math.random() * 0.6);
    ctx.fillStyle = Math.random() > 0.5 ? light : dark;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function buildTexture(kind: TextureKind): THREE.CanvasTexture {
  const size = kind === 'glow' ? 128 : 256;
  const { canvas, ctx } = createCanvas(size);

  switch (kind) {
    case 'estuco': {
      // Muro de estuco: gris claro (se tiñe con el color del material) + grano.
      ctx.fillStyle = '#cfcfcf';
      ctx.fillRect(0, 0, size, size);
      splashNoise(ctx, size, 900, 0.12, '#ffffff', '#9a9a9a');
      ctx.globalAlpha = 0.06;
      ctx.strokeStyle = '#6f6f6f';
      for (let i = 0; i < 18; i += 1) {
        ctx.beginPath();
        ctx.moveTo(Math.random() * size, Math.random() * size);
        ctx.lineTo(Math.random() * size, Math.random() * size);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'teja': {
      // Tejado con tejas sugeridas: 4 hiladas por metro con junta desplazada.
      ctx.fillStyle = '#8f8f8f';
      ctx.fillRect(0, 0, size, size);
      const rowHeight = size / 4;
      for (let row = 0; row < 4; row += 1) {
        const y = row * rowHeight;
        ctx.fillStyle = row % 2 === 0 ? '#9d9d9d' : '#878787';
        ctx.fillRect(0, y, size, rowHeight - 1);
        ctx.strokeStyle = '#6a6a6a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, y + rowHeight);
        ctx.lineTo(size, y + rowHeight);
        ctx.stroke();
        // Juntas verticales de cada teja.
        const tiles = 8;
        for (let col = 0; col < tiles; col += 1) {
          const x = (col + (row % 2 === 0 ? 0 : 0.5)) * (size / tiles);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + rowHeight);
          ctx.stroke();
        }
      }
      splashNoise(ctx, size, 260, 0.08, '#ffffff', '#5f5f5f');
      break;
    }
    case 'asfalto': {
      ctx.fillStyle = '#6d6d6d';
      ctx.fillRect(0, 0, size, size);
      splashNoise(ctx, size, 1400, 0.16, '#8f8f8f', '#4a4a4a');
      ctx.globalAlpha = 0.05;
      ctx.strokeStyle = '#3a3a3a';
      ctx.lineWidth = 3;
      for (let i = 0; i < 6; i += 1) {
        ctx.beginPath();
        ctx.moveTo(Math.random() * size, 0);
        ctx.lineTo(Math.random() * size, size);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'acera': {
      // Losa de acera con juntas de dilatación.
      ctx.fillStyle = '#c2c2c2';
      ctx.fillRect(0, 0, size, size);
      splashNoise(ctx, size, 700, 0.1, '#ffffff', '#9d9d9d');
      ctx.strokeStyle = '#8a8a8a';
      ctx.lineWidth = 4;
      const slabs = 4;
      for (let i = 0; i <= slabs; i += 1) {
        const p = (i * size) / slabs;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(size, p);
        ctx.stroke();
      }
      break;
    }
    case 'ladrillo': {
      ctx.fillStyle = '#a08f88';
      ctx.fillRect(0, 0, size, size);
      const rows = 8;
      const h = size / rows;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#6d5c56';
      for (let row = 0; row < rows; row += 1) {
        const y = row * h;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
        const bricks = 4;
        for (let col = 0; col < bricks; col += 1) {
          const x = (col + (row % 2 === 0 ? 0 : 0.5)) * (size / bricks);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + h);
          ctx.stroke();
        }
      }
      splashNoise(ctx, size, 300, 0.1, '#c9b8b0', '#5d4d47');
      break;
    }
    case 'rejilla': {
      // Chapa plegada / rejilla de equipos de climatización.
      ctx.fillStyle = '#8b8b8b';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = '#5f5f5f';
      ctx.lineWidth = 3;
      for (let i = 0; i < 16; i += 1) {
        const x = (i * size) / 16;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.stroke();
      }
      break;
    }
    case 'cesped': {
      ctx.fillStyle = '#c9c9c9';
      ctx.fillRect(0, 0, size, size);
      splashNoise(ctx, size, 1200, 0.14, '#e8e8e8', '#9a9a9a');
      break;
    }
    case 'glow':
    default: {
      // Degradado radial: se reutiliza para charcos de luz, humo y chispas.
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.45, 'rgba(255,255,255,0.45)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      break;
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  // 2x de anisotropía: se nota en el plano de la calle y no cuesta casi nada.
  texture.anisotropy = 2;
  texture.needsUpdate = true;
  return texture;
}

export function getTexture(kind: TextureKind): THREE.CanvasTexture {
  const cached = textureCache.get(kind);
  if (cached) return cached as THREE.CanvasTexture;
  const texture = buildTexture(kind);
  textureCache.set(kind, texture);
  return texture;
}

/**
 * Degradado vertical para el haz del líder: opaco en la BASE (el suelo) y transparente
 * hacia ARRIBA (el foco). Sin textura el cono aditivo se ve como un triángulo plano;
 * con el degradado se lee como un volumen de luz sin bordes duros.
 *
 * UV de un cono en three: uv.y = 1 en el vértice (arriba) y uv.y = 0 en la base (abajo).
 * Con flipY = true (por defecto), la fila SUPERIOR del canvas es uv.y = 1.
 */
let beamTextureCache: THREE.CanvasTexture | null = null;

export function getBeamTexture(): THREE.CanvasTexture {
  if (beamTextureCache) return beamTextureCache;
  const width = 16;
  const height = 128;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D no disponible para el degradado del haz');
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    const t = y / (height - 1); // 0 = arriba (vértice), 1 = abajo (base)
    // Sube rápido desde el foco y se recorta suavemente al tocar el suelo.
    const borde = t > 0.92 ? 1 - Math.pow((t - 0.92) / 0.08, 1.5) * 0.85 : 1;
    const alpha = Math.pow(t, 0.8) * borde * 255;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      image.data[i] = 255;
      image.data[i + 1] = 255;
      image.data[i + 2] = 255;
      image.data[i + 3] = Math.round(alpha);
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  beamTextureCache = texture;
  return texture;
}

/* -------------------------------------------------------------------------- *
 * Materiales compartidos
 * -------------------------------------------------------------------------- */

const materialCache = new Map<string, THREE.Material>();

function cached<T extends THREE.Material>(key: string, factory: () => T): T {
  const found = materialCache.get(key);
  if (found) return found as T;
  const material = factory();
  materialCache.set(key, material);
  return material;
}

/** Muro: estuco teñido con el color del arquetipo. */
export function wallMaterial(color: string): THREE.MeshStandardMaterial {
  return cached(`wall|${color}`, () => {
    const map = getTexture('estuco').clone();
    map.needsUpdate = true;
    map.repeat.set(2, 2);
    return new THREE.MeshStandardMaterial({
      color,
      map,
      roughness: 0.92,
      metalness: 0.02,
    });
  });
}

export function trimMaterial(color: string, roughness = 0.6): THREE.MeshStandardMaterial {
  return cached(`trim|${color}|${roughness}`, () =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.08 }),
  );
}

export function roofTileMaterial(color: string): THREE.MeshStandardMaterial {
  return cached(`tile|${color}`, () => {
    // Las UVs de ExtrudeGeometry vienen en metros: 1 repetición = 1 m = 4 hiladas.
    const map = getTexture('teja').clone();
    map.needsUpdate = true;
    map.repeat.set(1, 1);
    return new THREE.MeshStandardMaterial({ color, map, roughness: 0.85, metalness: 0.04 });
  });
}

export function flatRoofMaterial(color: string): THREE.MeshStandardMaterial {
  return cached(`flat|${color}`, () =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0.02 }),
  );
}

export function brickMaterial(color: string): THREE.MeshStandardMaterial {
  return cached(`brick|${color}`, () => {
    const map = getTexture('ladrillo').clone();
    map.needsUpdate = true;
    map.repeat.set(2, 3);
    return new THREE.MeshStandardMaterial({ color, map, roughness: 0.95 });
  });
}

export function metalMaterial(color: string, roughness = 0.42, metalness = 0.75): THREE.MeshStandardMaterial {
  return cached(`metal|${color}|${roughness}|${metalness}`, () =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness }),
  );
}

/** Metal visto por las dos caras (parabólicas, tapas, chapa fina). */
export function metallicDoubleSided(color: string): THREE.MeshStandardMaterial {
  return cached(`metal2|${color}`, () =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.55, side: THREE.DoubleSide }),
  );
}

export function grilleMaterial(color: string): THREE.MeshStandardMaterial {
  return cached(`grille|${color}`, () => {
    const map = getTexture('rejilla').clone();
    map.needsUpdate = true;
    map.repeat.set(3, 3);
    return new THREE.MeshStandardMaterial({ color, map, roughness: 0.55, metalness: 0.45 });
  });
}

/** Ventana apagada: vidrio oscuro con reflejo (metalness alto, rugosidad baja). */
export function darkGlassMaterial(): THREE.MeshStandardMaterial {
  return cached('glass|dark', () =>
    new THREE.MeshStandardMaterial({
      color: '#0D1520',
      roughness: 0.14,
      metalness: 0.62,
      emissive: '#0E1A2A',
      emissiveIntensity: 0.5,
    }),
  );
}

/** Asfalto mojado: rugosidad baja pero SIN reflector (un pase extra de render por frame
 *  es justo lo que hundía el proyector; el brillo se consigue con la luz direccional). */
export function asphaltMaterial(): THREE.MeshStandardMaterial {
  return cached('asphalt', () => {
    const map = getTexture('asfalto').clone();
    map.needsUpdate = true;
    map.repeat.set(14, 6);
    return new THREE.MeshStandardMaterial({
      color: '#252932',
      map,
      roughness: 0.38,
      metalness: 0.16,
    });
  });
}

export function sidewalkMaterial(): THREE.MeshStandardMaterial {
  return cached('sidewalk', () => {
    const map = getTexture('acera').clone();
    map.needsUpdate = true;
    map.repeat.set(18, 2);
    return new THREE.MeshStandardMaterial({ color: '#414856', map, roughness: 0.88 });
  });
}

export function curbMaterial(): THREE.MeshStandardMaterial {
  return cached('curb', () => new THREE.MeshStandardMaterial({ color: '#586071', roughness: 0.7 }));
}

export function grassMaterial(): THREE.MeshStandardMaterial {
  return cached('grass', () => {
    const map = getTexture('cesped').clone();
    map.needsUpdate = true;
    map.repeat.set(10, 10);
    return new THREE.MeshStandardMaterial({ color: '#1B2A22', map, roughness: 1 });
  });
}

/** Material aditivo sobre la textura radial: charcos de luz, humo y chispas. */
export function glowMaterial(
  color: string,
  opacity: number,
  blending: THREE.Blending = THREE.AdditiveBlending,
): THREE.MeshBasicMaterial {
  return cached(`glow|${color}|${opacity}|${blending}`, () => {
    const map = getTexture('glow').clone();
    map.needsUpdate = true;
    return new THREE.MeshBasicMaterial({
      color,
      map,
      transparent: true,
      opacity,
      depthWrite: false,
      blending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  });
}

/** Letreros (banda comercial, rótulo de la calle) generados con fuentes del sistema. */
export function signMaterial(text: string, accent: string, variant: 'team' | 'street' | 'warning'): THREE.MeshStandardMaterial {
  return cached(`sign|${variant}|${text}|${accent}`, () => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D no disponible para el rótulo');
    const font =
      '700 84px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

    if (variant === 'warning') {
      // Señal amarilla con rayo dibujado a mano (sin fuente ni icono externo).
      ctx.fillStyle = '#F5B942';
      ctx.fillRect(0, 0, 512, 256);
      ctx.fillStyle = '#14181F';
      ctx.beginPath();
      ctx.moveTo(286, 24);
      ctx.lineTo(198, 140);
      ctx.lineTo(258, 140);
      ctx.lineTo(216, 232);
      ctx.lineTo(316, 112);
      ctx.lineTo(252, 112);
      ctx.closePath();
      ctx.fill();
    } else if (variant === 'street') {
      ctx.fillStyle = '#1B2130';
      ctx.fillRect(0, 0, 512, 256);
      ctx.fillStyle = accent;
      ctx.fillRect(0, 0, 512, 14);
      ctx.fillRect(0, 242, 512, 14);
      ctx.fillStyle = '#E7ECF5';
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 128);
    } else {
      // Rótulo de equipo: fondo oscuro, banda en el color de identidad y el nombre real
      // que escribieron los jugadores (dato real, nunca inventado).
      ctx.fillStyle = '#10151F';
      ctx.fillRect(0, 0, 512, 256);
      ctx.fillStyle = accent;
      ctx.fillRect(0, 0, 512, 26);
      ctx.fillRect(0, 230, 512, 26);
      ctx.fillStyle = '#F5F8FF';
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Ajuste de tamaño: los nombres son libres ("Los Tigres", "Equipo 1"…).
      let size = 84;
      while (size > 30) {
        if (ctx.measureText(text).width <= 456) break;
        size -= 4;
        ctx.font =
          `700 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
      }
      ctx.fillText(text, 256, 132);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 2;
    return new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.45,
      metalness: 0.1,
      emissive: new THREE.Color('#0B1220'),
      emissiveIntensity: 0.6,
      toneMapped: false,
    });
  });
}

/* -------------------------------------------------------------------------- *
 * Paquete de materiales por casa
 * -------------------------------------------------------------------------- */

/**
 * Materiales de UNA casa. Los compartidos salen de las cachés de arriba (se reutilizan
 * entre equipos); los "vivos" son únicos y se animan mutando el material dentro de
 * `useFrame`, que es como este componente evita cualquier setState por frame.
 */
export interface HouseMaterials {
  /* Compartidos (nunca se liberan aquí) */
  wall: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  roofCap: THREE.MeshStandardMaterial;
  flatRoof: THREE.MeshStandardMaterial;
  brick: THREE.MeshStandardMaterial;
  base: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  sign: THREE.MeshStandardMaterial;
  /* Únicos por casa (animados → se liberan al desmontar) */
  door: THREE.MeshStandardMaterial;
  pane: THREE.MeshBasicMaterial;
  aura: THREE.MeshBasicMaterial;
  pool: THREE.MeshBasicMaterial;
  lawn: THREE.MeshStandardMaterial;
  smoke: THREE.MeshBasicMaterial;
  flame: THREE.MeshBasicMaterial;
  halo: THREE.MeshBasicMaterial;
  beam: THREE.MeshBasicMaterial;
  leaderRing: THREE.MeshBasicMaterial;
}

/** Materiales únicos que el componente debe liberar al desmontarse. */
export function houseOwnedMaterials(mats: HouseMaterials): THREE.Material[] {
  return [
    mats.door,
    mats.pane,
    mats.aura,
    mats.pool,
    mats.lawn,
    mats.smoke,
    mats.flame,
    mats.halo,
    mats.beam,
    mats.leaderRing,
  ];
}

export function buildHouseMaterials(variation: HouseVariation, teamColor: string): HouseMaterials {
  const { palette } = variation;
  const glowMap = (repeat: number) => {
    const map = getTexture('glow').clone();
    map.needsUpdate = true;
    map.repeat.set(repeat, repeat);
    return map;
  };
  const lawnMap = getTexture('cesped').clone();
  lawnMap.needsUpdate = true;
  lawnMap.repeat.set(3, 3);

  const smokeMap = getTexture('glow').clone();
  smokeMap.needsUpdate = true;

  return {
    wall: wallMaterial(palette.wall),
    trim: trimMaterial(palette.trim),
    accent: trimMaterial(palette.accent),
    roof: variation.flatRoof ? flatRoofMaterial(palette.roof) : roofTileMaterial(palette.roof),
    roofCap: trimMaterial(palette.roof, 0.7),
    flatRoof: flatRoofMaterial('#2B323E'),
    brick: brickMaterial(palette.accent),
    base: trimMaterial('#2A2F38', 0.95),
    metal: metalMaterial('#5A6273'),
    glass: darkGlassMaterial(),
    sign: signMaterial(teamSignText(variation.seed), palette.trim, 'street'),

    door: new THREE.MeshStandardMaterial({
      color: teamColor,
      roughness: 0.42,
      metalness: 0.14,
      emissive: new THREE.Color(teamColor).multiplyScalar(0.5),
      emissiveIntensity: 0.08,
    }),
    // Ventana encendida: emissiva fuerte y sin tone mapping → sin post-proceso el
    // ventanal igual "quema" un poco y se lee como luz (el bloom real está prohibido
    // por presupuesto: un pase extra de render era el culpable del pico de CPU).
    pane: new THREE.MeshBasicMaterial({
      // Sin luz: el vidrio se pinta con el color por instancia (encendido/apagado),
      // así TODO el ventanal de la casa es 1 draw call y 1 buffer de colores.
      color: '#ffffff',
      toneMapped: false,
    }),
    aura: new THREE.MeshBasicMaterial({
      color: '#3ECF8E',
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
    pool: new THREE.MeshBasicMaterial({
      color: '#FFB347',
      map: glowMap(1),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
    lawn: new THREE.MeshStandardMaterial({
      color: '#24402E',
      map: lawnMap,
      roughness: 1,
    }),
    smoke: new THREE.MeshBasicMaterial({
      color: '#7A8496',
      map: smokeMap,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
    flame: new THREE.MeshBasicMaterial({
      color: '#FF7A32',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
    halo: new THREE.MeshBasicMaterial({
      color: '#F5B942',
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
    beam: new THREE.MeshBasicMaterial({
      color: '#F7D28A',
      map: getBeamTexture(),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
    // Aro de líder en el suelo: marca inequívoca y discreta (sustituye al "halo de
    // tubo" cuando el haz es demasiado sutil).
    leaderRing: new THREE.MeshBasicMaterial({
      color: '#F5B942',
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  };
}

/** La banda del rótulo no lleva datos del juego: es decoración arquitectónica fija. */
function teamSignText(seed: number): string {
  const names = ['BLOQUE', 'PORTAL', 'PLAZA', 'PASEO', 'AVENIDA', 'CALLE'];
  return `${names[seed % names.length]} ${1 + (seed % 8)}`;
}

