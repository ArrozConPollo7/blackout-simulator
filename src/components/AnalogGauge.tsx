"use client";

import React from "react";

interface AnalogGaugeProps {
  title: string;
  icon: string;
  unit: string;
  /** Demanda agregada actual. */
  currentValue: number;
  /** Techo de la ronda: pasar de aquí es apagón. */
  limitValue: number;
  /** Demanda nominal del panel sin crisis (marcador de referencia). */
  nominalValue?: number;
  /** Escala de dibujo; por defecto, el mayor entre techo y demanda con holgura. */
  scaleMax?: number;
}

/**
 * Medidor analógico: la zona verde llega hasta el techo de la ronda, la franja
 * roja es la zona de apagón, y la aguja marca la demanda en vivo.
 */
export function AnalogGauge({
  title,
  icon,
  unit,
  currentValue,
  limitValue,
  nominalValue,
  scaleMax,
}: AnalogGaugeProps) {
  const scale = scaleMax ?? Math.max(limitValue, currentValue, 1) * 1.12;
  const needlePercent = Math.min(100, (currentValue / scale) * 100);
  const limitPercent = Math.min(100, (limitValue / scale) * 100);
  const nominalPercent = nominalValue ? Math.min(100, (nominalValue / scale) * 100) : null;

  const loadPercent = limitValue > 0 ? Math.round((currentValue / limitValue) * 100) : 0;
  const over = currentValue > limitValue;
  const nearLimit = !over && loadPercent >= 90;

  const state = over ? "SOBRECARGA" : nearLimit ? "AL LÍMITE" : "DENTRO DEL TECHO";
  const border = over ? "border-error/60 shadow-[0_0_12px_rgba(255,27,58,0.3)]" : nearLimit ? "border-warning-amber/40" : "border-surface-container-high";

  return (
    <div className={`flex flex-col bg-surface-container rounded-xl p-4 shadow-md border gap-2 transition-all duration-300 ${border}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary text-[22px]">{icon}</span>
          <span className="font-headline text-lg text-secondary leading-none uppercase tracking-wide">{title}</span>
        </div>

        <div
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded font-data text-xs font-bold border ${
            over
              ? "bg-error/20 text-error border-error/50 animate-pulse"
              : nearLimit
              ? "bg-warning-amber/20 text-warning-amber border-warning-amber/40"
              : "bg-surface-container-high text-primary border-primary/30"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              over ? "bg-error animate-ping" : nearLimit ? "bg-warning-amber animate-pulse" : "bg-primary"
            }`}
          />
          <span>{loadPercent}% DEL TECHO</span>
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <div className="font-headline text-2xl font-bold tracking-tight text-primary">
          {currentValue.toLocaleString("es-CO")}{" "}
          <span className="text-sm font-data font-normal text-on-surface-variant">
            / {limitValue.toLocaleString("es-CO")} {unit}
          </span>
        </div>

        <span
          className={`font-data text-xs uppercase tracking-wider font-bold ${
            over ? "text-error animate-pulse phosphor-glow-red" : nearLimit ? "text-warning-amber" : "text-primary phosphor-glow-green"
          }`}
        >
          {state}
        </span>
      </div>

      {/* Barra: verde hasta el techo, rojo después */}
      <div className="w-full bg-surface-container-lowest h-7 rounded-lg overflow-hidden relative border border-outline-variant/30">
        <div className="absolute inset-y-0 left-0 bg-primary-fixed-dim/40" style={{ width: `${limitPercent}%` }} />
        <div
          className={`absolute inset-y-0 bg-error ${over ? "animate-pulse" : "opacity-50"}`}
          style={{ left: `${limitPercent}%`, right: 0 }}
        />

        {nominalPercent !== null && (
          <div className="absolute inset-y-0 w-0.5 bg-secondary/70" style={{ left: `calc(${nominalPercent}% - 1px)` }} />
        )}

        <div
          className="absolute top-0 bottom-0 w-1.5 bg-secondary-fixed shadow-[0_0_10px_#00f5ff] z-10 transition-all duration-200"
          style={{ left: `calc(${needlePercent}% - 3px)` }}
        />

      </div>

      <div className="flex items-center justify-between gap-2 text-on-surface-variant font-data text-[10px]">
        <span>0 {unit}</span>
        {nominalPercent !== null && <span className="text-secondary">NOMINAL {nominalValue?.toLocaleString("es-CO")}</span>}
        {over ? (
          <span className="bg-error/15 border border-error/50 text-error font-bold px-1.5 py-0.5 rounded">
            EXCESO DE {(currentValue - limitValue).toLocaleString("es-CO")} {unit}
          </span>
        ) : (
          <span className="text-error font-bold">TECHO {limitValue.toLocaleString("es-CO")}</span>
        )}
      </div>
    </div>
  );
}
