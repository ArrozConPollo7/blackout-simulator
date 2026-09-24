'use client';

/**
 * Vecindario reactivo del Host (Fase 2.6) — react-three-fiber.
 *
 * Una casa low-poly por equipo que refleja su TeamState REAL (llega por Realtime):
 *   Electricidad → número de ventanas iluminadas
 *   Gas          → intensidad del humo de la chimenea
 *   Eficiencia   → color del aura y de la luz de la casa (verde → ámbar → rojo)
 *   Presupuesto  → velocidad del medidor giratorio del techo
 *   Ranking      → halo sobre la casa del líder
 *   Crisis       → ambiente rojo-ámbar y parpadeo simultáneo de todas las casas
 *
 * Rendimiento: se paga una sola vez (es la pantalla del Host, nunca un celular).
 * Sin post-procesamiento: el bloom se emula con materiales brillantes, planos
 * aditivos y luces puntuales por casa (menos pases de render para el portátil del aula),
 * más niebla y viñeta CSS para la profundidad que pide Design.md.
 */

import React, { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { TeamState } from '@/types/game';
import { compareTeams } from '@/engine/results';

export interface NeighborhoodStageProps {
  teams: TeamState[];
  isCrisis?: boolean;
  selectedTeamId?: string | null;
  onSelectTeam?: (teamId: string) => void;
  className?: string;
}

/** Referencias del caso (content/economy.ts) para traducir estado a imagen. */
const CONSUMO_REFERENCIA = 100;
const PRESUPUESTO_REFERENCIA = 100000;
const VENTANAS_POR_CASA = 8;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const mapRange = (value: number, inMin: number, inMax: number, outMin: number, outMax: number) =>
  outMin + ((clamp(value, inMin, inMax) - inMin) / (inMax - inMin)) * (outMax - outMin);

/** Verde (eficiencia alta) → ámbar → rojo (eficiencia baja). */
function auraColor(eficiencia: number): THREE.Color {
  const t = clamp(eficiencia / 100, 0, 1);
  const rojo = new THREE.Color('#FF3B4E');
  const ambar = new THREE.Color('#F5B942');
  const verde = new THREE.Color('#3ECF8E');
  return t < 0.5
    ? rojo.clone().lerp(ambar, t / 0.5)
    : ambar.clone().lerp(verde, (t - 0.5) / 0.5);
}

interface HouseProps {
  team: TeamState;
  position: [number, number, number];
  yaw: number;
  isLeader: boolean;
  isSelected: boolean;
  isCrisis: boolean;
  onSelect: () => void;
}

function House({ team, position, yaw, isLeader, isSelected, isCrisis, onSelect }: HouseProps) {
  const windowRefs = useRef<Array<THREE.Mesh | null>>([]);
  const smokeRefs = useRef<Array<THREE.Mesh | null>>([]);
  const meterRef = useRef<THREE.Group>(null);
  const auraRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const groupRef = useRef<THREE.Group>(null);

  const windows = useMemo(() => {
    const layout: Array<[number, number, number, number]> = [];
    // Fachada frontal: 2x2
    for (const x of [-0.45, 0.45]) {
      for (const y of [0.45, 0.82]) layout.push([x, y, 0.86, 0]);
    }
    // Laterales: 1x2 a cada lado
    for (const z of [-0.35, 0.1]) {
      layout.push([0.86, 0.6, z, Math.PI / 2]);
      layout.push([-0.86, 0.6, z, -Math.PI / 2]);
    }
    return layout;
  }, []);

  const smokeSeeds = useMemo(
    () => Array.from({ length: 6 }, (_, i) => ({ offset: i / 6, seed: (i % 3) * 0.12 })),
    [],
  );

  useFrame((state, delta) => {
    const t = 1 - Math.exp(-delta * 2.6);
    const time = state.clock.elapsedTime;

    // --- Ventanas: cuántas están encendidas según el consumo acumulado ---
    const ratioConsumo = clamp(team.electricidad / CONSUMO_REFERENCIA, 0.3, 1.4);
    const encendidas = Math.round(mapRange(ratioConsumo, 0.3, 1.4, 0, VENTANAS_POR_CASA));
    const colorVentana = new THREE.Color(isCrisis ? '#FF7A4D' : '#F5B942');

    windowRefs.current.forEach((mesh, index) => {
      if (!mesh) return;
      const material = mesh.material as THREE.MeshBasicMaterial;
      const parpadeo = isCrisis ? 0.72 + 0.28 * Math.sin(time * 14 + index * 0.9) : 1;
      const objetivo = index < encendidas ? 0.95 * parpadeo : 0.05;
      material.opacity += (objetivo - material.opacity) * t;
      material.color.lerp(colorVentana, t);
    });

    // --- Gas: intensidad del humo de la chimenea ---
    const intensidadHumo = clamp(mapRange(team.gas, 40, 110, 0.08, 0.42), 0.03, 0.5);
    smokeRefs.current.forEach((mesh, index) => {
      if (!mesh) return;
      const seed = smokeSeeds[index];
      const ciclo = (time * 0.32 + seed.offset) % 1;
      mesh.position.y = 0.95 + ciclo * 1.7;
      mesh.position.x = Math.sin(time * 1.1 + index) * 0.05;
      const escala = 0.06 + ciclo * 0.16;
      mesh.scale.setScalar(escala);
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity += (intensidadHumo * (1 - ciclo) - material.opacity) * t;
      material.color.lerp(new THREE.Color(isCrisis ? '#8a3b2a' : '#5b6478'), t);
    });

    // --- Presupuesto: velocidad del medidor (más gasto = gira más rápido) ---
    const gastado = Math.max(0, PRESUPUESTO_REFERENCIA - team.presupuesto);
    const velocidad = 0.5 + (gastado / PRESUPUESTO_REFERENCIA) * 6;
    if (meterRef.current) meterRef.current.rotation.y += delta * velocidad;

    // --- Eficiencia: aura en el suelo + luz de la casa ---
    const color = auraColor(team.eficiencia);
    const pulso = 0.6 + 0.12 * Math.sin(time * 1.6);
    if (auraRef.current) {
      const material = auraRef.current.material as THREE.MeshBasicMaterial;
      material.color.lerp(color, t);
      const objetivoOpacidad = (isSelected ? 0.42 : 0.24) * pulso;
      material.opacity += (objetivoOpacidad - material.opacity) * t;
      const escala = 1 + (1 - clamp(team.eficiencia / 100, 0, 1)) * 0.25 + (isCrisis ? 0.08 : 0);
      auraRef.current.scale.setScalar(escala);
    }
    if (lightRef.current) {
      lightRef.current.color.lerp(color, t);
      const objetivoIntensidad = 1.1 + clamp(team.eficiencia / 100, 0, 1) * 1.6;
      lightRef.current.intensity += (objetivoIntensidad - lightRef.current.intensity) * t;
    }

    // --- Ranking: halo del líder ---
    if (haloRef.current) {
      const material = haloRef.current.material as THREE.MeshBasicMaterial;
      const objetivoHalo = isLeader ? 0.14 + 0.05 * Math.sin(time * 2.4) : 0;
      material.opacity += (objetivoHalo - material.opacity) * t;
      haloRef.current.rotation.y += delta * 0.25;
    }

    // --- Interacción: la casa seleccionada se yergue un poco ---
    if (groupRef.current) {
      const objetivoAltura = isSelected ? 0.14 : 0;
      groupRef.current.position.y += (objetivoAltura - groupRef.current.position.y) * t;
    }
  });

  const handleSelect = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect();
  };

  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <group ref={groupRef} onClick={handleSelect}>
        {/* Cuerpo y techo */}
        <mesh position={[0, 0.55, 0]} castShadow>
          <boxGeometry args={[1.7, 1.1, 1.6]} />
          <meshStandardMaterial color="#1b2130" roughness={0.85} metalness={0.15} />
        </mesh>
        <mesh position={[0, 1.28, 0]} rotation={[0, Math.PI / 4, 0]}>
          <coneGeometry args={[1.42, 0.7, 4]} />
          <meshStandardMaterial color="#232b3d" roughness={0.9} flatShading />
        </mesh>
        <mesh position={[0, 0.32, 0.81]}>
          <planeGeometry args={[0.42, 0.6]} />
          <meshStandardMaterial color="#0f141c" roughness={1} />
        </mesh>

        {/* Chimenea */}
        <mesh position={[0.42, 1.5, -0.3]}>
          <boxGeometry args={[0.22, 0.6, 0.22]} />
          <meshStandardMaterial color="#2a3244" roughness={0.95} />
        </mesh>

        {/* Ventanas iluminadas */}
        {windows.map(([x, y, z, rotationY], index) => (
          <mesh
            key={`ventana-${index}`}
            position={[x, y, z]}
            rotation={[0, rotationY, 0]}
            ref={(mesh) => {
              windowRefs.current[index] = mesh;
            }}
          >
            <planeGeometry args={[0.24, 0.22]} />
            <meshBasicMaterial
              color="#F5B942"
              transparent
              opacity={0.08}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
        ))}

        {/* Humo de la chimenea */}
        {smokeSeeds.map((seed, index) => (
          <mesh
            key={`humo-${index}`}
            position={[0.42, 1.1, -0.3]}
            ref={(mesh) => {
              smokeRefs.current[index] = mesh;
            }}
          >
            <sphereGeometry args={[1, 8, 6]} />
            <meshBasicMaterial color="#9AA6BF" transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}

        {/* Medidor giratorio sobre el techo (presupuesto) */}
        <group position={[0, 1.72, 0]} ref={meterRef}>
          <mesh>
            <cylinderGeometry args={[0.12, 0.12, 0.07, 10]} />
            <meshStandardMaterial color="#3EC6F0" emissive="#0b3a4a" emissiveIntensity={0.6} />
          </mesh>
          <mesh position={[0.11, 0.02, 0]}>
            <boxGeometry args={[0.22, 0.015, 0.03]} />
            <meshBasicMaterial color="#8bdfff" toneMapped={false} />
          </mesh>
        </group>

        {/* Aura de eficiencia en el suelo */}
        <mesh
          position={[0, 0.02, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          ref={auraRef}
          scale={1}
        >
          <ringGeometry args={[1.05, 1.35, 32]} />
          <meshBasicMaterial color="#3ECF8E" transparent opacity={0.24} side={THREE.DoubleSide} />
        </mesh>

        {/* Halo del líder */}
        <mesh position={[0, 0.95, 0]} ref={haloRef}>
          <cylinderGeometry args={[0.82, 1.12, 1.75, 20, 1, true]} />
          <meshBasicMaterial
            color="#F5B942"
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>

        {/* Luz puntual: da profundidad y tiñe el suelo según la eficiencia */}
        <pointLight
          ref={lightRef}
          position={[0, 1.7, 0.4]}
          intensity={1.6}
          distance={7}
          decay={2}
          color="#3ECF8E"
        />
      </group>
    </group>
  );
}

function CrisisAmbience({ isCrisis, children }: { isCrisis: boolean; children: React.ReactNode }) {
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const fogRef = useRef<THREE.Fog>(null);
  const flashRef = useRef(0);
  const previous = useRef(isCrisis);

  useFrame((state, delta) => {
    const t = 1 - Math.exp(-delta * 1.8);
    if (previous.current !== isCrisis) {
      previous.current = isCrisis;
      if (isCrisis) flashRef.current = 1; // chispa simultánea al entrar en crisis
    }
    flashRef.current = Math.max(0, flashRef.current - delta * 2.2);

    const base = isCrisis ? 0.5 : 0.34;
    const chispa = flashRef.current * 0.8 + (isCrisis ? 0.06 * Math.sin(state.clock.elapsedTime * 9) : 0);
    if (ambientRef.current) {
      ambientRef.current.intensity += (base + chispa - ambientRef.current.intensity) * t;
      ambientRef.current.color.lerp(new THREE.Color(isCrisis ? '#ff6a4a' : '#cfd8e6'), t);
    }
    if (fogRef.current) {
      fogRef.current.color.lerp(new THREE.Color(isCrisis ? '#2a0d10' : '#080c14'), t);
    }
  });

  return (
    <>
      <ambientLight ref={ambientRef} intensity={0.34} />
      <fog ref={fogRef} attach="fog" args={['#080c14', 16, 42]} />
      {children}
    </>
  );
}

function Ground({ isCrisis }: { isCrisis: boolean }) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, delta) => {
    if (!materialRef.current) return;
    const t = 1 - Math.exp(-delta * 1.6);
    materialRef.current.color.lerp(new THREE.Color(isCrisis ? '#241013' : '#0d121c'), t);
  });
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[120, 120]} />
        <meshStandardMaterial ref={materialRef} color="#0d121c" roughness={1} />
      </mesh>
      <gridHelper args={[80, 40, '#1d2636', '#141c28']} position={[0, 0.01, 0]} />
    </>
  );
}

function CameraRig({ center }: { center: number }) {
  useFrame((state, delta) => {
    const t = 1 - Math.exp(-delta * 1.2);
    const objetivoX = Math.sin(state.clock.elapsedTime * 0.08) * 1.6;
    state.camera.position.x += (objetivoX - state.camera.position.x) * t;
    state.camera.lookAt(center, 1.1, 0);
  });
  return null;
}

export default function NeighborhoodStage({
  teams,
  isCrisis = false,
  selectedTeamId = null,
  onSelectTeam,
  className = '',
}: NeighborhoodStageProps) {
  const [webglOk, setWebglOk] = useState<boolean | null>(null);

  React.useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      setWebglOk(Boolean(gl));
    } catch {
      setWebglOk(false);
    }
  }, []);

  const leaderId = useMemo(() => {
    if (teams.length === 0) return null;
    return [...teams].sort(compareTeams)[0]?.id ?? null;
  }, [teams]);

  const posiciones = useMemo(() => {
    const total = teams.length || 1;
    const separacion = 3.4;
    const ancho = (total - 1) * separacion;
    return teams.map((team, index) => ({
      team,
      position: [
        index * separacion - ancho / 2,
        0,
        index % 2 === 0 ? 0.35 : -0.35,
      ] as [number, number, number],
      yaw: index % 2 === 0 ? 0.22 : -0.18,
    }));
  }, [teams]);

  if (webglOk === false) {
    return (
      <div
        className={`w-full rounded-xl border border-border-subtle bg-bg-surface p-6 text-center ${className}`}
      >
        <span className="material-symbols-outlined text-[28px] text-accent-gas">grid_off</span>
        <p className="font-label-md text-label-md text-text-secondary uppercase mt-2">
          Este dispositivo no puede dibujar el vecindario en 3D (WebGL no disponible). Las métricas
          siguen disponibles en las tarjetas de telemetría.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-border-subtle bg-[radial-gradient(120%_110%_at_50%_0%,#101725_0%,#070a11_70%)] ${className}`}
    >
      {webglOk && (
        <Canvas
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          camera={{ position: [0, 6.4, 13.5], fov: 42, near: 0.1, far: 90 }}
        >
          <CrisisAmbience isCrisis={isCrisis}>
            <directionalLight position={[-6, 9, 6]} intensity={0.65} color="#b9c6dd" />
            <Ground isCrisis={isCrisis} />
            {posiciones.map(({ team, position, yaw }) => (
              <House
                key={team.id}
                team={team}
                position={position}
                yaw={yaw}
                isLeader={team.id === leaderId}
                isSelected={team.id === selectedTeamId}
                isCrisis={isCrisis}
                onSelect={() => onSelectTeam?.(team.id)}
              />
            ))}
            <CameraRig center={0} />
          </CrisisAmbience>
        </Canvas>
      )}

      {/* Viñeta: profundidad sin post-procesamiento */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(115%_100%_at_50%_45%,transparent_45%,rgba(0,0,0,0.55)_100%)]" />

      <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-2">
        <span className="material-symbols-outlined text-[16px] text-text-secondary">visibility</span>
        <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-widest">
          {isCrisis ? 'VECINDARIO EN CRISIS' : 'VECINDARIO EN TIEMPO REAL'}
        </span>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-4 flex flex-wrap gap-x-4 gap-y-1 font-label-sm text-label-sm text-text-secondary">
        <span className="flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px] text-accent-electricidad">bolt</span>
          ventanas = consumo
        </span>
        <span className="flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px] text-accent-gas">
            local_fire_department
          </span>
          humo = gas
        </span>
        <span className="flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px] text-accent-eficiencia">speed</span>
          aura = eficiencia
        </span>
        <span className="flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px] text-accent-presupuesto">
            electric_meter
          </span>
          medidor = presupuesto
        </span>
        <span className="flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px] text-secondary">light_mode</span>
          halo = líder
        </span>
      </div>
    </div>
  );
}
