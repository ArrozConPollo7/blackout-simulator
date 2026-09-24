'use client';

/**
 * Calle, entorno y RED ELÉCTRICA del vecindario.
 *
 * La red es la metáfora del juego: los postes llevan la línea por delante de las casas,
 * de cada poste baja una acometida hasta la fachada y por esos cables SE VE CORRER LA
 * ENERGÍA (pulsos que viajan por la catenaria). La velocidad y el brillo de esos pulsos
 * salen de la electricidad real de cada equipo: el que derrocha, manda pulsos rápidos y
 * brillantes; el que ahorra, los manda lentos y apagados. En crisis la red parpadea y
 * salta un arco eléctrico en el transformador.
 *
 * RENDIMIENTO (esto es la calle, se ve entera SIEMPRE: no hay culling que salve el frame)
 *  - Vallas, árboles, arbustos, postes, aisladores, marcas viales, juntas de acera,
 *    cruce peatonal y estrellas van INSTANCIADOS: la calle entera son ~20 draw calls.
 *  - Los pulsos de energía son UN solo InstancedMesh; sus matrices y colores se escriben
 *    por frame en un único buffer pequeño (24 instancias), sin crear objetos.
 *  - Los cables son TubeGeometry de 4 caras radiales (96 triángulos cada uno) memoizados:
 *    se construyen al entrar equipos, no en cada frame.
 *  - Los materiales que titilan en crisis son COMPARTIDOS (farolas): 2 materiales animados
 *    hacen parpadear toda la iluminación de la calle sin tocar cada mesh.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import {
  ALTURA_POSTE,
  clamp,
  expDamp,
  type NeighborhoodLayout,
  type StreetLayout,
} from './neighborhood-config';
import { GEO, InstancedField, LightPool, instanceMatrix } from './BuildingParts';
import {
  concreteRoadMaterial,
  grassMaterial,
  grilleMaterial,
  metalMaterial,
  pavementSignMaterial,
  sharedGlowMaterial,
  trimMaterial,
} from './street-materials';

/* -------------------------------------------------------------------------- *
 * Utilidades
 * -------------------------------------------------------------------------- */

/** Punto de una catenaria aproximada (parábola por seno) entre dos apoyos. */
function cablePoint(
  from: THREE.Vector3,
  to: THREE.Vector3,
  sag: number,
  t: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  return out.set(
    from.x + (to.x - from.x) * t,
    from.y + (to.y - from.y) * t - Math.sin(Math.PI * t) * sag,
    from.z + (to.z - from.z) * t,
  );
}

function cableGeometry(from: THREE.Vector3, to: THREE.Vector3, sag: number, radius: number): THREE.TubeGeometry {
  const points: THREE.Vector3[] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i += 1) {
    points.push(cablePoint(from, to, sag, i / steps, new THREE.Vector3()));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 12, radius, 4, false);
}

/** Libera geometrías memoizadas cuando cambian (evita fugas al entrar/salir equipos). */
function useDisposeOnChange(resources: Array<{ dispose: () => void }>): void {
  useEffect(
    () => () => {
      resources.forEach((resource) => resource.dispose());
    },
    [resources],
  );
}

const scratchMatrix = new THREE.Matrix4();
const scratchVector = new THREE.Vector3();
const scratchColor = new THREE.Color();
const PULSE_COLOR = new THREE.Color('#FFD27A');
const PULSE_COLOR_CRISIS = new THREE.Color('#FF7A4D');

/* -------------------------------------------------------------------------- *
 * Suelo
 * -------------------------------------------------------------------------- */

function Terrain({ isCrisis }: { isCrisis: boolean }) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, delta) => {
    if (!materialRef.current) return;
    const t = expDamp(delta, 1.6);
    materialRef.current.color.lerp(
      isCrisis ? scratchColor.set('#221013') : scratchColor.set('#141A20'),
      t,
    );
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]} receiveShadow>
      <planeGeometry args={[260, 260]} />
      <meshStandardMaterial ref={materialRef} color="#141A20" roughness={1} />
    </mesh>
  );
}

/* -------------------------------------------------------------------------- *
 * Calzada, acera y marcas
 * -------------------------------------------------------------------------- */

interface RoadProps {
  street: StreetLayout;
  spanWidth: number;
  centerX: number;
}

function Road({ street, spanWidth, centerX }: RoadProps) {
  const concrete = concreteRoadMaterial();
  const asphalt = useMemo(() => trimMaterial('#22262E', 0.4), []);
  const length = spanWidth + 34;

  const dashes = useMemo(() => {
    const matrices: THREE.Matrix4[] = [];
    const count = Math.floor(length / 2.6);
    for (let i = 0; i <= count; i += 1) {
      // El asfalto llega hasta y = 0.08: las marcas se pintan 1 cm por encima para que
      // no queden enterradas dentro de la losa (z-fighting / invisibles).
      matrices.push(instanceMatrix([centerX - length / 2 + i * 2.6, 0.09, street.roadCenter], [0.9, 0.02, 0.14]));
    }
    return matrices;
  }, [length, centerX, street.roadCenter]);

  const joints = useMemo(() => {
    const matrices: THREE.Matrix4[] = [];
    const sidewalkCenter = (street.sidewalk[0] + street.sidewalk[1]) / 2;
    const count = Math.floor(length / 1.8);
    for (let i = 0; i <= count; i += 1) {
      matrices.push(
        instanceMatrix(
          [centerX - length / 2 + i * 1.8, 0.235, sidewalkCenter],
          [0.05, 0.02, street.sidewalk[1] - street.sidewalk[0]],
        ),
      );
    }
    return matrices;
  }, [length, centerX, street.sidewalk]);

  const crosswalk = useMemo(() => {
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i < 7; i += 1) {
      matrices.push(
        instanceMatrix(
          [centerX + spanWidth / 2 + 7, 0.095, street.road[0] + 0.6 + i * 1.05],
          [1.4, 0.02, 0.55],
        ),
      );
    }
    return matrices;
  }, [centerX, spanWidth, street.road]);

  const curbTop = 0.22;

  return (
    <group>
      {/* Calzada */}
      <mesh
        geometry={GEO.box()}
        material={asphalt}
        position={[centerX, 0.02, street.roadCenter]}
        scale={[length, 0.12, street.road[1] - street.road[0]]}
        receiveShadow
      />
      {/* Acera de las casas: sobreelevada, con bordillo y juntas de dilatación */}
      <mesh
        geometry={GEO.box()}
        material={concrete}
        position={[centerX, curbTop / 2, (street.sidewalk[0] + street.sidewalk[1]) / 2]}
        scale={[length, curbTop, street.sidewalk[1] - street.sidewalk[0]]}
        receiveShadow
      />
      <mesh
        geometry={GEO.box()}
        material={trimMaterial('#5C6474', 0.75)}
        position={[centerX, curbTop / 2 - 0.02, street.sidewalk[1] + 0.06]}
        scale={[length, curbTop, 0.16]}
      />
      <InstancedField geometry={GEO.box()} material={trimMaterial('#4E5563', 0.9)} matrices={joints} />
      <InstancedField geometry={GEO.box()} material={trimMaterial('#D6DCE6', 0.8)} matrices={dashes} />
      <InstancedField geometry={GEO.box()} material={trimMaterial('#C9D2DE', 0.85)} matrices={crosswalk} />
      {/* Franja ajardinada al otro lado de la calzada: cierra la composición */}
      <mesh
        geometry={GEO.plane()}
        material={grassMaterial()}
        position={[centerX, 0.01, street.road[1] + 5]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[length, 10, 1]}
        receiveShadow
      />
    </group>
  );
}

/* -------------------------------------------------------------------------- *
 * Vegetación instanciada
 * -------------------------------------------------------------------------- */

interface VegetationProps {
  spots: Array<{ x: number; z: number }>;
  street: StreetLayout;
  spanWidth: number;
  centerX: number;
  seed: number;
}

function Vegetation({ spots, street, spanWidth, centerX, seed }: VegetationProps) {
  const trunks = metalMaterial('#3A2F27', 0.95, 0.05);
  const grassEdge = trimMaterial('#26382A', 1);

  const data = useMemo(() => {
    let state = seed >>> 0;
    const random = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const treeMatrices: THREE.Matrix4[] = [];
    const clumpMatrices: THREE.Matrix4[] = [];
    const clumpColors: THREE.Color[] = [];
    const bushMatrices: THREE.Matrix4[] = [];

    // Los árboles viven SIEMPRE en la junta entre dos casas (nunca delante de una
    // fachada): así el follaje no tapa las ventanas, que son la lectura de la
    // electricidad en el proyector.
    for (const spot of spots) {
      const x = spot.x + (random() - 0.5) * 1.6;
      const z = spot.z + (random() - 0.5) * 0.8;
      const height = 2.6 + random() * 1.5;
      treeMatrices.push(instanceMatrix([x, height / 2, z], [0.17, height, 0.17]));
      const clumps = 3;
      for (let c = 0; c < clumps; c += 1) {
        const radius = 1.0 + random() * 0.55;
        const offsetX = (random() - 0.5) * 1.1;
        const offsetZ = (random() - 0.5) * 1.1;
        clumpMatrices.push(
          instanceMatrix(
            [x + offsetX, height * (0.85 + c * 0.1) + offsetZ * 0.2, z + offsetZ],
            [radius, radius * 0.85, radius],
            random() * Math.PI,
          ),
        );
        clumpColors.push(new THREE.Color().setHSL(0.3 + random() * 0.05, 0.32, 0.16 + random() * 0.08));
      }
    }

    // Arbustos rasos: en la línea de los solares y en la franja verde de enfrente.
    for (let i = 0; i < 16; i += 1) {
      const x = centerX - (spanWidth + 16) / 2 + random() * (spanWidth + 16);
      const z = street.plotFront - 0.25 + random() * 0.5;
      bushMatrices.push(
        instanceMatrix([x, 0.28, z], [0.42 + random() * 0.3, 0.36, 0.42 + random() * 0.3], random() * Math.PI),
      );
    }
    for (let i = 0; i < 10; i += 1) {
      const x = centerX - (spanWidth + 20) / 2 + random() * (spanWidth + 20);
      bushMatrices.push(
        instanceMatrix(
          [x, 0.3, street.road[1] + 1.2 + random() * 2],
          [0.5 + random() * 0.35, 0.4, 0.5 + random() * 0.35],
          random() * Math.PI,
        ),
      );
    }

    return { treeMatrices, clumpMatrices, clumpColors, bushMatrices };
  }, [seed, spots, spanWidth, centerX, street.plotFront, street.road]);

  const clumpMaterial = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({ color: '#DFE7DF', roughness: 0.95, flatShading: true });
    return material;
  }, []);
  useEffect(() => () => clumpMaterial.dispose(), [clumpMaterial]);

  const clumpMeshRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = clumpMeshRef.current;
    if (!mesh) return;
    data.clumpMatrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    data.clumpColors.forEach((color, index) => mesh.setColorAt(index, color));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [data]);

  return (
    <group>
      <InstancedField geometry={GEO.cylinder(6)} material={trunks} matrices={data.treeMatrices} />
      <instancedMesh
        ref={clumpMeshRef}
        args={[GEO.icosa(), clumpMaterial, Math.max(1, data.clumpMatrices.length)]}
        castShadow
      />
      <InstancedField geometry={GEO.icosa()} material={trimMaterial('#1F3325', 1)} matrices={data.bushMatrices} />
      <mesh
        geometry={GEO.plane()}
        material={grassEdge}
        position={[0, 0.008, street.sidewalk[0] - 0.4]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[spanWidth + 24, 0.8, 1]}
      />
    </group>
  );
}

/* -------------------------------------------------------------------------- *
 * Alumbrado público (parpadea en crisis con SOLO dos materiales compartidos)
 * -------------------------------------------------------------------------- */

interface PublicLightingProps {
  positions: number[];
  z: number;
  isCrisis: boolean;
}

function PublicLighting({ positions, z, isCrisis }: PublicLightingProps) {
  const glassMaterial = useMemo(() => sharedGlowMaterial('#FFE7B0', 0.95), []);
  const poolMaterial = useMemo(() => sharedGlowMaterial('#FFE7B0', 0.16), []);
  const pole = metalMaterial('#4C5462', 0.6, 0.4);

  useFrame(() => {
    // Farolas compartidas: en crisis el alumbrado entero cae y titila a la vez.
    const flicker = isCrisis ? 0.18 + 0.12 * Math.random() : 1;
    glassMaterial.opacity = 0.95 * flicker;
    poolMaterial.opacity = 0.16 * flicker;
  });

  return (
    <group>
      {positions.map((x) => (
        <group key={`farola-${x}`} position={[x, 0, z]}>
          <mesh geometry={GEO.cylinder(8)} material={pole} position={[0, 2.8, 0]} scale={[0.1, 5.6, 0.1]} castShadow />
          <mesh geometry={GEO.box()} material={pole} position={[0, 5.5, -0.4]} scale={[0.12, 0.12, 0.9]} />
          <mesh geometry={GEO.box()} material={pole} position={[-0.2, 5.68, -0.8]} scale={[0.22, 0.24, 1.6]} />
          <mesh geometry={GEO.cone(6)} material={pole} position={[0, 5.9, -0.8]} scale={[0.34, 0.3, 0.34]} />
          <mesh
            geometry={GEO.box()}
            material={glassMaterial}
            position={[0, 5.42, -0.8]}
            scale={[0.34, 0.08, 1.1]}
          />
          <LightPool position={[0, 0.23, -0.8]} size={[4.6, 4.6]} material={poolMaterial} />
        </group>
      ))}
    </group>
  );
}

/* -------------------------------------------------------------------------- *
 * Transformador + arco eléctrico de la crisis
 * -------------------------------------------------------------------------- */

function Transformer({ position, isCrisis }: { position: [number, number, number]; isCrisis: boolean }) {
  const cabinet = grilleMaterial('#3F5A48');
  const dark = metalMaterial('#2A3138', 0.7, 0.3);
  const label = useMemo(() => pavementSignMaterial('', '#14181F', 'warning'), []);
  const arcRef = useRef<THREE.Mesh>(null);
  const arcMaterial = useMemo(() => sharedGlowMaterial('#BEE9FF', 0), []);
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame((state, delta) => {
    const t = expDamp(delta, 6);
    // El arco chisporrotea a ráfagas: nunca un valor continuo, siempre "a saltos".
    const rafaga = isCrisis ? Math.max(0, Math.sin(state.clock.elapsedTime * 9.3) * 1.6 - 0.9) : 0;
    arcMaterial.opacity += (clamp(rafaga, 0, 0.9) - arcMaterial.opacity) * t;
    if (arcRef.current) {
      arcRef.current.scale.set(0.5 + rafaga * 1.6, 0.5 + rafaga * 2.2, 0.5);
      arcRef.current.rotation.z = rafaga * 0.4;
    }
    if (lightRef.current) {
      lightRef.current.intensity += (rafaga * 9 - lightRef.current.intensity) * t;
    }
  });

  return (
    <group position={position}>
      <mesh geometry={GEO.box()} material={trimMaterial('#3A414A', 0.95)} position={[0, 0.08, 0]} scale={[3.2, 0.16, 2.0]} />
      <mesh geometry={GEO.box()} material={cabinet} position={[0, 0.95, 0]} scale={[2.0, 1.5, 1.2]} castShadow />
      <mesh geometry={GEO.box()} material={dark} position={[0, 1.74, 0]} scale={[2.16, 0.14, 1.34]} />
      {/* Aisladores y acometida */}
      {[-0.7, 0, 0.7].map((x) => (
        <mesh
          key={`trafo-bushing-${x}`}
          geometry={GEO.cylinder(6)}
          material={trimMaterial('#8A94A6', 0.35)}
          position={[x, 1.94, 0]}
          scale={[0.09, 0.26, 0.09]}
        />
      ))}
      <mesh
        geometry={GEO.plane()}
        material={label}
        position={[1.02, 1.16, 0]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[0.9, 0.45, 1]}
      />
      <mesh
        ref={arcRef}
        geometry={GEO.plane()}
        material={arcMaterial}
        position={[0.2, 2.3, 0.2]}
        rotation={[0, 0, 0]}
      />
      {/* Luz creada SIEMPRE (aunque esté a 0): añadir/quitar luces recompila shaders */}
      <pointLight ref={lightRef} position={[0, 2.4, 0.3]} intensity={0} distance={22} decay={2} color="#BEE9FF" />
    </group>
  );
}

/* -------------------------------------------------------------------------- *
 * RED ELÉCTRICA: postes, cables, acometidas y pulsos de energía
 * -------------------------------------------------------------------------- */

interface GridSpan {
  from: THREE.Vector3;
  to: THREE.Vector3;
  sag: number;
  /** Índice del equipo asociado (para leer su electricidad en cada frame). */
  teamIndex: number;
  /** true = acometida (poste→fachada), false = tramo de línea. */
  drop: boolean;
}

interface PowerGridProps {
  layout: NeighborhoodLayout;
  street: StreetLayout;
  isCrisis: boolean;
}

const PULSES_PER_SPAN = 3;

function PowerGrid({ layout, street, isCrisis }: PowerGridProps) {
  const placements = layout.placements;
  const structuralKey = placements.map((p) => `${p.team.id}@${p.position[0].toFixed(2)}`).join('|');

  // Ref viva: la red se reconstruye solo cuando cambia el REPARTO (entran/salen equipos),
  // nunca cuando cambia el estado de los equipos (eso se lee por frame desde aquí).
  const liveRef = useRef(placements);
  liveRef.current = placements;

  const poleZ = street.sidewalk[1] - 0.5;
  const poleXs = useMemo(() => {
    const xs: number[] = [];
    if (placements.length === 0) return xs;
    xs.push(layout.bounds.minX - 2.2);
    for (let i = 0; i < placements.length - 1; i += 1) {
      xs.push((placements[i].position[0] + placements[i + 1].position[0]) / 2);
    }
    xs.push(layout.bounds.maxX + 2.2);
    return xs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuralKey]);

  const spans = useMemo(() => {
    const list: GridSpan[] = [];
    const y = ALTURA_POSTE - 0.7;
    // Tramos de línea entre postes
    for (let i = 0; i < poleXs.length - 1; i += 1) {
      list.push({
        from: new THREE.Vector3(poleXs[i], y, poleZ),
        to: new THREE.Vector3(poleXs[i + 1], y, poleZ),
        sag: 0.75,
        teamIndex: Math.min(i, placements.length - 1),
        drop: false,
      });
    }
    // Acometidas: del poste más cercano a la fachada de cada casa
    placements.forEach((placement, index) => {
      const poleX = poleXs[Math.min(index, poleXs.length - 1)];
      const facadeZ = placement.position[2] + placement.variation.depth / 2;
      list.push({
        from: new THREE.Vector3(poleX, y - 0.3, poleZ),
        to: new THREE.Vector3(placement.position[0], 4.4, facadeZ + 0.06),
        sag: 0.35,
        teamIndex: index,
        drop: true,
      });
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuralKey, poleZ]);

  const cableMaterial = metalMaterial('#23262C', 0.65, 0.35);
  const poleMaterial = trimMaterial('#6B6357', 0.95);
  const insulatorMaterial = trimMaterial('#9AA6B8', 0.3);
  // Blanco a propósito: el color de cada pulso llega por color de instancia (ámbar de
  // electricidad o naranja de crisis). Si el material también fuese ámbar se multiplicaría.
  const pulseMaterial = useMemo(() => sharedGlowMaterial('#FFFFFF', 0.9), []);

  const cables = useMemo(
    () => spans.map((span) => cableGeometry(span.from, span.to, span.sag, span.drop ? 0.035 : 0.05)),
    [spans],
  );
  useDisposeOnChange(cables);

  const poles = useMemo(
    () => poleXs.map((x) => instanceMatrix([x, ALTURA_POSTE / 2, poleZ], [0.15, ALTURA_POSTE, 0.15])),
    [poleXs, poleZ],
  );
  const crossarms = useMemo(
    () =>
      poleXs.flatMap((x) => [
        instanceMatrix([x, ALTURA_POSTE - 0.6, poleZ], [1.9, 0.11, 0.11]),
        instanceMatrix([x, ALTURA_POSTE - 1.25, poleZ], [1.4, 0.09, 0.09]),
      ]),
    [poleXs, poleZ],
  );
  const insulators = useMemo(
    () =>
      poleXs.flatMap((x) =>
        [-0.75, -0.25, 0.25, 0.75].map((offset) =>
          instanceMatrix([x + offset, ALTURA_POSTE - 0.45, poleZ], [0.06, 0.2, 0.06]),
        ),
      ),
    [poleXs, poleZ],
  );

  const pulseCount = spans.length * PULSES_PER_SPAN;
  const pulseMeshRef = useRef<THREE.InstancedMesh>(null!);

  useLayoutEffect(() => {
    const mesh = pulseMeshRef.current;
    if (!mesh) return;
    for (let i = 0; i < pulseCount; i += 1) {
      mesh.setMatrixAt(i, scratchMatrix.makeScale(0, 0, 0));
      mesh.setColorAt(i, PULSE_COLOR);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [pulseCount]);

  useFrame((state, delta) => {
    const mesh = pulseMeshRef.current;
    if (!mesh || pulseCount === 0) return;
    const teams = liveRef.current;
    const time = state.clock.elapsedTime;
    const glow = isCrisis ? PULSE_COLOR_CRISIS : PULSE_COLOR;
    let index = 0;

    for (let s = 0; s < spans.length; s += 1) {
      const span = spans[s];
      const team = teams[span.teamIndex]?.team;
      // electricidad 30..170 kWh → 0..1: cuánta energía circula por ese cable.
      const carga = team ? clamp((team.electricidad - 30) / 140, 0.05, 1) : 0.4;
      const speed = (span.drop ? 0.16 : 0.1) * (0.35 + carga);
      const crisisDim = isCrisis ? 0.45 + 0.35 * Math.sin(time * 11 + s) : 1;

      for (let k = 0; k < PULSES_PER_SPAN; k += 1) {
        const t = (k / PULSES_PER_SPAN + time * speed + s * 0.13) % 1;
        cablePoint(span.from, span.to, span.sag, t, scratchVector);
        const size = (span.drop ? 0.1 : 0.13) * (0.55 + carga * 0.65) * (isCrisis ? 1.1 : 1);
        // makeScale + setPosition: cero asignaciones por frame (nada de new Vector3).
        scratchMatrix.makeScale(size, size, size);
        scratchMatrix.setPosition(scratchVector);
        mesh.setMatrixAt(index, scratchMatrix);
        scratchColor.copy(glow).multiplyScalar(clamp(carga * 1.25, 0.15, 1) * crisisDim);
        mesh.setColorAt(index, scratchColor);
        index += 1;
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // El brillo del cable entero late con la red (material compartido, 1 escritura).
    pulseMaterial.opacity = 0.75 * (isCrisis ? 0.5 + 0.5 * Math.sin(time * 7) : 1);
  });

  return (
    <group>
      <InstancedField geometry={GEO.cylinder(8)} material={poleMaterial} matrices={poles} castShadow />
      <InstancedField geometry={GEO.box()} material={poleMaterial} matrices={crossarms} />
      <InstancedField geometry={GEO.cylinder(6)} material={insulatorMaterial} matrices={insulators} />
      {cables.map((geometry, index) => (
        <mesh key={`cable-${index}`} geometry={geometry} material={cableMaterial} />
      ))}
      <instancedMesh
        ref={pulseMeshRef}
        args={[GEO.sphere(6, 4), pulseMaterial, Math.max(1, pulseCount)]}
      />
    </group>
  );
}

/* -------------------------------------------------------------------------- *
 * Señalética y fondo
 * -------------------------------------------------------------------------- */

function StreetFurniture({ street, centerX, spanWidth }: { street: StreetLayout; centerX: number; spanWidth: number }) {
  const post = metalMaterial('#5A6273', 0.5, 0.5);
  const sign = useMemo(() => pavementSignMaterial('ZONA ENERGIA', '#F5B942', 'street'), []);
  const warning = useMemo(() => pavementSignMaterial('', '#14181F', 'warning'), []);
  const binMaterial = grilleMaterial('#46505E');

  return (
    <group>
      {/* Señal de la calle + aviso de zona de red */}
      <group position={[centerX - spanWidth / 2 - 4.5, 0, street.sidewalk[0] + 1.2]}>
        <mesh geometry={GEO.cylinder(6)} material={post} position={[0, 1.4, 0]} scale={[0.06, 2.8, 0.06]} />
        <mesh geometry={GEO.plane()} material={sign} position={[0, 2.35, 0.03]} scale={[1.5, 0.75, 1]} />
      </group>
      <group position={[centerX + spanWidth / 2 + 2.5, 0, street.road[0] - 0.4]}>
        <mesh geometry={GEO.cylinder(6)} material={post} position={[0, 1.2, 0]} scale={[0.06, 2.4, 0.06]} />
        <mesh
          geometry={GEO.plane()}
          material={warning}
          position={[0, 1.95, 0.03]}
          rotation={[0, Math.PI, 0]}
          scale={[0.85, 0.42, 1]}
        />
      </group>
      {/* Contenedores de basura junto al bordillo */}
      {[centerX - spanWidth / 2 - 8.5, centerX + spanWidth / 2 + 9].map((x) => (
        <group key={`contenedor-${x}`} position={[x, 0, street.road[0] - 1.1]}>
          <mesh geometry={GEO.cylinder(10)} material={binMaterial} position={[0, 0.5, 0]} scale={[0.42, 1.0, 0.42]} castShadow />
          <mesh geometry={GEO.cylinder(10)} material={binMaterial} position={[0, 1.05, 0]} scale={[0.46, 0.12, 0.46]} />
        </group>
      ))}
    </group>
  );
}

function Skyline({ centerX, spanWidth, isCrisis }: { centerX: number; spanWidth: number; isCrisis: boolean }) {
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: '#0E1420', roughness: 1 }), []);
  useEffect(() => () => material.dispose(), [material]);
  const matrices = useMemo(() => {
    const list: THREE.Matrix4[] = [];
    let state = 987654321;
    const random = () => {
      state = (state * 1103515245 + 12345) >>> 0;
      return state / 4294967296;
    };
    const count = 16;
    for (let i = 0; i < count; i += 1) {
      const x = centerX - spanWidth / 2 - 40 + (i / (count - 1)) * (spanWidth + 80);
      const height = 8 + random() * 22;
      const width = 5 + random() * 8;
      list.push(instanceMatrix([x, height / 2, -34 - random() * 16], [width, height, width]));
    }
    return list;
  }, [centerX, spanWidth]);

  const meshRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);
  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    (mesh.material as THREE.MeshStandardMaterial).color.lerp(
      isCrisis ? scratchColor.set('#1A0C10') : scratchColor.set('#0E1420'),
      expDamp(delta, 1.2),
    );
  });

  return <instancedMesh ref={meshRef} args={[GEO.box(), material, matrices.length]} />;
}

function Stars() {
  const geometry = useMemo(() => {
    const count = 90;
    const positions = new Float32Array(count * 3);
    let state = 24681357;
    const random = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (random() - 0.5) * 220;
      positions[i * 3 + 1] = 45 + random() * 70;
      positions[i * 3 + 2] = -60 - random() * 120;
    }
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return buffer;
  }, []);
  useDisposeOnChange([geometry]);
  return (
    <points geometry={geometry}>
      {/* Points: 1 draw call y sin assets → el "cielo" cuesta prácticamente nada */}
      <pointsMaterial color="#C7D3E6" size={1.6} sizeAttenuation={false} transparent opacity={0.7} toneMapped={false} />
    </points>
  );
}

/* -------------------------------------------------------------------------- *
 * Escena de calle completa
 * -------------------------------------------------------------------------- */

export interface StreetSceneProps {
  layout: NeighborhoodLayout;
  street: StreetLayout;
  isCrisis: boolean;
}

export default function StreetScene({ layout, street, isCrisis }: StreetSceneProps) {
  const spanWidth = layout.bounds.maxX - layout.bounds.minX;
  const centerX = 0;
  const lampPositions = useMemo(
    () => [centerX - spanWidth / 2 - 3.5, centerX - spanWidth * 0.18, centerX + spanWidth * 0.18, centerX + spanWidth / 2 + 3.5],
    [centerX, spanWidth],
  );

  // Los árboles se plantan en las juntas entre casas (y en los extremos), nunca delante
  // de una fachada: el follaje no debe tapar las ventanas que codifican la electricidad.
  const treeSpots = useMemo(() => {
    const spots: Array<{ x: number; z: number }> = [];
    const placements = layout.placements;
    if (placements.length === 0) return spots;
    const z = street.sidewalk[0] + 1.0;
    spots.push({ x: layout.bounds.minX - 4.5, z });
    for (let i = 0; i < placements.length - 1; i += 1) {
      spots.push({ x: (placements[i].position[0] + placements[i + 1].position[0]) / 2, z });
    }
    spots.push({ x: layout.bounds.maxX + 4.5, z });
    return spots;
  }, [layout, street.sidewalk]);

  return (
    <group>
      <Terrain isCrisis={isCrisis} />
      <Road street={street} spanWidth={spanWidth} centerX={centerX} />
      <Vegetation
        spots={treeSpots}
        street={street}
        spanWidth={spanWidth}
        centerX={centerX}
        seed={hashSeed(layout)}
      />
      <PublicLighting positions={lampPositions} z={street.sidewalk[1] - 0.1} isCrisis={isCrisis} />
      <PowerGrid layout={layout} street={street} isCrisis={isCrisis} />
      <Transformer position={[layout.bounds.minX - 4.2, 0, street.sidewalk[0] + 1.5]} isCrisis={isCrisis} />
      <StreetFurniture street={street} centerX={centerX} spanWidth={spanWidth} />
      <Skyline centerX={centerX} spanWidth={spanWidth} isCrisis={isCrisis} />
      <Stars />
    </group>
  );
}

function hashSeed(layout: NeighborhoodLayout): number {
  let hash = 2166136261;
  for (const placement of layout.placements) {
    for (let i = 0; i < placement.team.id.length; i += 1) {
      hash ^= placement.team.id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}
