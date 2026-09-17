"use client";

import React, { useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { CrtContainer } from "@/components/CrtContainer";
import { useCrtSettings } from "@/lib/crtContext";
import { suscribirFps } from "@/lib/fpsProbe";
import { sound } from "@/lib/audio";

export default function CrtCalibrationPage() {
  const {
    curvature,
    scanlinesOpacity,
    rgbSplit,
    phosphor,
    flicker,
    bloom,
    isDegaussing,
    triggerDegauss,
    updateSetting,
    resetDefaults,
    modoLigero,
    autoLigero,
  } = useCrtSettings();

  /**
   * La sonda de fps vive en `lib/fpsProbe` (a nivel de módulo, sobrevive a
   * re-montajes). Aquí solo se muestra el resultado, que llega aunque el árbol de
   * React se reconstruya al hidratar con ajustes guardados.
   */
  const [fpsMedidos, setFpsLocal] = useState<number | null>(null);
  useEffect(() => suscribirFps(setFpsLocal), []);

  const handleDegauss = () => {
    triggerDegauss();
  };

  return (
    <CrtContainer className="pb-24">
      <Header
        title="Calibración de Monitor CRT"
        subtitle="AJUSTE DE HARDWARE // v4.2"
        role="team"
      />

      <main className="max-w-3xl mx-auto p-4 sm:p-6 flex flex-col gap-6">
        {/* Cabecera del Panel de Servicio */}
        <div className="bg-surface-container-lowest border border-surface-container-high rounded-xl p-4 sm:p-5 flex items-center justify-between shadow-xl">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-3xl text-secondary animate-pulse">
              tune
            </span>
            <div>
              <span className="font-data text-[10px] text-outline uppercase tracking-widest">
                POTENCIÓMETROS DE CHASIS TRASERO
              </span>
              <h2 className="font-headline text-xl font-bold uppercase tracking-tight text-primary phosphor-glow-green">
                CALIBRACIÓN DE RAYOS CATÓDICOS
              </h2>
            </div>
          </div>

          <button
            onClick={resetDefaults}
            className="px-3 py-1.5 rounded bg-surface-container-high hover:bg-surface-variant text-outline hover:text-on-surface font-data text-xs border border-outline-variant transition-colors"
          >
            VALORES DE FÁBRICA
          </button>
        </div>

        {/* GRAN BOTÓN DE BOBINA DE DESMAGNETIZACIÓN (DEGAUSS) */}
        <div className="bg-surface-container-low border-2 border-warning-amber/50 rounded-2xl p-5 shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-4 relative overflow-hidden">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-warning-amber text-[22px] animate-spin">
                rotate_right
              </span>
              <h3 className="font-headline text-lg font-bold uppercase tracking-wide text-warning-amber phosphor-glow-amber">
                BOBINA DE DESMAGNETIZACIÓN (DEGAUSS)
              </h3>
            </div>
            <p className="font-data text-xs text-on-surface-variant max-w-md">
              Descarga un pulso de corriente alterna sobre la máscara de sombra para eliminar manchas magnéticas y restaurar la pureza de color del cañón de electrones.
            </p>
          </div>

          <button
            onClick={handleDegauss}
            disabled={isDegaussing}
            className="w-full sm:w-auto px-6 py-4 rounded-xl bg-warning-amber text-black font-headline text-base uppercase tracking-wider font-bold shadow-[0_5px_0_#996300,0_0_20px_rgba(255,176,0,0.5)] active:translate-y-1 active:shadow-none transition-all flex items-center justify-center gap-2 cursor-pointer select-none shrink-0"
          >
            <span className="material-symbols-outlined text-[24px]">
              electric_bolt
            </span>
            <span>{isDegaussing ? "DESMAGNETIZANDO..." : "¡DISPARAR DEGAUSS!"}</span>
          </button>
        </div>

        {/* MODO LIGERO: para portátiles que se ahogan con el proyector */}
        <div
          className={`border-2 rounded-2xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4 ${
            modoLigero
              ? "bg-primary/5 border-primary/60"
              : "bg-surface-container-low border-surface-container-high"
          }`}
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[22px]">battery_saver</span>
              <h3 className="font-headline text-lg font-bold uppercase tracking-wide text-primary phosphor-glow-green">
                MODO LIGERO
              </h3>
            </div>
            <p className="font-data text-xs text-on-surface-variant max-w-xl">
              Apaga el haz de electrones, la viñeta de barril, el parpadeo y la animación del
              osciloscopio, y baja el refresco del reloj: la CPU y la GPU del portátil dejan de
              dispararse. El tablero, las reglas y los números se ven exactamente igual.
            </p>
            <p className="font-data text-[11px] text-outline">
              {fpsMedidos !== null
                ? `SONDA DE RENDIMIENTO: ${fpsMedidos} fps en este equipo (por debajo de 40 se activa solo).`
                : "SONDA DE RENDIMIENTO: aún sin medición; el modo ligero lo puedes forzar con este interruptor."}
              {modoLigero && autoLigero ? " · ACTIVADO AUTOMÁTICAMENTE EN ESTE EQUIPO." : ""}
              {!modoLigero && autoLigero ? " · ESTE EQUIPO NO LLEGA A 40 FPS: SE ACTIVA SOLO." : ""}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              sound.playRelayClick(!modoLigero);
              updateSetting("modoLigero", !modoLigero);
            }}
            className={`w-full sm:w-auto px-6 py-4 rounded-xl font-headline text-base uppercase tracking-wider font-bold transition-all cursor-pointer select-none shrink-0 ${
              modoLigero
                ? "bg-primary text-black shadow-[0_0_18px_rgba(43,240,117,0.45)]"
                : "bg-surface-container-high text-outline border border-outline-variant"
            }`}
          >
            {modoLigero ? "MODO LIGERO ACTIVADO" : "ACTIVAR MODO LIGERO"}
          </button>
        </div>

        {/* CONTROLES DE CALIBRACIÓN DE PANTALLA */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Curvatura del Tubo */}
          <div className="bg-surface-container p-4 rounded-xl border border-surface-container-high flex flex-col justify-between gap-3">
            <div>
              <span className="font-data text-xs font-bold text-on-surface uppercase">
                CURVATURA DE PANTALLA (BARRIL)
              </span>
              <p className="font-data text-[11px] text-on-surface-variant mt-0.5">
                Simula el vidrio abovedado y la viñeta perimetral de un monitor de 14 pulgadas.
              </p>
            </div>

            <button
              onClick={() => {
                sound.playRelayClick(!curvature);
                updateSetting("curvature", !curvature);
              }}
              className={`w-full py-2.5 rounded font-data text-xs font-bold uppercase tracking-wider border transition-all ${
                curvature
                  ? "bg-primary text-black border-primary shadow-[0_0_10px_rgba(43,240,117,0.4)]"
                  : "bg-surface-container-high text-outline border-outline-variant"
              }`}
            >
              {curvature ? "CURVATURA ACTIVADA" : "PANTALLA PLANA"}
            </button>
          </div>

          {/* Parpadeo de Haz Catódico */}
          <div className="bg-surface-container p-4 rounded-xl border border-surface-container-high flex flex-col justify-between gap-3">
            <div>
              <span className="font-data text-xs font-bold text-on-surface uppercase">
                MICRO-PARPADEO DEL HAZ (FLICKER)
              </span>
              <p className="font-data text-[11px] text-on-surface-variant mt-0.5">
                Fogonazo breve cada 6–15 s, como un cátodo que pierde la señal un instante
                (antes era un parpadeo continuo que costaba una recomposición de pantalla por frame).
              </p>
            </div>

            <button
              onClick={() => {
                sound.playRelayClick(!flicker);
                updateSetting("flicker", !flicker);
              }}
              className={`w-full py-2.5 rounded font-data text-xs font-bold uppercase tracking-wider border transition-all ${
                flicker
                  ? "bg-primary text-black border-primary shadow-[0_0_10px_rgba(43,240,117,0.4)]"
                  : "bg-surface-container-high text-outline border-outline-variant"
              }`}
            >
              {flicker ? "PARPADEO DISCRETO ACTIVADO" : "SIN PARPADEO"}
            </button>
          </div>

          {/* Deslizador de Líneas de Escaneo (Scanlines) */}
          <div className="bg-surface-container p-4 rounded-xl border border-surface-container-high flex flex-col gap-2">
            <div className="flex justify-between items-center font-data text-xs">
              <span className="font-bold text-on-surface uppercase">
                DENSIDAD DE LÍNEAS (SCANLINES)
              </span>
              <span className="text-primary font-bold">{scanlinesOpacity}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={scanlinesOpacity}
              onChange={(e) => updateSetting("scanlinesOpacity", parseInt(e.target.value, 10))}
              className="w-full accent-primary bg-surface-container-lowest h-2 rounded cursor-pointer appearance-none border border-outline-variant"
            />
            <div className="flex justify-between text-[9px] font-data text-outline">
              <span>0% (APAGADO)</span>
              <span>50%</span>
              <span>100% (REJILLA COMPLETA)</span>
            </div>
          </div>

          {/* Deslizador de Aberración Cromática */}
          <div className="bg-surface-container p-4 rounded-xl border border-surface-container-high flex flex-col gap-2">
            <div className="flex justify-between items-center font-data text-xs">
              <span className="font-bold text-on-surface uppercase">
                DESFASE RGB (ABERRACIÓN)
              </span>
              <span className="text-secondary font-bold">{rgbSplit} px</span>
            </div>
            <input
              type="range"
              min="0"
              max="6"
              step="0.5"
              value={rgbSplit}
              onChange={(e) => updateSetting("rgbSplit", parseFloat(e.target.value))}
              className="w-full accent-secondary bg-surface-container-lowest h-2 rounded cursor-pointer appearance-none border border-outline-variant"
            />
            <div className="flex justify-between text-[9px] font-data text-outline">
              <span>0 px (NÍTIDO)</span>
              <span>2 px (NORMAL)</span>
              <span>6 px (SOBRECARGA)</span>
            </div>
          </div>
        </div>

        {/* TIPO DE FÓSFORO MONOCROMÁTICO */}
        <div className="bg-surface-container-low border border-surface-container-high rounded-xl p-4 sm:p-5 flex flex-col gap-3">
          <span className="font-data text-xs font-bold text-on-surface uppercase tracking-wider">
            // TIPO DE FÓSFORO DEL TUBO DE RAYOS CATÓDICOS
          </span>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              { id: "green", label: "VERDE P1", desc: "Fósforo Clásico Mainframe", color: "#2bf075" },
              { id: "amber", label: "ÁMBAR P3", desc: "Terminal Industrial", color: "#ffb000" },
              { id: "cyan", label: "CIAN P4", desc: "Telemetría Digital", color: "#00f5ff" },
              { id: "white", label: "BLANCO P7", desc: "Laboratorio Radar", color: "#f0f0f5" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  sound.playRelayClick(true);
                  updateSetting("phosphor", item.id as any);
                }}
                className={`p-3 rounded-lg border text-left flex flex-col gap-1 transition-all active:scale-95 cursor-pointer ${
                  phosphor === item.id
                    ? "bg-surface-container-high border-primary shadow-[0_0_12px_rgba(43,240,117,0.3)]"
                    : "bg-surface-container border-surface-container-high hover:bg-surface-container-high"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="font-headline text-xs font-bold" style={{ color: item.color }}>
                    {item.label}
                  </span>
                </div>
                <span className="font-data text-[10px] text-on-surface-variant">
                  {item.desc}
                </span>
              </button>
            ))}
          </div>
        </div>
      </main>
    </CrtContainer>
  );
}
