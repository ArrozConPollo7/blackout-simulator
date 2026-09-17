"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Header } from "@/components/Header";
import { CrtContainer } from "@/components/CrtContainer";
import { useSocket } from "@/lib/useSocket";
import { DISTRICTS, MAX_BLACKOUTS, SECTOR_SPECS, SECTOR_ORDER, versionLabel } from "@/lib/types";

const PIN = "VOLT";
const VIEW_W = 800;
const VIEW_H = 440;
const CENTER = { x: VIEW_W / 2, y: VIEW_H / 2 };
const RADIUS_X = 300;
const RADIUS_Y = 160;

export default function GridOverviewPage() {
  const { roomState, isConnected, send } = useSocket({
    pin: PIN,
    onOpen: () => send({ type: "WATCH_ROOM", pin: PIN }),
  });
  const [freq, setFreq] = useState(60.0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const teams = useMemo(() => Object.values(roomState?.teams || {}), [roomState?.teams]);
  const demand = roomState?.demand;
  const capacity = roomState?.capacity;
  const totalMW = demand?.mw ?? 0;
  const totalGas = demand?.gas ?? 0;
  const overloadMW = Boolean(capacity && totalMW > capacity.maxMW);
  const overloadGas = Boolean(capacity && totalGas > capacity.maxGas);
  const overload = overloadMW || overloadGas;

  useEffect(() => {
    const interval = setInterval(() => {
      const baseFreq = overload ? 58.8 : 60.0;
      const jitter = (Math.random() - 0.5) * (overload ? 0.4 : 0.06);
      setFreq(Number((baseFreq + jitter).toFixed(2)));
    }, 600);
    return () => clearInterval(interval);
  }, [overload]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frameId: number;
    let phase = 0;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = "rgba(13, 13, 23, 0.25)";
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(60, 74, 60, 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = overload ? "#ff1b3a" : "#2bf075";
      ctx.shadowColor = overload ? "#ff1b3a" : "#2bf075";
      ctx.shadowBlur = 8;

      const waveFreq = overload ? 0.03 : 0.05;
      const amp = overload ? h * 0.42 : h * 0.35;

      for (let x = 0; x < w; x += 1) {
        const y = h / 2 + Math.sin(x * waveFreq + phase) * amp + (Math.random() - 0.5) * (overload ? 8 : 1.5);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      phase += overload ? 0.18 : 0.12;
      frameId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(frameId);
  }, [overload]);

  // Posiciones radiales de los distritos presentes en la malla
  const nodes = useMemo(() => {
    const present = DISTRICTS.filter((district) => teams.some((team) => team.districtId === district.id));
    const count = present.length || 1;
    return present.map((district, index) => {
      const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
      const team = teams.find((t) => t.districtId === district.id);
      return {
        district,
        team,
        x: CENTER.x + Math.cos(angle) * RADIUS_X,
        y: CENTER.y + Math.sin(angle) * RADIUS_Y,
      };
    });
  }, [teams]);

  const transportColor = overload ? "#ff1b3a" : "#2bf075";

  return (
    <CrtContainer className="pb-24">
      <Header
        title="Visión General de la Red"
        subtitle={versionLabel}
        pin={roomState?.pin || PIN}
        role="team"
        statusLabel={isConnected ? "TELEMETRÍA EN LÍNEA" : "SIN ENLACE"}
      />

      <main className="max-w-6xl mx-auto p-3 sm:p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between bg-surface-container-lowest border border-surface-container-high rounded-xl p-4 gap-4 shadow-xl">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${overload ? "bg-error animate-ping" : "bg-primary animate-pulse"}`} />
            <div>
              <span className="font-data text-[10px] text-outline uppercase tracking-widest">
                Estado de red regional
              </span>
              <h2
                className={`font-headline text-lg sm:text-xl font-bold uppercase tracking-tight ${
                  overload ? "text-error" : "text-primary"
                }`}
              >
                {overload ? "Estado crítico // riesgo de desincronización" : "Estabilidad en alta tensión"}
              </h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs font-data">
            <div className="flex flex-col items-end">
              <span className="text-outline uppercase text-[10px]">Frecuencia</span>
              <span className={`font-headline text-base font-bold ${freq < 59.5 ? "text-error animate-pulse" : "text-primary"}`}>
                {freq.toFixed(2)} HZ
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-outline uppercase text-[10px]">Demanda / Techo eléctrico</span>
              <span className={`font-headline text-base font-bold ${overloadMW ? "text-error" : "text-secondary"}`}>
                {totalMW.toLocaleString("es-CO")} / {(capacity?.maxMW ?? 0).toLocaleString("es-CO")} MW
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-outline uppercase text-[10px]">Demanda / Techo de gas</span>
              <span className={`font-headline text-base font-bold ${overloadGas ? "text-error" : "text-secondary"}`}>
                {totalGas.toLocaleString("es-CO")} / {(capacity?.maxGas ?? 0).toLocaleString("es-CO")} m3
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-outline uppercase text-[10px]">Ronda</span>
              <span className="font-headline text-base font-bold text-primary">
                {roomState?.currentRound || 0} / {roomState?.totalRounds || 4}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-surface-container-low border border-surface-container-high rounded-2xl p-4 sm:p-6 shadow-2xl flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-surface-container-high pb-2 font-data text-xs">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[18px]">hub</span>
              <span className="text-on-surface font-bold uppercase tracking-wider">
                Diagrama unifilar y topología de malla
              </span>
            </div>
            <span className="text-primary text-[10px] uppercase font-bold">Sincronización vectorial</span>
          </div>

          <div className="w-full bg-[#070710] rounded-xl border border-outline-variant/30 p-2 sm:p-4 relative overflow-hidden flex items-center justify-center">
            <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full h-auto max-h-[460px]">
              <defs>
                <filter id="glow-grid" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <pattern id="grid-dots" width="20" height="20" patternUnits="userSpaceOnUse">
                  <circle cx="2" cy="2" r="1" fill="rgba(43, 240, 117, 0.08)" />
                </pattern>
              </defs>

              <rect width={VIEW_W} height={VIEW_H} fill="url(#grid-dots)" />

              {nodes.map((node) => (
                <line
                  key={`link-${node.district.id}`}
                  x1={CENTER.x}
                  y1={CENTER.y}
                  x2={node.x}
                  y2={node.y}
                  stroke={node.team && node.team.sectors.industry ? transportColor : "#3c4a3c"}
                  strokeWidth={node.team && node.team.sectors.industry ? 3 : 2}
                  strokeDasharray="8 4"
                  className={overload ? "animate-pulse" : ""}
                />
              ))}

              {/* Anillo interurbano */}
              {nodes.length > 2 &&
                nodes.map((node, index) => {
                  const next = nodes[(index + 1) % nodes.length];
                  return (
                    <line
                      key={`ring-${node.district.id}`}
                      x1={node.x}
                      y1={node.y}
                      x2={next.x}
                      y2={next.y}
                      stroke="#3c4a3c"
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                    />
                  );
                })}

              <g transform={`translate(${CENTER.x}, ${CENTER.y})`}>
                <circle
                  r="40"
                  fill="#121226"
                  stroke={overload ? "#ff1b3a" : "#2bf075"}
                  strokeWidth="3"
                  filter="url(#glow-grid)"
                />
                <circle r="24" fill="#1c1c36" stroke="#00f5ff" strokeWidth="1.5" strokeDasharray="3 2" />
                <text y="-2" textAnchor="middle" fill="#2bf075" fontSize="11" fontFamily="monospace" fontWeight="bold">
                  MATRIZ
                </text>
                <text y="10" textAnchor="middle" fill="#00f5ff" fontSize="9" fontFamily="monospace">
                  {capacity?.maxMW ?? 0} MW
                </text>
                <text y="56" textAnchor="middle" fill="#bacbb8" fontSize="9" fontFamily="monospace">
                  GAS {capacity?.maxGas ?? 0} m3
                </text>
              </g>

              {nodes.map((node) => {
                const team = node.team;
                const districtDemand = team ? demand?.perTeam?.[team.id] : null;
                const stroke = team && team.welfare < 400 ? "#ff1b3a" : "#00f5ff";
                return (
                  <g key={node.district.id} transform={`translate(${node.x}, ${node.y})`}>
                    <rect x="-58" y="-32" width="116" height="64" rx="6" fill="#1b1b25" stroke={stroke} strokeWidth="2" />
                    <text y="-16" textAnchor="middle" fill={stroke} fontSize="11" fontFamily="monospace" fontWeight="bold">
                      {node.district.id}
                    </text>
                    <text y="-3" textAnchor="middle" fill="#e4e1f0" fontSize="8" fontFamily="monospace">
                      {node.district.name.slice(0, 16)}
                    </text>
                    <text y="10" textAnchor="middle" fill="#2bf075" fontSize="9" fontFamily="monospace">
                      {districtDemand?.mw ?? 0} MW / {districtDemand?.gas ?? 0} m3
                    </text>
                    <text y="23" textAnchor="middle" fill="#00f5ff" fontSize="8" fontFamily="monospace">
                      {team ? `${team.welfare} HP // $${team.budget.toLocaleString("es-CO")}` : "SIN OPERADOR"}
                    </text>
                    {SECTOR_ORDER.map((key, index) => (
                      <circle
                        key={key}
                        cx={-44 + index * 10}
                        cy="-26"
                        r="3.5"
                        fill={team && team.sectors[key] ? "#2bf075" : "#34343f"}
                      />
                    ))}
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="flex flex-wrap items-center gap-4 font-data text-[10px] text-on-surface-variant">
            {SECTOR_ORDER.map((key) => (
              <span key={key} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-primary" />
                {SECTOR_SPECS[key].label} ({SECTOR_SPECS[key].demandMW} MW / {SECTOR_SPECS[key].demandGas} m3)
              </span>
            ))}
            <span className="text-outline">// Los puntos por subestación indican los sectores encendidos</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-surface-container-low border border-surface-container-high rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between font-data text-xs">
              <span className="text-on-surface font-bold uppercase tracking-wider">
                // Osciloscopio de onda senoidal
              </span>
              <span className={overload ? "text-error font-bold animate-pulse" : "text-primary"}>
                {freq.toFixed(2)} Hz [VECT: {overload ? "DESVÍO" : "OK"}]
              </span>
            </div>

            <div className="h-36 w-full bg-[#090915] rounded-lg overflow-hidden border border-outline-variant/40">
              <canvas ref={canvasRef} width={500} height={144} className="w-full h-full block" />
            </div>

            <div className="flex items-center justify-between text-[10px] font-data text-outline">
              <span>BASE: 60.00 HZ</span>
              <span>SENSIBILIDAD: 10 mV/DIV</span>
              <span>BARRIDO: 5 ms/DIV</span>
            </div>
          </div>

          <div className="bg-surface-container-low border border-surface-container-high rounded-xl p-4 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between font-data text-xs">
              <span className="text-on-surface font-bold uppercase tracking-wider">
                // Margen de reserva girante
              </span>
              <span className={`font-bold ${overload ? "text-error" : "text-secondary"}`}>
                {Math.max(0, (capacity?.maxMW ?? 0) - totalMW)} MW disponibles
              </span>
            </div>

            <div className="flex flex-col gap-2 font-data text-xs">
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Distritos en la malla</span>
                <span className="text-primary font-bold">{teams.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Apagones acumulados</span>
                <span className={roomState && roomState.blackoutCount > 0 ? "text-error font-bold" : "text-primary font-bold"}>
                  {roomState?.blackoutCount ?? 0} / {MAX_BLACKOUTS}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Crisis vigente</span>
                <span className="text-secondary font-bold">
                  {roomState?.activeCrisis ? `R${roomState.activeCrisis.round} ${roomState.activeCrisis.tagline}` : "—"}
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded bg-surface-container border border-surface-container-high text-xs font-data text-on-surface-variant">
              <span>ESTADO DE ENLACE: </span>
              <span className={overload ? "text-error font-bold" : "text-primary font-bold"}>
                {overload ? "PÉRDIDA DE SINCRONISMO INMINENTE" : "BLOQUEO DE ENCLAVAMIENTO SINCRONIZADO"}
              </span>
            </div>
          </div>
        </div>
      </main>
    </CrtContainer>
  );
}
