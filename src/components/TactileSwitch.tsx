"use client";

import React from "react";
import { sound } from "@/lib/audio";
import { SectorSpec } from "@/lib/types";

interface TactileSwitchProps {
  spec: SectorSpec;
  isActive: boolean;
  disabled?: boolean;
  onToggle: (newState: boolean) => void;
  onScreenShake?: () => void;
}

function formatMoney(value: number): string {
  const abs = Math.abs(value).toLocaleString("es-CO");
  return `${value < 0 ? "-" : "+"}$${abs}`;
}

export function TactileSwitch({
  spec,
  isActive,
  disabled = false,
  onToggle,
  onScreenShake,
}: TactileSwitchProps) {
  const handleToggle = () => {
    if (disabled) return;
    const nextState = !isActive;

    sound.playRelayClick(nextState);

    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(nextState ? [30, 15, 40] : [40, 20, 20]);
    }

    if (onScreenShake) onScreenShake();
    onToggle(nextState);
  };

  const accentBar = () => {
    if (!isActive) return "bg-surface-variant";
    switch (spec.accent) {
      case "cyan":
        return "bg-secondary-container";
      case "red":
        return "bg-error";
      case "magenta":
        return "bg-neon-magenta";
      case "green":
      default:
        return "bg-primary-container";
    }
  };

  const welfareRow =
    spec.welfareOff < 0 ? `${spec.welfareOff} BIENESTAR` : "SIN DAÑO A BIENESTAR";

  return (
    <div
      className={`bg-surface-container rounded-lg p-3 sm:p-4 shadow-lg flex flex-col gap-2 relative overflow-hidden border transition-all duration-200 ${
        isActive
          ? "border-outline-variant shadow-[0_0_12px_rgba(43,240,117,0.1)]"
          : "border-surface-container-high opacity-85"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${accentBar()}`} />

      <div className="flex items-start justify-between pl-2">
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                isActive ? "bg-primary animate-pulse shadow-[0_0_6px_#2bf075]" : "bg-surface-variant"
              }`}
            />
            <span className="font-data text-[11px] text-primary-fixed uppercase tracking-widest">
              {spec.tag}
            </span>
          </div>
          <span className="font-headline text-base sm:text-lg text-on-surface tracking-tight uppercase leading-snug font-bold mt-0.5">
            {spec.label}
          </span>
          <span className="font-data text-[11px] text-on-surface-variant">{spec.sublabel}</span>
        </div>

        <button
          onClick={handleToggle}
          type="button"
          disabled={disabled}
          className={`group relative flex flex-col items-center justify-center p-2 rounded select-none transition-all shadow-md border ${
            disabled ? "cursor-not-allowed" : "cursor-pointer active:translate-y-1"
          } ${
            isActive
              ? "bg-surface-container-high hover:bg-surface-container-highest border-outline-variant"
              : "bg-surface-container-low hover:bg-surface-container-high border-surface-variant"
          }`}
        >
          <span
            className={`font-data text-[10px] tracking-widest uppercase mb-1 font-bold ${
              isActive ? "text-primary phosphor-glow-green" : "text-on-surface-variant"
            }`}
          >
            {isActive ? "[ENCENDIDO]" : "[CORTADO]"}
          </span>

          <div className="w-12 h-14 bg-surface-container-lowest rounded flex flex-col items-center justify-between p-1 border border-outline-variant/40 shadow-inner">
            <div
              className={`w-9 h-5 rounded-xs flex items-center justify-center font-data text-xs font-bold transition-all ${
                isActive
                  ? "bg-primary text-on-primary shadow-[0_0_10px_rgba(43,240,117,0.8)]"
                  : "bg-surface-variant text-on-surface-variant"
              }`}
            >
              {isActive ? "ENC" : "OFF"}
            </div>
            <div
              className={`w-2 h-6 rounded-full transition-all duration-150 ${
                isActive ? "bg-primary-container" : "bg-surface-variant"
              }`}
            />
          </div>
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1 bg-surface-container-lowest p-2 rounded pl-2 font-data text-[10px] border border-surface-container-high">
        <div className="flex flex-col">
          <span className="text-on-surface-variant uppercase">Demanda</span>
          <span
            className={`font-bold ${isActive ? "text-primary phosphor-glow-green" : "text-on-surface-variant line-through"}`}
          >
            {spec.demandMW} MW
          </span>
          <span className={isActive ? "text-secondary-fixed-dim" : "text-on-surface-variant line-through"}>
            {spec.demandGas} m3
          </span>
        </div>

        <div className="flex flex-col">
          <span className="text-on-surface-variant uppercase">Economía</span>
          <span className={`font-bold ${isActive ? "text-secondary" : "text-error"}`}>
            {formatMoney(isActive ? spec.revenueOn : spec.revenueOff)}
          </span>
          <span className="text-on-surface-variant text-[9px]">
            {spec.gridFee !== 0 ? `RED ${formatMoney(spec.gridFee)}` : "SIN GASTO FIJO"}
          </span>
        </div>

        <div className="flex flex-col">
          <span className="text-on-surface-variant uppercase">Si se apaga</span>
          <span className={`font-bold ${spec.welfareOff < 0 ? "text-error" : "text-primary-fixed-dim"}`}>
            {welfareRow}
          </span>
        </div>
      </div>
    </div>
  );
}
