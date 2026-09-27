/**
 * Procedural audio with the Web Audio API — no sound files needed.
 * Engine hum pitch follows speed, plus a boost roar, beeps and impacts.
 * Swap in Howler.js + real samples later for extra polish.
 */
export class AudioEngine {
  private ctx?: AudioContext;
  private master?: GainNode;
  private engineGain?: GainNode;
  private osc1?: OscillatorNode;
  private osc2?: OscillatorNode;
  private filter?: BiquadFilterNode;
  private boostGain?: GainNode;
  private noiseBuf?: AudioBuffer;
  muted = false;

  /** Must be called from a user gesture (e.g. the Start button). */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(ctx.destination);

    // Engine: two detuned saws through a low-pass filter.
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 400;
    this.filter.Q.value = 6;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.osc1.connect(this.filter);
    this.osc2.connect(this.filter);
    this.filter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.osc1.start();
    this.osc2.start();

    // White noise buffer for boost + impacts.
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.8;
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    noise.connect(bp);
    bp.connect(this.boostGain);
    this.boostGain.connect(this.master);
    noise.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  /** speed01: 0..1, thrust: 0..1 */
  update(speed01: number, thrust: number, boosting: boolean, active: boolean): void {
    if (!this.ctx || !this.osc1 || !this.osc2 || !this.filter || !this.engineGain || !this.boostGain) return;
    const t = this.ctx.currentTime;
    const f = 45 + speed01 * 110 + thrust * 18;
    this.osc1.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 0.502, t, 0.05);
    this.filter.frequency.setTargetAtTime(250 + speed01 * 1400 + thrust * 500, t, 0.08);
    this.engineGain.gain.setTargetAtTime(active ? 0.05 + thrust * 0.07 + speed01 * 0.05 : 0, t, 0.1);
    this.boostGain.gain.setTargetAtTime(active && boosting ? 0.22 : 0, t, 0.06);
  }

  beep(freq: number, dur = 0.15, type: OscillatorType = 'square', vol = 0.18): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  chime(): void {
    this.beep(880, 0.12, 'triangle', 0.15);
    setTimeout(() => this.beep(1320, 0.18, 'triangle', 0.12), 70);
  }

  fanfare(): void {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.beep(f, 0.3, 'triangle', 0.16), i * 120));
  }

  impact(strength: number): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300 + strength * 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.4);
  }
}
