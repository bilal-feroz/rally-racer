import { clamp, smoothstep } from '../core/math';
import { loadSettings, saveSettings } from '../game/Storage';
import type { VehicleSim } from '../vehicle/VehicleSim';
import { SURF_GRASS } from '../world/TerrainField';

/**
 * Engine model: a 4-cylinder firing-pulse synthesiser running in an AudioWorklet. Every
 * combustion event emits a short decaying exhaust pulse (with per-cylinder variation); the
 * pulse train is shaped by load (throttle) and then coloured by resonant filters on the main
 * thread graph. Everything is generated — no audio files.
 */
export const ENGINE_WORKLET = /* js */ `
class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 900, minValue: 300, maxValue: 10000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'crackle', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.phase = 0;
    this.rpm = 900;
    this.load = 0;
    this.cylVar = [1.0, 0.86, 0.95, 0.9];
    this.cyl = 0;
    this.env = 0;
    this.lp = 0;
    this.seed = 12345;
    this.pop = 0;
  }
  rand() { this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff; return this.seed / 0x7fffffff; }
  process(inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const targetRpm = params.rpm[0];
    const targetLoad = params.load[0];
    const crackle = params.crackle[0];
    for (let i = 0; i < out.length; i++) {
      this.rpm += (targetRpm - this.rpm) * 0.0015;
      this.load += (targetLoad - this.load) * 0.002;
      const fireHz = this.rpm / 30; // 4-cyl 4-stroke
      this.phase += fireHz / sampleRate;
      if (this.phase >= 1) {
        this.phase -= 1;
        this.cyl = (this.cyl + 1) & 3;
        const misfire = this.load < 0.1 && this.rand() < 0.06 ? 0.3 : 1;
        this.env = this.cylVar[this.cyl] * (0.45 + 0.75 * this.load) * misfire * (0.9 + this.rand() * 0.2);
        if (crackle > 0 && this.rand() < crackle * 0.25) this.pop = 0.9 + this.rand() * 0.6;
      }
      // pulse shape: sharp attack, decay faster under load (brighter)
      const k = 5.5 + 5 * this.load;
      const p = this.phase;
      const pulse = this.env * Math.exp(-p * k) * (1 - Math.exp(-p * 60));
      const noise = (this.rand() * 2 - 1) * (0.07 + 0.17 * this.load) * Math.exp(-p * 4);
      let s = pulse + noise * this.env;
      // pop / crackle on overrun
      if (this.pop > 0.001) {
        s += (this.rand() * 2 - 1) * this.pop;
        this.pop *= 0.992;
      }
      // DC blocking-ish leaky integrator removal
      this.lp += (s - this.lp) * 0.004;
      out[i] = (s - this.lp) * 0.9;
    }
    return true;
  }
}
registerProcessor('engine-processor', EngineProcessor);
`;

export interface EngineVoice {
  node: AudioWorkletNode | null;
  fallback: OscillatorNode[];
  filter: BiquadFilterNode;
  gain: GainNode;
}

/** Builds the engine synth (worklet pulse train + exhaust colouring). Shared by game and tests. */
export async function createEngineVoice(ctx: BaseAudioContext): Promise<EngineVoice> {
  const gain = ctx.createGain();
  gain.gain.value = 0.0;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1800;
  filter.Q.value = 0.8;
  const body = ctx.createBiquadFilter();
  body.type = 'peaking';
  body.frequency.value = 140;
  body.Q.value = 1.2;
  body.gain.value = 7;
  const rasp = ctx.createBiquadFilter();
  rasp.type = 'peaking';
  rasp.frequency.value = 900;
  rasp.Q.value = 2;
  rasp.gain.value = 4;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 35;
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 1023) * 2 - 1;
    curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2);
  }
  shaper.curve = curve;
  let node: AudioWorkletNode | null = null;
  const fallback: OscillatorNode[] = [];
  try {
    const url = URL.createObjectURL(new Blob([ENGINE_WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    node = new AudioWorkletNode(ctx, 'engine-processor', { numberOfInputs: 0, outputChannelCount: [1] });
    node.connect(hp);
  } catch {
    // fallback: two detuned oscillators
    for (const type of ['sawtooth', 'square'] as OscillatorType[]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 30;
      const g = ctx.createGain();
      g.gain.value = type === 'square' ? 0.15 : 0.25;
      o.connect(g).connect(hp);
      o.start();
      fallback.push(o);
    }
  }
  hp.connect(body).connect(rasp).connect(shaper).connect(filter).connect(gain);
  return { node, fallback, filter, gain };
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineGain!: GainNode;
  private engineNode: AudioWorkletNode | null = null;
  private engineFilter!: BiquadFilterNode;
  private gravelGain!: GainNode;
  private gravelFilter!: BiquadFilterNode;
  private scrubGain!: GainNode;
  private scrubFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private ready = false;
  muted = false;
  private paused = false;
  private readonly volume: number;
  private engineFallback: OscillatorNode[] = [];

  constructor(private readonly disabled: boolean) {
    const s = loadSettings();
    this.muted = s.muted;
    this.volume = s.volume;
  }

  /** Must be called from a user gesture. */
  resume(): void {
    if (this.disabled) return;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      void this.build();
    }
    void this.ctx.resume();
    this.paused = false;
    this.applyMaster();
  }

  private async build(): Promise<void> {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // noise buffer shared by surface sounds
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b = 0.97 * b + 0.03 * w; // slightly pink
      d[i] = w * 0.6 + b * 2.2;
    }

    // engine chain
    const voice = await createEngineVoice(ctx);
    this.engineNode = voice.node;
    this.engineFallback = voice.fallback;
    this.engineFilter = voice.filter;
    this.engineGain = voice.gain;
    this.engineGain.connect(this.master);

    // gravel rumble
    const gsrc = ctx.createBufferSource();
    gsrc.buffer = this.noiseBuf;
    gsrc.loop = true;
    this.gravelFilter = ctx.createBiquadFilter();
    this.gravelFilter.type = 'bandpass';
    this.gravelFilter.frequency.value = 400;
    this.gravelFilter.Q.value = 0.7;
    this.gravelGain = ctx.createGain();
    this.gravelGain.gain.value = 0;
    gsrc.connect(this.gravelFilter).connect(this.gravelGain).connect(this.master);
    gsrc.start();

    // scrub / slide hiss
    const ssrc = ctx.createBufferSource();
    ssrc.buffer = this.noiseBuf;
    ssrc.loop = true;
    ssrc.playbackRate.value = 1.3;
    this.scrubFilter = ctx.createBiquadFilter();
    this.scrubFilter.type = 'bandpass';
    this.scrubFilter.frequency.value = 1500;
    this.scrubFilter.Q.value = 0.9;
    this.scrubGain = ctx.createGain();
    this.scrubGain.gain.value = 0;
    ssrc.connect(this.scrubFilter).connect(this.scrubGain).connect(this.master);
    ssrc.start();

    // wind
    const wsrc = ctx.createBufferSource();
    wsrc.buffer = this.noiseBuf;
    wsrc.loop = true;
    wsrc.playbackRate.value = 0.7;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 700;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wsrc.connect(wf).connect(this.windGain).connect(this.master);
    wsrc.start();

    // turbo spool: a faint sine whistle whose pitch follows boost (rpm x load)
    this.turboOsc = ctx.createOscillator();
    this.turboOsc.type = 'sine';
    this.turboOsc.frequency.value = 1800;
    const tf = ctx.createBiquadFilter();
    tf.type = 'bandpass';
    tf.frequency.value = 3000;
    tf.Q.value = 0.8;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turboOsc.connect(tf).connect(this.turboGain).connect(this.master);
    this.turboOsc.start();

    this.ready = true;
    this.applyMaster();
  }

  private applyMaster(): void {
    if (!this.ctx || !this.ready) return;
    const v = this.muted || this.paused ? 0 : this.volume;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    saveSettings({ ...loadSettings(), muted: this.muted, volume: this.volume });
    this.applyMaster();
    return this.muted;
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.applyMaster();
  }

  update(dt: number, sim: VehicleSim, state: string): void {
    if (!this.ctx || !this.ready) return;
    const t = this.ctx.currentTime;
    const active = state !== 'title' && state !== 'paused';
    const rpm = sim.rpm;
    const load = clamp(sim.throttleEff, 0, 1) * (sim.shiftTimer > 0 ? 0.2 : 1);
    if (this.engineNode) {
      this.engineNode.parameters.get('rpm')!.setTargetAtTime(rpm, t, 0.015);
      this.engineNode.parameters.get('load')!.setTargetAtTime(load, t, 0.03);
      this.engineNode.parameters.get('crackle')!.setTargetAtTime(sim.backfire > 0.1 ? 0.8 : load < 0.05 && rpm > 4500 ? 0.12 : 0, t, 0.02);
    } else {
      for (const o of this.engineFallback) o.frequency.setTargetAtTime(rpm / 30, t, 0.02);
    }
    this.engineFilter.frequency.setTargetAtTime(900 + rpm * 0.42 + load * 1800, t, 0.05);
    this.engineGain.gain.setTargetAtTime(active ? 0.42 + load * 0.25 : 0.0, t, 0.08);

    // surfaces
    let slide = 0;
    let dirt = 0;
    let grass = 0;
    let contacts = 0;
    for (const w of sim.wheels) {
      if (!w.contact) continue;
      contacts++;
      slide = Math.max(slide, w.slide);
      if (w.surface === SURF_GRASS) grass++;
      else dirt++;
    }
    const sp = sim.speed;
    const roll = contacts > 0 ? smoothstep(1, 30, sp) : 0;
    this.gravelGain.gain.setTargetAtTime(active ? roll * (dirt * 0.07 + grass * 0.045) : 0, t, 0.05);
    this.gravelFilter.frequency.setTargetAtTime(220 + sp * 9, t, 0.1);
    this.scrubGain.gain.setTargetAtTime(active ? smoothstep(0.15, 0.8, slide) * smoothstep(2, 14, sp) * 0.32 : 0, t, 0.04);
    this.scrubFilter.frequency.setTargetAtTime(900 + sp * 18, t, 0.1);
    this.windGain.gain.setTargetAtTime(active ? smoothstep(15, 60, sp) * 0.18 : 0, t, 0.2);

    // turbo: boost builds with rpm under load; lifting at boost vents a short "pssh"
    const boostTarget = load * smoothstep(3000, 6500, rpm);
    this.boost += (boostTarget - this.boost) * Math.min(1, dt * (boostTarget > this.boost ? 2.5 : 8));
    this.turboOsc.frequency.setTargetAtTime(1600 + this.boost * 3600, t, 0.05);
    this.turboGain.gain.setTargetAtTime(active ? this.boost * 0.022 : 0, t, 0.05);
    if (active && this.lastLoad > 0.6 && load < 0.15 && this.boost > 0.45) this.blowOff(this.boost);
    this.lastLoad = load;

    if (sim.landingImpact > 0.25 && !this.landingLatch) {
      this.landingLatch = true;
      this.thud(sim.landingImpact);
    } else if (sim.landingImpact < 0.1) this.landingLatch = false;
    if (sim.collisionImpact > 0.3 && !this.hitLatch) {
      this.hitLatch = true;
      this.thud(sim.collisionImpact * 1.2);
    } else if (sim.collisionImpact < 0.1) this.hitLatch = false;
    void dt;
  }

  private landingLatch = false;
  private turboOsc!: OscillatorNode;
  private turboGain!: GainNode;
  private boost = 0;
  private lastLoad = 0;

  /** Blow-off valve vent: a short band-passed noise burst. */
  private blowOff(strength: number): void {
    if (!this.ctx || !this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(1400, t + 0.3);
    f.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1 * strength, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random());
    n.stop(t + 0.35);
  }
  private hitLatch = false;

  thud(strength: number): void {
    if (!this.ctx || !this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7 * clamp(strength, 0.1, 1), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.4);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.35 * strength, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    n.connect(f).connect(ng).connect(this.master);
    n.start(t, Math.random());
    n.stop(t + 0.3);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0): void {
    if (!this.ctx || !this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  beep(go: boolean): void {
    this.tone(go ? 1320 : 660, go ? 0.45 : 0.18, 'square', 0.12);
  }

  checkpoint(): void {
    this.tone(988, 0.09, 'triangle', 0.18);
    this.tone(1480, 0.14, 'triangle', 0.16, 0.07);
  }

  finish(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.16, i * 0.09));
    this.tone(1568, 0.8, 'sine', 0.1, 0.36);
  }
}
