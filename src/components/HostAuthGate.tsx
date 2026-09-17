"use client";

import React, { useState, useEffect, ReactNode } from "react";
import Link from "next/link";
import { sound } from "@/lib/audio";

interface HostAuthGateProps {
  /**
   * Render prop: recibe la clave maestra guardada en la sesión y el callback
   * para invalidarla. La verificación real ocurre en el servidor (la sala solo
   * obedece órdenes de un socket autenticado con `HOST_PASSCODE`).
   */
  children: (session: { passcode: string; invalidate: (reason?: string | null) => void }) => ReactNode;
}

const STORAGE_KEY = "host_passcode";

export function HostAuthGate({ children }: HostAuthGateProps) {
  const [passcode, setPasscode] = useState<string | null>(null);
  const [passcodeInput, setPasscodeInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [shakeKeypad, setShakeKeypad] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setPasscode(sessionStorage.getItem(STORAGE_KEY));
    }
  }, []);

  /**
   * El servidor es quien valida la clave: cuando la rechaza, `reason` trae su
   * mensaje exacto (p. ej. "el Worker no tiene HOST_PASSCODE configurado").
   * Si no llega motivo, se usa el genérico.
   */
  const invalidate = (reason?: string | null) => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    setPasscode(null);
    setPasscodeInput("");
    setErrorMsg((reason || "").trim() || "CLAVE RECHAZADA POR LA CONSOLA MAESTRA // INTENTA DE NUEVO");
  };

  const handleKeyPress = (char: string) => {
    sound.playRelayClick(true);
    if (passcodeInput.length < 16) {
      setPasscodeInput((prev) => prev + char);
      setErrorMsg(null);
    }
  };

  const handleVerify = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!passcodeInput.trim()) {
      setErrorMsg("INGRESA LA CLAVE MAESTRA DEL ANFITRIÓN");
      return;
    }
    sound.playWarningBeep(0.4);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(STORAGE_KEY, passcodeInput.trim());
    }
    setPasscode(passcodeInput.trim());
  };

  if (passcode === null) {
    return (
      <div className="min-h-screen bg-[#080812] flex items-center justify-center p-4">
        <div
          className={`max-w-md w-full bg-surface-container-lowest border-2 border-error rounded-2xl p-6 sm:p-8 shadow-[0_0_40px_rgba(255,27,58,0.4)] flex flex-col gap-6 relative overflow-hidden ${
            shakeKeypad ? "shake-violent" : ""
          }`}
        >
          <div className="flex items-center justify-between border-b border-error/30 pb-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-error text-[20px] animate-ping">lock</span>
              <span className="font-data text-xs text-error font-bold tracking-widest uppercase">
                PROTOCOLO DE SEGURIDAD MAESTRO
              </span>
            </div>
            <span className="font-data text-[10px] bg-error/20 text-error px-2 py-0.5 rounded font-bold">
              NIVEL 5
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <h2 className="text-xl sm:text-2xl font-headline font-bold text-error uppercase phosphor-glow-red leading-tight">
              CONSOLA DE ANFITRIÓN BLOQUEADA
            </h2>
            <p className="font-data text-xs text-on-surface-variant leading-relaxed">
              El control del proyector, los disparos de crisis y la red eléctrica estatal están
              restringidos al organizador. La clave se valida en el servidor: sin ella, las órdenes
              del proyector son rechazadas.
            </p>
          </div>

          <form onSubmit={handleVerify} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="font-data text-[11px] text-on-surface-variant uppercase tracking-wider">
                CLAVE MAESTRA DEL ANFITRIÓN:
              </label>
              <input
                type="password"
                value={passcodeInput}
                onChange={(e) => setPasscodeInput(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full bg-surface-container px-3 py-3 rounded border border-error/50 font-data text-xl text-primary tracking-widest focus:outline-none focus:border-primary shadow-inner"
              />
              <span className="font-data text-[10px] text-outline">
                Definida en el servidor con la variable de entorno{" "}
                <span className="text-secondary font-bold font-mono">HOST_PASSCODE</span> (por defecto{" "}
                <span className="font-mono">1984</span>).
              </span>
            </div>

            {errorMsg && (
              <div className="bg-error/20 border border-error p-2 rounded text-error font-data text-xs text-center font-bold animate-pulse">
                {errorMsg}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 pt-1">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleKeyPress(num)}
                  className="py-3 rounded bg-surface-container hover:bg-surface-container-high active:bg-primary active:text-black text-on-surface font-headline text-lg font-bold border border-surface-container-high shadow-md transition-all select-none"
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  sound.playRelayClick(false);
                  setPasscodeInput("");
                  setErrorMsg(null);
                }}
                className="py-3 rounded bg-surface-container hover:bg-surface-variant text-outline font-data text-xs font-bold border border-surface-container-high shadow-md transition-all select-none uppercase"
              >
                Limpiar
              </button>
              <button
                type="button"
                onClick={() => handleKeyPress("0")}
                className="py-3 rounded bg-surface-container hover:bg-surface-container-high active:bg-primary active:text-black text-on-surface font-headline text-lg font-bold border border-surface-container-high shadow-md transition-all select-none"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => {
                  sound.playRelayClick(false);
                  setPasscodeInput((prev) => prev.slice(0, -1));
                }}
                className="py-3 rounded bg-surface-container hover:bg-surface-variant text-outline font-data text-xs font-bold border border-surface-container-high shadow-md transition-all select-none flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-[18px]">backspace</span>
              </button>
            </div>

            <button
              type="submit"
              className="mt-2 w-full py-3.5 rounded-lg bg-error text-on-error font-headline text-base uppercase tracking-wider font-bold shadow-[0_4px_0_#690005,0_0_20px_rgba(255,27,58,0.5)] active:translate-y-1 active:shadow-none transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">vpn_key</span>
              <span>AUTORIZAR CONSOLA MAESTRA</span>
            </button>
          </form>

          <div className="text-center pt-3 border-t border-surface-container-high flex justify-between items-center text-xs font-data text-outline">
            <span>¿Eres un jugador?</span>
            <Link href="/" className="text-secondary hover:underline flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">arrow_back</span>
              <span>IR AL MANDO DE DISTRITO</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="fixed top-[5.5rem] right-3 z-50">
        <button
          onClick={() => {
            sound.playRelayClick(false);
            invalidate();
          }}
          className="px-2 py-1 rounded bg-error/20 hover:bg-error text-error hover:text-white border border-error text-[10px] font-data uppercase tracking-wider transition-colors flex items-center gap-1 shadow-lg cursor-pointer"
          title="Cerrar sesión de anfitrión"
        >
          <span className="material-symbols-outlined text-[14px]">lock</span>
          <span className="hidden sm:inline">BLOQUEAR</span>
        </button>
      </div>

      {children({ passcode, invalidate })}
    </div>
  );
}
