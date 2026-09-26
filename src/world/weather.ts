// Dynamic weather: a Markov chain of weather states that blends continuous
// parameters (cloud, rain, fog, wind, snow) and renders precipitation.
import * as THREE from 'three';
import { damp } from '../core/math';
import { simRng } from '../core/rng';
import { Season } from './worldState';

export type WeatherKind = 'sunny' | 'cloudy' | 'rain' | 'heavyRain' | 'thunderstorm' | 'fog' | 'windy' | 'snow';

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  sunny: 'Clear skies',
  cloudy: 'Cloudy',
  rain: 'Rain',
  heavyRain: 'Heavy rain',
  thunderstorm: 'Thunderstorm',
  fog: 'Fog',
  windy: 'Strong wind',
  snow: 'Snow',
};
export const WEATHER_ICON: Record<WeatherKind, string> = {
  sunny: '☀️', cloudy: '☁️', rain: '🌦️', heavyRain: '🌧️', thunderstorm: '⛈️', fog: '🌫️', windy: '🍃', snow: '❄️',
};

interface Params { cloud: number; rain: number; fog: number; wind: number; snow: number; storm: number }
const TARGETS: Record<WeatherKind, Params> = {
  sunny: { cloud: 0.1, rain: 0, fog: 0, wind: 0.25, snow: 0, storm: 0 },
  cloudy: { cloud: 0.6, rain: 0, fog: 0.05, wind: 0.4, snow: 0, storm: 0 },
  rain: { cloud: 0.8, rain: 0.5, fog: 0.12, wind: 0.5, snow: 0, storm: 0.2 },
  heavyRain: { cloud: 0.95, rain: 1, fog: 0.2, wind: 0.75, snow: 0, storm: 0.5 },
  thunderstorm: { cloud: 1, rain: 1, fog: 0.15, wind: 1, snow: 0, storm: 1 },
  fog: { cloud: 0.5, rain: 0, fog: 0.75, wind: 0.05, snow: 0, storm: 0 },
  windy: { cloud: 0.45, rain: 0, fog: 0, wind: 1, snow: 0, storm: 0 },
  snow: { cloud: 0.85, rain: 0, fog: 0.25, wind: 0.45, snow: 1, storm: 0.1 },
};

const SEASON_WEIGHTS: Record<Season, [WeatherKind, number][]> = {
  spring: [['sunny', 4], ['cloudy', 3], ['rain', 3], ['heavyRain', 1], ['thunderstorm', 0.6], ['fog', 1.5], ['windy', 1]],
  summer: [['sunny', 7], ['cloudy', 2], ['rain', 1], ['thunderstorm', 1.2], ['fog', 0.3], ['windy', 1]],
  autumn: [['sunny', 3], ['cloudy', 4], ['rain', 3], ['heavyRain', 1.5], ['thunderstorm', 0.5], ['fog', 2.5], ['windy', 2.5]],
  winter: [['sunny', 2.5], ['cloudy', 4], ['snow', 4], ['fog', 1.5], ['windy', 1.5], ['rain', 0.7]],
};

export class Weather {
  kind: WeatherKind = 'sunny';
  forced: WeatherKind | null = null;
  p: Params = { ...TARGETS.sunny };
  temperature = 15;
  snowCover = 0;
  wetness = 0;
  private hoursLeft = 6;
  private rain: THREE.LineSegments;
  private snow: THREE.Points;
  private rainU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmt: { value: 0 }, uWind: { value: 0 } };
  private snowU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmt: { value: 0 }, uWind: { value: 0 } };
  onLightning: ((distance: number) => void) | null = null;
  private lightningTimer = 5;

  constructor(scene: THREE.Scene) {
    const N = 4000;
    const rp = new Float32Array(N * 2 * 3);
    const rs = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      for (let k = 0; k < 2; k++) {
        rp.set([x, y, z], (i * 2 + k) * 3);
        rs[i * 2 + k] = k;
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(rs, 1));
    this.rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
      uniforms: this.rainU,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float aEnd; uniform float uTime; uniform vec3 uCam; uniform float uAmt; uniform float uWind;
        varying float vA;
        void main(){
          vec3 box = vec3(36.0, 18.0, 36.0);
          vec3 p = position * box;
          p.y = mod(p.y - uTime * 16.0, box.y);
          p.x = mod(p.x + uWind * p.y * 0.3 - uCam.x, box.x);
          p.z = mod(p.z - uCam.z, box.z);
          vec3 w = vec3(uCam.x + p.x - box.x * 0.5, uCam.y + p.y - box.y * 0.35, uCam.z + p.z - box.z * 0.5);
          w.y += aEnd * 0.45; w.x += aEnd * uWind * 0.12;
          vA = step(position.x * 0.999, uAmt) * 0.45;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: `varying float vA; void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(0.75, 0.8, 0.9, vA); }`,
    }));
    this.rain.frustumCulled = false;
    scene.add(this.rain);

    const SN = 2500;
    const sp = new Float32Array(SN * 3);
    for (let i = 0; i < SN * 3; i++) sp[i] = Math.random();
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snow = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: this.snowU,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        uniform float uTime; uniform vec3 uCam; uniform float uAmt; uniform float uWind; varying float vA;
        void main(){
          vec3 box = vec3(30.0, 14.0, 30.0);
          vec3 p = position * box;
          float t = uTime * 1.3;
          p.y = mod(p.y - t, box.y);
          p.x = mod(p.x + sin(t + position.z * 30.0) * 0.8 + uWind * t * 1.5 - uCam.x, box.x);
          p.z = mod(p.z + cos(t * 0.7 + position.x * 20.0) * 0.8 - uCam.z, box.z);
          vec3 w = vec3(uCam.x + p.x - box.x * 0.5, uCam.y + p.y - box.y * 0.35, uCam.z + p.z - box.z * 0.5);
          vA = step(position.x, uAmt);
          vec4 mv = viewMatrix * vec4(w, 1.0);
          gl_PointSize = 60.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA; void main(){ if (vA < 0.01) discard; vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; gl_FragColor = vec4(1.0, 1.0, 1.0, (1.0 - d * 2.0) * 0.9); }`,
    }));
    this.snow.frustumCulled = false;
    scene.add(this.snow);
  }

  /** Force a weather state (from events); pass null to release. */
  force(kind: WeatherKind | null, hours = 8) {
    this.forced = kind;
    if (kind) {
      this.kind = kind;
      this.hoursLeft = hours;
    }
  }

  /** Called every game hour. */
  tickHour(season: Season, droughtActive: boolean, coldSnap: boolean) {
    this.hoursLeft -= 1;
    if (this.hoursLeft <= 0) {
      if (this.forced) this.forced = null;
      let weights = SEASON_WEIGHTS[season].slice();
      if (droughtActive) weights = [['sunny', 8], ['windy', 2], ['cloudy', 1]];
      if (coldSnap) weights = [['snow', 6], ['cloudy', 2], ['windy', 2], ['fog', 1]];
      // continuity: favour staying similar
      weights = weights.map(([k, w]) => [k, k === this.kind ? w * 1.5 : w]);
      this.kind = simRng.weighted(weights);
      this.hoursLeft = simRng.range(3, 10);
    }
    const baseTemp = { spring: 12, summer: 22, autumn: 10, winter: -1 }[season];
    this.temperature = baseTemp - this.p.rain * 4 - this.p.snow * 3 - this.p.wind * 2 + (droughtActive ? 8 : 0) - (coldSnap ? 9 : 0);
  }

  update(dt: number, time: number, cam: THREE.Vector3, gameDtHours: number) {
    const t = TARGETS[this.kind];
    const k = 0.25;
    this.p.cloud = damp(this.p.cloud, t.cloud, k, dt);
    this.p.rain = damp(this.p.rain, t.rain, k * 1.5, dt);
    this.p.fog = damp(this.p.fog, t.fog, k, dt);
    this.p.wind = damp(this.p.wind, t.wind, k, dt);
    this.p.snow = damp(this.p.snow, t.snow, k, dt);
    this.p.storm = damp(this.p.storm, t.storm, k, dt);
    // accumulate ground snow and wetness in game-time
    const snowRate = this.p.snow > 0.3 ? 0.08 : this.temperature > 3 ? -0.06 : -0.01;
    this.snowCover = Math.min(1, Math.max(0, this.snowCover + snowRate * gameDtHours));
    const wetRate = this.p.rain > 0.2 ? 0.3 * this.p.rain : -0.08;
    this.wetness = Math.min(1, Math.max(0, this.wetness + wetRate * gameDtHours));

    this.rainU.uTime.value = time;
    this.rainU.uCam.value.copy(cam);
    this.rainU.uAmt.value = this.p.rain;
    this.rainU.uWind.value = this.p.wind;
    this.snowU.uTime.value = time;
    this.snowU.uCam.value.copy(cam);
    this.snowU.uAmt.value = this.p.snow;
    this.snowU.uWind.value = this.p.wind;
    this.rain.visible = this.p.rain > 0.02;
    this.snow.visible = this.p.snow > 0.02;

    if (this.p.storm > 0.6) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 4 + Math.random() * 14;
        this.onLightning?.(Math.random());
      }
    }
  }

  /** How far prey can smell/hear the player is scaled by this. */
  get stealthModifier() {
    return 1 - this.p.rain * 0.35 - this.p.wind * 0.15 - this.p.fog * 0.1;
  }
  /** Visibility factor for NPCs and prey. */
  get visibility() {
    return 1 - this.p.fog * 0.6 - this.p.rain * 0.25 - this.p.snow * 0.3;
  }
}
