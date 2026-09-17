"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { RoomState, ClientMessage, ServerMessage } from "./types";
import { sound } from "./audio";

export interface UseSocketOptions {
  /**
   * PIN de la sala. Viaja en la propia URL del socket (`/ws?pin=…`) porque en
   * Cloudflare cada sala vive en su propio Durable Object: el router necesita
   * saber a cuál enrutar el upgrade. El servidor Node lo ignora.
   */
  pin?: string;
  onJoinSuccess?: (teamId: string, pin: string) => void;
  onJoinRejected?: (reason: string) => void;
  onSessionExpired?: () => void;
  onRoomNotFound?: (pin: string) => void;
  onAlert?: (message: string) => void;
  /** Se dispara en cada apertura de socket (incluidas las reconexiones). */
  onOpen?: () => void;
}

function normalizePin(pin?: string): string {
  return String(pin || "VOLT")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6) || "VOLT";
}

export function useSocket(options: UseSocketOptions = {}) {
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const queueRef = useRef<string[]>([]);
  const disposedRef = useRef(false);

  // PIN efectivo: se estabiliza con un pequeño retardo para no reconectar en
  // cada tecla que escribe la mesa.
  const requestedPin = normalizePin(options.pin);
  const [activePin, setActivePin] = useState(requestedPin);
  const activePinRef = useRef(activePin);

  useEffect(() => {
    activePinRef.current = activePin;
  }, [activePin]);

  useEffect(() => {
    if (requestedPin === activePin) return;
    const timeout = setTimeout(() => setActivePin(requestedPin), 350);
    return () => clearTimeout(timeout);
  }, [requestedPin, activePin]);

  // Callbacks vivos sin re-disparar el efecto de conexión.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const connect = useCallback(() => {
    if (typeof window === "undefined" || disposedRef.current) return;

    if (
      socketRef.current &&
      (socketRef.current.readyState === WebSocket.OPEN ||
        socketRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws?pin=${encodeURIComponent(activePinRef.current)}`;

    try {
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setErrorMsg(null);

        while (queueRef.current.length > 0) {
          const queued = queueRef.current.shift();
          if (queued && ws.readyState === WebSocket.OPEN) ws.send(queued);
        }

        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "PING" }));
          }
        }, 20000);

        optionsRef.current.onOpen?.();
      };

      ws.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case "SYNC_STATE":
            setRoomState(msg.state);
            break;
          case "JOIN_SUCCESS":
            optionsRef.current.onJoinSuccess?.(msg.teamId, msg.pin);
            break;
          case "JOIN_REJECTED":
            optionsRef.current.onJoinRejected?.(msg.reason);
            break;
          case "ROOM_NOT_FOUND":
            optionsRef.current.onRoomNotFound?.(msg.pin);
            break;
          case "SESSION_EXPIRED":
            optionsRef.current.onSessionExpired?.();
            break;
          case "ERROR":
            setErrorMsg(msg.message);
            break;
          case "ALERT":
            if (msg.message !== "PONG") optionsRef.current.onAlert?.(msg.message);
            break;
          default:
            break;
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        if (!disposedRef.current) {
          reconnectTimeoutRef.current = setTimeout(connect, 1500);
        }
      };

      ws.onerror = () => {
        // El cierre dispara la reconexión; aquí solo se avisa en consola.
        console.warn("Enlace WebSocket interrumpido; reintentando…");
      };
    } catch (err) {
      console.error("Fallo al inicializar WebSocket:", err);
    }
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    queueRef.current = []; // no arrastrar mensajes de la sala anterior
    connect();
    return () => {
      disposedRef.current = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [connect, activePin]);

  // Cuenta atrás local: el servidor solo publica la fecha límite de la fase
  // (nada de latidos por segundo desde el Worker/Durable Object).
  const deadlineTs = roomState?.deadlineTs ?? null;
  const [nowTs, setNowTs] = useState(() => Date.now());

  useEffect(() => {
    if (!deadlineTs) return;
    setNowTs(Date.now());
    // La cuenta atrás solo repinta lo necesario: 250 ms durante la fase con
    // reloj, y nada mientras la pestaña no está a la vista (el proyector suele
    // quedarse en segundo plano mientras el salón habla).
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setNowTs(Date.now());
    }, 250);
    return () => clearInterval(id);
  }, [deadlineTs]);

  const timeRemaining = deadlineTs
    ? Math.max(0, Math.ceil((deadlineTs - nowTs) / 1000))
    : roomState?.timeRemaining ?? 0;

  const send = useCallback((msg: ClientMessage) => {
    const raw = JSON.stringify(msg);
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(raw);
    } else {
      // Si el socket está negociando el handshake o reconectando, se reintenta.
      queueRef.current.push(raw);
      if (queueRef.current.length > 20) queueRef.current.shift();
    }
  }, []);

  return {
    roomState,
    isConnected,
    errorMsg,
    timeRemaining,
    send,
    clearError: () => setErrorMsg(null),
    reconnect: connect,
  };
}

/** Sonidos compartidos por el proyector y el mando según la fase. */
export function usePhaseSounds(roomState: RoomState | null) {
  const lastPhaseRef = useRef<string | null>(null);

  useEffect(() => {
    if (!roomState) return;
    const { phase, lastResolution } = roomState;

    if (phase === lastPhaseRef.current) {
      return;
    }
    lastPhaseRef.current = phase;

    if (phase === "CRISIS_ANNOUNCE") {
      sound.playAlarmKlaxon();
    } else if (phase === "CRISIS_ACTIVE") {
      sound.playWarningBeep(0.6);
    } else if (phase === "RESOLUTION" && lastResolution) {
      if (lastResolution.outcome === "BLACKOUT") sound.playBlackout();
      else sound.playStabilized();
    } else if (phase === "GAME_OVER") {
      sound.playBlackout();
    }
  }, [roomState]);
}

/**
 * Origen del servidor (URL LAN para los móviles). Empieza vacío para que el
 * HTML del servidor y el del cliente coincidan (evita errores de hidratación).
 */
export function useClientOrigin(): string {
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  return origin;
}
