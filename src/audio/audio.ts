/**
 * Everything you hear is synthesised at runtime — no audio files, so the whole
 * game stays a sub-megabyte download and starts instantly over a phone network.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private sfxGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private started = false;
  private musicTimer = 0;
  private step = 0;
  musicOn = true;
  sfxOn = true;

  /** Must be called from inside a user gesture — iOS will not start audio
   *  otherwise, and silently. */
  unlock(): void {
    if (this.started) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.30;
    this.musicGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);

    const len = this.ctx.sampleRate * 0.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.started = true;
    void this.ctx.resume();
  }

  resume(): void { void this.ctx?.resume(); }

  private now(): number { return this.ctx!.currentTime; }

  private tone(
    freq: number, dur: number, type: OscillatorType, gain: number,
    slideTo?: number, dest?: GainNode,
  ): void {
    if (!this.ctx || !this.sfxOn) return;
    const t = this.now();
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest ?? this.sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, cutoff: number, sweepTo?: number): void {
    if (!this.ctx || !this.sfxOn) return;
    const t = this.now();
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfxGain);
    s.start(t); s.stop(t + dur);
  }

  // ------------------------------------------------------------------ sfx ---
  shot(kind: string, near: number): void {
    if (near < 0.05) return;
    const v = 0.10 * near;
    switch (kind) {
      case 'BEAM':    this.tone(880, 0.09, 'sawtooth', v, 220); break;
      case 'SHELL':   this.noise(0.14, v * 1.6, 1400, 300); this.tone(150, 0.12, 'square', v); break;
      case 'MISSILE': this.tone(320, 0.22, 'sawtooth', v * 0.9, 900); break;
      default:        this.tone(640, 0.05, 'square', v * 0.8, 380); break;
    }
  }

  explode(big: boolean, near: number): void {
    if (near < 0.05) return;
    this.noise(big ? 0.5 : 0.18, (big ? 0.34 : 0.15) * near, big ? 1100 : 2200, big ? 70 : 400);
    if (big) this.tone(90, 0.35, 'sine', 0.16 * near, 34);
  }

  pickup(): void { this.tone(420, 0.09, 'triangle', 0.13, 780); }
  drop(): void { this.tone(600, 0.10, 'triangle', 0.13, 260); }
  build(): void { this.tone(300, 0.07, 'square', 0.10, 520); }
  denied(): void { this.tone(150, 0.14, 'sawtooth', 0.10, 90); }

  capture(mine: boolean): void {
    const base = mine ? 392 : 262;
    [0, 4, 7].forEach((semi, i) => {
      setTimeout(() => this.tone(base * Math.pow(2, semi / 12), 0.28, 'triangle', 0.10), i * 70);
    });
  }

  fanfare(win: boolean): void {
    const seq = win ? [392, 494, 587, 784] : [392, 330, 262, 196];
    seq.forEach((f, i) => setTimeout(() => this.tone(f, 0.45, 'triangle', 0.14), i * 160));
  }

  // ---------------------------------------------------------------- music ---
  /** A four-bar loop that tightens as the match gets late — a slow, martial
   *  ostinato under the whole game rather than a melody you get sick of. */
  tickMusic(dtMs: number, intensity: number): void {
    if (!this.ctx || !this.musicOn || !this.started) return;
    const bpm = 96 + intensity * 26;
    const stepMs = 60000 / bpm / 2;
    this.musicTimer += dtMs;
    while (this.musicTimer >= stepMs) {
      this.musicTimer -= stepMs;
      this.playStep(this.step++, intensity);
    }
  }

  private playStep(i: number, intensity: number): void {
    const bar = Math.floor(i / 16) % 4;
    const s = i % 16;
    const roots = [55, 55, 73.42, 65.41];   // A1 A1 D2 C2
    const root = roots[bar];

    if (s % 4 === 0) this.tone(root, 0.34, 'sawtooth', 0.10, root * 0.99, this.musicGain);
    if (s === 6 || s === 12) this.tone(root * 1.5, 0.16, 'square', 0.045, undefined, this.musicGain);

    if (intensity > 0.25 && s % 2 === 0) {
      const scale = [0, 3, 5, 7, 10];
      const semi = scale[(i * 3) % scale.length];
      this.tone(root * 4 * Math.pow(2, semi / 12), 0.09, 'triangle', 0.028, undefined, this.musicGain);
    }
    if (s % 8 === 0) this.kick();
    if (intensity > 0.5 && (s === 4 || s === 12)) this.snare();
  }

  private kick(): void {
    if (!this.ctx) return;
    const t = this.now();
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + 0.2);
  }

  private snare(): void {
    if (!this.ctx) return;
    const t = this.now();
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 1600;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    s.connect(f); f.connect(g); g.connect(this.musicGain);
    s.start(t); s.stop(t + 0.12);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.musicGain) this.musicGain.gain.value = on ? 0.30 : 0;
  }
}
