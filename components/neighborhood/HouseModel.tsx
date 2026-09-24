'use client';

/**
 * Una casa por equipo: arquetipo + variación determinista + animación reactiva
 * al TeamState REAL que llega por Realtime.
 *
 * MAPA DE ESTADO → IMAGEN (el corazón del juego, y el motivo de este archivo):
 *   electricidad → nº de ventanas encendidas   (vidrios instanciados, color por instancia)
 *   gas          → humo + llama de la salida de humos
 *   eficiencia   → color del aura/césped/luz   (verde → ámbar → rojo)
 *   presupuesto  → velocidad del medidor del techo
 *   ranking      → haz de luz + aura sobre el líder  (lo decide NeighborhoodStage)
 *   crisis       → caída de tensión y parpadeo simultáneo de todas las ventanas
 *   selección    → la casa se yergue, la puerta se enciende, el aura sube
 *
 * CONTRATO DE RENDIMIENTO (esto corre en el portátil del aula):
 *   1. Cero `setState` dentro de `useFrame`: se mutan refs, matrices y materiales.
 *   2. Todo lo que se interpola usa `expDamp(delta, k)` → mismo suavizado a 30 o a 60 fps.
 *   3. Las ventanas son 2-4 draw calls por casa (marcos instanciados por tamaño de vano
 *      + un único InstancedMesh de vidrios con color por instancia), no una malla por vano.
 *   4. No se crean objetos (Color/Vector3/Matrix4) dentro del frame: hay scratch de módulo.
 *   5. Solo las piezas grandes proyectan sombra; un único mapa de sombra de 1024 en la escena.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';

import type { TeamState } from '@/types/game';
import {
  UMBRAL_EFICIENCIA_FRAGIL,
  clamp,
  efficiencyColor,
  expDamp,
  flameIntensity,
  litFraction,
  meterSpeed,
  smokeIntensity,
  type HouseVariation,
  type StreetLayout,
} from './neighborhood-config';
import {
  AcUnit,
  Antenna,
  Balcony,
  Car,
  Chimney,
  DoorVano,
  Downspout,
  Driveway,
  FenceRun,
  FlatRoof,
  Flue,
  GEO,
  GableRoof,
  InstancedField,
  LightPool,
  Mailbox,
  Plinth,
  RooftopMeter,
  SatelliteDish,
  TeamSign,
  WaterTank,
  facingOffset,
  instanceMatrix,
} from './BuildingParts';
import {
  buildHouseMaterials,
  houseOwnedMaterials,
  signMaterial,
  type HouseMaterials,
} from './materials';

/* -------------------------------------------------------------------------- *
 * Scratch de módulo: nada de asignar colores/vectores dentro de useFrame
 * -------------------------------------------------------------------------- */

const LIT_PANE = new THREE.Color('#FFC46B');
const DARK_PANE = new THREE.Color('#0E1725');
const SMOKE_OK = new THREE.Color('#8A93A6');
const SMOKE_CRISIS = new THREE.Color('#6E4A44');
const LAWN_BASE = new THREE.Color('#24402E');
const scratchColor = new THREE.Color();
const scratchColor2 = new THREE.Color();

const SMOKE_PUFFS = 5;

/* -------------------------------------------------------------------------- *
 * Reparto de vanos, puerta, humos y cota de cubierta (todo determinista)
 * -------------------------------------------------------------------------- */

export interface WindowSlot {
  position: [number, number, number];
  rotationY: number;
  width: number;
  height: number;
}

interface BuildingFrame {
  /** Cota de arranque de la cubierta (donde apoya el tejado o el peto). */
  wallTop: number;
  roofWidth: number;
  roofDepth: number;
  roofZ: number;
  /** Origen del humo: la boca de la chimenea o la salida de humos. */
  vent: [number, number, number];
  chimney?: { position: [number, number, number]; height: number };
  flue?: { position: [number, number, number]; height: number };
}

interface Volumes {
  ground: { width: number; depth: number; height: number; y: number; z: number };
  upper?: { width: number; depth: number; height: number; y: number; z: number };
  annex?: { width: number; depth: number; height: number; x: number; y: number; z: number };
}

const bit = (seed: number, index: number): boolean => ((seed >> index) & 1) === 1;

export function casaVolumes(v: HouseVariation): Volumes {
  const groundY = v.plinthHeight + v.floorHeight / 2;
  const ground = { width: v.width, depth: v.depth, height: v.floorHeight, y: groundY, z: 0 };
  if (v.floors < 2) return { ground };
  const upperHeight = (v.floors - 1) * v.floorHeight;
  const upper = {
    width: v.width * 0.84,
    depth: v.depth * 0.88,
    height: upperHeight,
    y: v.plinthHeight + v.floorHeight + upperHeight / 2,
    z: -v.depth * 0.06,
  };
  const annexHeight = v.floorHeight * 0.8;
  // El anexo/garaje vuela 1.3 m como máximo: entra dentro del vuelo del solar que el
  // encuadre ya cuenta y no llega a tocar el solar del vecino.
  const annex = v.hasAnnex
    ? {
        width: v.width * 0.3,
        depth: v.depth * 0.72,
        height: annexHeight,
        x: (bit(v.seed, 2) ? 1 : -1) * (v.width * 0.52),
        y: v.plinthHeight + annexHeight / 2,
        z: -v.depth * 0.1,
      }
    : undefined;
  return { ground, upper, annex };
}

/** Cota y piezas de cubierta + boca de humos de cada arquetipo. */
export function buildingFrame(v: HouseVariation): BuildingFrame {
  if (v.archetype === 'casa') {
    const vols = casaVolumes(v);
    const top = vols.upper ?? vols.ground;
    const wallTop = v.plinthHeight + v.floors * v.floorHeight;
    const chimneyHeight = v.roofHeight * 0.7 + 1.5;
    const chimneyY = wallTop + v.roofHeight * 0.55;
    const chimney: [number, number, number] = [
      (bit(v.seed, 4) ? 1 : -1) * v.width * 0.22,
      chimneyY,
      -v.depth * 0.12,
    ];
    return {
      wallTop,
      roofWidth: top.width,
      roofDepth: top.depth,
      roofZ: top.z,
      chimney: { position: chimney, height: chimneyHeight },
      vent: [chimney[0], chimneyY + chimneyHeight / 2 + 0.14, chimney[2]],
    };
  }

  const wallTop = v.plinthHeight + v.floors * v.floorHeight;
  const flueHeight = 1.05;
  const fluePosition: [number, number, number] = [
    (bit(v.seed, 5) ? 1 : -1) * v.width * 0.3,
    wallTop + 0.22,
    -v.depth * 0.24,
  ];
  return {
    wallTop,
    roofWidth: v.width,
    roofDepth: v.depth,
    roofZ: 0,
    flue: { position: fluePosition, height: flueHeight },
    vent: [fluePosition[0], fluePosition[1] + flueHeight + 0.42, fluePosition[2]],
  };
}

interface HousePlan {
  windows: WindowSlot[];
  door: { position: [number, number, number]; width: number; height: number };
  frame: BuildingFrame;
}

/**
 * Reparto de vanos por arquetipo. La puerta NUNCA coincide con un vano: el hueco de
 * la entrada se reserva aquí y la fachada se reparte alrededor.
 */
export function buildPlan(v: HouseVariation): HousePlan {
  const windows: WindowSlot[] = [];
  const frame = buildingFrame(v);
  const push = (
    position: [number, number, number],
    rotationY: number,
    width: number,
    height: number,
  ) => windows.push({ position, rotationY, width, height });

  let door = {
    position: [0, v.plinthHeight + 1.1, v.depth / 2] as [number, number, number],
    width: 1.05,
    height: 2.2,
  };

  switch (v.archetype) {
    case 'casa': {
      const vols = casaVolumes(v);
      const doorSide = bit(v.seed, 3) ? 1 : -1;
      door = {
        position: [doorSide * v.width * 0.12, v.plinthHeight + 1.1, v.depth / 2],
        width: 1.05,
        height: 2.2,
      };
      for (let floor = 0; floor < v.floors; floor += 1) {
        const volume = floor === 0 ? vols.ground : vols.upper;
        if (!volume) continue;
        const z = volume.z + volume.depth / 2;
        const y = volume.y + 0.24;
        const spread = volume.width * (floor === 0 ? 0.32 : 0.28);
        push([-spread, y, z], 0, floor === 0 ? 1.05 : 1.15, 1.3);
        push([spread, y, z], 0, floor === 0 ? 1.05 : 1.15, 1.3);
      }
      // Un vano por planta en el lado izquierdo (el derecho lo tapa el vecino).
      for (let floor = 0; floor < v.floors; floor += 1) {
        const volume = floor === 0 ? vols.ground : vols.upper;
        if (!volume) continue;
        push([-volume.width / 2, volume.y + 0.2, volume.z + volume.depth * 0.12], -Math.PI / 2, 1.0, 1.2);
      }
      break;
    }
    case 'local': {
      // Escaparate: tres paños de vidrio grande y la puerta ocupando el cuarto módulo.
      const bandZ = v.depth / 2;
      const y = v.plinthHeight + v.floorHeight * 0.52;
      const bays = 4;
      for (let i = 0; i < bays - 1; i += 1) {
        const x = -v.width * 0.36 + (i * v.width * 0.72) / (bays - 1);
        push([x, y, bandZ], 0, 1.6, 2.35);
      }
      door = {
        position: [v.width * 0.36, v.plinthHeight + 1.2, bandZ],
        width: 1.2,
        height: 2.4,
      };
      if (v.floors > 1) {
        const upperY = v.plinthHeight + v.floorHeight + v.floorHeight * 0.5;
        for (let i = 0; i < 3; i += 1) {
          push([(i - 1) * v.width * 0.27, upperY, bandZ], 0, 1.25, 1.45);
        }
      }
      break;
    }
    case 'apartamentos': {
      for (let floor = 0; floor < v.floors; floor += 1) {
        const y = v.plinthHeight + floor * v.floorHeight + v.floorHeight * 0.55;
        const columns = floor === 0 ? [-0.31, 0.31] : [-0.29, 0, 0.29];
        for (const fraction of columns) {
          push([v.width * fraction, y, v.depth / 2], 0, 1.05, 1.3);
        }
        push([-v.width / 2, y, v.depth * 0.06], -Math.PI / 2, 0.95, 1.15);
      }
      door = {
        position: [0, v.plinthHeight + 1.25, v.depth / 2],
        width: 1.35,
        height: 2.5,
      };
      break;
    }
    case 'oficina':
    default: {
      for (let floor = 0; floor < v.floors; floor += 1) {
        const y = v.plinthHeight + floor * v.floorHeight + v.floorHeight * 0.52;
        const fractions = floor === 0 ? [-0.11, 0.11, 0.33] : [-0.33, -0.11, 0.11, 0.33];
        for (const fraction of fractions) {
          push([v.width * fraction, y, v.depth / 2], 0, 1.55, 1.5);
        }
      }
      door = {
        position: [-v.width * 0.33, v.plinthHeight + 1.4, v.depth / 2],
        width: 1.7,
        height: 2.8,
      };
      break;
    }
  }

  return { windows, door, frame };
}

/* -------------------------------------------------------------------------- *
 * Capa de ventanas: marcos instanciados + vidrios instanciados con color por instancia
 * -------------------------------------------------------------------------- */

interface WindowLayerProps {
  windows: WindowSlot[];
  materials: HouseMaterials;
  paneMeshRef: React.RefObject<THREE.InstancedMesh>;
}

function WindowLayer({ windows, materials, paneMeshRef }: WindowLayerProps) {
  // Un grupo por tamaño de vano: los marcos de igual medida se instancian juntos.
  const frameGroups = useMemo(() => {
    const groups = new Map<string, { width: number; height: number; matrices: THREE.Matrix4[] }>();
    for (const slot of windows) {
      const key = `${slot.width.toFixed(2)}x${slot.height.toFixed(2)}`;
      const entry = groups.get(key) ?? { width: slot.width, height: slot.height, matrices: [] };
      entry.matrices.push(instanceMatrix(slot.position, [1, 1, 1], slot.rotationY));
      groups.set(key, entry);
    }
    return [...groups.values()];
  }, [windows]);

  // El vidrio va retranqueado 7 cm respecto al plano de fachada: el revelo del marco
  // deja ver el espesor y la ventana se lee como hueco, no como calcomanía.
  const paneMatrices = useMemo(
    () =>
      windows.map((slot) =>
        instanceMatrix(facingOffset(slot.position, slot.rotationY, -0.07), [slot.width, slot.height, 1], slot.rotationY),
      ),
    [windows],
  );

  useLayoutEffect(() => {
    const mesh = paneMeshRef.current;
    if (!mesh) return;
    paneMatrices.forEach((matrix, index) => {
      mesh.setMatrixAt(index, matrix);
      // setColorAt crea el atributo de color por instancia en la primera llamada.
      mesh.setColorAt(index, DARK_PANE);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [paneMatrices, paneMeshRef]);

  return (
    <>
      {frameGroups.map((group) => (
        <InstancedField
          key={`marco-${group.width}x${group.height}`}
          geometry={GEO.frame(group.width, group.height)}
          material={materials.trim}
          matrices={group.matrices}
        />
      ))}
      <instancedMesh
        ref={paneMeshRef}
        args={[GEO.plane(), materials.pane, Math.max(1, paneMatrices.length)]}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- *
 * Volúmenes por arquetipo
 * -------------------------------------------------------------------------- */

interface VolumeProps {
  v: HouseVariation;
  materials: HouseMaterials;
  plan: HousePlan;
}

function CasaVolume({ v, materials, plan }: VolumeProps) {
  const vols = casaVolumes(v);
  const frame = plan.frame;
  const annexRoofY = vols.annex ? vols.annex.y + vols.annex.height / 2 : 0;
  return (
    <>
      <Plinth width={v.width} depth={v.depth} height={v.plinthHeight} material={materials.base} />
      <mesh
        geometry={GEO.box()}
        material={materials.wall}
        position={[0, vols.ground.y, vols.ground.z]}
        scale={[vols.ground.width, vols.ground.height, vols.ground.depth]}
        castShadow
        receiveShadow
      />
      {/* Cornisa entre plantas: la línea horizontal que da escala al edificio */}
      <mesh
        geometry={GEO.box()}
        material={materials.trim}
        position={[0, v.plinthHeight + v.floorHeight - 0.06, vols.ground.z]}
        scale={[v.width + 0.16, 0.18, v.depth + 0.16]}
      />
      {vols.upper && (
        <>
          <mesh
            geometry={GEO.box()}
            material={materials.wall}
            position={[0, vols.upper.y, vols.upper.z]}
            scale={[vols.upper.width, vols.upper.height, vols.upper.depth]}
            castShadow
            receiveShadow
          />
          <mesh
            geometry={GEO.box()}
            material={materials.trim}
            position={[0, v.plinthHeight + v.floors * v.floorHeight - 0.06, vols.upper.z]}
            scale={[vols.upper.width + 0.16, 0.18, vols.upper.depth + 0.16]}
          />
        </>
      )}
      {vols.annex && (
        <>
          <mesh
            geometry={GEO.box()}
            material={materials.wall}
            position={[vols.annex.x, vols.annex.y, vols.annex.z]}
            scale={[vols.annex.width, vols.annex.height, vols.annex.depth]}
            castShadow
            receiveShadow
          />
          <mesh
            geometry={GEO.box()}
            material={materials.flatRoof}
            position={[vols.annex.x, annexRoofY + 0.09, vols.annex.z]}
            scale={[vols.annex.width + 0.24, 0.18, vols.annex.depth + 0.24]}
          />
          <mesh
            geometry={GEO.box()}
            material={materials.metal}
            position={[vols.annex.x, vols.annex.y - 0.2, vols.annex.z + vols.annex.depth / 2 + 0.02]}
            scale={[vols.annex.width * 0.66, vols.annex.height * 0.7, 0.08]}
          />
        </>
      )}
      <GableRoof
        width={frame.roofWidth}
        depth={frame.roofDepth}
        height={v.roofHeight}
        materials={materials}
        position={[0, frame.wallTop, frame.roofZ]}
      />
      <Downspout
        position={[v.width * 0.44, 0.15, v.depth / 2 + 0.1]}
        height={v.plinthHeight + v.floors * v.floorHeight - 0.3}
        materials={materials}
      />
      <Downspout
        position={[-v.width * 0.46, 0.15, -v.depth / 2 - 0.1]}
        height={v.plinthHeight + v.floors * v.floorHeight - 0.3}
        materials={materials}
      />
      {v.hasBalcony && vols.upper && (
        <Balcony
          position={[-vols.upper.width * 0.28, vols.upper.y - 0.4, vols.upper.z + vols.upper.depth / 2]}
          width={vols.upper.width * 0.5}
          materials={materials}
        />
      )}
    </>
  );
}

function LocalVolume({ v, materials, plan }: VolumeProps) {
  const frame = plan.frame;
  const upperHeight = (v.floors - 1) * v.floorHeight;
  const fasciaY = v.plinthHeight + v.floorHeight * 0.9;
  return (
    <>
      <Plinth width={v.width} depth={v.depth} height={v.plinthHeight} material={materials.base} />
      <mesh
        geometry={GEO.box()}
        material={materials.wall}
        position={[0, v.plinthHeight + v.floorHeight / 2, 0]}
        scale={[v.width, v.floorHeight, v.depth]}
        castShadow
        receiveShadow
      />
      {upperHeight > 0 && (
        <>
          <mesh
            geometry={GEO.box()}
            material={materials.wall}
            position={[0, v.plinthHeight + v.floorHeight + upperHeight / 2, -v.depth * 0.03]}
            scale={[v.width * 0.92, upperHeight, v.depth * 0.94]}
            castShadow
            receiveShadow
          />
          <mesh
            geometry={GEO.box()}
            material={materials.trim}
            position={[0, v.plinthHeight + v.floorHeight - 0.06, 0]}
            scale={[v.width + 0.22, 0.16, v.depth + 0.22]}
          />
        </>
      )}
      {/* Banda comercial con el nombre del local (decorativo) */}
      <mesh
        geometry={GEO.box()}
        material={materials.accent}
        position={[0, fasciaY, v.depth / 2 + 0.06]}
        scale={[v.width * 0.86, 0.62, 0.16]}
      />
      <mesh
        geometry={GEO.plane()}
        material={materials.sign}
        position={[0, fasciaY, v.depth / 2 + 0.15]}
        scale={[v.width * 0.72, 0.46, 1]}
      />
      {/* Toldo: el perfil extruido con faldón es lo que hace leer "comercio" */}
      <mesh
        geometry={GEO.awning(v.width * 0.88, 1.55, 0.55, 0.3)}
        material={[materials.trim, materials.accent]}
        position={[0, fasciaY - 0.5, v.depth / 2]}
        castShadow
      />
      <FlatRoof
        width={v.width}
        depth={v.depth}
        parapet={v.roofHeight}
        materials={materials}
        position={[0, frame.wallTop, v.depth * 0.03]}
      />
      <AcUnit position={[v.width * 0.24, frame.wallTop + 0.75, -v.depth * 0.18]} size={[1.3, 0.9, 0.85]} />
      <Antenna position={[v.width * 0.3, frame.wallTop + 0.22, -v.depth * 0.3]} height={2.1} materials={materials} />
    </>
  );
}

function ApartamentosVolume({ v, materials, plan }: VolumeProps) {
  const frame = plan.frame;
  const bodyHeight = v.floors * v.floorHeight;
  const balconyFloors = [2, 4].filter((floor) => floor <= v.floors);
  return (
    <>
      <Plinth width={v.width} depth={v.depth} height={v.plinthHeight} material={materials.base} />
      <mesh
        geometry={GEO.box()}
        material={materials.wall}
        position={[0, v.plinthHeight + bodyHeight / 2, 0]}
        scale={[v.width, bodyHeight, v.depth]}
        castShadow
        receiveShadow
      />
      {/* Forjados planta a planta + bandas verticales en las esquinas */}
      {Array.from({ length: v.floors - 1 }, (_, index) => (
        <mesh
          key={`forjado-${index}`}
          geometry={GEO.box()}
          material={materials.trim}
          position={[0, v.plinthHeight + (index + 1) * v.floorHeight - 0.06, 0]}
          scale={[v.width + 0.18, 0.16, v.depth + 0.18]}
        />
      ))}
      {[-1, 1].map((side) => (
        <mesh
          key={`banda-${side}`}
          geometry={GEO.box()}
          material={materials.accent}
          position={[side * (v.width / 2 - 0.16), v.plinthHeight + bodyHeight / 2, v.depth / 2 + 0.03]}
          scale={[0.42, bodyHeight, 0.14]}
        />
      ))}
      {balconyFloors.map((floor) => (
        <Balcony
          key={`balcon-${floor}`}
          position={[0, v.plinthHeight + (floor - 1) * v.floorHeight + v.floorHeight * 0.02, v.depth / 2]}
          width={v.width * 0.88}
          materials={materials}
        />
      ))}
      {/* Portal de entrada + buzones */}
      <mesh
        geometry={GEO.box()}
        material={materials.trim}
        position={[0, v.plinthHeight + 2.9, v.depth / 2 + 0.5]}
        scale={[v.width * 0.44, 0.2, 1.5]}
        castShadow
      />
      <mesh
        geometry={GEO.box()}
        material={materials.trim}
        position={[v.width * 0.22, v.plinthHeight + 1.4, v.depth / 2 + 1.1]}
        scale={[0.16, 3.0, 0.16]}
      />
      <mesh
        geometry={GEO.box()}
        material={materials.metal}
        position={[-v.width * 0.42, v.plinthHeight + 1.5, v.depth / 2 + 0.06]}
        scale={[0.9, 1.5, 0.18]}
      />
      {[0, 1, 2, 3].map((index) => (
        <mesh
          key={`buzon-${index}`}
          geometry={GEO.box()}
          material={materials.base}
          position={[-v.width * 0.42, v.plinthHeight + 0.95 + index * 0.26, v.depth / 2 + 0.16]}
          scale={[0.62, 0.2, 0.06]}
        />
      ))}
      {/* Bajantes en las esquinas: en un bloque de 5 plantas son lo que remata la fachada */}
      {[-1, 1].map((side) => (
        <Downspout
          key={`bajante-${side}`}
          position={[side * (v.width / 2 - 0.18), 0.15, v.depth / 2 + 0.12]}
          height={v.plinthHeight + bodyHeight - 0.35}
          materials={materials}
        />
      ))}
      <FlatRoof
        width={v.width}
        depth={v.depth}
        parapet={v.roofHeight}
        materials={materials}
        position={[0, frame.wallTop, 0]}
      />
      {/* Caseta de ascensor, depósito y antenas: la cubierta de un bloque real */}
      <mesh
        geometry={GEO.box()}
        material={materials.wall}
        position={[-v.width * 0.22, frame.wallTop + 1.0, -v.depth * 0.2]}
        scale={[v.width * 0.34, 1.6, v.depth * 0.34]}
        castShadow
      />
      <mesh
        geometry={GEO.box()}
        material={materials.flatRoof}
        position={[-v.width * 0.22, frame.wallTop + 1.86, -v.depth * 0.2]}
        scale={[v.width * 0.38, 0.12, v.depth * 0.38]}
      />
      {v.hasTank && (
        <WaterTank
          position={[v.width * 0.24, frame.wallTop + 0.22, -v.depth * 0.14]}
          radius={Math.min(0.85, v.width * 0.12)}
          materials={materials}
        />
      )}
      {v.hasAntenna && (
        <Antenna position={[v.width * 0.3, frame.wallTop + 0.22, -v.depth * 0.32]} height={2.6} materials={materials} />
      )}
      <AcUnit position={[v.width * 0.06, frame.wallTop + 0.9, -v.depth * 0.24]} size={[1.4, 1.0, 0.9]} />
    </>
  );
}

function OficinaVolume({ v, materials, plan }: VolumeProps) {
  const frame = plan.frame;
  const bodyHeight = v.floors * v.floorHeight;
  const mullions = useMemo(() => {
    const matrices: THREE.Matrix4[] = [];
    const fractions = [-0.44, -0.22, 0, 0.22, 0.44];
    for (let floor = 0; floor < v.floors; floor += 1) {
      const y = v.plinthHeight + floor * v.floorHeight;
      for (const fraction of fractions) {
        matrices.push(
          instanceMatrix([v.width * fraction, y + v.floorHeight * 0.52, v.depth / 2 + 0.04], [0.09, v.floorHeight, 0.14]),
        );
      }
      // Dintel de remate de la banda de vidrio de cada planta.
      matrices.push(
        instanceMatrix([0, y + v.floorHeight * 0.94, v.depth / 2 + 0.04], [v.width + 0.1, 0.12, 0.14]),
      );
    }
    return matrices;
  }, [v.width, v.depth, v.floors, v.floorHeight, v.plinthHeight]);
  return (
    <>
      <Plinth width={v.width} depth={v.depth} height={v.plinthHeight} material={materials.base} />
      <mesh
        geometry={GEO.box()}
        material={materials.wall}
        position={[0, v.plinthHeight + bodyHeight / 2, 0]}
        scale={[v.width, bodyHeight, v.depth]}
        castShadow
        receiveShadow
      />
      {/* Fachada de vidrio: bandas ciegas por planta + montantes instanciados */}
      {Array.from({ length: v.floors }, (_, index) => (
        <mesh
          key={`banda-ciega-${index}`}
          geometry={GEO.box()}
          material={materials.accent}
          position={[
            0,
            v.plinthHeight + index * v.floorHeight + v.floorHeight * 0.06,
            v.depth / 2 + 0.04,
          ]}
          scale={[v.width + 0.2, v.floorHeight * 0.28, 0.2]}
        />
      ))}
      <InstancedField geometry={GEO.box()} material={materials.metal} matrices={mullions} />
      {/* Cornisa de remate + acceso */}
      <mesh
        geometry={GEO.box()}
        material={materials.trim}
        position={[0, frame.wallTop - 0.08, 0]}
        scale={[v.width + 0.34, 0.2, v.depth + 0.34]}
      />
      <mesh
        geometry={GEO.box()}
        material={materials.trim}
        position={[plan.door.position[0] * 0.9, v.plinthHeight + 3.3, v.depth / 2 + 0.7]}
        scale={[v.width * 0.36, 0.22, 1.9]}
        castShadow
      />
      <mesh
        geometry={GEO.box()}
        material={materials.metal}
        position={[plan.door.position[0] - v.width * 0.16, v.plinthHeight + 1.7, v.depth / 2 + 1.5]}
        scale={[0.18, 3.4, 0.18]}
      />
      {[-1, 1].map((side) => (
        <Downspout
          key={`bajante-${side}`}
          position={[side * (v.width / 2 - 0.2), 0.15, v.depth / 2 + 0.12]}
          height={v.plinthHeight + bodyHeight - 0.4}
          materials={materials}
        />
      ))}
      <FlatRoof
        width={v.width}
        depth={v.depth}
        parapet={v.roofHeight}
        materials={materials}
        position={[0, frame.wallTop, 0]}
      />
      <AcUnit position={[-v.width * 0.26, frame.wallTop + 0.9, -v.depth * 0.2]} size={[1.6, 1.1, 1.0]} />
      <AcUnit position={[v.width * 0.22, frame.wallTop + 0.9, -v.depth * 0.26]} size={[1.4, 1.0, 0.95]} />
      <Antenna position={[v.width * 0.36, frame.wallTop + 0.22, -v.depth * 0.36]} height={3.0} materials={materials} />
      <mesh
        geometry={GEO.box()}
        material={materials.wall}
        position={[v.width * 0.05, frame.wallTop + 0.95, -v.depth * 0.3]}
        scale={[v.width * 0.26, 1.5, v.depth * 0.3]}
        castShadow
      />
    </>
  );
}

/* -------------------------------------------------------------------------- *
 * Casa completa
 * -------------------------------------------------------------------------- */

export interface HouseModelProps {
  team: TeamState;
  variation: HouseVariation;
  position: [number, number, number];
  yaw: number;
  street: StreetLayout;
  isLeader: boolean;
  isSelected: boolean;
  isCrisis: boolean;
  onSelect: (teamId: string) => void;
}

export default function HouseModel({
  team,
  variation,
  position,
  yaw,
  street,
  isLeader,
  isSelected,
  isCrisis,
  onSelect,
}: HouseModelProps) {
  const materials = useMemo(() => buildHouseMaterials(variation, team.color), [variation, team.color]);
  const plan = useMemo(() => buildPlan(variation), [variation]);
  const label = useMemo(() => signMaterial(team.name, team.color, 'team'), [team.name, team.color]);

  // Materiales vivos (se animan por frame) y humo clonado por voluta.
  const puffMaterials = useMemo(
    () => Array.from({ length: SMOKE_PUFFS }, () => materials.smoke.clone()),
    [materials],
  );

  useEffect(() => {
    return () => {
      houseOwnedMaterials(materials).forEach((material) => material.dispose());
      puffMaterials.forEach((material) => material.dispose());
    };
  }, [materials, puffMaterials]);

  const liftRef = useRef<THREE.Group>(null);
  const paneMeshRef = useRef<THREE.InstancedMesh>(null!);
  const smokeRefs = useRef<Array<THREE.Mesh | null>>([]);
  const rotorRef = useRef<THREE.Group>(null!);
  const auraRef = useRef<THREE.Mesh>(null!);
  const poolRef = useRef<THREE.Mesh>(null!);
  const haloRef = useRef<THREE.Mesh>(null!);
  const leaderRingRef = useRef<THREE.Mesh>(null!);
  const beamRef = useRef<THREE.Mesh>(null!);
  const flameRef = useRef<THREE.Mesh>(null!);
  const smokeGroupRef = useRef<THREE.Group>(null!);

  // --- Geometría del solar (jardín, valla, acceso, coche) -------------------
  const plot = useMemo(() => {
    const front = variation.depth / 2;
    const plotFrontLocal = street.plotFront - position[2];
    const depth = Math.max(1.6, plotFrontLocal - front);
    const gateSide = bit(variation.seed, 6) ? 1 : -1;
    const gateOffset = gateSide * variation.width * 0.26;
    return {
      front,
      plotFrontLocal,
      depth,
      centerZ: front + depth / 2,
      gateOffset,
      gateSide,
      fenceLength: variation.width + 2.6,
    };
  }, [variation, street.plotFront, position]);

  useFrame((state, delta) => {
    // --- ELECTRICIDAD → ventanas encendidas ---------------------------------
    const slots = plan.windows.length;
    const litRatio = litFraction(team.electricidad);
    const litCount = clamp(Math.round(litRatio * slots), 0, slots);

    // Crisis = caída de tensión global, con la MISMA fase en todas las casas
    // (el parpadeo simultáneo del vecindario en crisis).
    const crisisFlicker = isCrisis ? 0.55 + 0.45 * Math.sin(state.clock.elapsedTime * 13.2) : 1;
    const brownout = isCrisis ? 0.62 : 1;
    // Eficiencia baja = instalación que falla: su propia oscilación, desfasada por casa,
    // siempre visible por encima de 0 (nunca se apaga del todo).
    const fragilidad = clamp(1 - team.eficiencia / UMBRAL_EFICIENCIA_FRAGIL, 0, 1);
    const phase = (variation.seed % 100) / 100;
    const ownFlicker =
      1 - fragilidad * (0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 17 + phase * 6.28));
    const brillo = clamp(crisisFlicker * brownout * ownFlicker, 0.16, 1.05);

    const paneMesh = paneMeshRef.current;
    if (paneMesh && paneMesh.instanceColor) {
      for (let index = 0; index < slots; index += 1) {
        if (index < litCount) scratchColor.copy(LIT_PANE).multiplyScalar(brillo);
        else scratchColor.copy(DARK_PANE);
        paneMesh.setColorAt(index, scratchColor);
      }
      paneMesh.instanceColor.needsUpdate = true;
    }

    // --- GAS → humo y llama -------------------------------------------------
    const tSmoke = expDamp(delta, 1.8);
    const densidad = smokeIntensity(team.gas);
    const smokeColor = isCrisis ? SMOKE_CRISIS : SMOKE_OK;
    const speedFactor = 0.75 + clamp(team.gas, 0, 160) / 160;
    smokeRefs.current.forEach((puff, index) => {
      if (!puff) return;
      const material = puff.material as THREE.MeshBasicMaterial;
      const ciclo = (state.clock.elapsedTime * 0.22 * speedFactor + index / SMOKE_PUFFS) % 1;
      puff.position.y = ciclo * 1.9;
      puff.position.x = Math.sin(state.clock.elapsedTime * 0.7 + index) * 0.16 * ciclo;
      puff.scale.setScalar(0.42 + ciclo * 1.25);
      const objetivo = densidad * (1 - ciclo) * (isCrisis ? 1.25 : 1);
      material.opacity += (objetivo - material.opacity) * tSmoke;
      material.color.lerp(smokeColor, tSmoke);
    });
    const llama = flameIntensity(team.gas);
    if (flameRef.current) {
      const pulso = 0.85 + 0.15 * Math.sin(state.clock.elapsedTime * 11 + phase * 4);
      flameRef.current.scale.set(0.26 * (0.4 + llama), 0.5 * (0.3 + llama) * pulso, 0.26 * (0.4 + llama));
      const material = flameRef.current.material as THREE.MeshBasicMaterial;
      material.opacity += (0.2 + llama * 0.75 - material.opacity) * expDamp(delta, 3);
    }

    // --- PRESUPUESTO → medidor del techo ------------------------------------
    if (rotorRef.current) rotorRef.current.rotation.y += delta * meterSpeed(team.presupuesto);

    // --- EFICIENCIA → color del aura, del césped y de la luz ----------------
    efficiencyColor(team.eficiencia, scratchColor2);
    const tAura = expDamp(delta, 2.2);
    if (auraRef.current) {
      const material = auraRef.current.material as THREE.MeshBasicMaterial;
      material.color.lerp(scratchColor2, tAura);
      const pulso = 0.72 + 0.28 * Math.sin(state.clock.elapsedTime * 1.5 + phase * 6.28);
      const objetivo = (isSelected ? 0.42 : 0.2) * pulso * (isCrisis ? 1.15 : 1);
      material.opacity += (objetivo - material.opacity) * tAura;
      const escala = 1 + (1 - clamp(team.eficiencia / 100, 0, 1)) * 0.22;
      auraRef.current.scale.set(
        auraRef.current.scale.x + (variation.width * 0.5 * escala - auraRef.current.scale.x) * tAura,
        auraRef.current.scale.y + (plot.depth * 0.55 * escala - auraRef.current.scale.y) * tAura,
        1,
      );
    }
    if (poolRef.current) {
      const material = poolRef.current.material as THREE.MeshBasicMaterial;
      // La luz que se escapa por las ventanas: sube con el consumo y con la eficiencia.
      material.color.copy(scratchColor2).lerp(LIT_PANE, 0.55);
      const objetivo = (0.1 + litRatio * 0.35) * brillo * (isCrisis ? 0.8 : 1);
      material.opacity += (objetivo - material.opacity) * tAura;
    }
    materials.lawn.color.copy(LAWN_BASE).lerp(scratchColor2, 0.55);

    // --- RANKING → haz de luz, halo y aro del líder --------------------------
    const tLider = expDamp(delta, 1.6);
    if (haloRef.current) {
      const material = haloRef.current.material as THREE.MeshBasicMaterial;
      // Muy discreto: el halo es un acento, el aviso claro es el aro del suelo.
      const objetivo = isLeader ? 0.055 + 0.02 * Math.sin(state.clock.elapsedTime * 2.2) : 0;
      material.opacity += (objetivo - material.opacity) * tLider;
      haloRef.current.rotation.y += delta * 0.2;
    }
    if (beamRef.current) {
      const material = beamRef.current.material as THREE.MeshBasicMaterial;
      // Haz volumétrico con degradado: 0 arriba, máximo al tocar el suelo.
      const objetivo = isLeader ? 0.2 + 0.04 * Math.sin(state.clock.elapsedTime * 1.3) : 0;
      material.opacity += (objetivo - material.opacity) * tLider;
    }
    if (leaderRingRef.current) {
      const material = leaderRingRef.current.material as THREE.MeshBasicMaterial;
      const objetivo = isLeader ? 0.3 + 0.08 * Math.sin(state.clock.elapsedTime * 2.6) : 0;
      material.opacity += (objetivo - material.opacity) * tLider;
    }

    // --- SELECCIÓN → la casa se yergue y la puerta se enciende --------------
    const tSel = expDamp(delta, 3.2);
    if (liftRef.current) {
      liftRef.current.position.y += ((isSelected ? 0.16 : 0) - liftRef.current.position.y) * tSel;
    }
    materials.door.emissiveIntensity += ((isSelected ? 0.5 : 0.08) - materials.door.emissiveIntensity) * tSel;

    // --- Humo siempre de cara a la cámara (billboard por guiñada) -----------
    if (smokeGroupRef.current) {
      const camAzimuth = Math.atan2(
        state.camera.position.x - position[0],
        state.camera.position.z - position[2],
      );
      smokeGroupRef.current.rotation.y = camAzimuth - yaw;
    }
  });

  const handleSelect = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(team.id);
  };

  const Volume =
    variation.archetype === 'local'
      ? LocalVolume
      : variation.archetype === 'apartamentos'
        ? ApartamentosVolume
        : variation.archetype === 'oficina'
          ? OficinaVolume
          : CasaVolume;

  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {/* Caja de impacto invisible: un solo objeto con manejadores en vez de 100 mallas
          → el raycast del puntero se mantiene barato con 6 casas en pantalla. */}
      <mesh
        position={[0, 2.6, plot.centerZ * 0.4]}
        scale={[variation.width + 3.0, 6.5, variation.depth + plot.depth + 2]}
        visible={false}
        onClick={handleSelect}
        onPointerOver={() => {
          if (typeof document !== 'undefined') document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          if (typeof document !== 'undefined') document.body.style.cursor = 'auto';
        }}
      >
        <boxGeometry args={[1, 1, 1]} />
      </mesh>

      {/* Solar: no se levanta con la selección, está clavado en el suelo */}
      <mesh
        geometry={GEO.plane()}
        material={materials.lawn}
        position={[0, 0.015, plot.centerZ]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[variation.width + 2.2, plot.depth, 1]}
        receiveShadow
      />
      <mesh
        geometry={GEO.box()}
        material={materials.base}
        position={[plan.door.position[0], 0.05, plot.front + 0.9]}
        scale={[1.3, 0.09, 1.8]}
        receiveShadow
      />
      {variation.hasFence && (
        <FenceRun
          position={[0, 0, plot.plotFrontLocal - 0.2]}
          length={plot.fenceLength}
          materials={materials}
          gateOffset={plot.gateOffset}
        />
      )}
      {variation.hasCar && (
        <>
          <Driveway
            position={[plot.gateOffset, 0.02, plot.front + plot.depth * 0.5]}
            width={3.2}
            length={plot.depth + 1.2}
            materials={materials}
          />
          <Car
            position={[plot.gateOffset, 0, plot.front + 1.9]}
            rotationY={Math.PI}
            bodyColor={variation.palette.accent}
            materials={materials}
          />
        </>
      )}
      {variation.hasFence && (
        <Mailbox position={[-plot.gateOffset * 1.4, 0, plot.plotFrontLocal - 0.75]} materials={materials} />
      )}
      <TeamSign
        position={[-plot.gateSide * variation.width * 0.34, 0, plot.plotFrontLocal - 1.5]}
        rotationY={-plot.gateSide * 0.14}
        width={Math.min(2.6, variation.width * 0.4)}
        materials={materials}
        label={label}
      />
      {/* Charco de luz de las ventanas + anillo de eficiencia */}
      <LightPool
        position={[0, 0.03, plot.front + plot.depth * 0.22]}
        size={[variation.width + 2.6, plot.depth * 1.3]}
        material={materials.pool}
      />
      <mesh
        ref={auraRef}
        geometry={GEO.ring(0.68)}
        material={materials.aura}
        position={[0, 0.04, plot.centerZ]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[variation.width * 0.5, plot.depth * 0.55, 1]}
      />
      {/* Aro de líder: va en el SOLAR (no se levanta con la selección) porque es una
          marca de suelo. Con el haz degradado + este aro, el líder se lee de un vistazo
          incluso con el proyector descalibrado. */}
      <mesh
        ref={leaderRingRef}
        geometry={GEO.ring(0.9)}
        material={materials.leaderRing}
        position={[0, 0.055, plot.centerZ * 0.55]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[variation.width * 0.62, (plot.depth + variation.depth) * 0.45, 1]}
      />

      {/* Edificio + cubierta + detalles: esto sí se levanta al seleccionar */}
      <group ref={liftRef}>
        <Volume v={variation} materials={materials} plan={plan} />
        <WindowLayer windows={plan.windows} materials={materials} paneMeshRef={paneMeshRef} />
        <DoorVano
          position={plan.door.position}
          width={plan.door.width}
          height={plan.door.height}
          materials={materials}
          doorMaterial={materials.door}
          canopy={variation.archetype === 'casa'}
          steps={2}
        />
        {plan.frame.chimney && (
          <Chimney
            position={plan.frame.chimney.position}
            height={plan.frame.chimney.height}
            materials={materials}
          />
        )}
        {plan.frame.flue && (
          <Flue position={plan.frame.flue.position} height={plan.frame.flue.height} materials={materials} />
        )}
        {variation.hasDish && (
          <SatelliteDish
            position={[variation.width * 0.4, plan.frame.wallTop - 0.9, variation.depth / 2 + 0.1]}
            rotationY={-0.5}
            scale={0.9}
          />
        )}
        <RooftopMeter
          position={
            variation.flatRoof
              ? [-variation.width * 0.32, plan.frame.wallTop + 0.22, -variation.depth * 0.08]
              : [-variation.width * 0.36, plan.frame.wallTop - 0.45, variation.depth / 2 + 0.16]
          }
          materials={materials}
          rotorRef={rotorRef}
        />

        {/* Humo de la salida real (chimenea o salida de humos) */}
        <group ref={smokeGroupRef} position={plan.frame.vent}>
          {Array.from({ length: SMOKE_PUFFS }, (_, index) => (
            <mesh
              key={`humo-${index}`}
              ref={(mesh) => {
                smokeRefs.current[index] = mesh;
              }}
              geometry={GEO.plane()}
              material={puffMaterials[index]}
              position={[0, 0, 0]}
            />
          ))}
        </group>
        <mesh ref={flameRef} geometry={GEO.cone(8)} material={materials.flame} position={plan.frame.vent} />

        {/* Haz del líder: cono con el foco ARRIBA y la base ancha en el suelo, con
            degradado (opacidad 0 en el foco, máximo al tocar el suelo) → volumen de luz
            sin bordes duros. Antes era un cono invertido y se veía como un triángulo. */}
        <mesh
          ref={haloRef}
          geometry={GEO.cylinderOpen(20)}
          material={materials.halo}
          position={[0, variation.totalHeight * 0.45, 0]}
          scale={[variation.width * 0.62, variation.totalHeight, variation.depth * 0.7]}
        />
        <mesh
          ref={beamRef}
          geometry={GEO.coneOpen(20)}
          material={materials.beam}
          position={[0, (variation.totalHeight + 8) / 2, 0]}
          scale={[variation.width * 0.72, variation.totalHeight + 8, variation.depth * 0.66]}
        />
      </group>
    </group>
  );
}
