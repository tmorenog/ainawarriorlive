// Fully procedural WebAudio soundscape: wind, leaves, rain, water, birds,
// insects, owls, thunder, fire, floodwater, footsteps and cat voices.
// Nothing is sampled — every sound is synthesised, so it's all original.
import * as THREE from 'three';

type Surface = string;

function noiseBuffer(ctx: AudioContext, seconds: number, type: 'white' | 'pink' | 'brown'): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (type === 'white') d[i] = w;
    else if (type === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  return buf;
}

interface Loop { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode }

export interface SoundEnv {
  wind: number; rain: number; night: number; forest: number; water: number; fire: number; flood: number;
  cave: number; season: string; snow: number; storm: number; inCamp: boolean; underwater: boolean;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private amb!: GainNode;
  private sfx!: GainNode;
  private muffle!: BiquadFilterNode;
  private reverb!: ConvolverNode;
  private reverbGain!: GainNode;
  private white!: AudioBuffer;
  private pink!: AudioBuffer;
  private brown!: AudioBuffer;
  private loops: Record<string, Loop> = {};
  private timers: Record<string, number> = { bird: 2, cricket: 0, owl: 20, distant: 30, frog: 5, cicada: 0 };
  private env: SoundEnv | null = null;
  volume = 0.8;
  ambVolume = 0.9;
  listener = new THREE.Vector3();
  private cricketOsc: OscillatorNode | null = null;
  private cricketGain: GainNode | null = null;

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 18000;
    this.muffle.connect(this.master);
    this.master.connect(ctx.destination);
    this.amb = ctx.createGain();
    this.amb.gain.value = this.ambVolume;
    this.amb.connect(this.muffle);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.muffle);
    // cave reverb
    this.reverb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, ctx.sampleRate * 2.2, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    }
    this.reverb.buffer = ir;
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0;
    this.sfx.connect(this.reverb);
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);

    this.white = noiseBuffer(ctx, 2, 'white');
    this.pink = noiseBuffer(ctx, 3, 'pink');
    this.brown = noiseBuffer(ctx, 3, 'brown');
    this.loops.wind = this.loop(this.pink, 'bandpass', 500, 0.6);
    this.loops.leaves = this.loop(this.white, 'highpass', 3500, 0.3);
    this.loops.rain = this.loop(this.white, 'lowpass', 6000, 0.2);
    this.loops.rainLow = this.loop(this.pink, 'lowpass', 900, 0.5);
    this.loops.water = this.loop(this.brown, 'lowpass', 700, 0.7);
    this.loops.waterHi = this.loop(this.pink, 'bandpass', 2200, 1.2);
    this.loops.fire = this.loop(this.brown, 'lowpass', 400, 0.7);
    this.loops.flood = this.loop(this.brown, 'lowpass', 1100, 0.5);
    this.loops.cave = this.loop(this.brown, 'lowpass', 150, 1);
    // crickets: amplitude-modulated sine
    const osc = ctx.createOscillator();
    osc.frequency.value = 4400;
    const am = ctx.createGain();
    am.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 28;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain);
    lfoGain.connect(am.gain);
    const cg = ctx.createGain();
    cg.gain.value = 0;
    osc.connect(am);
    am.connect(cg);
    cg.connect(this.amb);
    osc.start();
    lfo.start();
    this.cricketOsc = osc;
    this.cricketGain = cg;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private loop(buf: AudioBuffer, type: BiquadFilterType, freq: number, q: number): Loop {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = Math.random();
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.amb);
    src.start(0, Math.random() * buf.duration);
    return { src, filter, gain };
  }

  private set(l: Loop, v: number, t = 0.5) {
    const ctx = this.ctx!;
    l.gain.gain.setTargetAtTime(v, ctx.currentTime, t);
  }

  update(dt: number, env: SoundEnv, time: number) {
    if (!this.ctx) return;
    this.env = env;
    const L = this.loops;
    const gust = 0.6 + 0.4 * Math.sin(time * 0.35) * Math.sin(time * 0.13 + 1);
    const cave = env.cave;
    const outside = 1 - cave * 0.8;
    this.set(L.wind, (0.03 + env.wind * 0.16 * gust + env.storm * 0.08) * outside);
    L.wind.filter.frequency.setTargetAtTime(300 + env.wind * 500 * gust, this.ctx.currentTime, 0.3);
    this.set(L.leaves, env.forest * (0.01 + env.wind * 0.05 * gust) * (env.season === 'winter' ? 0.4 : 1) * outside);
    this.set(L.rain, env.rain * 0.09 * outside);
    this.set(L.rainLow, env.rain * 0.14 * outside);
    this.set(L.water, env.water * 0.2);
    this.set(L.waterHi, env.water * 0.05);
    this.set(L.fire, env.fire * 0.45);
    this.set(L.flood, env.flood * 0.35);
    this.set(L.cave, cave * 0.12);
    this.reverbGain.gain.setTargetAtTime(cave * 0.6, this.ctx.currentTime, 0.4);
    // snow and underwater muffle
    const muff = env.underwater ? 500 : env.snow > 0.3 ? 5000 : 18000;
    this.muffle.frequency.setTargetAtTime(muff, this.ctx.currentTime, 0.4);
    // crickets at night in warm seasons
    const warm = env.season === 'summer' ? 1 : env.season === 'spring' ? 0.6 : env.season === 'autumn' ? 0.4 : 0;
    if (this.cricketGain) this.cricketGain.gain.setTargetAtTime(env.night * warm * (1 - env.rain) * 0.012 * outside, this.ctx.currentTime, 1);
    if (this.cricketOsc) this.cricketOsc.frequency.setTargetAtTime(4200 + Math.sin(time * 0.2) * 300, this.ctx.currentTime, 0.5);

    // scheduled one-shots
    const T = this.timers;
    for (const k in T) T[k] -= dt;
    if (T.bird <= 0) {
      T.bird = 0.8 + Math.random() * (env.night > 0.5 ? 20 : 3.5);
      if (env.night < 0.6 && env.rain < 0.5 && env.season !== 'winter' || Math.random() < 0.2) this.birdSong(env.forest);
    }
    if (T.owl <= 0) {
      T.owl = 15 + Math.random() * 30;
      if (env.night > 0.6) this.owl();
    }
    if (T.distant <= 0) {
      T.distant = 25 + Math.random() * 50;
      if (env.night > 0.5 && Math.random() < 0.5) this.foxBark(0.03);
      else if (env.night < 0.5 && Math.random() < 0.5) this.crow();
    }
    if (T.frog <= 0) {
      T.frog = 0.5 + Math.random() * 2;
      if (env.water > 0.2 && env.season !== 'winter' && (env.night > 0.4 || Math.random() < 0.2)) this.frog(env.water);
    }
    if (T.cicada <= 0) {
      T.cicada = 6 + Math.random() * 10;
      if (env.season === 'summer' && env.night < 0.3 && env.forest < 0.6 && env.rain < 0.2) this.cicada();
    }
    if (env.fire > 0.1 && Math.random() < dt * 14 * env.fire) this.crackle(env.fire);
  }

  // ------------------------------------------------------------ synth helpers
  private env2(g: GainNode, t0: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', sweepTo?: number, dest?: AudioNode, when = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    const g = ctx.createGain();
    this.env2(g, t0, Math.min(0.02, dur / 3), vol, dur);
    o.connect(g);
    g.connect(dest ?? this.sfx);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private burst(dur: number, vol: number, type: BiquadFilterType, freq: number, q = 1, dest?: AudioNode, when = 0, buf?: AudioBuffer) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const s = ctx.createBufferSource();
    s.buffer = buf ?? this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env2(g, t0, Math.min(0.01, dur / 4), vol, dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest ?? this.sfx);
    const b = s.buffer!;
    s.loop = dur + 0.1 > b.duration;
    s.start(t0, Math.random() * Math.max(0, b.duration - dur - 0.1));
    s.stop(t0 + dur + 0.15);
  }

  private panner(pos?: THREE.Vector3): AudioNode {
    if (!this.ctx || !pos) return this.sfx;
    const p = this.ctx.createStereoPanner();
    const g = this.ctx.createGain();
    const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z;
    const d = Math.hypot(dx, dz);
    const yaw = this.listenerYaw;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    p.pan.value = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / Math.max(d, 1)));
    g.gain.value = 1 / (1 + d * 0.15);
    p.connect(g);
    g.connect(this.sfx);
    return p;
  }
  listenerYaw = 0;

  // ------------------------------------------------------------ ambience one-shots
  birdSong(forest: number) {
    if (!this.ctx) return;
    const pattern = Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 1800;
    const vol = 0.012 + forest * 0.015;
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    pan.connect(this.amb);
    const n = 2 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      const w = i * (pattern === 0 ? 0.09 : pattern === 1 ? 0.16 : 0.12);
      if (pattern === 2) this.tone(base * 1.2, 0.07, vol, 'sine', base * 0.8, pan, w);
      else if (pattern === 3) this.tone(base, 0.12, vol, 'triangle', base * 1.5, pan, w * 1.3);
      else this.tone(base + (i % 2) * 400, 0.06, vol, 'sine', base * 1.3, pan, w);
    }
  }
  owl() {
    if (!this.ctx) return;
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.amb);
    this.tone(420, 0.35, 0.03, 'sine', 380, pan, 0);
    this.tone(410, 0.6, 0.03, 'sine', 360, pan, 0.5);
  }
  foxBark(vol = 0.05) {
    this.tone(700, 0.12, vol, 'sawtooth', 380);
    this.tone(650, 0.12, vol, 'sawtooth', 360, undefined, 0.25);
  }
  crow() {
    if (!this.ctx) return;
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    pan.connect(this.amb);
    for (let i = 0; i < 3; i++) this.burst(0.18, 0.02, 'bandpass', 1100, 4, pan, i * 0.3);
  }
  frog(k: number) {
    this.tone(180 + Math.random() * 80, 0.09, 0.02 * k, 'square', 140);
  }
  cicada() {
    if (!this.ctx) return;
    this.burst(2.5, 0.006, 'bandpass', 6500, 8, this.amb);
  }
  crackle(k: number) {
    this.burst(0.03, 0.05 * k, 'highpass', 2500 + Math.random() * 3000, 1);
  }
  thunder(distance: number) {
    if (!this.ctx) return;
    const delay = distance * 2.5;
    this.burst(2.8 + distance, 0.5 * (1 - distance * 0.5), 'lowpass', 180 + (1 - distance) * 250, 0.7, undefined, delay, this.brown);
    this.burst(0.4, 0.25 * (1 - distance), 'lowpass', 900, 0.5, undefined, delay);
  }
  crash() {
    this.burst(1.5, 0.35, 'lowpass', 400, 0.8, undefined, 0, this.brown);
    for (let i = 0; i < 6; i++) this.burst(0.08, 0.12, 'bandpass', 900 + Math.random() * 800, 2, undefined, i * 0.05);
  }
  alarm() {
    // an urgent cat yowl
    this.meow(0.9, 1.5, 0.06);
  }

  // ------------------------------------------------------------ player & cats
  footstep(surface: Surface, intensity: number) {
    const v = 0.035 * intensity;
    switch (surface) {
      case 'leaves': this.burst(0.09, v * 1.4, 'highpass', 2500, 0.8); this.burst(0.06, v * 0.6, 'bandpass', 900, 1); break;
      case 'needles': this.burst(0.06, v, 'bandpass', 3000, 1.5); break;
      case 'grass': this.burst(0.08, v * 0.9, 'bandpass', 4000, 0.7); break;
      case 'rock': this.burst(0.03, v * 0.8, 'bandpass', 1800, 3); break;
      case 'mud': this.burst(0.08, v * 1.2, 'lowpass', 500, 2); break;
      case 'water': this.burst(0.14, v * 2, 'bandpass', 1200, 0.8); this.burst(0.1, v, 'highpass', 4000, 0.5, undefined, 0.03); break;
      case 'snow': this.burst(0.1, v * 1.2, 'bandpass', 700, 1.2); break;
      case 'road': this.burst(0.03, v * 0.6, 'bandpass', 2400, 2); break;
      default: this.burst(0.05, v * 0.7, 'lowpass', 1200, 1); break;
    }
  }
  jump() { this.burst(0.08, 0.02, 'bandpass', 1500, 1); }
  land() { this.burst(0.07, 0.04, 'lowpass', 600, 1); }
  pounce() { this.burst(0.25, 0.05, 'bandpass', 1400, 0.6); }
  swipe() { this.burst(0.12, 0.05, 'bandpass', 2600, 2); }
  hit(heavy: boolean) {
    this.burst(0.12, heavy ? 0.14 : 0.09, 'lowpass', 700, 1);
    this.burst(0.2, 0.05, 'highpass', 3000, 0.5);
  }
  hurt() { this.meow(0.8, 0.35, 0.05); }
  hiss() { this.burst(0.7, 0.07, 'highpass', 3500, 0.5); }
  growl(creature: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = creature ? 90 : 160;
    const am = ctx.createGain();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 26;
    const lg = ctx.createGain();
    lg.gain.value = 0.5;
    lfo.connect(lg); lg.connect(am.gain);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 600;
    const g = ctx.createGain();
    this.env2(g, t0, 0.05, 0.05, 0.8);
    o.connect(am); am.connect(f); f.connect(g); g.connect(this.sfx);
    o.start(t0); lfo.start(t0); o.stop(t0 + 0.9); lfo.stop(t0 + 0.9);
  }
  yelp() { this.tone(900, 0.25, 0.05, 'sawtooth', 1400); }
  bark(pos?: THREE.Vector3) {
    const dest = this.panner(pos);
    this.tone(320, 0.12, 0.12, 'sawtooth', 220, dest);
    this.burst(0.12, 0.08, 'bandpass', 700, 2, dest);
  }
  meow(pitch = 1, dur = 0.5, vol = 0.04, pos?: THREE.Vector3) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = 480 * pitch;
    o.frequency.setValueAtTime(f0 * 0.8, t0);
    o.frequency.linearRampToValueAtTime(f0 * 1.25, t0 + dur * 0.35);
    o.frequency.linearRampToValueAtTime(f0 * 0.7, t0 + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(700, t0);
    f.frequency.linearRampToValueAtTime(1600, t0 + dur * 0.4);
    f.frequency.linearRampToValueAtTime(800, t0 + dur);
    const g = ctx.createGain();
    this.env2(g, t0, 0.04, vol, dur);
    o.connect(f); f.connect(g); g.connect(this.panner(pos));
    o.start(t0); o.stop(t0 + dur + 0.1);
  }
  purr() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.brown;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 220;
    const am = ctx.createGain();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 24;
    const lg = ctx.createGain(); lg.gain.value = 0.6;
    lfo.connect(lg); lg.connect(am.gain);
    const g = ctx.createGain();
    this.env2(g, t0, 0.3, 0.22, 2.2);
    s.connect(f); f.connect(am); am.connect(g); g.connect(this.sfx);
    s.start(t0); lfo.start(t0); s.stop(t0 + 2.6); lfo.stop(t0 + 2.6);
  }
  sniff() {
    for (let i = 0; i < 3; i++) this.burst(0.06, 0.03, 'bandpass', 3200, 2, undefined, i * 0.12);
  }
  eat() { for (let i = 0; i < 4; i++) this.burst(0.05, 0.04, 'bandpass', 1200 + Math.random() * 600, 2, undefined, i * 0.15); }
  pick() { this.burst(0.08, 0.04, 'highpass', 3000, 1); }
  drop() { this.burst(0.1, 0.05, 'lowpass', 800, 1); }
  catchPrey() { this.tone(2600, 0.08, 0.04, 'sine', 3400); this.burst(0.1, 0.05, 'lowpass', 900, 1, undefined, 0.05); }
  preyAlarm(kind: string, pos?: THREE.Vector3) {
    const dest = this.panner(pos);
    if (kind === 'bird') { this.tone(3200, 0.05, 0.05, 'sine', 4200, dest); this.tone(3000, 0.05, 0.05, 'sine', 4000, dest, 0.08); }
    else if (kind === 'mouse' || kind === 'vole') this.tone(4200, 0.05, 0.02, 'sine', 5000, dest);
    else this.burst(0.15, 0.04, 'bandpass', 1800, 1, dest);
  }
  wingFlap() { for (let i = 0; i < 5; i++) this.burst(0.05, 0.05, 'bandpass', 900, 1.2, undefined, i * 0.07); }

  // ------------------------------------------------------------ UI
  chime() { this.tone(880, 0.35, 0.03, 'sine'); this.tone(1320, 0.4, 0.02, 'sine', undefined, undefined, 0.08); }
  success() { this.tone(660, 0.25, 0.03, 'triangle'); this.tone(990, 0.35, 0.03, 'triangle', undefined, undefined, 0.12); }
  click() { this.tone(1200, 0.05, 0.015, 'sine'); }
  toll() { this.tone(220, 2.5, 0.05, 'sine', 210); this.tone(330, 2.5, 0.03, 'sine', 320, undefined, 0.02); }
}
