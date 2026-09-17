// Web Audio API procedural sound synthesizer for CRT-Punk industrial effects
class SoundEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private humNode: OscillatorNode | null = null;
  private humGain: GainNode | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.isMuted && this.humGain) {
      this.humGain.gain.setValueAtTime(0, this.ctx?.currentTime || 0);
    }
    return this.isMuted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  // Heavy mechanical knife/rocker switch clack
  public playRelayClick(engage: boolean = true) {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = engage ? "triangle" : "sawtooth";
    osc.frequency.setValueAtTime(engage ? 180 : 120, t);
    osc.frequency.exponentialRampToValueAtTime(engage ? 30 : 20, t + 0.08);

    gain.gain.setValueAtTime(0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    const bufferSize = Math.floor(ctx.sampleRate * 0.04);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.4;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(1400, t);
    noiseFilter.Q.setValueAtTime(2, t);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.09);
    noise.start(t);
    noise.stop(t + 0.05);
  }

  // Warning pulse beep
  public playWarningBeep(urgency: number = 0.5) {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const baseFreq = 650 + urgency * 600;
    osc.type = "square";
    osc.frequency.setValueAtTime(baseFreq, t);

    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.14);
  }

  // Crisis siren / Klaxon
  public playAlarmKlaxon() {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.linearRampToValueAtTime(880, t + 0.35);
    osc.frequency.linearRampToValueAtTime(440, t + 0.7);

    gain.gain.setValueAtTime(0.25, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.75);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.8);
  }

  // CRT Degauss Coil Discharge: Authentic "BWUUUUOONGG-CLACK"
  public playDegauss() {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;

    // Resonant coil sweep
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.9);

    gain.gain.setValueAtTime(0.9, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.1);

    // Spring clack
    const clack = ctx.createOscillator();
    const clackGain = ctx.createGain();
    clack.type = "triangle";
    clack.frequency.setValueAtTime(80, t + 0.85);
    clack.frequency.exponentialRampToValueAtTime(20, t + 0.95);
    clackGain.gain.setValueAtTime(0.5, t + 0.85);
    clackGain.gain.exponentialRampToValueAtTime(0.01, t + 0.98);

    osc.connect(gain);
    gain.connect(ctx.destination);
    clack.connect(clackGain);
    clackGain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 1.2);
    clack.start(t + 0.85);
    clack.stop(t + 1.0);
  }

  // Blackout static & sub-bass blowout
  public playBlackout() {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;

    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(140, t);
    sub.frequency.exponentialRampToValueAtTime(25, t + 1.2);

    subGain.gain.setValueAtTime(0.8, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 1.4);

    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.start(t);
    sub.stop(t + 1.5);

    const bufferSize = Math.floor(ctx.sampleRate * 0.8);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.25));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2200, t);
    filter.frequency.exponentialRampToValueAtTime(100, t + 0.8);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.7, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    noise.start(t);
    noise.stop(t + 0.85);
  }

  // Grid stabilized harmonic chime
  public playStabilized() {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const freqs = [330, 440, 554.37, 659.25];

    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t + idx * 0.08);

      gain.gain.setValueAtTime(0.001, t + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.2, t + idx * 0.08 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.08 + 1.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t + idx * 0.08);
      osc.stop(t + idx * 0.08 + 1.3);
    });
  }

  // 60Hz electrical mains hum loop
  public startMainsHum() {
    if (this.isMuted || this.humNode) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const t = ctx.currentTime;
      this.humNode = ctx.createOscillator();
      this.humGain = ctx.createGain();

      this.humNode.type = "sawtooth";
      this.humNode.frequency.setValueAtTime(60, t);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(180, t);

      this.humGain.gain.setValueAtTime(0.02, t);

      this.humNode.connect(filter);
      filter.connect(this.humGain);
      this.humGain.connect(ctx.destination);

      this.humNode.start(t);
    } catch {}
  }

  public stopMainsHum() {
    if (this.humNode) {
      try {
        this.humNode.stop();
        this.humNode.disconnect();
      } catch {}
      this.humNode = null;
    }
  }
}

export const sound = new SoundEngine();
