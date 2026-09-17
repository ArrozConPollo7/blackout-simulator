"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { sound } from "./audio";

export interface CrtSettings {
  curvature: boolean;
  scanlinesOpacity: number; // 0 to 100
  rgbSplit: number; // 0 to 8
  phosphor: "green" | "amber" | "cyan" | "white";
  flicker: boolean;
  bloom: number; // 0 to 100
  isDegaussing: boolean;
  triggerDegauss: () => void;
  updateSetting: <K extends keyof Omit<CrtSettings, "isDegaussing" | "triggerDegauss" | "updateSetting">>(
    key: K,
    value: CrtSettings[K]
  ) => void;
  resetDefaults: () => void;
}

const defaultSettings = {
  curvature: true,
  scanlinesOpacity: 75,
  rgbSplit: 1.5,
  phosphor: "green" as const,
  flicker: true,
  bloom: 70,
};

const CrtContext = createContext<CrtSettings | null>(null);

export function CrtProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaultSettings);
  const [isDegaussing, setIsDegaussing] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("crt_settings_v1");
      if (saved) {
        try {
          setSettings({ ...defaultSettings, ...JSON.parse(saved) });
        } catch {}
      }
    }
  }, []);

  const updateSetting = (key: any, value: any) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      if (typeof window !== "undefined") {
        localStorage.setItem("crt_settings_v1", JSON.stringify(next));
      }
      return next;
    });
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
    setSettings(defaultSettings);
    if (typeof window !== "undefined") {
      localStorage.removeItem("crt_settings_v1");
    }
  };

  return (
    <CrtContext.Provider
      value={{
        ...settings,
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

export function useCrtSettings() {
  const ctx = useContext(CrtContext);
  if (!ctx) {
    return {
      ...defaultSettings,
      isDegaussing: false,
      triggerDegauss: () => {},
      updateSetting: () => {},
      resetDefaults: () => {},
    };
  }
  return ctx;
}
