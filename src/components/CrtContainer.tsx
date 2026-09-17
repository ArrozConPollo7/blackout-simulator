"use client";

import React, { ReactNode } from "react";
import { useCrtSettings } from "@/lib/crtContext";
import { BottomNav } from "./BottomNav";

interface CrtContainerProps {
  children: ReactNode;
  shake?: boolean;
  violentShake?: boolean;
  className?: string;
  showBottomNav?: boolean;
}

export function CrtContainer({
  children,
  shake = false,
  violentShake = false,
  className = "",
  showBottomNav = true,
}: CrtContainerProps) {
  const {
    curvature,
    scanlinesOpacity,
    rgbSplit,
    phosphor,
    flicker,
    bloom,
    isDegaussing,
  } = useCrtSettings();

  const getPhosphorClass = () => {
    switch (phosphor) {
      case "amber":
        return "theme-amber text-[#ffb000]";
      case "cyan":
        return "theme-cyan text-[#00f5ff]";
      case "white":
        return "theme-white text-[#f0f0f5]";
      case "green":
      default:
        return "theme-green";
    }
  };

  return (
    <div
      className={`min-h-screen relative overflow-x-clip bg-[#080812] transition-transform duration-100 ${getPhosphorClass()} ${
        violentShake
          ? "shake-violent"
          : shake
          ? "shake-snap"
          : isDegaussing
          ? "animate-violent-jitter scale-105"
          : ""
      } ${flicker ? "animate-flicker" : ""} ${className}`}
      style={{
        filter: isDegaussing
          ? "hue-rotate(180deg) saturate(300%) contrast(150%) blur(1px)"
          : undefined,
      }}
    >
      {/* Raster de Líneas de Escaneo CRT */}
      <div
        className="fixed inset-0 crt-scanlines z-40 pointer-events-none transition-opacity duration-200"
        style={{ opacity: scanlinesOpacity / 100 }}
      />

      {/* Curvatura de Rayos Catódicos y Viñeta de Barril */}
      {curvature && (
        <div className="fixed inset-0 crt-vignette z-40 pointer-events-none" />
      )}

      {/* Haz de Electrones en Movimiento */}
      <div className="crt-beam z-40 pointer-events-none" />

      {children}

      {showBottomNav && <BottomNav />}
    </div>
  );
}
