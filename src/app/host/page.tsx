"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import confetti from "canvas-confetti";
import { Header } from "@/components/Header";
import { CrtContainer } from "@/components/CrtContainer";
import { AnalogGauge } from "@/components/AnalogGauge";
import { HostAuthGate } from "@/components/HostAuthGate";
import { useSocket, usePhaseSounds, useClientOrigin } from "@/lib/useSocket";
import { sound } from "@/lib/audio";
import {
  DISTRICTS,
  MAX_BLACKOUTS,
  SECTOR_SPECS,
  SECTOR_ORDER,
  SectorKey,
  TeamResolution,
  versionLabel,
} from "@/lib/types";

const PIN = "VOLT";

export default function HostProjectorPage() {
  return (
    <HostAuthGate>
      {({ passcode, invalidate }) => <HostConsole passcode={passcode} onAuthFailed={invalidate} />}
    </HostAuthGate>
  );
}

const PHASE_LABEL: Record<string, string> = {
  LOBBY: "VESTÍBULO",
  CRISIS_ANNOUNCE: "ANUNCIO DE CRISIS",
  CRISIS_ACTIVE: "NEGOCIACIÓN EN VIVO",
  RESOLUTION: "RESOLUCIÓN",
  GAME_OVER: "FIN DE PARTIDA",
};

function HostConsole({
  passcode,
  onAuthFailed,
}: {
  passcode: string;
  onAuthFailed: () => void;
}) {
  const [screenShake, setScreenShake] = useState(false);
  const [violentShake, setViolentShake] = useState(false);
  const [lastResolutionSeen, setLastResolutionSeen] = useState<number | null>(null);

  const { roomState, isConnected, errorMsg, timeRemaining, send, clearError } = useSocket({
    pin: PIN,
    onOpen: () => send({ type: "HOST_OPEN_ROOM", pin: PIN, passcode }),
  });

  usePhaseSounds(roomState);
  const origin = useClientOrigin();

  useEffect(() => {
    sound.startMainsHum();
    return () => sound.stopMainsHum();
  }, []);

  useEffect(() => {
    if (errorMsg && /CLAVE MAESTRA INVÁLIDA/.test(errorMsg)) {
      onAuthFailed();
    }
  }, [errorMsg, onAuthFailed]);

  const triggerShake = useCallback((ms = 200) => {
    setScreenShake(true);
    setTimeout(() => setScreenShake(false), ms);
  }, []);

  useEffect(() => {
    if (!roomState?.lastResolution) return;
    if (lastResolutionSeen === roomState.lastResolution.round) return;
    setLastResolutionSeen(roomState.lastResolution.round);

    if (roomState.lastResolution.outcome === "BLACKOUT") {
      setViolentShake(true);
      setTimeout(() => setViolentShake(false), 2200);
    } else {
      confetti({
        particleCount: 90,
        spread: 75,
        origin: { y: 0.6 },
        colors: ["#2bf075", "#00f5ff", "#66ff8e"],
      });
    }
  }, [roomState?.lastResolution, lastResolutionSeen]);

  const teams = useMemo(() => Object.values(roomState?.teams || {}), [roomState?.teams]);
  const demand = roomState?.demand;
  const capacity = roomState?.capacity;
  const totalMW = demand?.mw ?? 0;
  const totalGas = demand?.gas ?? 0;
  const overMW = Boolean(capacity && totalMW > capacity.maxMW);
  const overGas = Boolean(capacity && totalGas > capacity.maxGas);
  const timeSeconds = timeRemaining;
  const timeFormatted = `00:${String(Math.max(0, timeSeconds)).padStart(2, "0")}`;
  const isUrgent = timeSeconds <= 15 && roomState?.phase === "CRISIS_ACTIVE";

  const joinUrl = origin || "…";

  const crisis = roomState?.activeCrisis;
  const resolution = roomState?.lastResolution;
  const finals = roomState?.finalResults;
  const myTeamIdToName = (teamId: string | null) =>
    teamId ? roomState?.teams[teamId]?.name || teamId : null;

  const sendHost = (msg: Parameters<typeof send>[0]) => {
    sound.playRelayClick(true);
    triggerShake();
    send(msg);
  };

  if (!roomState) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 font-data text-xs flex flex-col gap-2 text-center">
          <span className="text-primary font-bold text-sm animate-pulse">
            {errorMsg ? "ACCESO DENEGADO" : "ESTABLECIENDO ENLACE CON LA MATRIZ…"}
          </span>
          <span className="text-on-surface-variant">
            {errorMsg || `Consola maestra solicitando la sala #${PIN}`}
          </span>
          {errorMsg && !/CLAVE MAESTRA INVÁLIDA/.test(errorMsg) && (
            <button onClick={clearError} className="text-secondary underline uppercase text-[10px]">
              Cerrar aviso
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <CrtContainer
      shake={screenShake}
      violentShake={violentShake || (isUrgent && timeSeconds % 2 === 0)}
      className="pb-20"
    >
      <Header
        title="Proyector Anfitrión"
        subtitle={versionLabel}
        pin={roomState.pin}
        role="host"
        statusLabel={isConnected ? "ENLACE MATRIZ OK" : "RECONECTANDO"}
      />

      <main className="max-w-7xl mx-auto p-3 sm:p-6 flex flex-col gap-5">
        {/* Barra superior: sesión, controles y cronómetro */}
        <div className="flex flex-col bg-surface-container-lowest rounded-xl p-4 sm:p-5 shadow-2xl gap-4 border border-outline-variant/30 relative overflow-hidden">
          <div className="absolute -top-10 -left-10 w-48 h-48 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-10 -right-10 w-48 h-48 bg-error/15 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-surface-container-high px-3 py-1 rounded-lg border border-outline-variant">
                <span className="font-data text-xs text-outline tracking-wider">SALA:</span>
                <span className="font-data text-sm font-bold text-secondary tracking-widest">
                  #{roomState.pin}
                </span>
              </div>
              <div className="flex items-center gap-1.5 bg-surface-container-high px-3 py-1 rounded-lg border border-outline-variant">
                <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
                <span className="font-data text-xs font-bold text-primary tracking-widest uppercase">
                  RONDA {roomState.currentRound || 0} / {roomState.totalRounds}
                </span>
              </div>
              <div className="flex items-center gap-1.5 bg-surface-container-high px-3 py-1 rounded-lg border border-outline-variant">
                <span className="font-data text-xs text-outline uppercase tracking-wider">Fase:</span>
                <span className="font-data text-xs font-bold text-secondary uppercase">
                  {PHASE_LABEL[roomState.phase]}
                </span>
              </div>
              <div
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border ${
                  roomState.blackoutCount >= MAX_BLACKOUTS - 1
                    ? "bg-error/20 border-error/60"
                    : "bg-surface-container-high border-outline-variant"
                }`}
              >
                <span className="font-data text-xs text-outline uppercase tracking-wider">Apagones:</span>
                <span
                  className={`font-data text-xs font-bold ${
                    roomState.blackoutCount >= MAX_BLACKOUTS - 1 ? "text-error animate-pulse" : "text-primary"
                  }`}
                >
                  {roomState.blackoutCount} / {MAX_BLACKOUTS}
                </span>
              </div>
              <div className="flex items-center gap-1.5 bg-primary/10 border border-primary/40 px-3 py-1 rounded-lg">
                <span className="material-symbols-outlined text-primary text-[15px]">wifi</span>
                <span className="font-data text-[11px] text-on-surface-variant uppercase">Móviles:</span>
                <span className="font-mono text-xs font-bold text-primary tracking-wider">{joinUrl}</span>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(joinUrl);
                    sound.playRelayClick(true);
                  }}
                  className="text-[10px] font-data text-secondary hover:underline cursor-pointer"
                >
                  copiar
                </button>
              </div>
            </div>

            <div className="flex items-center flex-wrap gap-2">
              {roomState.phase === "LOBBY" && (
                <>
                  <span className="font-data text-[10px] text-outline uppercase tracking-widest">
                    Reservar panel:
                  </span>
                  {[4, 5, 6].map((count) => (
                    <button
                      key={count}
                      onClick={() => sendHost({ type: "HOST_SEED_DISTRICTS", count })}
                      className="px-2.5 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-variant text-secondary font-data text-xs border border-outline-variant transition-all active:scale-95 cursor-pointer"
                    >
                      {count} DISTRITOS
                    </button>
                  ))}
                  <button
                    onClick={() => sendHost({ type: "HOST_REMOVE_UNCLAIMED" })}
                    className="px-2.5 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-variant text-outline font-data text-xs border border-outline-variant transition-all active:scale-95 cursor-pointer"
                  >
                    RETIRAR SIN OPERADOR
                  </button>
                  <button
                    onClick={() => sendHost({ type: "HOST_START_GAME" })}
                    className="flex items-center gap-1.5 bg-primary-container text-on-primary-container px-4 py-1.5 rounded-lg font-data text-xs font-bold tracking-wider hover:opacity-95 active:scale-95 transition-all shadow-[0_0_12px_rgba(43,240,117,0.5)] cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                    <span>INICIAR SIMULACIÓN</span>
                  </button>
                </>
              )}

              {roomState.phase === "CRISIS_ANNOUNCE" && (
                <button
                  onClick={() => sendHost({ type: "HOST_SKIP_ANNOUNCE" })}
                  className="flex items-center gap-1.5 bg-warning-amber text-black px-4 py-1.5 rounded-lg font-data text-xs font-bold tracking-wider hover:opacity-90 active:scale-95 transition-all shadow-md cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">fast_forward</span>
                  <span>ADELANTAR NEGOCIACIÓN</span>
                </button>
              )}

              {roomState.phase === "CRISIS_ACTIVE" && (
                <button
                  onClick={() => sendHost({ type: "HOST_RESOLVE_NOW" })}
                  className="flex items-center gap-1.5 bg-warning-amber text-black px-4 py-1.5 rounded-lg font-data text-xs font-bold tracking-wider hover:opacity-90 active:scale-95 transition-all shadow-md cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">bolt</span>
                  <span>FORZAR RESOLUCIÓN</span>
                </button>
              )}

              {roomState.phase === "RESOLUTION" && (
                <button
                  onClick={() => sendHost({ type: "HOST_NEXT_ROUND" })}
                  className="flex items-center gap-1.5 bg-primary-container text-on-primary-container px-4 py-1.5 rounded-lg font-data text-xs font-bold tracking-wider hover:opacity-95 active:scale-95 transition-all shadow-[0_0_12px_rgba(43,240,117,0.5)] cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">leaderboard</span>
                  <span>
                    {roomState.currentRound >= roomState.totalRounds
                      ? "VER CLASIFICACIÓN FINAL"
                      : "SIGUIENTE RONDA >>"}
                  </span>
                </button>
              )}

              {roomState.phase === "GAME_OVER" && (
                <button
                  onClick={() => {
                    if (window.confirm("¿REINICIAR TODA LA SIMULACIÓN AL VESTÍBULO?")) {
                      sendHost({ type: "HOST_RESET_GAME" });
                    }
                  }}
                  className="flex items-center gap-1.5 bg-primary-container text-on-primary-container px-4 py-1.5 rounded-lg font-data text-xs font-bold tracking-wider hover:opacity-95 active:scale-95 transition-all shadow-md cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                  <span>NUEVA SIMULACIÓN</span>
                </button>
              )}
            </div>
          </div>

          {/* Cronómetro */}
          <div className="flex flex-col items-center justify-center py-3 bg-surface-container-low rounded-lg border border-surface-container-high">
            <div className="flex items-center justify-between w-full px-4 font-data text-[10px] text-on-surface-variant uppercase tracking-widest">
              <span className="flex items-center gap-1.5 text-secondary">
                <span className="material-symbols-outlined text-[14px] animate-spin">alarm</span>
                {roomState.phase === "CRISIS_ANNOUNCE"
                  ? `Anuncio de crisis // ${roomState.announceSeconds}s`
                  : roomState.phase === "CRISIS_ACTIVE"
                  ? `Negociación en vivo // ${roomState.negotiationSeconds}s`
                  : "Cronómetro en reposo"}
              </span>
              <span
                className={`font-bold ${
                  overMW || overGas || isUrgent ? "text-error animate-pulse phosphor-glow-red" : "text-primary phosphor-glow-green"
                }`}
              >
                {roomState.phase === "LOBBY"
                  ? `RED SIN ESTRÉS // PANEL DE ${teams.length || 0} DISTRITOS`
                  : overMW && overGas
                  ? "SOBRECARGA EN MW Y GAS // RIESGO DE APAGÓN"
                  : overMW
                  ? "SOBRECARGA ELÉCTRICA // RIESGO DE APAGÓN"
                  : overGas
                  ? "SOBRECARGA DE GAS // RIESGO DE APAGÓN"
                  : "DEMANDA DENTRO DE LA CAPACIDAD"}
              </span>
            </div>

            <div className="flex items-baseline gap-3 my-1">
              <span
                className={`text-5xl sm:text-7xl font-headline font-bold tracking-tight ${
                  isUrgent
                    ? "text-error drop-shadow-[0_0_20px_rgba(255,27,58,0.9)] animate-violent-jitter"
                    : overMW || overGas
                    ? "text-warning-amber drop-shadow-[0_0_15px_rgba(255,176,0,0.6)] animate-jitter"
                    : "text-primary drop-shadow-[0_0_15px_rgba(43,240,117,0.6)]"
                }`}
              >
                {timeFormatted}
              </span>
              <span className="font-data text-xs text-on-surface-variant tracking-widest uppercase">
                seg restantes
              </span>
            </div>

            <div className="flex items-end gap-1.5 h-5 w-4/5 justify-center opacity-80">
              {Array.from({ length: 16 }).map((_, idx) => (
                <div
                  key={idx}
                  className={`w-2 rounded-xs transition-all duration-150 ${
                    overMW || overGas || isUrgent
                      ? "bg-error animate-pulse"
                      : idx % 3 === 0
                      ? "bg-secondary"
                      : "bg-primary"
                  }`}
                  style={{ height: `${Math.max(20, Math.sin(idx * 0.5 + timeSeconds * 0.3) * 100)}%` }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Indicadores regionales */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <AnalogGauge
            title="La Chispa"
            icon="bolt"
            unit="MW"
            currentValue={totalMW}
            limitValue={capacity?.maxMW || 0}
            nominalValue={capacity?.baseMW || 0}
          />

          <AnalogGauge
            title="Los Gases"
            icon="local_fire_department"
            unit="m3"
            currentValue={totalGas}
            limitValue={capacity?.maxGas || 0}
            nominalValue={capacity?.baseGas || 0}
          />
        </div>

        {/* Tarjeta de crisis */}
        {crisis && (
          <div className="flex flex-col bg-error-container/30 text-on-error-container rounded-xl p-4 sm:p-5 shadow-lg border border-error/50">
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-error text-[20px] animate-ping">warning</span>
                <span className="font-data text-xs text-error font-bold tracking-widest uppercase">
                  [RONDA {crisis.round} // {crisis.tagline}]
                </span>
              </div>
              <span className="font-data text-xs bg-surface-container-lowest text-error px-2 py-0.5 rounded border border-error/40 uppercase">
                {crisis.hexCode}
              </span>
            </div>

            <div className="flex items-center gap-3 mb-2">
              <span className="material-symbols-outlined text-error text-[32px]">{crisis.icon}</span>
              <h2 className="font-headline text-xl sm:text-2xl text-error tracking-tight font-bold uppercase leading-tight phosphor-glow-red">
                {crisis.name}
              </h2>
            </div>

            <p className="font-data text-xs sm:text-sm text-on-surface leading-relaxed mb-3">{crisis.description}</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-data text-xs">
              <div className="bg-surface-container-lowest/80 p-2.5 rounded-lg border border-surface-container-high">
                <span className="text-outline text-[10px] uppercase block">Capacidad eléctrica</span>
                <span className="text-primary font-bold">
                  {capacity?.maxMW} MW
                  {crisis.electricMultiplier !== 1 && (
                    <span className="text-error">
                      {" "}
                      {`(${crisis.electricMultiplier < 1 ? "-" : "+"}${Math.round(
                        Math.abs(1 - crisis.electricMultiplier) * 100
                      )}%)`}
                    </span>
                  )}
                </span>
              </div>
              <div className="bg-surface-container-lowest/80 p-2.5 rounded-lg border border-surface-container-high">
                <span className="text-outline text-[10px] uppercase block">Capacidad de gas</span>
                <span className="text-secondary font-bold">
                  {capacity?.maxGas} m3
                  {crisis.gasMultiplier !== 1 && (
                    <span className="text-error">
                      {" "}
                      {`(${crisis.gasMultiplier < 1 ? "-" : "+"}${Math.round(
                        Math.abs(1 - crisis.gasMultiplier) * 100
                      )}%)`}
                    </span>
                  )}
                </span>
              </div>
              <div className="bg-surface-container-lowest/80 p-2.5 rounded-lg border border-surface-container-high">
                <span className="text-outline text-[10px] uppercase block">Demanda civil</span>
                <span className={crisis.residentialDemandMultiplier > 1 ? "text-error font-bold" : "text-primary font-bold"}>
                  {crisis.residentialDemandMultiplier > 1
                    ? `RESIDENCIAL x${crisis.residentialDemandMultiplier}`
                    : "SIN CAMBIO"}
                </span>
              </div>
            </div>

            <p className="font-data text-[11px] text-on-surface-variant mt-2 italic">// {crisis.objective}</p>
          </div>
        )}

        {/* Malla de distritos */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between px-1 font-data text-[11px]">
            <span className="text-on-surface-variant uppercase tracking-widest">
              // Distritos en la malla: {teams.length} / {DISTRICTS.length}
              {capacity ? ` // base ${capacity.baseMW} MW y ${capacity.baseGas} m3` : ""}
            </span>
            <span className="text-primary tracking-widest uppercase font-bold">
              El anfitrión puede anular sectores de cualquier distrito
            </span>
          </div>

          {teams.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 bg-surface-container-low rounded-xl border border-surface-container-high text-center gap-3">
              <span className="material-symbols-outlined text-4xl text-outline animate-pulse">sensors_off</span>
              <span className="font-headline text-lg text-secondary">NO HAY DISTRITOS EN LA MALLA</span>
              <p className="font-data text-xs text-on-surface-variant max-w-md">
                Reserva el panel (4 a 6 distritos) con los botones de arriba, o pide a cada mesa que entre
                desde su teléfono a <span className="text-primary font-bold">{joinUrl}</span> y tome su
                distrito con el PIN <span className="text-primary font-bold">#{roomState.pin}</span>.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {teams.map((team) => {
                const teamDemand = demand?.perTeam?.[team.id] || { mw: 0, gas: 0 };
                const critical = team.welfare < 400;
                return (
                  <div
                    key={team.id}
                    className={`flex flex-col bg-surface-container-low rounded-xl p-4 gap-2 border ${
                      critical ? "border-error/60 bg-error/5 ring-1 ring-error/30" : "border-surface-container-high"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`font-data text-xs px-2 py-0.5 rounded font-bold shrink-0 ${
                            critical
                              ? "bg-error text-on-error animate-pulse"
                              : "bg-surface-container-high text-secondary border border-outline-variant"
                          }`}
                        >
                          {team.districtId}
                        </span>
                        <span className="font-headline text-base tracking-tight font-bold text-on-surface truncate">
                          {team.name}
                        </span>
                        <span
                          className={`font-data text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                            team.claimed
                              ? "bg-primary/20 text-primary border border-primary/40"
                              : "bg-surface-variant text-outline"
                          }`}
                        >
                          {team.claimed ? team.operator || "MESA" : "SIN OPERADOR"}
                        </span>
                        {team.claimed && !team.connected && (
                          <span className="font-data text-[10px] text-warning-amber shrink-0">[SIN ENLACE]</span>
                        )}
                      </div>
                      <span className={`font-data text-xs font-bold shrink-0 ${critical ? "text-error" : "text-primary"}`}>
                        {team.welfare} HP
                      </span>
                    </div>

                    <div className="flex items-center justify-between font-data text-[11px] text-on-surface-variant">
                      <span className="font-bold text-on-surface">
                        {teamDemand.mw} MW / {teamDemand.gas} m3
                      </span>
                      <span>${team.budget.toLocaleString("es-CO")}</span>
                      <span>MARTIRIO: {team.welfareSacrificed}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {SECTOR_ORDER.map((key) => {
                        const spec = SECTOR_SPECS[key];
                        const active = team.sectors[key];
                        return (
                          <button
                            key={key}
                            type="button"
                            disabled={roomState.phase === "GAME_OVER"}
                            onClick={() =>
                              sendHost({
                                type: "HOST_TOGGLE_SECTOR",
                                teamId: team.id,
                                sector: key as SectorKey,
                                state: !active,
                              })
                            }
                            title={`Anular ${spec.label} de ${team.name}`}
                            className={`flex items-center justify-between bg-surface-container p-2 rounded-lg border transition-all cursor-pointer text-left active:scale-95 disabled:opacity-40 ${
                              active ? "border-primary/40 hover:border-primary" : "border-surface-container-high opacity-70"
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`material-symbols-outlined text-[16px] ${
                                  active ? "text-primary" : "text-outline"
                                }`}
                              >
                                {spec.icon}
                              </span>
                              <span className="font-data text-[11px]">{spec.short}</span>
                            </div>
                            <span
                              className={`font-data text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                active
                                  ? "bg-primary-container text-on-primary-container"
                                  : "bg-surface-container-high text-outline"
                              }`}
                            >
                              {active ? "ENC" : "OFF"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Telemetría */}
        <div className="flex flex-col bg-surface-container-lowest rounded-xl p-4 shadow-inner gap-2 border border-surface-container-high">
          <div className="flex items-center justify-between font-data text-xs">
            <div className="flex items-center gap-1.5 text-primary">
              <span className="material-symbols-outlined text-[16px]">terminal</span>
              <span className="font-bold tracking-wider uppercase">Bus de telemetría</span>
            </div>
            <span className="text-on-surface-variant uppercase tracking-widest text-[10px]">
              {isConnected ? "ENLACE MATRIZ: OK" : "ENLACE CAÍDO"}
            </span>
          </div>

          <div className="flex flex-col gap-1.5 font-data text-xs max-h-40 overflow-y-auto pr-1">
            {roomState.logs.map((log) => (
              <div key={log.id} className="flex items-start gap-2">
                <span className="text-outline shrink-0">&gt; {log.timestamp}</span>
                <span
                  className={`font-bold shrink-0 ${
                    log.type === "ALERT"
                      ? "text-error animate-pulse"
                      : log.type === "WARN"
                      ? "text-warning-amber"
                      : log.type === "TEAM"
                      ? "text-secondary"
                      : log.type === "HOST"
                      ? "text-primary-fixed"
                      : "text-primary"
                  }`}
                >
                  [{log.type}]
                </span>
                <span className={log.type === "ALERT" ? "text-error font-bold" : "text-on-surface"}>
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Modal de resolución de ronda */}
      {roomState.phase === "RESOLUTION" && resolution && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div
            className={`max-w-3xl w-full rounded-2xl p-6 sm:p-8 flex flex-col gap-5 border-2 shadow-2xl max-h-[92vh] overflow-y-auto ${
              resolution.outcome === "BLACKOUT"
                ? "bg-surface-container-lowest border-error shadow-[0_0_40px_rgba(255,27,58,0.7)]"
                : "bg-surface-container-lowest border-primary shadow-[0_0_40px_rgba(43,240,117,0.7)]"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-data text-xs text-outline uppercase tracking-widest">
                Ciclo de resolución // Ronda {resolution.round}
              </span>
              <span
                className={`font-data text-xs px-2.5 py-0.5 rounded font-bold uppercase ${
                  resolution.outcome === "BLACKOUT" ? "bg-error text-on-error" : "bg-primary text-on-primary"
                }`}
              >
                {resolution.outcome === "BLACKOUT" ? `APAGÓN // ${resolution.cause}` : "RED ESTABLE"}
              </span>
            </div>

            <div className="flex flex-col items-center text-center gap-2">
              <span
                className={`text-4xl sm:text-5xl font-headline font-bold uppercase tracking-tight ${
                  resolution.outcome === "BLACKOUT"
                    ? "text-error phosphor-glow-red animate-glitch-text"
                    : "text-primary phosphor-glow-green"
                }`}
              >
                {resolution.outcome === "BLACKOUT" ? "¡APAGÓN DEL SISTEMA!" : "¡RED ESTABILIZADA!"}
              </span>
              <p className="font-data text-sm text-on-surface-variant max-w-xl">
                {resolution.outcome === "BLACKOUT"
                  ? `Demanda ${resolution.totalMW.toLocaleString("es-CO")} MW / ${resolution.totalGas.toLocaleString(
                      "es-CO"
                    )} m3 contra un techo de ${resolution.capacityMW} MW / ${resolution.capacityGas} m3. Castigo colectivo: ${-300} de Bienestar a todos los distritos e ingresos industriales anulados.`
                  : `Demanda ${resolution.totalMW.toLocaleString("es-CO")} MW / ${resolution.totalGas.toLocaleString(
                      "es-CO"
                    )} m3 dentro del techo de ${resolution.capacityMW} MW / ${resolution.capacityGas} m3 (margen ${resolution.marginMW} MW / ${resolution.marginGas} m3).`}
              </p>
              <span className="font-data text-[11px] text-outline uppercase tracking-widest">
                Apagones acumulados: {resolution.blackoutCount} / {MAX_BLACKOUTS}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {resolution.teamResults.map((result: TeamResolution) => (
                <div
                  key={result.teamId}
                  className="bg-surface-container p-3 rounded-lg border border-surface-container-high flex flex-col gap-1 text-xs font-data"
                >
                  <div className="flex justify-between items-center font-bold">
                    <span className="text-secondary">
                      {result.districtId} {result.teamName}
                    </span>
                    <span className={result.budgetDelta >= 0 ? "text-primary" : "text-error"}>
                      {result.budgetDelta >= 0 ? "+" : ""}
                      {result.budgetDelta.toLocaleString("es-CO")} $
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px] text-on-surface-variant">
                    <span>Bienestar</span>
                    <span className={result.welfareDelta >= 0 ? "text-primary" : "text-error"}>
                      {result.welfareDelta >= 0 ? "+" : ""}
                      {result.welfareDelta} pts ({result.welfareBefore} → {result.welfareAfter})
                    </span>
                  </div>
                  {result.lines.map((line, index) => (
                    <div
                      key={index}
                      className={`text-[10px] ${line.kind === "bonus" ? "text-primary" : "text-error"}`}
                    >
                      • {line.text}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <button
              onClick={() => sendHost({ type: "HOST_NEXT_ROUND" })}
              className={`w-full py-3 rounded-lg font-headline text-base uppercase tracking-wider font-bold shadow-lg transition-all active:translate-y-0.5 cursor-pointer ${
                resolution.outcome === "BLACKOUT"
                  ? "bg-error text-on-error hover:bg-error/90"
                  : "bg-primary text-on-primary hover:bg-primary/90"
              }`}
            >
              {roomState.currentRound >= roomState.totalRounds
                ? "VER CLASIFICACIÓN FINAL >>"
                : "AVANZAR A LA SIGUIENTE RONDA >>"}
            </button>
          </div>
        </div>
      )}

      {/* Modal de fin de partida */}
      {roomState.phase === "GAME_OVER" && finals && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-lg flex items-center justify-center p-4">
          <div
            className={`max-w-3xl w-full bg-surface-container-lowest border-2 rounded-2xl p-6 sm:p-8 flex flex-col gap-5 max-h-[92vh] overflow-y-auto ${
              finals.irreversible ? "border-error shadow-[0_0_50px_rgba(255,27,58,0.7)]" : "border-secondary shadow-[0_0_50px_rgba(0,245,255,0.6)]"
            }`}
          >
            <div className="text-center flex flex-col items-center gap-2">
              <span
                className={`material-symbols-outlined text-5xl animate-bounce ${
                  finals.irreversible ? "text-error" : "text-secondary"
                }`}
              >
                {finals.irreversible ? "power_off" : "emoji_events"}
              </span>
              <h2
                className={`text-2xl sm:text-4xl font-headline font-bold uppercase ${
                  finals.irreversible ? "text-error phosphor-glow-red" : "text-secondary phosphor-glow-cyan"
                }`}
              >
                {finals.irreversible
                  ? "Fallo regional irreversible — no hay ganadores"
                  : "Simulación completada"}
              </h2>
              <span className="font-data text-xs text-on-surface-variant tracking-widest uppercase">
                {finals.irreversible
                  ? `La red colapsó ${finals.blackoutCount} veces: la infraestructura común quedó destruida.`
                  : `Rondas jugadas: ${finals.roundsPlayed} // apagones: ${finals.blackoutCount} // PEF = Bienestar + (Tesorería / 100)`}
              </span>
            </div>

            <div className="flex flex-col gap-2.5">
              {finals.ranking.map((entry, index) => (
                <div
                  key={entry.teamId}
                  className={`flex items-center justify-between p-3 sm:p-4 rounded-xl border ${
                    !finals.irreversible && index === 0
                      ? "bg-primary/10 border-primary shadow-[0_0_15px_rgba(43,240,117,0.3)]"
                      : "bg-surface-container border-surface-container-high"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center font-headline font-bold shrink-0 ${
                        !finals.irreversible && index === 0
                          ? "bg-primary text-on-primary"
                          : "bg-surface-container-high text-secondary"
                      }`}
                    >
                      #{index + 1}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-headline text-base text-on-surface font-bold truncate">
                        {entry.districtId} {entry.teamName}
                      </span>
                      <span className="font-data text-[11px] text-on-surface-variant">
                        {entry.welfare} bienestar // ${entry.budget.toLocaleString("es-CO")} // sufrimiento{" "}
                        {entry.welfareSacrificed} // industria activa {entry.industryRoundsOn}/{entry.roundsPlayed}
                      </span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {finals.mentions.exemplary === entry.teamId && (
                          <span className="font-data text-[9px] bg-primary/20 text-primary border border-primary/40 px-1.5 py-0.5 rounded uppercase">
                            Operador de Red Ejemplar
                          </span>
                        )}
                        {finals.mentions.martyr === entry.teamId && (
                          <span className="font-data text-[9px] bg-tertiary/20 text-tertiary-fixed border border-tertiary-fixed/40 px-1.5 py-0.5 rounded uppercase">
                            Distrito Mártir
                          </span>
                        )}
                        {finals.mentions.parasite === entry.teamId && (
                          <span className="font-data text-[9px] bg-error/20 text-error border border-error/40 px-1.5 py-0.5 rounded uppercase">
                            Distrito Parásito
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end shrink-0">
                    <span className="font-headline text-lg text-primary font-bold">
                      {entry.pef.toLocaleString("es-CO")}
                    </span>
                    <span className="font-data text-[10px] text-outline uppercase tracking-wider">PEF</span>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => {
                if (window.confirm("¿REINICIAR TODA LA SIMULACIÓN AL VESTÍBULO?")) {
                  sendHost({ type: "HOST_RESET_GAME" });
                }
              }}
              className="w-full py-3 rounded-lg bg-primary text-on-primary font-headline text-base uppercase tracking-wider font-bold hover:bg-primary/90 transition-all shadow-[0_0_15px_rgba(43,240,117,0.5)] cursor-pointer"
            >
              Nueva simulación
            </button>
          </div>
        </div>
      )}
    </CrtContainer>
  );
}
