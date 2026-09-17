"use client";

import React, { useState } from "react";
import Link from "next/link";
import { sound } from "@/lib/audio";
import { versionLabel } from "@/lib/types";

interface HeaderProps {
  title: string;
  subtitle?: string;
  pin?: string;
  role?: "host" | "team";
  /** Texto de la línea de estado inferior (por defecto, sincronía nominal). */
  statusLabel?: string;
}

export function Header({
  title,
  subtitle = versionLabel,
  pin,
  role = "host",
  statusLabel = "SINC MALLA 99.4%",
}: HeaderProps) {
  const [isMuted, setIsMuted] = useState(sound.getMuted());

  const handleToggleMute = () => {
    const muted = sound.toggleMute();
    setIsMuted(muted);
    if (!muted) {
      sound.playRelayClick(true);
    }
  };

  return (
    <header className="sticky top-0 w-full z-30 bg-surface/90 backdrop-blur-md border-b border-surface-container-high shadow-lg">
      <div className="h-20 px-4 max-w-7xl mx-auto flex flex-col justify-center gap-1">
        <div className="flex items-center justify-between">
          {/* Logotipo y Título */}
          <div className="flex items-center gap-3">
            {/* Logotipo SVG */}
            <div className="w-9 h-9 rounded-md bg-[#090915] border-2 border-primary flex items-center justify-center shadow-[0_0_8px_rgba(43,240,117,0.4)]">
              <svg viewBox="0 0 100 100" className="w-7 h-7">
                <polygon
                  points="50,15 34,50 48,50 42,85 68,44 54,44"
                  fill="#2bf075"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="38"
                  fill="none"
                  stroke="#ff007f"
                  strokeWidth="3"
                  strokeDasharray="6 4"
                />
              </svg>
            </div>

            <div className="flex flex-col">
              <span className="text-[10px] font-data font-bold tracking-widest text-primary-fixed uppercase leading-none">
                {subtitle}
              </span>
              <h1 className="text-xl sm:text-2xl font-headline font-bold tracking-tight text-primary leading-tight uppercase phosphor-glow-green">
                {title}
              </h1>
            </div>
          </div>

          {/* Controles y Conmutador de Modo */}
          <div className="flex items-center gap-2">
            {pin && (
              <div className="hidden sm:flex items-center gap-1.5 bg-surface-container-high px-2.5 py-1 rounded border border-outline-variant">
                <span className="text-[10px] font-data text-outline tracking-wider">SALA:</span>
                <span className="text-xs font-data font-bold text-secondary tracking-widest">
                  #{pin}
                </span>
              </div>
            )}

            {/* Conmutador Rápido de Vista */}
            <Link
              href={role === "host" ? "/" : "/host"}
              className="px-2.5 py-1.5 rounded bg-surface-container-high hover:bg-surface-variant text-secondary text-xs font-data border border-outline-variant transition-colors flex items-center gap-1"
              title={role === "host" ? "Cambiar a Vista de Equipo" : "Cambiar a Vista de Anfitrión"}
            >
              <span className="material-symbols-outlined text-[16px]">
                {role === "host" ? "smartphone" : "tv"}
              </span>
              <span className="hidden md:inline">
                {role === "host" ? "VISTA EQUIPO" : "VISTA ANFITRIÓN"}
              </span>
              {role !== "host" && (
                <span className="material-symbols-outlined text-[12px] text-warning-amber">
                  lock
                </span>
              )}
            </Link>

            {/* Silenciador de Audio */}
            <button
              onClick={handleToggleMute}
              className={`w-9 h-9 flex items-center justify-center rounded bg-surface-container-high border border-outline-variant transition-colors ${
                isMuted ? "text-outline" : "text-primary shadow-[0_0_8px_rgba(43,240,117,0.3)]"
              }`}
              title={isMuted ? "Activar Audio" : "Silenciar Audio"}
            >
              <span className="material-symbols-outlined text-[20px]">
                {isMuted ? "volume_off" : "volume_up"}
              </span>
            </button>
          </div>
        </div>

        {/* Línea de Estado */}
        <div className="flex items-center justify-between text-[10px] font-data text-on-surface-variant pt-0.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-primary-fixed-dim animate-pulse shadow-[0_0_4px_#09e46b]" />
            <span className="tracking-wider uppercase">RED PRINCIPAL: EN LÍNEA 60.03 HZ</span>
          </div>
          <div className="flex items-center gap-1 bg-surface-container-low px-2 py-0.5 rounded border border-surface-container-high">
            <span className="material-symbols-outlined text-[12px] text-secondary">
              sensors
            </span>
            <span className="text-secondary tracking-widest uppercase font-bold">
              {statusLabel}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
