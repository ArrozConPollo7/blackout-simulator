'use client';

/**
 * Vecindario reactivo del Host — react-three-fiber (rediseño profesional, fase 2.7).
 *
 * Una casa por equipo que refleja su TeamState REAL (llega por Realtime):
 *   Electricidad → nº de ventanas encendidas
 *   Gas          → humo y llama de la chimenea o salida de humos
 *   Eficiencia   → color del aura, del césped y de la luz (verde → ámbar → rojo)
 *   Presupuesto  → velocidad del medidor del techo
 *   Ranking      → haz de luz + aura sobre la casa del líder (compareTeams)
 *   Crisis       → ambiente rojo-ámbar, caída de tensión y parpadeo simultáneo
 *   Selección    → la casa se yergue, su puerta se enciende y el aura sube
 *
 * ARQUITECTURA DEL MÓDULO
 *   neighborhood-config.ts  → paletas, arquetipos, hash determinista, encuadre de cámara
 *   materials.ts            → texturas procedurales y materiales compartidos
 *   BuildingParts.tsx       → piezas constructivas (tejados, vanos, vallas, coches…)
 *   HouseModel.tsx          → cada arquetipo + TODA la animación reactiva
 *   StreetScene.tsx         → calle, entorno y red eléctrica con pulsos de energía
 *
 * RENDIMIENTO (el proyector del aula ya se atragantó una vez, no se repite):
 *   · Sin post-procesamiento (ni EffectComposer ni bloom real): el brillo se emula con
 *     materiales emissive, planos aditivos y color por instancia.
 *   · dpr={[1, 1.5]} y PCFSoftShadowMap con UN SOLO mapa de sombra de 1024 y una sola
 *     luz con sombras; el resto de luces no proyectan sombra y su NÚMERO no cambia
 *     nunca (añadir/quitar luces obliga a recompilar shaders → tirones).
 *   · Nada de HDRI, fuentes ni texturas por red: todo procedural (aula sin internet).
 *   · Cero setState dentro de useFrame; las luces puntuales por casa se sustituyeron por
 *     emissive + charcos de luz aditivos (menos coste por fragmento con 6 casas).
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import type { TeamState } from '@/types/game';
import { compareTeams } from '@/engine/results';
import {
  CAMERA_LIFT,
  type CameraFit,
  type NeighborhoodLayout,
  type StreetLayout,
  clamp,
  expDamp,
  fitCamera,
  framingBounds,
  layoutNeighborhood,
  streetLayout,
} from './neighborhood/neighborhood-config';
import HouseModel from './neighborhood/HouseModel';
import StreetScene from './neighborhood/StreetScene';

export interface NeighborhoodStageProps {
  teams: TeamState[];
  isCrisis?: boolean;
  selectedTeamId?: string | null;
  onSelectTeam?: (teamId: string) => void;
  className?: string;
}

/* Colores de ambiente (Design.md) */
const AMBIENTE_OK = { cielo: '#7C97C4', suelo: '#141A22', niebla: '#0A0E17' };
const AMBIENTE_CRISIS = { cielo: '#C4623F', suelo: '#2A1113', niebla: '#2A0D10' };

const scratchTarget = new THREE.Vector3();
const scratchColor = new THREE.Color();

/* -------------------------------------------------------------------------- *
 * Ambiente: hemisferio + ambiente + niebla (todos los valores se interpolan)
 * -------------------------------------------------------------------------- */

function Ambience({ isCrisis, fogRef }: { isCrisis: boolean; fogRef: React.RefObject<THREE.Fog> }) {
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const flashRef = useRef(0);
  const previous = useRef(isCrisis);

  useFrame((state, delta) => {
    const t = expDamp(delta, 1.6);
    if (previous.current !== isCrisis) {
      previous.current = isCrisis;
      // Chispa simultánea de todo el vecindario al entrar en crisis.
      if (isCrisis) flashRef.current = 1;
    }
    flashRef.current = Math.max(0, flashRef.current - delta * 2.4);

    const dest = isCrisis ? AMBIENTE_CRISIS : AMBIENTE_OK;
    const chispa = flashRef.current * 0.7 + (isCrisis ? 0.04 * Math.sin(state.clock.elapsedTime * 9) : 0);

    if (hemiRef.current) {
      hemiRef.current.color.lerp(scratchColor.set(dest.cielo), t);
      hemiRef.current.groundColor.lerp(scratchColor.set(dest.suelo), t);
      hemiRef.current.intensity += ((isCrisis ? 0.42 : 0.5) + chispa - hemiRef.current.intensity) * t;
    }
    if (ambientRef.current) {
      ambientRef.current.intensity += ((isCrisis ? 0.24 : 0.16) + chispa - ambientRef.current.intensity) * t;
      ambientRef.current.color.lerp(scratchColor.set(isCrisis ? '#FF8A5A' : '#CFD8E6'), t);
    }
    if (fogRef.current) {
      fogRef.current.color.lerp(scratchColor.set(dest.niebla), t);
    }
  });

  return (
    <>
      <hemisphereLight ref={hemiRef} args={[AMBIENTE_OK.cielo, AMBIENTE_OK.suelo, 0.5]} />
      <ambientLight ref={ambientRef} intensity={0.16} color="#CFD8E6" />
    </>
  );
}

/* -------------------------------------------------------------------------- *
 * Cámara: encuadre calculado desde el número de equipos + dolly lento
 * -------------------------------------------------------------------------- */

interface CameraRigProps {
  layout: NeighborhoodLayout;
  street: StreetLayout;
  selectedTeamId: string | null;
  fogRef: React.RefObject<THREE.Fog>;
}

function CameraRig({ layout, street, selectedTeamId, fogRef }: CameraRigProps) {
  const fitRef = useRef<CameraFit | null>(null);
  const fitKeyRef = useRef('');
  const snappedRef = useRef(false);

  useFrame((state, delta) => {
    const camera = state.camera as THREE.PerspectiveCamera;
    // Tamaño REAL del contenedor (R3F lo actualiza con un ResizeObserver): el encuadre
    // se recalcula cuando cambia la fila o cuando cambia el aspect del lienzo.
    const aspect = state.size.width / Math.max(1, state.size.height);
    const box = framingBounds(layout, street);
    const key = `${layout.placements.length}|${box.minX.toFixed(1)}|${box.maxX.toFixed(1)}|${box.maxY.toFixed(1)}|${box.maxZ.toFixed(1)}|${aspect.toFixed(3)}`;

    if (key !== fitKeyRef.current) {
      fitKeyRef.current = key;
      fitRef.current = fitCamera(box, aspect, camera.fov);
      const fit = fitRef.current;
      if (fogRef.current) {
        // Niebla ANCLADA a la distancia real: arranca por delante del primer plano (la
        // calzada queda limpia) y cierra la profundidad sobre el skyline. Así la misma
        // escena se ve igual de atmosférica con 1 equipo que con 6.
        fogRef.current.near = fit.distance * 1.1;
        fogRef.current.far = fit.distance * 3;
      }
    }

    const fit = fitRef.current;
    if (!fit) return;

    const elapsed = state.clock.elapsedTime;
    const t = expDamp(delta, 1.15);

    const selected = selectedTeamId
      ? layout.placements.find((placement) => placement.team.id === selectedTeamId)
      : undefined;

    // Movimiento de cámara ACOTADO por el margen real que deja el encuadre: la suma de
    // dolly, parallax y deslizamiento hacia la casa seleccionada nunca consume más de
    // ~7% del semiancho, así que ni con 1 ni con 6 equipos nada toca el borde.
    const maxOffsetX = fit.halfWidth * 0.07;
    const maxOffsetY = fit.halfHeight * 0.04;
    const slide = clamp((selected?.position[0] ?? 0) * 0.18, -maxOffsetX * 0.7, maxOffsetX * 0.7);
    const parallax = Math.sin(elapsed * 0.042) * maxOffsetX * 0.35;
    const bob = Math.sin(elapsed * 0.031 + 1.3) * maxOffsetY;
    const dolly = 1 + 0.008 * Math.sin(elapsed * 0.027);

    const distance = fit.distance * dolly;
    const targetX = fit.target.x + slide + parallax;
    const targetY = fit.target.y + bob;

    // Primera colocación: la cámara salta a su sitio sin interpolar, para que el primer
    // frame ya esté encuadrado y no "vuele" desde la posición por defecto del Canvas.
    if (!snappedRef.current) {
      snappedRef.current = true;
      camera.position.set(targetX, targetY + distance * CAMERA_LIFT, fit.railZ + distance);
    }
    camera.position.x += (targetX - camera.position.x) * t;
    camera.position.y += (targetY + distance * CAMERA_LIFT - camera.position.y) * t;
    camera.position.z += (fit.railZ + distance - camera.position.z) * t;
    camera.lookAt(scratchTarget.set(targetX, fit.target.y, fit.target.z));
  });

  return null;
}

/* -------------------------------------------------------------------------- *
 * Escena
 * -------------------------------------------------------------------------- */

function Scene({ teams, isCrisis, selectedTeamId, onSelectTeam }: Required<Omit<NeighborhoodStageProps, 'className'>>) {
  const layout = useMemo(() => layoutNeighborhood(teams), [teams]);
  const street = useMemo(() => streetLayout(layout), [layout]);
  const fogRef = useRef<THREE.Fog>(null!);
  const lightRef = useRef<THREE.DirectionalLight>(null);

  const leaderId = useMemo(() => {
    if (teams.length === 0) return null;
    return [...teams].sort(compareTeams)[0]?.id ?? null;
  }, [teams]);

  // La luz con sombras se reposiciona y reencuadra su mapa SOLO cuando cambia la fila.
  useLayoutEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    light.position.set(layout.bounds.minX + 8, 26, 20);
    light.target.position.set(0, 2, 0);
    light.target.updateMatrixWorld();
    const shadowCamera = light.shadow.camera as THREE.OrthographicCamera;
    const halfWidth = (layout.bounds.maxX - layout.bounds.minX) / 2 + 7;
    shadowCamera.left = -halfWidth;
    shadowCamera.right = halfWidth;
    shadowCamera.top = layout.bounds.maxY + 7;
    shadowCamera.bottom = -12;
    shadowCamera.near = 1;
    shadowCamera.far = 95;
    shadowCamera.updateProjectionMatrix();
  }, [layout]);

  return (
    <>
      <fog ref={fogRef} attach="fog" args={[AMBIENTE_OK.niebla, 40, 170]} />
      <Ambience isCrisis={isCrisis} fogRef={fogRef} />
      {/* Única luz con sombras de toda la escena: 1 mapa de 1024, PCF suave. */}
      <directionalLight
        ref={lightRef}
        castShadow
        intensity={isCrisis ? 0.55 : 0.9}
        color={isCrisis ? '#FFB08A' : '#D7E3FF'}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0006}
        shadow-normalBias={0.035}
      />
      <StreetScene layout={layout} street={street} isCrisis={isCrisis} />
      {layout.placements.map((placement) => (
        <HouseModel
          key={placement.team.id}
          team={placement.team}
          variation={placement.variation}
          position={placement.position}
          yaw={placement.yaw}
          street={street}
          isLeader={placement.team.id === leaderId}
          isSelected={placement.team.id === selectedTeamId}
          isCrisis={isCrisis}
          onSelect={onSelectTeam}
        />
      ))}
      <CameraRig layout={layout} street={street} selectedTeamId={selectedTeamId} fogRef={fogRef} />
    </>
  );
}

/* -------------------------------------------------------------------------- *
 * Componente público
 * -------------------------------------------------------------------------- */

/** Ítem de la leyenda: icono de línea + texto, en una sola línea que nunca se parte. */
function LegendItem({
  icon,
  tone,
  className = '',
  children,
}: {
  icon: string;
  tone: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`flex items-center gap-1 whitespace-nowrap text-[10px] uppercase leading-none text-text-secondary ${className}`}
    >
      <span className={`material-symbols-outlined text-[13px] ${tone}`}>{icon}</span>
      {children}
    </span>
  );
}

export default function NeighborhoodStage({
  teams,
  isCrisis = false,
  selectedTeamId = null,
  onSelectTeam,
  className = '',
}: NeighborhoodStageProps) {
  const [webglOk, setWebglOk] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      setWebglOk(Boolean(gl));
    } catch {
      setWebglOk(false);
    }
  }, []);

  const seleccionado = useMemo(
    () => (selectedTeamId ? teams.find((team) => team.id === selectedTeamId) ?? null : null),
    [teams, selectedTeamId],
  );

  if (webglOk === false) {
    return (
      <div
        className={`w-full rounded-xl border border-border-subtle bg-bg-surface p-6 text-center ${className}`}
      >
        <span className="material-symbols-outlined text-[28px] text-accent-gas">grid_off</span>
        <p className="font-label-md text-label-md text-text-secondary uppercase mt-2">
          Este equipo no puede dibujar el barrio. Las cifras de cada mesa siguen abajo, en sus
          tarjetas.
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
          shadows="soft"
          dpr={[1, 1.5]}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.05,
          }}
          camera={{ position: [0, 9, 44], fov: 34, near: 0.5, far: 420 }}
        >
          <Scene
            teams={teams}
            isCrisis={isCrisis}
            selectedTeamId={selectedTeamId}
            onSelectTeam={onSelectTeam ?? (() => undefined)}
          />
        </Canvas>
      )}

      {/* Viñeta: profundidad sin post-procesamiento */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(115%_100%_at_50%_45%,transparent_45%,rgba(0,0,0,0.55)_100%)]" />

      <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-2">
        <span
          className={`material-symbols-outlined text-[16px] ${
            isCrisis ? 'text-accent-crisis' : 'text-text-secondary'
          }`}
        >
          {isCrisis ? 'warning' : 'visibility'}
        </span>
        <span
          className={`font-label-sm text-label-sm uppercase tracking-widest ${
            isCrisis ? 'text-accent-crisis animate-pulse' : 'text-text-secondary'
          }`}
        >
          {isCrisis ? 'VECINDARIO EN CRISIS' : 'VECINDARIO EN TIEMPO REAL'}
        </span>
        <span className="font-label-sm text-label-sm text-text-secondary uppercase">
          · {teams.length} {teams.length === 1 ? 'equipo' : 'equipos'}
        </span>
      </div>

      {/* Leyenda del mapa estado → imagen. Es una TIRA a todo el ancho con fondo
          translúcido: los ítems nunca se montan entre sí porque el contenedor tiene
          ancho fijo (inset-x) y los menos críticos se ocultan en pantallas estrechas. */}
      <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-[#050810]/70 px-2 py-1 backdrop-blur-[1px]">
        <LegendItem icon="bolt" tone="text-accent-electricidad">
          ventanas = electricidad
        </LegendItem>
        <LegendItem icon="local_fire_department" tone="text-accent-gas">
          humo = gas
        </LegendItem>
        <LegendItem icon="speed" tone="text-accent-eficiencia">
          aura/césped = eficiencia
        </LegendItem>
        <LegendItem icon="electric_meter" tone="text-accent-presupuesto">
          medidor = presupuesto
        </LegendItem>
        <LegendItem icon="light_mode" tone="text-secondary">
          haz y aro = líder
        </LegendItem>
        <LegendItem icon="sensors" tone="text-accent-electricidad" className="hidden lg:flex">
          pulsos en los cables = red
        </LegendItem>
        <LegendItem icon="warning" tone="text-accent-crisis" className="hidden xl:flex">
          crisis = parpadeo común
        </LegendItem>
      </div>

      {/* Telemetría de la casa seleccionada (mismos números que el motor, sin inventar).
          Arriba a la derecha para no chocar nunca con la leyenda inferior. */}
      {seleccionado && (
        <div className="pointer-events-none absolute right-3 top-3 max-w-[46%] rounded-lg border border-border-subtle bg-bg-surface/90 px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: seleccionado.color }}
            />
            <span className="font-label-md text-label-md text-text-primary uppercase">
              {seleccionado.name}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-label-sm text-label-sm text-text-secondary">
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px] text-accent-electricidad">bolt</span>
              <span className="font-mono">{seleccionado.electricidad.toFixed(0)}</span> kWh
            </span>
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px] text-accent-gas">
                local_fire_department
              </span>
              <span className="font-mono">{seleccionado.gas.toFixed(0)}</span> m³
            </span>
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px] text-accent-eficiencia">speed</span>
              <span className="font-mono">{seleccionado.eficiencia.toFixed(0)}</span>%
            </span>
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px] text-accent-presupuesto">
                account_balance_wallet
              </span>
              <span className="font-mono">{seleccionado.presupuesto.toFixed(0)}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px] text-text-secondary">
                emoji_events
              </span>
              <span className="font-mono">{seleccionado.puntos}</span>
            </span>
          </div>
        </div>
      )}

      {teams.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="font-label-md text-label-md text-text-secondary uppercase">
            Esperando equipos para construir el vecindario…
          </span>
        </div>
      )}
    </div>
  );
}
