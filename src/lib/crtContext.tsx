"use client";

import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { sound } from "./audio";
import { FPS_MINIMOS, fpsMedidos as ultimaMedicion, suscribirFps } from "./fpsProbe";

/** Ajustes que el usuario puede tocar desde /crt. */
export type AjustesCrt = {
  curvature: boolean;
  scanlinesOpacity: number; // 0 to 100
  rgbSplit: number; // 0 to 8
  phosphor: "green" | "amber" | "cyan" | "white";
  flicker: boolean;
  bloom: number; // 0 to 100
  /**
   * Modo ligero: apaga las capas decorativas que más le cuestan al compositor
   * (haz, viñeta, parpadeo continuo, osciloscopio animado). El tablero y las
   * reglas no cambian. Pensado para portátiles que se ahogan con el proyector.
   */
  modoLigero: boolean;
};

export interface CrtSettings extends AjustesCrt {
  /** true si el modo ligero lo activó la medición automática, no el usuario. */
  autoLigero: boolean;
  /** fps medidos por la sonda (null = todavía sin medir). */
  fpsMedidos: number | null;
  isDegaussing: boolean;
  triggerDegauss: () => void;
  updateSetting: <K extends keyof AjustesCrt>(key: K, value: AjustesCrt[K]) => void;
  resetDefaults: () => void;
}

const STORAGE_KEY = "crt_settings_v1";

const defaultSettings: AjustesCrt = {
  curvature: true,
  scanlinesOpacity: 75,
  rgbSplit: 1.5,
  phosphor: "green",
  flicker: true,
  bloom: 70,
  modoLigero: false,
};

const CrtContext = createContext<CrtSettings | null>(null);

export function CrtProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AjustesCrt>(defaultSettings);
  const [autoLigero, setAutoLigero] = useState(false);
  // Si la sonda ya midió (otra pantalla en la misma carga), se arranca con ese dato.
  const [fpsMedidos, setFpsMedidos] = useState<number | null>(() => ultimaMedicion());
  const [isDegaussing, setIsDegaussing] = useState(false);
  /** ¿Ya hay una decisión explícita (localStorage o ?lite/?full)? */
  const decidido = useRef(false);

  // 1) Preferencias guardadas y parámetros de URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let guardado: Partial<AjustesCrt> | null = null;
    try {
      guardado = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
      guardado = null;
    }

    const params = new URLSearchParams(window.location.search);
    const forzado =
      params.get("lite") === "1" ? true : params.get("full") === "1" ? false : null;

    if (forzado !== null) {
      decidido.current = true;
      const next = { ...defaultSettings, ...(guardado || {}), modoLigero: forzado };
      setSettings(next);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return;
    }

    if (guardado && typeof guardado === "object") {
      decidido.current = true;
      setSettings({ ...defaultSettings, ...guardado });
    }
  }, []);

  // 2) Sonda de rendimiento: si nadie eligió, decide la máquina.
  //    Dos señales, porque el coste de estas pantallas no siempre se ve en los
  //    fps: si el equipo es flojo (pocos núcleos o poca memoria) o si el ritmo
  //    medido no llega a 40 fps, se activa el modo ligero. La sonda vive fuera de
  //    React (lib/fpsProbe) para que un re-montaje no se lleve la medición.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const puedeDecidir = !decidido.current;

    const nucleos = navigator.hardwareConcurrency ?? 8;
    const memoria = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const equipoFlojo = nucleos <= 4 || memoria <= 4;
    const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (puedeDecidir && (equipoFlojo || sinMovimiento)) setAutoLigero(true);

    return suscribirFps((fps) => {
      setFpsMedidos(fps);
      if (puedeDecidir && fps < FPS_MINIMOS) setAutoLigero(true);
    });
  }, []);

  const modoLigero = settings.modoLigero || autoLigero;

  // 3) El modo se refleja en <html> para que el CSS reaccione sin re-renderizar.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.modo = modoLigero ? "ligero" : "completo";
  }, [modoLigero]);

  const updateSetting = <K extends keyof AjustesCrt>(key: K, value: AjustesCrt[K]) => {
    decidido.current = true;
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {}
      }
      return next;
    });
    // El modo ligero tocado a mano manda: la detección automática se retira.
    if (key === "modoLigero") setAutoLigero(false);
  };

  const triggerDegauss = () => {
    sound.playDegauss();
    setIsDegaussing(true);
    setTimeout(() => {
      setIsDegaussing(false);
    }, 1200);
  };

  const resetDefaults = () => {
    sound.playRelayClick(true);
    decidido.current = false;
    setSettings(defaultSettings);
    setAutoLigero(false);
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  return (
    <CrtContext.Provider
      value={{
        ...settings,
        modoLigero,
        autoLigero,
        fpsMedidos,
        isDegaussing,
        triggerDegauss,
        updateSetting,
        resetDefaults,
      }}
    >
      {children}
    </CrtContext.Provider>
  );
}

export function useCrtSettings(): CrtSettings {
  const ctx = useContext(CrtContext);
  if (!ctx) {
    return {
      ...defaultSettings,
      modoLigero: false,
      autoLigero: false,
      fpsMedidos: null,
      isDegaussing: false,
      triggerDegauss: () => {},
      updateSetting: () => {},
      resetDefaults: () => {},
    };
  }
  return ctx;
}
