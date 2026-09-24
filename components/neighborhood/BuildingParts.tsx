'use client';

/**
 * Piezas constructivas reutilizables del vecindario.
 *
 * Todo se arma con geometría paramétrica propia: cajas unitarias escaladas, extrusiones
 * con `THREE.Shape` (tejados a dos aguas, toldos, vanos con hueco) y unos pocos
 * sólidos de revolución. Nada de assets ni mallas importadas.
 *
 * RENDIMIENTO
 *  - Las geometrías se cachean por clave (`GEO.*`): las 6 casas comparten las mismas
 *    mallas base, así que la VRAM y las subidas a GPU no se multiplican por equipo.
 *  - Los elementos que se repiten dentro de una misma pieza (barrotes de barandilla,
 *    lamas de valla, ruedas del coche) van en un `InstancedMesh`: 1 draw call en vez
 *    de 12-20.
 *  - Solo las piezas grandes proyectan sombra (`castShadow`): el pase de sombra es
 *    el pase más caro y en el aula ya hubo un pico de CPU.
 */

import React, { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import type { HouseMaterials } from './materials';
import { grilleMaterial, metalMaterial, metallicDoubleSided, trimMaterial, wallMaterial } from './materials';

/* -------------------------------------------------------------------------- *
 * Cachés de geometría
 * -------------------------------------------------------------------------- */

const geometryCache = new Map<string, THREE.BufferGeometry>();

function cacheGeometry<T extends THREE.BufferGeometry>(key: string, factory: () => T): T {
  const found = geometryCache.get(key);
  if (found) return found as T;
  const geometry = factory();
  geometryCache.set(key, geometry);
  return geometry;
}

function createFrameGeometry(
  width: number,
  height: number,
  thickness: number,
  depth: number,
  sill: number,
  lintel: number,
): THREE.ExtrudeGeometry {
  const w = width / 2;
  const h = height / 2;
  const t = thickness;
  const shape = new THREE.Shape();
  // Perfil exterior asimétrico: el antepecho (abajo) y el dintel (arriba) sobresalen
  // respecto a las jambas, así el vano se lee como hueco de fábrica y no como calcomanía.
  shape.moveTo(-w - t, -h - t - sill);
  shape.lineTo(w + t, -h - t - sill);
  shape.lineTo(w + t, h + t + lintel);
  shape.lineTo(-w - t, h + t + lintel);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-w, -h);
  hole.lineTo(-w, h);
  hole.lineTo(w, h);
  hole.lineTo(w, -h);
  hole.closePath();
  shape.holes.push(hole);
  // El hueco del vano sale del propio Shape: marco + revelo visible, sin CSG.
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

/** Tejado a dos aguas: triángulo perfilado en Z-Y extruido a lo largo de X. */
function createGableGeometry(
  width: number,
  depth: number,
  overhangX: number,
  overhangZ: number,
  height: number,
): THREE.ExtrudeGeometry {
  const half = depth / 2 + overhangZ;
  const span = width + overhangX * 2;
  const shape = new THREE.Shape();
  shape.moveTo(-half, 0);
  shape.lineTo(half, 0);
  shape.lineTo(0, height);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: span,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -span / 2);
  geometry.rotateY(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/** Toldo: perfil en pendiente con faldón frontal, extruido a lo ancho del local. */
function createAwningGeometry(
  width: number,
  depth: number,
  drop: number,
  flap: number,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.16);
  shape.lineTo(depth, -drop);
  shape.lineTo(depth, -drop - flap);
  shape.lineTo(0, -0.18);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -width / 2);
  geometry.rotateY(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

const r2 = (value: number): string => value.toFixed(2);

export const GEO = {
  box: (): THREE.BufferGeometry => cacheGeometry('box', () => new THREE.BoxGeometry(1, 1, 1)),
  plane: (): THREE.BufferGeometry => cacheGeometry('plane', () => new THREE.PlaneGeometry(1, 1)),
  cylinder: (segments = 8): THREE.BufferGeometry =>
    cacheGeometry(`cyl|${segments}`, () => new THREE.CylinderGeometry(1, 1, 1, segments)),
  cone: (segments = 10): THREE.BufferGeometry =>
    cacheGeometry(`cone|${segments}`, () => new THREE.ConeGeometry(1, 1, segments)),
  sphere: (widthSegments = 8, heightSegments = 6): THREE.BufferGeometry =>
    cacheGeometry(`sph|${widthSegments}|${heightSegments}`, () =>
      new THREE.SphereGeometry(1, widthSegments, heightSegments),
    ),
  icosa: (): THREE.BufferGeometry =>
    cacheGeometry('icosa', () => new THREE.IcosahedronGeometry(1, 0)),
  ring: (inner: number): THREE.BufferGeometry =>
    cacheGeometry(`ring|${r2(inner)}`, () => new THREE.RingGeometry(inner, 1, 44)),
  cylinderOpen: (segments = 20): THREE.BufferGeometry =>
    cacheGeometry(`cylO|${segments}`, () => new THREE.CylinderGeometry(1, 1, 1, segments, 1, true)),
  coneOpen: (segments = 18): THREE.BufferGeometry =>
    cacheGeometry(`coneO|${segments}`, () => new THREE.ConeGeometry(1, 1, segments, 1, true)),
  frame: (
    width: number,
    height: number,
    thickness = 0.07,
    depth = 0.16,
    sill = 0.12,
    lintel = 0.05,
  ): THREE.BufferGeometry =>
    cacheGeometry(
      `frame|${r2(width)}|${r2(height)}|${r2(thickness)}|${r2(depth)}|${r2(sill)}|${r2(lintel)}`,
      () => createFrameGeometry(width, height, thickness, depth, sill, lintel),
    ),
  gable: (
    width: number,
    depth: number,
    overhangX: number,
    overhangZ: number,
    height: number,
  ): THREE.BufferGeometry =>
    cacheGeometry(
      `gable|${r2(width)}|${r2(depth)}|${r2(overhangX)}|${r2(overhangZ)}|${r2(height)}`,
      () => createGableGeometry(width, depth, overhangX, overhangZ, height),
    ),
  awning: (width: number, depth: number, drop: number, flap: number): THREE.BufferGeometry =>
    cacheGeometry(`awn|${r2(width)}|${r2(depth)}|${r2(drop)}|${r2(flap)}`, () =>
      createAwningGeometry(width, depth, drop, flap),
    ),
};

/* -------------------------------------------------------------------------- *
 * Campo instanciado (reutiliza geometría/material y agrupa en 1 draw call)
 * -------------------------------------------------------------------------- */

export interface InstancedFieldProps {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrices: THREE.Matrix4[];
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export function InstancedField({
  geometry,
  material,
  matrices,
  castShadow = false,
  receiveShadow = false,
}: InstancedFieldProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    // Esfera envolvente recalculada: tres frunce el campo cuando la casa sale de cámara.
    mesh.computeBoundingSphere();
  }, [matrices]);

  if (matrices.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, matrices.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  );
}

/**
 * Matriz de instancia. `rotation` acepta un ángulo en Y (caso habitual) o un Euler
 * completo (las ruedas del coche necesitan el cilindro tumbado sobre el eje X).
 */
export function instanceMatrix(
  position: [number, number, number],
  scale: [number, number, number],
  rotation: number | [number, number, number] = 0,
): THREE.Matrix4 {
  const euler =
    typeof rotation === 'number'
      ? new THREE.Euler(0, rotation, 0)
      : new THREE.Euler(rotation[0], rotation[1], rotation[2]);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(euler),
    new THREE.Vector3(...scale),
  );
}

/* -------------------------------------------------------------------------- *
 * Envolventes
 * -------------------------------------------------------------------------- */

/** Zócalo: un edificio real nunca nace del asfalto, siempre hay un arranque. */
export function Plinth({
  width,
  depth,
  height,
  material,
}: {
  width: number;
  depth: number;
  height: number;
  material: THREE.Material;
}) {
  return (
    <mesh
      geometry={GEO.box()}
      material={material}
      position={[0, height / 2, 0]}
      scale={[width + 0.28, height, depth + 0.28]}
      castShadow
      receiveShadow
    />
  );
}

export function GableRoof({
  width,
  depth,
  height,
  materials,
  overhangX = 0.42,
  overhangZ = 0.38,
  position,
}: {
  width: number;
  depth: number;
  height: number;
  materials: HouseMaterials;
  overhangX?: number;
  overhangZ?: number;
  position: [number, number, number];
}) {
  const geometry = GEO.gable(width, depth, overhangX, overhangZ, height);
  const eave = depth / 2 + overhangZ;
  const span = width + overhangX * 2;
  return (
    <group position={position}>
      {/* material[0] = fachones (los triángulos de los extremos) → color de muro;
          material[1] = faldones → teja. ExtrudeGeometry ya trae los dos grupos. */}
      <mesh geometry={geometry} material={[materials.trim, materials.roof]} castShadow receiveShadow />
      <mesh
        geometry={GEO.box()}
        material={materials.roofCap}
        position={[0, height + 0.01, 0]}
        scale={[span + 0.14, 0.11, 0.28]}
      />
      <mesh
        geometry={GEO.box()}
        material={materials.trim}
        position={[0, -0.04, eave - 0.04]}
        scale={[span + 0.08, 0.17, 0.09]}
      />
      <mesh
        geometry={GEO.box()}
        material={materials.trim}
        position={[0, -0.04, -eave + 0.04]}
        scale={[span + 0.08, 0.17, 0.09]}
      />
      {/* Canalón metálico sobre el alero delantero */}
      <mesh
        geometry={GEO.cylinder(8)}
        material={materials.metal}
        position={[0, 0.04, eave + 0.02]}
        rotation={[0, 0, Math.PI / 2]}
        scale={[0.07, span, 0.07]}
      />
    </group>
  );
}

export function FlatRoof({
  width,
  depth,
  parapet,
  materials,
  position,
}: {
  width: number;
  depth: number;
  parapet: number;
  materials: HouseMaterials;
  position: [number, number, number];
}) {
  const slab = 0.22;
  const front = depth + 0.3;
  return (
    <group position={position}>
      <mesh
        geometry={GEO.box()}
        material={materials.flatRoof}
        position={[0, slab / 2, 0]}
        scale={[width + 0.24, slab, depth + 0.24]}
        receiveShadow
      />
      {/* Peto perimetral + albardilla clara: el remate que hace leer "edificio". */}
      {([
        [0, slab + parapet / 2, front / 2],
        [0, slab + parapet / 2, -front / 2],
        [width / 2 + 0.15, slab + parapet / 2, 0],
        [-width / 2 - 0.15, slab + parapet / 2, 0],
      ] as Array<[number, number, number]>).map(([x, y, z], index) => (
        <mesh
          key={`peto-${index}`}
          geometry={GEO.box()}
          material={materials.trim}
          position={[x, y, z]}
          scale={index < 2 ? [width + 0.44, parapet, 0.16] : [0.16, parapet, depth + 0.44]}
          castShadow
        />
      ))}
      {([
        [0, slab + parapet + 0.04, front / 2],
        [0, slab + parapet + 0.04, -front / 2],
        [width / 2 + 0.15, slab + parapet + 0.04, 0],
        [-width / 2 - 0.15, slab + parapet + 0.04, 0],
      ] as Array<[number, number, number]>).map(([x, y, z], index) => (
        <mesh
          key={`albardilla-${index}`}
          geometry={GEO.box()}
          material={materials.roofCap}
          position={[x, y, z]}
          scale={index < 2 ? [width + 0.56, 0.08, 0.26] : [0.26, 0.08, depth + 0.56]}
        />
      ))}
    </group>
  );
}

/** Chimenea de ladrillo con sombrero y corona: el origen del humo (gas). */
export function Chimney({
  position,
  height,
  width = 0.62,
  materials,
}: {
  position: [number, number, number];
  height: number;
  width?: number;
  materials: HouseMaterials;
}) {
  return (
    <group position={position}>
      <mesh geometry={GEO.box()} material={materials.brick} scale={[width, height, width]} castShadow />
      <mesh
        geometry={GEO.box()}
        material={materials.roofCap}
        position={[0, height / 2 + 0.06, 0]}
        scale={[width * 1.3, 0.13, width * 1.3]}
      />
      {([
        [width * 0.42, width * 0.42],
        [-width * 0.42, width * 0.42],
        [width * 0.42, -width * 0.42],
        [-width * 0.42, -width * 0.42],
      ] as Array<[number, number]>).map(([x, z], index) => (
        <mesh
          key={`sombrero-pie-${index}`}
          geometry={GEO.box()}
          material={materials.metal}
          position={[x, height / 2 + 0.2, z]}
          scale={[0.07, 0.18, 0.07]}
        />
      ))}
      <mesh
        geometry={GEO.box()}
        material={materials.metal}
        position={[0, height / 2 + 0.32, 0]}
        scale={[width * 1.5, 0.09, width * 1.5]}
      />
    </group>
  );
}

/** Salida de humos de cubierta plana: sin chimenea, el gas igual tiene que verse. */
export function Flue({
  position,
  height = 1.05,
  materials,
}: {
  position: [number, number, number];
  height?: number;
  materials: HouseMaterials;
}) {
  return (
    <group position={position}>
      <mesh geometry={GEO.box()} material={materials.trim} scale={[0.56, 0.09, 0.56]} />
      <mesh
        geometry={GEO.cylinder(8)}
        material={materials.metal}
        position={[0, height / 2, 0]}
        scale={[0.15, height, 0.15]}
        castShadow
      />
      <mesh
        geometry={GEO.cylinder(8)}
        material={materials.metal}
        position={[0, height * 0.55, 0]}
        scale={[0.2, 0.07, 0.2]}
      />
      <mesh
        geometry={GEO.cone(10)}
        material={materials.metal}
        position={[0, height + 0.16, 0]}
        scale={[0.27, 0.24, 0.27]}
      />
    </group>
  );
}

/* -------------------------------------------------------------------------- *
 * Vanos
 *
 * Las VENTANAS no son una pieza por vano: cada casa instancia el marco (una malla
 * por tamaño de vano, con antepecho y dintel incluidos en la propia extrusión) y
 * TODOS los vidrios en un único InstancedMesh con color por instancia. Resultado:
 * un edificio de 20 ventanas consume 3-4 draw calls en vez de 100, y el encendido
 * ventana a ventana (electricidad) se anima escribiendo colores de instancia, sin
 * crear ni un material por frame.
 * -------------------------------------------------------------------------- */

/** Desplazamiento en el sistema local del vano (el +Z local mira a la calle). */
export function facingOffset(
  position: [number, number, number],
  rotationY: number,
  localZ: number,
): [number, number, number] {
  return [
    position[0] + Math.sin(rotationY) * localZ,
    position[1],
    position[2] + Math.cos(rotationY) * localZ,
  ];
}

export interface DoorVanoProps {
  position: [number, number, number];
  rotationY?: number;
  width?: number;
  height?: number;
  materials: HouseMaterials;
  /** Puerta en el color de identidad del equipo (acento visible). */
  doorMaterial: THREE.Material;
  canopy?: boolean;
  steps?: number;
}

export function DoorVano({
  position,
  rotationY = 0,
  width = 1.05,
  height = 2.2,
  materials,
  doorMaterial,
  canopy = false,
  steps = 0,
}: DoorVanoProps) {
  const thickness = 0.1;
  const depth = 0.2;
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh geometry={GEO.frame(width, height, thickness, depth)} material={materials.trim} castShadow />
      <mesh
        geometry={GEO.box()}
        material={doorMaterial}
        position={[0, 0, -0.06]}
        scale={[width - 0.06, height - 0.04, 0.08]}
      />
      {/* Manilla + mirilla de latón */}
      <mesh
        geometry={GEO.cylinder(8)}
        material={materials.metal}
        position={[width / 2 - 0.18, 0, 0.02]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[0.035, 0.16, 0.035]}
      />
      <mesh
        geometry={GEO.box()}
        material={materials.metal}
        position={[0, height * 0.24, -0.01]}
        scale={[0.2, 0.02, 0.02]}
      />
      {/* Luz de porche: vive aunque la casa esté a oscuras, da escala humana */}
      <mesh
        geometry={GEO.sphere(8, 6)}
        material={materials.flame}
        position={[width / 2 + 0.34, height * 0.42, 0.16]}
        scale={[0.09, 0.09, 0.09]}
      />
      {steps > 0 && (
        <>
          <mesh
            geometry={GEO.box()}
            material={materials.base}
            position={[0, -height / 2 - 0.05, 0.34]}
            scale={[width + 1.1, 0.16, 0.72]}
          />
          {steps > 1 && (
            <mesh
              geometry={GEO.box()}
              material={materials.base}
              position={[0, -height / 2 - 0.2, 0.66]}
              scale={[width + 1.3, 0.16, 0.72]}
            />
          )}
        </>
      )}
      {canopy && (
        <group position={[0, height / 2 + thickness + 0.22, 0.3]}>
          <mesh
            geometry={GEO.gable(width + 1.5, 1.5, 0.16, 0.22, 0.34)}
            material={[materials.trim, materials.roof]}
            castShadow
          />
          <mesh
            geometry={GEO.box()}
            material={materials.trim}
            position={[width / 2 + 0.5, -0.7, 0.5]}
            scale={[0.11, 1.4, 0.11]}
          />
          <mesh
            geometry={GEO.box()}
            material={materials.trim}
            position={[-width / 2 - 0.5, -0.7, 0.5]}
            scale={[0.11, 1.4, 0.11]}
          />
        </group>
      )}
    </group>
  );
}

/* -------------------------------------------------------------------------- *
 * Detalles de fachada y cubierta
 * -------------------------------------------------------------------------- */

export function Balcony({
  position,
  width,
  materials,
  railMaterial,
}: {
  position: [number, number, number];
  width: number;
  materials: HouseMaterials;
  railMaterial?: THREE.Material;
}) {
  const rail = railMaterial ?? materials.metal;
  const bars = useMemo(() => {
    const count = Math.max(6, Math.round(width / 0.22));
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i <= count; i += 1) {
      const x = -width / 2 + (i / count) * width;
      matrices.push(instanceMatrix([x, 0.44, 0.5], [0.035, 0.88, 0.035]));
    }
    return matrices;
  }, [width]);

  return (
    <group position={position}>
      <mesh geometry={GEO.box()} material={materials.accent} scale={[width + 0.3, 0.14, 1.25]} castShadow />
      <mesh
        geometry={GEO.box()}
        material={rail}
        position={[0, 0.92, 0.5]}
        scale={[width + 0.3, 0.06, 0.06]}
      />
      <mesh
        geometry={GEO.box()}
        material={rail}
        position={[width / 2 + 0.13, 0.5, 0.5]}
        scale={[0.06, 0.9, 0.06]}
      />
      <mesh
        geometry={GEO.box()}
        material={rail}
        position={[-width / 2 - 0.13, 0.5, 0.5]}
        scale={[0.06, 0.9, 0.06]}
      />
      <InstancedField geometry={GEO.box()} material={rail} matrices={bars} />
    </group>
  );
}

/** Equipo de aire acondicionado: en fachada (con bandeja) o sobre cubierta. */
export function AcUnit({
  position,
  rotationY = 0,
  size = [1.15, 0.82, 0.72],
  wallMounted = false,
}: {
  position: [number, number, number];
  rotationY?: number;
  size?: [number, number, number];
  wallMounted?: boolean;
}) {
  const [width, height, depth] = size;
  const body = grilleMaterial('#49515F');
  const metal = metalMaterial('#6B7484');
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh geometry={GEO.box()} material={body} scale={size} castShadow />
      <mesh
        geometry={GEO.cylinder(12)}
        material={metalMaterial('#252A34', 0.5, 0.6)}
        position={[0, 0, depth / 2 + 0.01]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[Math.min(width, height) * 0.34, 0.05, Math.min(width, height) * 0.34]}
      />
      {[0, 1, 2].map((index) => (
        <mesh
          key={`aspa-${index}`}
          geometry={GEO.box()}
          material={metal}
          position={[0, 0, depth / 2 + 0.04]}
          rotation={[0, 0, (index * Math.PI * 2) / 3]}
          scale={[Math.min(width, height) * 0.3, 0.06, 0.03]}
        />
      ))}
      {wallMounted ? (
        <>
          <mesh
            geometry={GEO.box()}
            material={metal}
            position={[0, -height / 2 - 0.06, 0]}
            scale={[width + 0.2, 0.1, depth + 0.2]}
          />
          <mesh
            geometry={GEO.box()}
            material={metal}
            position={[0, -height / 2 - 0.5, -depth * 0.3]}
            rotation={[0.5, 0, 0]}
            scale={[0.06, 0.7, 0.06]}
          />
        </>
      ) : (
        [1, -1].map((side) => (
          <mesh
            key={`pie-${side}`}
            geometry={GEO.box()}
            material={metal}
            position={[side * (width / 2 - 0.16), -height / 2 - 0.07, 0]}
            scale={[0.1, 0.14, depth]}
          />
        ))
      )}
    </group>
  );
}

export function SatelliteDish({
  position,
  rotationY = 0,
  scale = 1,
}: {
  position: [number, number, number];
  rotationY?: number;
  scale?: number;
}) {
  const dish = metallicDoubleSided('#9AA6B8');
  const arm = metalMaterial('#7C8698');
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <mesh
        geometry={GEO.cone(14)}
        material={dish}
        position={[0, 0, 0.06]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[0.46, 0.3, 0.46]}
      />
      <mesh
        geometry={GEO.box()}
        material={arm}
        position={[0, 0, 0.3]}
        rotation={[0.5, 0, 0]}
        scale={[0.05, 0.05, 0.5]}
      />
      <mesh geometry={GEO.box()} material={arm} position={[0, 0.12, 0.48]} scale={[0.12, 0.12, 0.16]} />
      <mesh
        geometry={GEO.cylinder(8)}
        material={arm}
        position={[0, -0.3, 0]}
        scale={[0.05, 0.4, 0.05]}
      />
    </group>
  );
}

export function Antenna({
  position,
  height = 2.4,
  materials,
}: {
  position: [number, number, number];
  height?: number;
  materials: HouseMaterials;
}) {
  return (
    <group position={position}>
      <mesh
        geometry={GEO.cylinder(6)}
        material={materials.metal}
        position={[0, height / 2, 0]}
        scale={[0.035, height, 0.035]}
      />
      {[0.45, 0.68, 0.88].map((ratio, index) => (
        <mesh
          key={`brazo-${index}`}
          geometry={GEO.box()}
          material={materials.metal}
          position={[0, height * ratio, 0]}
          rotation={[0, index * 0.5, 0]}
          scale={[index === 1 ? 1.1 : 0.8, 0.025, 0.025]}
        />
      ))}
      {[0.45, 0.68, 0.88].map((ratio, index) => (
        <mesh
          key={`dipolo-${index}`}
          geometry={GEO.box()}
          material={materials.metal}
          position={[index === 1 ? 0.5 : 0.34, height * ratio + 0.12, 0]}
          scale={[0.02, 0.28, 0.02]}
        />
      ))}
    </group>
  );
}

export function WaterTank({
  position,
  radius = 0.78,
  height = 1.25,
  materials,
}: {
  position: [number, number, number];
  radius?: number;
  height?: number;
  materials: HouseMaterials;
}) {
  const tank = wallMaterial('#7E8A99');
  return (
    <group position={position}>
      <mesh
        geometry={GEO.cylinder(14)}
        material={tank}
        position={[0, height / 2 + 0.3, 0]}
        scale={[radius, height, radius]}
        castShadow
      />
      <mesh
        geometry={GEO.cone(14)}
        material={materials.metal}
        position={[0, height + 0.42, 0]}
        scale={[radius * 1.04, 0.34, radius * 1.04]}
      />
      {[
        [radius * 0.6, radius * 0.6],
        [-radius * 0.6, radius * 0.6],
        [radius * 0.6, -radius * 0.6],
        [-radius * 0.6, -radius * 0.6],
      ].map(([x, z], index) => (
        <mesh
          key={`pata-tanque-${index}`}
          geometry={GEO.box()}
          material={materials.metal}
          position={[x, 0.15, z]}
          scale={[0.09, 0.3, 0.09]}
        />
      ))}
    </group>
  );
}

/** Bajante: la fachada gana realismo con sus pluviales bien puestos. */
export function Downspout({
  position,
  height,
  materials,
}: {
  position: [number, number, number];
  height: number;
  materials: HouseMaterials;
}) {
  return (
    <group position={position}>
      <mesh
        geometry={GEO.box()}
        material={materials.trim}
        position={[0, height / 2, 0]}
        scale={[0.12, height, 0.12]}
      />
      {[0.25, 0.62, 0.88].map((ratio, index) => (
        <mesh
          key={`abrazadera-${index}`}
          geometry={GEO.box()}
          material={materials.metal}
          position={[0, height * ratio, -0.06]}
          scale={[0.18, 0.07, 0.1]}
        />
      ))}
      <mesh
        geometry={GEO.box()}
        material={materials.trim}
        position={[0, -0.12, 0.1]}
        rotation={[0.5, 0, 0]}
        scale={[0.12, 0.34, 0.12]}
      />
      <mesh geometry={GEO.box()} material={materials.trim} position={[0, -0.3, 0.22]} scale={[0.14, 0.1, 0.3]} />
    </group>
  );
}

/** Valla con lamas instanciadas, raíles y portón opcional. */
export function FenceRun({
  position,
  rotationY = 0,
  length,
  height = 1.0,
  materials,
  gateOffset,
  gateWidth = 2.6,
}: {
  position: [number, number, number];
  rotationY?: number;
  length: number;
  height?: number;
  materials: HouseMaterials;
  gateOffset?: number;
  gateWidth?: number;
}) {
  const pickets = useMemo(() => {
    const spacing = 0.32;
    const count = Math.floor(length / spacing);
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i <= count; i += 1) {
      const x = -length / 2 + i * spacing;
      if (
        gateOffset !== undefined &&
        x > gateOffset - gateWidth / 2 &&
        x < gateOffset + gateWidth / 2
      ) {
        continue;
      }
      matrices.push(instanceMatrix([x, height / 2, 0], [0.09, height, 0.035]));
    }
    return matrices;
  }, [length, height, gateOffset, gateWidth]);

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh
        geometry={GEO.box()}
        material={materials.accent}
        position={[0, height * 0.32, 0]}
        scale={[length, 0.08, 0.05]}
      />
      <mesh
        geometry={GEO.box()}
        material={materials.accent}
        position={[0, height * 0.76, 0]}
        scale={[length, 0.08, 0.05]}
      />
      <InstancedField geometry={GEO.box()} material={materials.trim} matrices={pickets} />
      {[-length / 2, length / 2].map((x, index) => (
        <mesh
          key={`poste-valla-${index}`}
          geometry={GEO.box()}
          material={materials.trim}
          position={[x, height / 2 + 0.1, 0]}
          scale={[0.14, height + 0.2, 0.14]}
          castShadow
        />
      ))}
      {gateOffset !== undefined && (
        <group position={[gateOffset, 0, 0]}>
          <mesh
            geometry={GEO.box()}
            material={materials.metal}
            position={[0, height / 2, 0.02]}
            scale={[gateWidth, height - 0.06, 0.05]}
          />
          <mesh
            geometry={GEO.box()}
            material={materials.metal}
            position={[0, height / 2, -0.02]}
            scale={[gateWidth * 0.92, height - 0.3, 0.05]}
          />
        </group>
      )}
    </group>
  );
}

/** Entrada de vehículos: losa de hormigón con las huellas de los neumáticos. */
export function Driveway({
  position,
  width = 3.4,
  length = 3.6,
  materials,
}: {
  position: [number, number, number];
  width?: number;
  length?: number;
  materials: HouseMaterials;
}) {
  const concrete = trimMaterial('#4A505C', 0.95);
  return (
    <group position={position}>
      <mesh geometry={GEO.box()} material={concrete} scale={[width, 0.07, length]} receiveShadow />
      {[-width / 4, width / 4].map((x, index) => (
        <mesh
          key={`huella-${index}`}
          geometry={GEO.box()}
          material={materials.base}
          position={[x, 0.05, 0]}
          scale={[width * 0.34, 0.02, length - 0.3]}
        />
      ))}
    </group>
  );
}

export function Mailbox({
  position,
  rotationY = 0,
  materials,
}: {
  position: [number, number, number];
  rotationY?: number;
  materials: HouseMaterials;
}) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh
        geometry={GEO.box()}
        material={materials.metal}
        position={[0, 0.55, 0]}
        scale={[0.08, 1.1, 0.08]}
      />
      <mesh
        geometry={GEO.box()}
        material={materials.trim}
        position={[0, 1.16, 0.06]}
        scale={[0.3, 0.28, 0.52]}
        castShadow
      />
      <mesh
        geometry={GEO.cylinder(10)}
        material={materials.trim}
        position={[0, 1.3, 0.06]}
        rotation={[0, 0, Math.PI / 2]}
        scale={[0.15, 0.3, 0.15]}
      />
      <mesh
        geometry={GEO.box()}
        material={materials.metal}
        position={[0.18, 1.24, 0.1]}
        scale={[0.02, 0.2, 0.02]}
      />
    </group>
  );
}

/** Coche de barrio: muy pocos triángulos, pero da escala humana a la calle. */
export function Car({
  position,
  rotationY = 0,
  bodyColor = '#7C3B44',
  materials,
}: {
  position: [number, number, number];
  rotationY?: number;
  bodyColor?: string;
  materials: HouseMaterials;
}) {
  const body = trimMaterial(bodyColor, 0.35);
  const dark = trimMaterial('#20242C', 0.5);
  const wheelMaterial = metalMaterial('#1B1F26', 0.7, 0.35);
  const wheels = useMemo(
    () =>
      [
        [0.82, 1.32],
        [-0.82, 1.32],
        [0.82, -1.32],
        [-0.82, -1.32],
      ].map(([x, z]) => instanceMatrix([x, 0.33, z], [0.33, 0.24, 0.33], [0, 0, Math.PI / 2])),
    [],
  );
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh geometry={GEO.box()} material={body} position={[0, 0.63, 0]} scale={[1.82, 0.6, 4.3]} castShadow />
      <mesh geometry={GEO.box()} material={dark} position={[0, 1.14, -0.22]} scale={[1.6, 0.5, 2.1]} />
      <mesh
        geometry={GEO.box()}
        material={body}
        position={[0, 1.42, -0.28]}
        scale={[1.54, 0.1, 1.95]}
      />
      {/* 4 ruedas en 1 draw call: cilindro tumbado sobre X (Euler completo). */}
      <InstancedField geometry={GEO.cylinder(10)} material={wheelMaterial} matrices={wheels} />
      {[
        [0.62, 0.72],
        [-0.62, 0.72],
      ].map(([x, y], index) => (
        <mesh
          key={`faro-${index}`}
          geometry={GEO.box()}
          material={materials.flame}
          position={[x, y, 2.16]}
          scale={[0.3, 0.14, 0.06]}
        />
      ))}
      {[
        [0.62, 0.78],
        [-0.62, 0.78],
      ].map(([x, y], index) => (
        <mesh
          key={`piloto-${index}`}
          geometry={GEO.box()}
          material={materials.halo}
          position={[x, y, -2.16]}
          scale={[0.26, 0.12, 0.06]}
        />
      ))}
    </group>
  );
}

/** Rótulo del equipo: nombre real en el color de identidad (dato del juego). */
export function TeamSign({
  position,
  rotationY = 0,
  width = 2.4,
  height = 1.2,
  materials,
  label,
}: {
  position: [number, number, number];
  rotationY?: number;
  width?: number;
  height?: number;
  materials: HouseMaterials;
  /** Material con la textura del nombre del equipo (se crea una vez por equipo). */
  label: THREE.Material;
}) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh
        geometry={GEO.box()}
        material={materials.metal}
        position={[0, height / 2, 0]}
        scale={[0.11, height + 1.5, 0.11]}
      />
      <mesh
        geometry={GEO.box()}
        material={materials.base}
        position={[0, height / 2 + 0.5, 0]}
        scale={[width + 0.18, height + 0.18, 0.1]}
        castShadow
      />
      <mesh
        geometry={GEO.plane()}
        material={label}
        position={[0, height / 2 + 0.5, 0.06]}
        scale={[width, height, 1]}
      />
      <mesh
        geometry={GEO.box()}
        material={materials.trim}
        position={[0, height + 0.62, 0.16]}
        rotation={[-0.22, 0, 0]}
        scale={[width + 0.5, 0.08, 0.5]}
      />
    </group>
  );
}

/** Medidor del techo: anemómetro que gira más rápido cuanto más presupuesto se gastó. */
export function RooftopMeter({
  position,
  materials,
  rotorRef,
}: {
  position: [number, number, number];
  materials: HouseMaterials;
  rotorRef: React.RefObject<THREE.Group>;
}) {
  const cyan = trimMaterial('#3EC6F0', 0.35);
  const bands = useMemo(
    () =>
      [0, 1, 2].map((index) =>
        instanceMatrix([0, -0.34 + index * 0.11, 0.13], [0.24, 0.03, 0.02]),
      ),
    [],
  );
  return (
    <group position={position}>
      <mesh geometry={GEO.box()} material={materials.base} scale={[0.46, 0.09, 0.46]} />
      <mesh
        geometry={GEO.cylinder(8)}
        material={materials.metal}
        position={[0, 0.34, 0]}
        scale={[0.05, 0.62, 0.05]}
      />
      <mesh
        geometry={GEO.box()}
        material={grilleMaterial('#3D4553')}
        position={[0, 0.82, 0]}
        scale={[0.36, 0.46, 0.22]}
      />
      <mesh
        geometry={GEO.box()}
        material={cyan}
        position={[0, 0.82, 0.12]}
        scale={[0.3, 0.05, 0.02]}
      />
      <InstancedField geometry={GEO.box()} material={materials.base} matrices={bands} />
      <group ref={rotorRef} position={[0, 1.16, 0]}>
        <mesh geometry={GEO.cylinder(8)} material={materials.metal} scale={[0.07, 0.12, 0.07]} />
        {[0, 1, 2].map((index) => (
          <group key={`cazoleta-${index}`} rotation={[0, (index * Math.PI * 2) / 3, 0]}>
            <mesh
              geometry={GEO.box()}
              material={materials.metal}
              position={[0.3, 0, 0]}
              scale={[0.6, 0.025, 0.025]}
            />
            <mesh
              geometry={GEO.sphere(8, 6)}
              material={materials.trim}
              position={[0.62, 0.02, 0]}
              scale={[0.11, 0.11, 0.05]}
            />
          </group>
        ))}
      </group>
    </group>
  );
}

/** Charco de luz en el suelo: bloom falso, cero pases extra de render. */
export function LightPool({
  position,
  size,
  material,
  rotationY = 0,
}: {
  position: [number, number, number];
  size: [number, number];
  material: THREE.Material;
  rotationY?: number;
}) {
  return (
    <mesh
      geometry={GEO.plane()}
      material={material}
      position={position}
      rotation={[-Math.PI / 2, 0, rotationY]}
      scale={[size[0], size[1], 1]}
    />
  );
}

/* -------------------------------------------------------------------------- *
 * Cierre
 * -------------------------------------------------------------------------- */
