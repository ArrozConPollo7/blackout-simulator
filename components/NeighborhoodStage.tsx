'use client';

import React from 'react';
import Image from 'next/image';
import { TeamState } from '@/types/game';

interface NeighborhoodStageProps {
  teams: TeamState[];
  isCrisis?: boolean;
  onSelectTeam?: (teamId: string) => void;
  className?: string;
}

/**
 * NeighborhoodStage Component
 * 
 * BOUNDARY NOTICE: This component encapsulates the low-poly isometric neighborhood
 * digital twin with spatial HUD pins over individual houses.
 * In the future, this static image + SVG overlay block will be replaced SURGICALLY
 * by a live Three.js / WebGL interactive scene.
 */
export default function NeighborhoodStage({
  teams,
  isCrisis = false,
  onSelectTeam,
  className = '',
}: NeighborhoodStageProps) {
  const alfa = teams.find((t) => t.id === 'alfa') || teams[0];
  const gamma = teams.find((t) => t.id === 'gamma') || teams[1];
  const delta = teams.find((t) => t.id === 'delta') || teams[2];
  const beta = teams.find((t) => t.id === 'beta') || teams[3];

  return (
    <div
      className={`relative w-full rounded-xl overflow-hidden bg-bg-surface border shadow-2xl transition-all duration-300 ${
        isCrisis ? 'border-accent-crisis/60 shadow-[0_0_35px_rgba(255,59,78,0.25)]' : 'border-border-subtle'
      } ${className}`}
    >
      {/* Aspect Ratio Container for Projector / 16:9 SCADA Display */}
      <div className="relative w-full h-[380px] lg:h-[450px] xl:h-[500px] flex items-center justify-center overflow-hidden">
        {/* Low-Poly Neighborhood Asset (Background Digital Twin) */}
        <Image
          src="/images/neighborhood.png"
          alt="Vecindario 3D Low-Poly — Simulación de Cargas Eléctricas"
          fill
          priority
          className={`object-cover object-center transition-all duration-700 ${
            isCrisis ? 'filter brightness-75 contrast-125 hue-rotate-[-20deg]' : ''
          }`}
        />

        {/* Ambient Darkened Gradient Vignette */}
        <div className="absolute inset-0 bg-gradient-to-t from-bg-surface via-transparent to-bg-surface/60 pointer-events-none"></div>

        {/* SCADA Blueprint Graticule Overlay */}
        <div className="absolute inset-0 bg-[radial-gradient(#232B3D_1px,transparent_1px)] [background-size:24px_24px] opacity-40 pointer-events-none"></div>

        {/* CRISIS AMBIENT ALERT OVERLAY */}
        {isCrisis && (
          <div className="absolute inset-0 bg-accent-crisis/15 pointer-events-none mix-blend-color-burn animate-pulse"></div>
        )}

        {/* SVG EMISSIVE POWER FLOW LINES (SCADA GRID OVERLAY) */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="powerLineGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#3ECF8E" stopOpacity="0.8" />
              <stop offset="50%" stopColor="#F5B942" stopOpacity="0.9" />
              <stop offset="100%" stopColor={isCrisis ? '#FF3B4E' : '#3EC6F0'} stopOpacity="0.8" />
            </linearGradient>
            <filter id="glowEffect" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Grid Interconnect Vectors */}
          <path
            d="M 230,230 L 480,150 L 780,260 L 1050,210"
            fill="none"
            stroke="url(#powerLineGradient)"
            strokeWidth={isCrisis ? '2.5' : '1.5'}
            strokeDasharray={isCrisis ? '4,4' : '6,4'}
            filter="url(#glowEffect)"
            className={isCrisis ? 'animate-[dash_1s_linear_infinite]' : 'opacity-70'}
          />
        </svg>

        {/* ========================================================= */}
        {/* SPATIAL HUD TELEMETRY PINS (Positioned over Low-Poly Houses) */}
        {/* ========================================================= */}

        {/* PIN 1: EQUIPO ALFA (Leader / House 1) */}
        {alfa && (
          <div
            onClick={() => onSelectTeam && onSelectTeam(alfa.id)}
            className="absolute left-[16%] top-[34%] z-20 flex flex-col items-center group cursor-pointer transition-transform duration-200 hover:scale-105"
          >
            <div className="px-2.5 py-1 rounded bg-bg-surface/95 border border-accent-eficiencia text-accent-eficiencia shadow-xl flex items-center gap-1.5 backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-accent-eficiencia animate-ping"></span>
              <span className="font-label-sm text-label-sm font-bold tracking-wide">
                #1 ALFA (01) · {alfa.electricidad} kWh
              </span>
              <span className="text-[10px] font-bold px-1 rounded bg-accent-eficiencia/20 text-accent-eficiencia uppercase">
                LÍDER
              </span>
            </div>
            <div className="w-px h-8 bg-accent-eficiencia shadow-sm"></div>
            <div className="w-3.5 h-3.5 rounded-full bg-accent-eficiencia flex items-center justify-center shadow-lg ring-4 ring-accent-eficiencia/30">
              <div className="w-1.5 h-1.5 rounded-full bg-bg-primary"></div>
            </div>
          </div>
        )}

        {/* PIN 2: EQUIPO GAMMA (Balanced / House 2) */}
        {gamma && (
          <div
            onClick={() => onSelectTeam && onSelectTeam(gamma.id)}
            className="absolute left-[38%] top-[20%] z-20 flex flex-col items-center group cursor-pointer transition-transform duration-200 hover:scale-105"
          >
            <div className="px-2.5 py-1 rounded bg-bg-surface/95 border border-accent-electricidad text-accent-electricidad shadow-xl flex items-center gap-1.5 backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-accent-electricidad animate-pulse"></span>
              <span className="font-label-sm text-label-sm font-bold tracking-wide">
                #2 GAMMA (02) · {gamma.electricidad} kWh
              </span>
            </div>
            <div className="w-px h-8 bg-accent-electricidad shadow-sm"></div>
            <div className="w-3.5 h-3.5 rounded-full bg-accent-electricidad flex items-center justify-center shadow-lg ring-4 ring-accent-electricidad/30">
              <div className="w-1.5 h-1.5 rounded-full bg-bg-primary"></div>
            </div>
          </div>
        )}

        {/* PIN 3: EQUIPO DELTA (Intermediate / House 3) */}
        {delta && (
          <div
            onClick={() => onSelectTeam && onSelectTeam(delta.id)}
            className="absolute left-[62%] top-[45%] z-20 flex flex-col items-center group cursor-pointer transition-transform duration-200 hover:scale-105"
          >
            <div className="px-2.5 py-1 rounded bg-bg-surface/95 border border-accent-presupuesto text-accent-presupuesto shadow-xl flex items-center gap-1.5 backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-accent-presupuesto animate-pulse"></span>
              <span className="font-label-sm text-label-sm font-bold tracking-wide">
                #3 DELTA (03) · {delta.electricidad} kWh
              </span>
            </div>
            <div className="w-px h-8 bg-accent-presupuesto shadow-sm"></div>
            <div className="w-3.5 h-3.5 rounded-full bg-accent-presupuesto flex items-center justify-center shadow-lg ring-4 ring-accent-presupuesto/30">
              <div className="w-1.5 h-1.5 rounded-full bg-bg-primary"></div>
            </div>
          </div>
        )}

        {/* PIN 4: EQUIPO BETA (Wasteful / Crisis Risk / House 4) */}
        {beta && (
          <div
            onClick={() => onSelectTeam && onSelectTeam(beta.id)}
            className="absolute left-[82%] top-[32%] z-20 flex flex-col items-center group cursor-pointer transition-transform duration-200 hover:scale-105"
          >
            <div className="px-2.5 py-1 rounded bg-bg-surface/95 border border-accent-crisis text-accent-crisis shadow-xl flex items-center gap-1.5 backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-accent-crisis animate-ping"></span>
              <span className="font-label-sm text-label-sm font-bold tracking-wide">
                #4 BETA (04) · {beta.electricidad} kWh
              </span>
              <span className="text-[10px] font-bold px-1 rounded bg-accent-crisis/20 text-accent-crisis uppercase">
                {isCrisis ? 'COLAPSO' : 'CRÍTICO'}
              </span>
            </div>
            <div className="w-px h-8 bg-accent-crisis shadow-sm"></div>
            <div className="w-3.5 h-3.5 rounded-full bg-accent-crisis flex items-center justify-center shadow-lg ring-4 ring-accent-crisis/30 animate-pulse">
              <div className="w-1.5 h-1.5 rounded-full bg-bg-primary"></div>
            </div>
          </div>
        )}

        {/* Bottom Legend Overlay Inside Stage */}
        <div className="absolute bottom-4 left-4 z-20 flex items-center gap-3 px-3 py-1.5 rounded-lg bg-bg-surface/90 border border-border-subtle backdrop-blur-md font-label-sm text-label-sm text-text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent-eficiencia"></span>
            Líder
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent-electricidad"></span>
            Equilibrado
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent-crisis"></span>
            Sobrecarga
          </span>
        </div>
      </div>
    </div>
  );
}
