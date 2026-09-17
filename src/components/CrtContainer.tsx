"use client";

import React, { ReactNode, useEffect, useState } from "react";
import { useCrtSettings } from "@/lib/crtContext";
import { BottomNav } from "./BottomNav";

interface CrtContainerProps {
  children: ReactNode;
  shake?: boolean;
  violentShake?: boolean;
  className?: string;
  showBottomNav?: boolean;
}

/**
 * Parpadeo del fósforo, ahora discreto.
 *
 * Antes era `animation: flicker 2s infinite` sobre el contenedor de toda la
 * página: la `opacity` de un millón de píxeles cambiaba en cada frame y el
 * compositor re-rasterizaba el tablero entero (con sus sombras de texto y las
 * scanlines encima). Eso era el grueso del consumo de CPU/GPU del proyector.
 *
 * Un CRT real no parpadea a 60 Hz: se le va la señal de vez en cuando. Esta capa
 * se enciende un instante cada 6–15 s, así que entre parpadeo y parpadeo el
 * navegador queda completamente quieto.
 */
function ParpadeoCRT({ activo }: { activo: boolean }) {
  const [encendido, setEncendido] = useState(false);

  useEffect(() => {
    if (!activo) {
      setEncendido(false);
      return;
    }
    let programado: ReturnType<typeof setTimeout>;
    let apagado: ReturnType<typeof setTimeout>;

    const disparar = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        setEncendido(true);
        apagado = setTimeout(() => setEncendido(false), 110);
      }
      programado = setTimeout(disparar, 6000 + Math.random() * 9000);
    };

    programado = setTimeout(disparar, 2500 + Math.random() * 5000);
    return () => {
      clearTimeout(programado);
      clearTimeout(apagado);
    };
  }, [activo]);

  if (!activo) return null;
  return <div className={`crt-flash ${encendido ? "on" : ""}`} aria-hidden="true" />;
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
    modoLigero,
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

  // En modo ligero las scanlines se atenúan (el dato manda sobre el adorno).
  const opacidadScanlines = modoLigero
    ? Math.min(0.22, scanlinesOpacity / 100)
    : scanlinesOpacity / 100;

  // El temblor de la desmagnetización solo se queda en modo completo: en modo
  // ligero el fogonazo del overlay ya cuenta la historia sin mover el tablero.
  const animacionRaiz = violentShake
    ? "shake-violent"
    : shake
    ? "shake-snap"
    : isDegaussing && !modoLigero
    ? "animate-violent-jitter scale-105"
    : isDegaussing
    ? "scale-[1.01]"
    : "";

  return (
    <div
      className={`min-h-screen relative overflow-x-clip bg-[#080812] transition-transform duration-100 ${getPhosphorClass()} ${animacionRaiz} ${className}`}
    >
      {/* Raster de Líneas de Escaneo CRT (capa propia, se rasteriza una vez) */}
      <div
        className="fixed inset-0 crt-scanlines z-40 pointer-events-none transition-opacity duration-200"
        style={{ opacity: opacidadScanlines }}
      />

      {/* Curvatura de Rayos Catódicos y Viñeta de Barril (degradados, sin blur) */}
      {curvature && !modoLigero && (
        <div className="fixed inset-0 crt-vignette z-40 pointer-events-none" />
      )}

      {/* Haz de Electrones en Movimiento (capa promovida; fuera en modo ligero) */}
      {!modoLigero && <div className="crt-beam z-40 pointer-events-none" />}

      {/* Fogonazo de desmagnetización: sustituye al `filter` de página completa. */}
      <div className={`crt-degauss ${isDegaussing ? "on" : ""}`} aria-hidden="true" />

      <ParpadeoCRT activo={flicker && !modoLigero} />

      {children}

      {showBottomNav && <BottomNav />}
    </div>
  );
}
