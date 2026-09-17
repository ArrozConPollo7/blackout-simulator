"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Header } from "@/components/Header";
import { CrtContainer } from "@/components/CrtContainer";
import { TactileSwitch } from "@/components/TactileSwitch";
import { useSocket, usePhaseSounds, useClientOrigin } from "@/lib/useSocket";
import { sound } from "@/lib/audio";
import {
  DISTRICTS,
  SECTOR_ORDER,
  SECTOR_SPECS,
  DistrictTeam,
  SectorKey,
  MAX_WELFARE,
  MAX_BLACKOUTS,
  incidentTags,
  versionLabel,
} from "@/lib/types";

const TEAM_KEY = "blackout_team_id";
const PIN_KEY = "blackout_pin";
const OPERATOR_KEY = "blackout_operator";

function readStorage(key: string, fallback = ""): string {
  if (typeof window === "undefined") return fallback;
  return window.sessionStorage.getItem(key) || window.localStorage.getItem(key) || fallback;
}

const PHASE_LABEL: Record<string, string> = {
  LOBBY: "VESTÍBULO // ESPERANDO ARRANQUE",
  CRISIS_ANNOUNCE: "ANUNCIO DE CRISIS",
  CRISIS_ACTIVE: "CRISIS EN VIVO // NEGOCIAR",
  RESOLUTION: "CICLO RESUELTO",
  GAME_OVER: "SIMULACIÓN CERRADA",
};

export default function DistrictControllerPage() {
  const [pinInput, setPinInput] = useState("VOLT");
  const [operatorInput, setOperatorInput] = useState("");
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [screenShake, setScreenShake] = useState(false);
  const [violentShake, setViolentShake] = useState(false);
  const [lastResolutionSeen, setLastResolutionSeen] = useState<number | null>(null);

  useEffect(() => {
    setPinInput(readStorage(PIN_KEY, "VOLT"));
    setOperatorInput(readStorage(OPERATOR_KEY, ""));
    setMyTeamId(readStorage(TEAM_KEY) || null);
  }, []);

  const handleJoinSuccess = useCallback((teamId: string) => {
    setMyTeamId(teamId);
    window.sessionStorage.setItem(TEAM_KEY, teamId);
  }, []);

  const handleJoinRejected = useCallback((reason: string) => {
    setNotice(reason);
    if (typeof window !== "undefined") window.sessionStorage.removeItem(TEAM_KEY);
    setMyTeamId(null);
  }, []);

  const handleSessionExpired = useCallback(() => {
    setMyTeamId(null);
    if (typeof window !== "undefined") window.sessionStorage.removeItem(TEAM_KEY);
  }, []);

  const { roomState, isConnected, errorMsg, timeRemaining, send, clearError } = useSocket({
    pin: pinInput,
    onJoinSuccess: handleJoinSuccess,
    onJoinRejected: handleJoinRejected,
    onSessionExpired: handleSessionExpired,
    onRoomNotFound: (pin) => setNotice(`NO EXISTE UNA SALA #${pin}. PIDE AL ANFITRIÓN QUE ABRA EL PROYECTOR.`),
    onOpen: () => {
      // Tras una reconexión, un cambio de PIN o una recarga, recuperamos el
      // mando del distrito o al menos observamos la sala para ver qué hay libre.
      const savedTeam = readStorage(TEAM_KEY);
      const savedPin = readStorage(PIN_KEY);
      if (savedTeam && savedPin) {
        send({ type: "JOIN_DISTRICT", pin: savedPin, districtId: "", teamId: savedTeam });
      } else {
        send({ type: "WATCH_ROOM", pin: (savedPin || pinInput || "VOLT").toUpperCase() });
      }
    },
  });

  usePhaseSounds(roomState);

  const origin = useClientOrigin();

  const myTeam: DistrictTeam | undefined = useMemo(() => {
    if (!roomState || !myTeamId) return undefined;
    return roomState.teams[myTeamId];
  }, [roomState, myTeamId]);

  useEffect(() => {
    if (roomState && myTeamId && !roomState.teams[myTeamId]) {
      setMyTeamId(null);
      window.sessionStorage.removeItem(TEAM_KEY);
    }
  }, [roomState, myTeamId]);

  // Reacción a la resolución de la ronda
  useEffect(() => {
    if (!roomState?.lastResolution) return;
    if (lastResolutionSeen === roomState.lastResolution.round) return;
    setLastResolutionSeen(roomState.lastResolution.round);

    if (roomState.lastResolution.outcome === "BLACKOUT") {
      setViolentShake(true);
      setTimeout(() => setViolentShake(false), 1800);
    }
  }, [roomState?.lastResolution, lastResolutionSeen]);

  const triggerSnapShake = useCallback(() => {
    setScreenShake(true);
    setTimeout(() => setScreenShake(false), 180);
  }, []);

  const handleJoin = useCallback(
    (districtId?: string) => {
      const pin = pinInput.trim().toUpperCase();
      const operator = operatorInput.trim() || "MESA SIN IDENTIFICAR";
      sound.playRelayClick(true);
      triggerSnapShake();
      setNotice(null);
      window.localStorage.setItem(PIN_KEY, pin);
      window.localStorage.setItem(OPERATOR_KEY, operator);
      send({ type: "JOIN_DISTRICT", pin, districtId: districtId || "", operator });
    },
    [pinInput, operatorInput, send, triggerSnapShake]
  );

  const handleLeave = useCallback(() => {
    sound.playRelayClick(false);
    send({ type: "LEAVE_DISTRICT" });
    window.sessionStorage.removeItem(TEAM_KEY);
    setMyTeamId(null);
  }, [send]);

  const handleToggleSector = useCallback(
    (sector: SectorKey, state: boolean) => {
      triggerSnapShake();
      send({ type: "TOGGLE_SECTOR", sector, state });
    },
    [send, triggerSnapShake]
  );

  const handleScram = useCallback(() => {
    if (
      window.confirm(
        "¿CORTE TOTAL DE EMERGENCIA? Se abren los tres alimentadores de tu distrito (industria, residencial y críticos)."
      )
    ) {
      sound.playAlarmKlaxon();
      setViolentShake(true);
      setTimeout(() => setViolentShake(false), 600);
      send({ type: "SCRAM" });
    }
  }, [send]);

  const timeSeconds = timeRemaining;
  const timeFormatted = `00:${String(Math.max(0, timeSeconds)).padStart(2, "0")}`;
  const isUrgent = timeSeconds <= 15 && roomState?.phase === "CRISIS_ACTIVE";

  const occupancy = useMemo(() => {
    const map: Record<string, DistrictTeam | undefined> = {};
    for (const team of Object.values(roomState?.teams || {})) {
      map[team.districtId] = team;
    }
    return map;
  }, [roomState?.teams]);

  // ---------------------------------------------------------------- Vestíbulo
  if (!myTeam) {
    return (
      <CrtContainer shake={screenShake} className="flex flex-col min-h-screen pb-24">
        <Header title="Mando de Distrito" subtitle={versionLabel} pin={pinInput} role="team" />

        <main className="flex-1 max-w-md mx-auto w-full p-3 sm:p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between bg-surface-container-lowest border border-surface-container-high px-3 py-2 rounded-lg font-data text-xs">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? "bg-primary animate-pulse" : "bg-error animate-ping"}`} />
              <span className={isConnected ? "text-primary font-bold" : "text-error font-bold"}>
                {isConnected ? "ENLACE MATRIZ: CONECTADO" : "ENLACE MATRIZ: RECONECTANDO…"}
              </span>
            </div>
            <span className="text-[10px] text-outline uppercase">
              {roomState ? `SALA #${roomState.pin}` : "SIN SALA"}
            </span>
          </div>

          <div className="bg-surface-container-low border border-secondary/40 rounded-lg p-3 flex flex-col gap-1.5">
            <span className="font-data text-[10px] text-secondary font-bold uppercase tracking-wider flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">smartphone</span>
              ABRE ESTA DIRECCIÓN EN TU TELÉFONO (MISMA WI-FI)
            </span>
            <div className="bg-surface-container-lowest px-2.5 py-1.5 rounded border border-outline-variant/50 font-mono text-xs text-primary font-bold tracking-wider select-all">
              {origin || "—"}
            </div>
          </div>

          {(notice || errorMsg) && (
            <div className="bg-error-container text-on-error-container p-2.5 rounded-lg font-data text-xs flex items-start justify-between gap-2 border border-error">
              <span>{notice || errorMsg}</span>
              <button
                onClick={() => {
                  setNotice(null);
                  clearError();
                }}
                className="text-[10px] underline uppercase shrink-0"
              >
                Cerrar
              </button>
            </div>
          )}

          <div className="bg-surface-container-lowest border-2 border-primary/50 rounded-xl p-4 sm:p-5 shadow-[0_0_30px_rgba(43,240,117,0.25)] flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-surface-container-high pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
                <span className="font-data text-xs text-primary font-bold tracking-widest uppercase">
                  ACCESO DE MESA OPERADORA
                </span>
              </div>
              <span className="font-data text-[10px] text-outline">
                {Object.keys(roomState?.teams || {}).length} DISTRITOS EN MALLA
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-data text-[11px] text-on-surface-variant uppercase tracking-wider">
                CÓDIGO PIN DE LA SALA
              </label>
              <input
                type="text"
                maxLength={6}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.toUpperCase())}
                placeholder="VOLT"
                className="w-full bg-surface-container px-3 py-2 rounded border border-outline-variant font-headline text-lg text-primary tracking-widest uppercase focus:outline-none focus:border-primary"
              />
              <label className="font-data text-[11px] text-on-surface-variant uppercase tracking-wider">
                NOMBRE DE LA MESA
              </label>
              <input
                type="text"
                maxLength={40}
                value={operatorInput}
                onChange={(e) => setOperatorInput(e.target.value)}
                placeholder="ej. Mesa 3 — Los Traidores"
                className="w-full bg-surface-container px-3 py-2 rounded border border-outline-variant font-headline text-sm text-on-surface focus:outline-none focus:border-primary"
              />
            </div>

            <div className="flex items-center gap-2 my-0.5">
              <div className="flex-1 h-px bg-surface-container-high" />
              <span className="font-data text-[10px] text-outline uppercase">TOMA TU DISTRITO</span>
              <div className="flex-1 h-px bg-surface-container-high" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {DISTRICTS.map((district) => {
                const occupant = occupancy[district.id];
                const taken = Boolean(occupant?.claimed);
                return (
                  <button
                    key={district.id}
                    type="button"
                    onClick={() => handleJoin(district.id)}
                    className={`p-2.5 rounded-lg border text-left flex flex-col gap-0.5 transition-all active:scale-95 cursor-pointer shadow-md ${
                      taken
                        ? "bg-surface-container-high border-secondary/50"
                        : "bg-surface-container hover:bg-surface-container-high border-surface-container-high hover:border-primary/60"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-data text-[10px] text-secondary font-bold">{district.id}</span>
                      <span className="material-symbols-outlined text-[14px] text-primary">bolt</span>
                    </div>
                    <span className="font-headline text-xs font-bold text-on-surface truncate">{district.name}</span>
                    <span className="font-data text-[9px] text-outline truncate">
                      {taken ? `OCUPADO: ${occupant?.operator ?? "MESA"}` : occupant ? "RESERVADO // LIBRE" : "LIBRE"}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => handleJoin()}
              className="w-full py-3 rounded-lg bg-primary text-on-primary font-headline text-sm uppercase tracking-wider font-bold shadow-[0_4px_0_#005322,0_0_15px_rgba(43,240,117,0.3)] active:translate-y-1 active:shadow-none transition-all cursor-pointer"
            >
              ACTIVAR ENLACE DE MANDO
            </button>
          </div>
        </main>
      </CrtContainer>
    );
  }

  // ---------------------------------------------------------------- Consola
  const district = DISTRICTS.find((d) => d.id === myTeam.districtId) || DISTRICTS[0];
  const demand = roomState?.demand?.perTeam?.[myTeam.id] || { mw: 0, gas: 0 };
  const capacity = roomState?.capacity;
  const totalMW = roomState?.demand?.mw ?? 0;
  const totalGas = roomState?.demand?.gas ?? 0;
  const overMW = Boolean(capacity && totalMW > capacity.maxMW);
  const overGas = Boolean(capacity && totalGas > capacity.maxGas);
  const resolution = roomState?.lastResolution;
  const myResult = resolution?.teamResults.find((r) => r.teamId === myTeam.id);

  return (
    <CrtContainer
      shake={screenShake}
      violentShake={violentShake || (isUrgent && timeSeconds % 2 === 0)}
      className="pb-28"
    >
      <Header title="Mando de Distrito" subtitle={versionLabel} pin={roomState?.pin || pinInput} role="team" />

      <main className="max-w-md mx-auto w-full p-3 sm:p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between bg-surface-container-lowest p-2.5 rounded-lg border border-surface-container-high font-data text-xs">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                roomState?.phase === "CRISIS_ACTIVE" ? "bg-error animate-ping" : "bg-primary animate-pulse"
              }`}
            />
            <span className="font-bold uppercase tracking-wider text-secondary">
              {PHASE_LABEL[roomState?.phase ?? "LOBBY"]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-outline">RONDA</span>
            <span className="font-headline text-sm text-primary font-bold">
              {roomState?.currentRound || 0}/{roomState?.totalRounds || 4}
            </span>
            <span className={`font-headline text-sm ${isUrgent ? "text-error animate-pulse" : "text-primary"}`}>
              {timeFormatted}
            </span>
            <button
              onClick={handleLeave}
              className="px-1.5 py-0.5 rounded bg-surface-container-high hover:bg-surface-variant text-[10px] text-outline hover:text-on-surface transition-colors cursor-pointer"
              title="Liberar el mando de este distrito"
            >
              SALIR
            </button>
          </div>
        </div>

        {/* Identidad y recursos del distrito */}
        <div className="bg-surface-container-low rounded-lg p-3 border border-surface-container-high flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="px-1.5 py-0.5 rounded bg-surface-variant text-primary-fixed font-data text-[10px] uppercase font-bold">
                  {district.id}
                </span>
                <span className="font-data text-[10px] text-on-surface-variant truncate">{district.tag}</span>
              </div>
              <h2 className="font-headline text-xl text-primary tracking-tight uppercase leading-tight font-bold mt-0.5 phosphor-glow-green">
                {myTeam.name}
              </h2>
              <span className="font-data text-[11px] text-on-surface-variant">
                OPERADOR: {myTeam.operator || "SIN IDENTIFICAR"}
              </span>
            </div>
            <div className="bg-surface-container-high rounded p-2 flex flex-col items-end border border-outline-variant shrink-0">
              <span className="font-data text-[9px] text-on-surface-variant uppercase tracking-widest">TESORERÍA</span>
              <span className="font-data text-sm font-bold text-primary tracking-wider phosphor-glow-green">
                ${myTeam.budget.toLocaleString("es-CO")}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-surface-container p-2 rounded border border-surface-container-high flex flex-col gap-1">
              <div className="flex items-center justify-between font-data text-[10px] text-tertiary-fixed-dim">
                <span className="font-bold uppercase tracking-wider">Bienestar</span>
                <span className={myTeam.welfare < 400 ? "text-error animate-pulse" : "text-primary-fixed-dim"}>
                  {myTeam.welfare < 400 ? "[REVUELTA]" : "[ESTABLE]"}
                </span>
              </div>
              <span className="font-headline text-lg font-bold text-on-surface">
                {myTeam.welfare}
                <span className="font-data text-[10px] text-on-surface-variant"> / {MAX_WELFARE} pts</span>
              </span>
              <div className="h-2 w-full bg-surface-container-lowest rounded overflow-hidden border border-surface-container-high">
                <div
                  className={`h-full transition-all duration-300 ${
                    myTeam.welfare < 400 ? "bg-error" : myTeam.welfare < 800 ? "bg-warning-amber" : "bg-primary"
                  }`}
                  style={{ width: `${Math.min(100, (myTeam.welfare / MAX_WELFARE) * 100)}%` }}
                />
              </div>
            </div>

            <div className="bg-surface-container p-2 rounded border border-surface-container-high flex flex-col gap-1">
              <span className="font-data text-[10px] text-on-surface-variant uppercase tracking-wider">
                Consumo del distrito
              </span>
              <span className="font-headline text-lg font-bold text-primary">
                {demand.mw} MW
                <span className="font-data text-[11px] text-secondary-fixed-dim"> / {demand.gas} m3</span>
              </span>
              <span className="font-data text-[10px] text-on-surface-variant">
                {SECTOR_ORDER.filter((key) => myTeam.sectors[key]).length} de 3 sectores en línea
              </span>
            </div>
          </div>
        </div>

        {/* Tablero regional espejo: lo que hay que negociar en voz alta */}
        <div
          className={`bg-surface-container-lowest rounded-lg p-3 border flex flex-col gap-2 ${
            overMW || overGas ? "border-error/70 shadow-[0_0_12px_rgba(255,27,58,0.25)]" : "border-surface-container-high"
          }`}
        >
          <div className="flex items-center justify-between font-data text-[10px] uppercase tracking-widest">
            <span className="text-on-surface-variant">// Tablero regional (espejo del proyector)</span>
            <span className={overMW || overGas ? "text-error font-bold animate-pulse" : "text-primary font-bold"}>
              {roomState?.phase === "LOBBY"
                ? "SIN CRISIS ACTIVA"
                : overMW && overGas
                ? "DÉFICIT EN MW Y GAS"
                : overMW
                ? "DÉFICIT ELÉCTRICO"
                : overGas
                ? "DÉFICIT DE GAS"
                : "DENTRO DE CAPACIDAD"}
            </span>
          </div>

          {[
            {
              label: "LA CHISPA (MW)",
              value: totalMW,
              max: capacity?.maxMW ?? 0,
              over: overMW,
            },
            {
              label: "LOS GASES (m3)",
              value: totalGas,
              max: capacity?.maxGas ?? 0,
              over: overGas,
            },
          ].map((gauge) => (
            <div key={gauge.label} className="flex flex-col gap-1">
              <div className="flex justify-between font-data text-xs">
                <span className="text-on-surface-variant">{gauge.label}</span>
                <span className={gauge.over ? "text-error font-bold" : "text-primary font-bold"}>
                  {gauge.value.toLocaleString("es-CO")} / {gauge.max.toLocaleString("es-CO")}
                  {gauge.over ? ` (+${(gauge.value - gauge.max).toLocaleString("es-CO")})` : ""}
                </span>
              </div>
              <div className="h-3 w-full bg-surface-container rounded overflow-hidden border border-outline-variant/40 flex">
                <div
                  className={`h-full transition-all duration-300 ${gauge.over ? "bg-error animate-pulse" : "bg-primary"}`}
                  style={{ width: `${gauge.max ? Math.min(100, (gauge.value / gauge.max) * 100) : 0}%` }}
                />
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between font-data text-[10px] text-on-surface-variant">
            <span>FALLOS ACUMULADOS: {roomState?.blackoutCount ?? 0} / {MAX_BLACKOUTS}</span>
            <span>{roomState?.activeCrisis ? roomState.activeCrisis.name : "PENDIENTE"}</span>
          </div>
        </div>

        {/* Incidentes aleatorios de la ronda */}
        {(roomState?.incidents?.length ?? 0) > 0 && (
          <div className="flex flex-col gap-2">
            {(roomState?.incidents || []).map((incident) => (
              <div
                key={incident.id}
                className="bg-surface-container-lowest border border-warning-amber/60 rounded-lg p-2.5 flex flex-col gap-1"
              >
                <span className="flex items-center gap-1.5 font-data text-[10px] text-warning-amber font-bold uppercase tracking-widest">
                  <span className="material-symbols-outlined text-[14px] animate-pulse">bolt</span>
                  INCIDENTE // {incident.tagline}
                </span>
                <span className="font-headline text-sm text-on-surface font-bold uppercase tracking-tight leading-tight">
                  {incident.name}
                </span>
                <div className="flex flex-wrap gap-1">
                  {incidentTags(incident).map((tag) => (
                    <span
                      key={tag}
                      className="font-data text-[9px] bg-warning-amber/10 text-warning-amber border border-warning-amber/40 px-1.5 py-0.5 rounded uppercase font-bold"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Palancas */}
        <div className="flex items-center justify-between px-1">
          <h3 className="font-data text-xs uppercase tracking-wider text-on-surface font-bold">
            Sectores de bus de alimentación
          </h3>
          <span
            className={`font-data text-[10px] tracking-widest ${
              SECTOR_ORDER.some((key) => roomState?.lockedSectors?.[key])
                ? "text-warning-amber font-bold"
                : "text-on-surface-variant"
            }`}
          >
            {roomState?.phase === "GAME_OVER"
              ? "BLOQUEADO"
              : SECTOR_ORDER.some((key) => roomState?.lockedSectors?.[key])
              ? "PALANCAS BLOQUEADAS POR INCIDENTE"
              : "EN VIVO"}
          </span>
        </div>

        <div className="flex flex-col gap-3">
          {SECTOR_ORDER.map((key) => (
            <TactileSwitch
              key={key}
              spec={SECTOR_SPECS[key]}
              isActive={myTeam.sectors[key]}
              disabled={roomState?.phase === "GAME_OVER" || Boolean(roomState?.lockedSectors?.[key])}
              onToggle={(state) => handleToggleSector(key, state)}
              onScreenShake={triggerSnapShake}
            />
          ))}
        </div>

        <div className="flex items-center justify-between bg-surface-container-lowest p-2 rounded px-3 border border-error/30">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-error text-[18px]">gavel</span>
            <span className="font-data text-[10px] text-on-surface-variant uppercase tracking-wider">
              Corte total de emergencia
            </span>
          </div>
          <button
            onClick={handleScram}
            disabled={roomState?.phase === "GAME_OVER"}
            className="px-2.5 py-1 rounded bg-error-container text-on-error-container font-data text-xs font-bold uppercase hover:bg-error hover:text-on-error transition-colors border border-error cursor-pointer disabled:opacity-40"
          >
            [SCRAM]
          </button>
        </div>

        {/* Resultado de la ronda para esta mesa */}
        {roomState?.phase === "RESOLUTION" && resolution && myResult && (
          <div
            className={`rounded-lg p-3 border flex flex-col gap-2 ${
              resolution.outcome === "BLACKOUT"
                ? "bg-error-container/20 border-error/60"
                : "bg-primary/5 border-primary/50"
            }`}
          >
            <div className="flex items-center justify-between font-data text-xs">
              <span className={resolution.outcome === "BLACKOUT" ? "text-error font-bold" : "text-primary font-bold"}>
                RONDA {resolution.round}: {resolution.outcome === "BLACKOUT" ? "¡APAGÓN!" : "RED ESTABLE"}
              </span>
              <span className="text-on-surface-variant">
                {resolution.totalMW} MW / {resolution.totalGas} m3 vs {resolution.capacityMW} / {resolution.capacityGas}
              </span>
            </div>

            <div className="flex items-center justify-between font-data text-xs">
              <span className="text-on-surface-variant">TU BALANCE</span>
              <span className="flex gap-3">
                <span className={myResult.welfareDelta >= 0 ? "text-primary font-bold" : "text-error font-bold"}>
                  {myResult.welfareDelta >= 0 ? "+" : ""}
                  {myResult.welfareDelta} BIENESTAR
                </span>
                <span className={myResult.budgetDelta >= 0 ? "text-primary font-bold" : "text-error font-bold"}>
                  {myResult.budgetDelta >= 0 ? "+" : ""}
                  {myResult.budgetDelta.toLocaleString("es-CO")} $
                </span>
              </span>
            </div>

            <div className="flex flex-col gap-0.5 font-data text-[10px]">
              {myResult.lines.map((line, index) => (
                <span key={index} className={line.kind === "bonus" ? "text-primary" : "text-error"}>
                  • {line.text}
                </span>
              ))}
            </div>

            {resolution.blackoutCount >= MAX_BLACKOUTS && (
              <span className="font-headline text-error font-bold uppercase text-sm animate-pulse">
                Fallo regional irreversible // no hay ganadores
              </span>
            )}
          </div>
        )}
      </main>
    </CrtContainer>
  );
}