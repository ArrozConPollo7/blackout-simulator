'use client';

/**
 * Motor de audio sintetizado del centro de control (estética SCADA / terminal CRT).
 *
 * Todo el sonido se genera con la Web Audio API —osciladores, ruido por buffer, filtros
 * y envolventes—: el repo no tiene ni un archivo de audio y el aula se proyecta con red
 * mala. Cero assets, cero descargas.
 *
 * Reglas que este módulo respeta:
 *  1. SSR: no se toca `window` ni `AudioContext` en el top-level. Todo va detrás de
 *     guardas y de la fachada `audio`.
 *  2. Autoplay: el `AudioContext` se crea en `unlock()`, dentro de un gesto del usuario.
 *     Antes de eso cualquier llamada es un no-op silencioso.
 *  3. Silencio por defecto: el sonido arranca APAGADO; el host lo enciende cuando quiere.
 *     La preferencia vive en `localStorage` con el prefijo del proyecto (`eec:`).
 *  4. Sin clipping: un `GainNode` maestro (con volumen de usuario) y un compresor de
 *     seguridad al final de la cadena; ninguna voz pasa de ~0.1 y las sumas se quedan
 *     por debajo de 0.25.
 */

import { useCallback, useEffect, useState } from 'react';

export type AudioEvent =
  | 'click'
  | 'confirm'
  | 'deny'
  | 'phase'
  | 'crisis'
  | 'resolve'
  | 'podium'
  | 'join'
  | 'timeLow'
  | 'telemetry';

export interface AudioPlayOptions {
  /** Multiplicador de amplitud de esta reproducción (1 = normal). */
  volume?: number;
  /** Multiplicador de altura (1 = normal, 2 = una octava arriba). */
  pitch?: number;
}

const STORAGE_KEY = 'eec:audio-habilitado';
/** Ganancia del bus maestro con el volumen a 1: deja aire para el compresor. */
const MASTER_CEILING = 0.9;
const DEFAULT_VOLUME = 0.7;
const MIN_FREQ = 20;
const FLOOR = 0.0001;

// ---------------------------------------------------------------------------
// Estado del módulo (perezoso: nada se crea hasta el primer gesto)
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

let enabled = false;
let preferenceRead = false;
let unlocked = false;
let volume = DEFAULT_VOLUME;

let ambientWanted = false;
let ambientLayer: Layer | null = null;
let crisisWanted = false;
let crisisLayer: Layer | null = null;

/** Capa continua (ambiente o crisis): su `output` sirve de fundido de entrada/salida. */
interface Layer {
  output: GainNode;
  dispose: () => void;
}

const enabledListeners = new Set<(enabled: boolean) => void>();

function notifyEnabled(): void {
  enabledListeners.forEach((listener) => listener(enabled));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function persist(next: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    /* almacenamiento bloqueado: la preferencia dura solo esta sesión */
  }
}

function readPreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function contextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  // `AudioContext` vive en el scope global, no como propiedad declarada de `Window`:
  // por eso el ensanchamiento explícito (Safari antiguo solo expone `webkitAudioContext`).
  const candidate = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return candidate.AudioContext ?? candidate.webkitAudioContext ?? null;
}

/** Crea el grafo (contexto + maestro + compresor) la primera vez que se puede. */
function ensureGraph(): { ctx: AudioContext; bus: GainNode } | null {
  if (ctx && master) return { ctx, bus: master };
  const Ctor = contextCtor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
    return null;
  }
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.knee.value = 8;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.24;

  master = ctx.createGain();
  master.gain.value = volume * MASTER_CEILING;
  master.connect(limiter);
  limiter.connect(ctx.destination);
  noise = null;
  return { ctx, bus: master };
}

/** Grafo listo para sonar: solo después de `unlock()` y de un gesto del usuario. */
function ready(): { ctx: AudioContext; bus: GainNode } | null {
  if (!unlocked || typeof window === 'undefined') return null;
  const graph = ensureGraph();
  if (!graph || graph.ctx.state === 'closed') return null;
  if (graph.ctx.state === 'suspended') void graph.ctx.resume().catch(() => undefined);
  return graph;
}

/** Ruido blanco cacheado por contexto: la materia prima de clics, aire y estática. */
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === c.sampleRate) return noise;
  const length = Math.floor(c.sampleRate * 2);
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  noise = buffer;
  return buffer;
}

function fadeOutLayer(layer: Layer, seconds: number): void {
  const c = ctx;
  if (!c || c.state === 'closed') {
    layer.dispose();
    return;
  }
  const now = c.currentTime;
  try {
    layer.output.gain.cancelScheduledValues(now);
    layer.output.gain.setValueAtTime(Math.max(FLOOR, layer.output.gain.value), now);
    layer.output.gain.exponentialRampToValueAtTime(FLOOR, now + seconds);
  } catch {
    layer.dispose();
    return;
  }
  setTimeout(() => layer.dispose(), seconds * 1000 + 120);
}

// ---------------------------------------------------------------------------
// Voces: tono con envolvente y filtro paso-bajo
// ---------------------------------------------------------------------------

interface ToneSpec {
  freq: number;
  freqEnd?: number;
  dur: number;
  gain: number;
  type?: OscillatorType;
  at?: number;
  attack?: number;
  cutoff?: number;
  cutoffEnd?: number;
  detune?: number;
  curve?: 'exp' | 'lin';
}

function tone(c: AudioContext, bus: AudioNode, spec: ToneSpec, scale: number, pitch: number): void {
  const t0 = c.currentTime + (spec.at ?? 0);
  const dur = Math.max(0.02, spec.dur);
  const peak = Math.max(FLOOR * 2, spec.gain * scale);
  const osc = c.createOscillator();
  osc.type = spec.type ?? 'triangle';
  osc.frequency.setValueAtTime(clamp(spec.freq * pitch, MIN_FREQ, 18000), t0);
  if (spec.freqEnd) {
    const end = clamp(spec.freqEnd * pitch, MIN_FREQ, 18000);
    if (spec.curve === 'lin') osc.frequency.linearRampToValueAtTime(end, t0 + dur);
    else osc.frequency.exponentialRampToValueAtTime(end, t0 + dur);
  }
  if (spec.detune) osc.detune.value = spec.detune;

  const env = c.createGain();
  const attack = Math.min(spec.attack ?? 0.004, dur * 0.5);
  env.gain.setValueAtTime(FLOOR, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + attack);
  env.gain.exponentialRampToValueAtTime(FLOOR, t0 + dur);

  let head: AudioNode = osc;
  if (spec.cutoff) {
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(clamp(spec.cutoff, 60, 18000), t0);
    if (spec.cutoffEnd) {
      filter.frequency.exponentialRampToValueAtTime(
        clamp(spec.cutoffEnd, 60, 18000),
        t0 + dur,
      );
    }
    filter.Q.value = 0.9;
    osc.connect(filter);
    head = filter;
  }
  head.connect(env);
  env.connect(bus);
  osc.start(t0);
  osc.stop(t0 + dur + 0.04);
}

interface BurstSpec {
  dur: number;
  gain: number;
  freq: number;
  freqEnd?: number;
  type?: BiquadFilterType;
  q?: number;
  at?: number;
  attack?: number;
}

/** Golpe de ruido filtrado: clics de tecla, chispa de relé, estática. */
function burst(c: AudioContext, bus: AudioNode, spec: BurstSpec, scale: number): void {
  const t0 = c.currentTime + (spec.at ?? 0);
  const dur = Math.max(0.01, spec.dur);
  const peak = Math.max(FLOOR * 2, spec.gain * scale);

  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;

  const filter = c.createBiquadFilter();
  filter.type = spec.type ?? 'bandpass';
  filter.frequency.setValueAtTime(clamp(spec.freq, 60, 18000), t0);
  if (spec.freqEnd) {
    filter.frequency.exponentialRampToValueAtTime(clamp(spec.freqEnd, 60, 18000), t0 + dur);
  }
  filter.Q.value = spec.q ?? 0.9;

  const env = c.createGain();
  const attack = Math.min(spec.attack ?? 0.002, dur * 0.5);
  env.gain.setValueAtTime(FLOOR, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + attack);
  env.gain.exponentialRampToValueAtTime(FLOOR, t0 + dur);

  src.connect(filter);
  filter.connect(env);
  env.connect(bus);
  src.start(t0);
  src.stop(t0 + dur + 0.04);
}

// ---------------------------------------------------------------------------
// Diseño sonoro de los eventos (pico por evento < 0.25, siempre filtrado)
// ---------------------------------------------------------------------------

type Voice = (c: AudioContext, bus: AudioNode, scale: number, pitch: number) => void;

const SOUNDS: Record<AudioEvent, Voice> = {
  /** Tecla seca: chispa de ruido agudo + tick cuadrado que se apaga. */
  click: (c, bus, s, p) => {
    burst(c, bus, { dur: 0.012, gain: 0.045, type: 'highpass', freq: 1900 }, s);
    tone(c, bus, { type: 'square', freq: 1480, dur: 0.035, gain: 0.05, cutoff: 4200, cutoffEnd: 1100 }, s, p);
  },

  /** Confirmación: dos tonos ascendentes (880 → 1320), limpios. */
  confirm: (c, bus, s, p) => {
    tone(c, bus, { type: 'triangle', freq: 660, dur: 0.12, gain: 0.075, cutoff: 2600 }, s, p);
    tone(
      c,
      bus,
      { type: 'triangle', freq: 990, dur: 0.18, gain: 0.065, cutoff: 3200, at: 0.085, attack: 0.006 },
      s,
      p,
    );
  },

  /** Denegación: zumbido corto descendente que se cierra a paso bajo. */
  deny: (c, bus, s, p) => {
    tone(
      c,
      bus,
      {
        type: 'sawtooth',
        freq: 188,
        freqEnd: 72,
        dur: 0.3,
        gain: 0.085,
        attack: 0.008,
        cutoff: 1300,
        cutoffEnd: 260,
      },
      s,
      p,
    );
    tone(c, bus, { type: 'sine', freq: 92, freqEnd: 46, dur: 0.26, gain: 0.05, attack: 0.006 }, s, p);
  },

  /** Cambio de fase: chasquido de relé + golpe mecánico grave. */
  phase: (c, bus, s, p) => {
    burst(c, bus, { dur: 0.03, gain: 0.08, type: 'bandpass', freq: 2300, q: 1.4 }, s);
    tone(c, bus, { type: 'sine', freq: 130, freqEnd: 58, dur: 0.16, gain: 0.085, attack: 0.003 }, s, p);
    tone(
      c,
      bus,
      { type: 'triangle', freq: 340, dur: 0.05, gain: 0.045, at: 0.055, cutoff: 2200 },
      s,
      p,
    );
  },

  /** Crisis: caída de tensión (glissando) + sirena de dos tonos + estática. */
  crisis: (c, bus, s, p) => {
    tone(
      c,
      bus,
      {
        type: 'sawtooth',
        freq: 430,
        freqEnd: 46,
        dur: 1.5,
        gain: 0.07,
        attack: 0.01,
        cutoff: 1500,
        cutoffEnd: 300,
      },
      s,
      p,
    );
    // Sirena: dos notas que caen, la segunda más lejos.
    tone(c, bus, { type: 'triangle', freq: 730, freqEnd: 570, dur: 0.42, gain: 0.05, attack: 0.02, cutoff: 1100 }, s, p);
    tone(
      c,
      bus,
      { type: 'triangle', freq: 730, freqEnd: 570, dur: 0.42, gain: 0.04, at: 0.46, attack: 0.02, cutoff: 900 },
      s,
      p,
    );
    burst(
      c,
      bus,
      { dur: 1.4, gain: 0.045, type: 'bandpass', freq: 1800, freqEnd: 700, q: 0.7, attack: 0.05 },
      s,
    );
  },

  /** Resolución: acorde mayor corto (E–G#–B) con entrada suave. */
  resolve: (c, bus, s, p) => {
    [329.63, 415.3, 493.88].forEach((freq, i) => {
      tone(
        c,
        bus,
        { type: 'triangle', freq, dur: 0.72, gain: 0.055, attack: 0.02, cutoff: 3200, at: i * 0.035, detune: i * 3 },
        s,
        p,
      );
    });
  },

  /** Podio: fanfarria corta ascendente y un brillo de ruido. */
  podium: (c, bus, s, p) => {
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      tone(
        c,
        bus,
        { type: 'triangle', freq, dur: 0.2, gain: 0.045, attack: 0.006, cutoff: 4200, at: i * 0.11 },
        s,
        p,
      );
    });
    tone(c, bus, { type: 'triangle', freq: 1046.5, dur: 0.5, gain: 0.05, attack: 0.006, cutoff: 5200, at: 0.33 }, s, p);
    tone(c, bus, { type: 'triangle', freq: 783.99, dur: 0.46, gain: 0.022, attack: 0.01, cutoff: 4200, at: 0.33 }, s, p);
    burst(c, bus, { dur: 0.5, gain: 0.016, type: 'highpass', freq: 4200, at: 0.32, attack: 0.02 }, s);
  },

  /** Nuevo equipo en red: dos blips cortos. */
  join: (c, bus, s, p) => {
    tone(c, bus, { type: 'square', freq: 880, dur: 0.05, gain: 0.05, cutoff: 2600 }, s, p);
    tone(c, bus, { type: 'square', freq: 1320, dur: 0.09, gain: 0.05, cutoff: 3200, at: 0.07 }, s, p);
    burst(c, bus, { dur: 0.02, gain: 0.03, type: 'highpass', freq: 3200 }, s);
  },

  /** Tiempo bajo: tic doble, seco, imposible de confundir con un click. */
  timeLow: (c, bus, s, p) => {
    [0, 0.17].forEach((at, i) => {
      tone(c, bus, { type: 'square', freq: 1250, dur: 0.03, gain: 0.05, cutoff: 3600, at }, s, p);
      tone(
        c,
        bus,
        { type: 'sine', freq: 320, dur: 0.06, gain: i === 0 ? 0.05 : 0.04, attack: 0.002, at },
        s,
        p,
      );
    });
  },

  /** Telemetría: blip de datos, casi un susurro (acompaña refrescos de estado). */
  telemetry: (c, bus, s, p) => {
    tone(c, bus, { type: 'sine', freq: 1750, freqEnd: 2400, dur: 0.06, gain: 0.03, cutoff: 5200 }, s, p);
    burst(c, bus, { dur: 0.03, gain: 0.014, type: 'bandpass', freq: 3000, q: 1.1 }, s);
  },
};

// ---------------------------------------------------------------------------
// Capas continuas: zumbido de subestación y crisis
// ---------------------------------------------------------------------------

const AMBIENT_GAIN = 0.8;
const CRISIS_GAIN = 1;

function buildAmbient(c: AudioContext, bus: GainNode): Layer {
  const now = c.currentTime;
  const output = c.createGain();
  output.gain.value = FLOOR;
  output.connect(bus);
  const stops: Array<() => void> = [];

  // Zumbido de red: 50 Hz y armónicos filtrados (subestación, no un tono musical).
  const humBus = c.createGain();
  humBus.gain.value = 0.45;
  const humFilter = c.createBiquadFilter();
  humFilter.type = 'lowpass';
  humFilter.frequency.value = 340;
  humFilter.Q.value = 0.7;
  humBus.connect(humFilter);
  humFilter.connect(output);
  [50, 100, 150].forEach((freq, i) => {
    const osc = c.createOscillator();
    osc.type = i === 0 ? 'sine' : 'triangle';
    osc.frequency.value = freq;
    const gain = c.createGain();
    gain.gain.value = i === 0 ? 0.055 : 0.018;
    osc.connect(gain);
    gain.connect(humBus);
    osc.start(now);
    stops.push(() => {
      try {
        osc.stop();
      } catch {
        /* ya detenido */
      }
      osc.disconnect();
      gain.disconnect();
    });
  });

  // Aire de ventilación: ruido filtrado, muy bajo.
  const air = c.createBufferSource();
  air.buffer = noiseBuffer(c);
  air.loop = true;
  const airFilter = c.createBiquadFilter();
  airFilter.type = 'bandpass';
  airFilter.frequency.value = 430;
  airFilter.Q.value = 0.5;
  const airGain = c.createGain();
  airGain.gain.value = 0.02;
  air.connect(airFilter);
  airFilter.connect(airGain);
  airGain.connect(output);
  air.start(now);
  stops.push(() => {
    try {
      air.stop();
    } catch {
      /* ya detenido */
    }
    air.disconnect();
    airFilter.disconnect();
    airGain.disconnect();
  });

  // Respiración lenta: el zumbido nunca es un tono muerto.
  const lfo = c.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.06;
  const lfoDepth = c.createGain();
  lfoDepth.gain.value = 0.22;
  lfo.connect(lfoDepth);
  lfoDepth.connect(humBus.gain);
  lfo.start(now);
  stops.push(() => {
    try {
      lfo.stop();
    } catch {
      /* ya detenido */
    }
    lfo.disconnect();
    lfoDepth.disconnect();
  });

  output.gain.exponentialRampToValueAtTime(AMBIENT_GAIN, now + 1.6);

  return {
    output,
    dispose: () => {
      stops.forEach((stop) => stop());
      humBus.disconnect();
      humFilter.disconnect();
      output.disconnect();
    },
  };
}

function buildCrisis(c: AudioContext, bus: GainNode): Layer {
  const now = c.currentTime;
  const output = c.createGain();
  output.gain.value = FLOOR;
  output.connect(bus);
  const stops: Array<() => void> = [];

  // Sirena lejana: ondulación lenta de 500–640 Hz, filtrada y atenuada.
  const siren = c.createOscillator();
  siren.type = 'triangle';
  siren.frequency.value = 570;
  const sirenLfo = c.createOscillator();
  sirenLfo.type = 'triangle';
  sirenLfo.frequency.value = 0.55;
  const sirenDepth = c.createGain();
  sirenDepth.gain.value = 70;
  sirenLfo.connect(sirenDepth);
  sirenDepth.connect(siren.frequency);
  const sirenFilter = c.createBiquadFilter();
  sirenFilter.type = 'lowpass';
  sirenFilter.frequency.value = 950;
  const sirenGain = c.createGain();
  sirenGain.gain.value = 0.05;
  siren.connect(sirenFilter);
  sirenFilter.connect(sirenGain);
  sirenGain.connect(output);
  siren.start(now);
  sirenLfo.start(now);
  stops.push(() => {
    [siren, sirenLfo].forEach((node) => {
      try {
        node.stop();
      } catch {
        /* ya detenido */
      }
      node.disconnect();
    });
    sirenDepth.disconnect();
    sirenFilter.disconnect();
    sirenGain.disconnect();
  });

  // Tensión: drone grave con el filtro abriéndose poco a poco.
  const tension = c.createOscillator();
  tension.type = 'sawtooth';
  tension.frequency.value = 58;
  const tensionFilter = c.createBiquadFilter();
  tensionFilter.type = 'lowpass';
  tensionFilter.frequency.setValueAtTime(180, now);
  tensionFilter.frequency.linearRampToValueAtTime(430, now + 24);
  tensionFilter.Q.value = 1.1;
  const tensionGain = c.createGain();
  tensionGain.gain.value = 0.035;
  tension.connect(tensionFilter);
  tensionFilter.connect(tensionGain);
  tensionGain.connect(output);
  tension.start(now);
  stops.push(() => {
    try {
      tension.stop();
    } catch {
      /* ya detenido */
    }
    tension.disconnect();
    tensionFilter.disconnect();
    tensionGain.disconnect();
  });

  // Estática de línea degradada, con trémolo lento.
  const stat = c.createBufferSource();
  stat.buffer = noiseBuffer(c);
  stat.loop = true;
  const statFilter = c.createBiquadFilter();
  statFilter.type = 'bandpass';
  statFilter.frequency.value = 1500;
  statFilter.Q.value = 0.6;
  const statGain = c.createGain();
  statGain.gain.value = 0.018;
  const tremolo = c.createOscillator();
  tremolo.type = 'sine';
  tremolo.frequency.value = 0.35;
  const tremoloDepth = c.createGain();
  tremoloDepth.gain.value = 0.012;
  tremolo.connect(tremoloDepth);
  tremoloDepth.connect(statGain.gain);
  stat.connect(statFilter);
  statFilter.connect(statGain);
  statGain.connect(output);
  stat.start(now);
  tremolo.start(now);
  stops.push(() => {
    [stat, tremolo].forEach((node) => {
      try {
        node.stop();
      } catch {
        /* ya detenido */
      }
      node.disconnect();
    });
    statFilter.disconnect();
    statGain.disconnect();
    tremoloDepth.disconnect();
  });

  output.gain.exponentialRampToValueAtTime(CRISIS_GAIN, now + 1.4);

  return {
    output,
    dispose: () => {
      stops.forEach((stop) => stop());
      output.disconnect();
    },
  };
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/** Sube o baja el bus maestro sin cortes (encender/apagar el sonido de golpe chasquea). */
function rampMaster(target: number, seconds: number): void {
  if (!master || !ctx || ctx.state === 'closed') return;
  const now = ctx.currentTime;
  try {
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(FLOOR, master.gain.value), now);
    master.gain.exponentialRampToValueAtTime(Math.max(FLOOR, target), now + seconds);
  } catch {
    master.gain.value = Math.max(FLOOR, target);
  }
}

function isEnabled(): boolean {
  if (!preferenceRead) {
    preferenceRead = true;
    enabled = readPreference();
  }
  return enabled;
}

function setEnabled(next: boolean): void {
  const value = Boolean(next);
  const changed = value !== enabled;
  enabled = value;
  persist(value);

  if (value) {
    if (unlocked) {
      rampMaster(volume * MASTER_CEILING, 0.2);
      const graph = ready();
      if (graph && ambientWanted) startAmbient();
      if (graph && crisisWanted) startCrisis();
    }
  } else {
    rampMaster(FLOOR, 0.12);
    teardownAmbient();
    teardownCrisis();
  }

  if (changed) notifyEnabled();
}

/**
 * Debe llamarse DENTRO de un gesto del usuario (click): aquí y solo aquí se crea el
 * `AudioContext`, que sin gesto quedaría suspendido por la política de autoplay.
 */
function unlock(): void {
  if (typeof window === 'undefined') return;
  unlocked = true;
  const graph = ensureGraph();
  if (!graph) return;
  if (graph.ctx.state === 'suspended') void graph.ctx.resume().catch(() => undefined);
  if (!isEnabled()) return;
  if (ambientWanted) startAmbient();
  if (crisisWanted) startCrisis();
}

function play(event: AudioEvent, options?: AudioPlayOptions): void {
  if (!isEnabled() || !event) return;
  const graph = ready();
  if (!graph) return;
  const voice = SOUNDS[event];
  if (!voice) return;
  const scale = clamp(options?.volume ?? 1, 0, 3);
  const pitch = clamp(options?.pitch ?? 1, 0.25, 4);
  try {
    voice(graph.ctx, graph.bus, scale, pitch);
  } catch {
    /* un fallo de audio nunca debe romper la partida */
  }
}

/** Zumbido de subestación continuo. Idempotente. */
function startAmbient(): void {
  ambientWanted = true;
  if (!isEnabled() || !unlocked) return;
  if (ambientLayer) return;
  const graph = ensureGraph();
  if (!graph || graph.ctx.state === 'closed') return;
  ambientLayer = buildAmbient(graph.ctx, graph.bus);
}

function teardownAmbient(): void {
  const layer = ambientLayer;
  ambientLayer = null;
  if (layer) fadeOutLayer(layer, 0.5);
}

function stopAmbient(): void {
  ambientWanted = false;
  teardownAmbient();
}

/** En crisis el ambiente sube de tensión y aparece una sirena lejana. Idempotente. */
function setCrisis(active: boolean): void {
  crisisWanted = Boolean(active);
  if (!crisisWanted) {
    teardownCrisis();
    return;
  }
  if (!isEnabled() || !unlocked) return;
  if (crisisLayer) return;
  const graph = ensureGraph();
  if (!graph || graph.ctx.state === 'closed') return;
  crisisLayer = buildCrisis(graph.ctx, graph.bus);
}

function startCrisis(): void {
  if (!isEnabled() || !unlocked || crisisLayer) return;
  const graph = ensureGraph();
  if (!graph || graph.ctx.state === 'closed') return;
  crisisLayer = buildCrisis(graph.ctx, graph.bus);
}

function teardownCrisis(): void {
  const layer = crisisLayer;
  crisisLayer = null;
  if (layer) fadeOutLayer(layer, 0.9);
}

function setVolume(v: number): void {
  volume = clamp(v, 0, 1);
  if (!master || !ctx || ctx.state === 'closed') return;
  try {
    master.gain.setTargetAtTime(volume * MASTER_CEILING, ctx.currentTime, 0.05);
  } catch {
    master.gain.value = volume * MASTER_CEILING;
  }
}

export const audio = {
  isEnabled,
  setEnabled,
  unlock,
  play,
  startAmbient,
  stopAmbient,
  setCrisis,
  setVolume,
};

/** Estado del sonido, sincronizado con el módulo (varias instancias del botón). */
export function useSoundEnabled(): [boolean, (enabled: boolean) => void] {
  const [isOn, setIsOn] = useState(false);

  useEffect(() => {
    setIsOn(audio.isEnabled());
    enabledListeners.add(setIsOn);
    return () => {
      enabledListeners.delete(setIsOn);
    };
  }, []);

  // Si el host dejó el sonido encendido, el primer gesto de la página desbloquea el
  // AudioContext sin que tenga que volver a pulsar el botón.
  useEffect(() => {
    if (!isOn) return;
    const handler = () => audio.unlock();
    document.addEventListener('pointerdown', handler, { once: true, capture: true });
    document.addEventListener('keydown', handler, { once: true, capture: true });
    return () => {
      document.removeEventListener('pointerdown', handler, { capture: true });
      document.removeEventListener('keydown', handler, { capture: true });
    };
  }, [isOn]);

  const update = useCallback((next: boolean) => {
    audio.setEnabled(next);
  }, []);

  return [isOn, update];
}

/** Reproductor de eventos: no-op cuando el sonido está apagado. */
export function useAudioEvent(): (event: AudioEvent, options?: AudioPlayOptions) => void {
  return useCallback((event: AudioEvent, options?: AudioPlayOptions) => {
    audio.play(event, options);
  }, []);
}

export default audio;
