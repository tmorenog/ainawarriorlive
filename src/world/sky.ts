// Sky dome with gradient, sun, moon, stars and procedural clouds; drives the
// scene lighting and fog through the day/night cycle.
import * as THREE from 'three';
import { clamp, lerp } from '../core/math';

type Key = [number, string, string, string, number]; // hour, top, horizon, light colour, light intensity
const KEYS: Key[] = [
  [0, '#070b1c', '#18203a', '#6f86c8', 0.28],
  [4.5, '#0d1430', '#2a2c4a', '#7a8cc8', 0.25],
  [5.8, '#2b3a6e', '#b87a7a', '#ffb07a', 0.5],
  [7, '#4d7fc0', '#f4b98a', '#ffd2a0', 1.2],
  [9.5, '#4a8ad8', '#bcd9ec', '#fff0d8', 1.55],
  [13, '#3f86d8', '#cfe4f0', '#fff6e8', 1.65],
  [16.5, '#4a84cc', '#e8dcc0', '#ffe6c0', 1.55],
  [18.8, '#3d5c9c', '#ffae70', '#ffb070', 1.4],
  [20, '#27315f', '#d8705a', '#ff8a60', 0.7],
  [21.2, '#0f1633', '#35304e', '#7080c0', 0.3],
  [24, '#070b1c', '#18203a', '#6f86c8', 0.28],
];

const skyVert = `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor;
uniform vec3 uMoonDir; uniform float uNight; uniform float uCloud; uniform float uTime; uniform float uStorm;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0.0; float a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5;} return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.65, h), 0.65));
  col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.3, h));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 900.0) * 6.0 + pow(sd, 14.0) * 0.28 + pow(sd, 3.0) * 0.08) * (1.0 - uCloud * 0.7);
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.85, 0.9, 1.0) * (smoothstep(0.99955, 0.9998, md) * 1.2 + pow(md, 60.0) * 0.12) * uNight * (1.0 - uCloud * 0.8);
  // stars
  if (h > 0.0) {
    vec2 sp = d.xz / (h + 0.25) * 90.0;
    float st = hash(floor(sp));
    float tw = 0.6 + 0.4 * sin(uTime * 3.0 + st * 40.0);
    col += vec3(step(0.9965, st) * tw) * uNight * smoothstep(0.0, 0.25, h) * (1.0 - uCloud);
  }
  // clouds
  if (h > -0.05) {
    vec2 cp = d.xz / (h + 0.18) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
    float c = fbm(cp);
    float cov = mix(0.62, 0.28, uCloud);
    float amt = smoothstep(cov, cov + 0.25, c) * smoothstep(-0.05, 0.2, h);
    vec3 lit = mix(vec3(1.0, 0.97, 0.92), uSunColor, 0.35) * mix(1.0, 0.25, uNight);
    vec3 shade = mix(uHorizon, vec3(0.45, 0.47, 0.52), 0.5) * mix(1.0, 0.3, uNight);
    vec3 cc = mix(shade, lit, smoothstep(0.4, 0.9, c) * 0.8 + pow(sd, 4.0) * 0.4);
    cc = mix(cc, vec3(0.28, 0.3, 0.34) * mix(1.0, 0.35, uNight), uStorm);
    col = mix(col, cc, amt * 0.92);
    col = mix(col, cc * 0.9, uCloud * uCloud * 0.55 * smoothstep(-0.05, 0.3, h));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  mesh: THREE.Mesh;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uNight: { value: 0 },
    uCloud: { value: 0.2 },
    uTime: { value: 0 },
    uStorm: { value: 0 },
  };
  fogColor = new THREE.Color();
  sunDir = new THREE.Vector3();
  lightning = 0;

  constructor(private scene: THREE.Scene) {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    const mat = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4028, 0.9);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.12);
    scene.add(this.ambient);
    scene.fog = new THREE.FogExp2(0x9fb8c8, 0.006);
  }

  setShadowQuality(size: number, enabled: boolean) {
    this.sun.castShadow = enabled;
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      (this.sun.shadow as any).map = null;
    }
    this.sun.shadow.mapSize.set(size, size);
  }

  update(hour: number, time: number, cam: THREE.Vector3, w: { cloud: number; fog: number; rain: number; storm: number; snow: number }, inCave: number) {
    // interpolate keys
    let i = 0;
    while (i < KEYS.length - 1 && KEYS[i + 1][0] <= hour) i++;
    const a = KEYS[i], b = KEYS[Math.min(i + 1, KEYS.length - 1)];
    const t = b[0] === a[0] ? 0 : (hour - a[0]) / (b[0] - a[0]);
    const top = new THREE.Color(a[1]).lerp(new THREE.Color(b[2 - 1]), t);
    const hor = new THREE.Color(a[2]).lerp(new THREE.Color(b[2]), t);
    const lc = new THREE.Color(a[3]).lerp(new THREE.Color(b[3]), t);
    let li = lerp(a[4], b[4], t);

    const grey = new THREE.Color(0x8a939c);
    const cloudy = clamp(w.cloud, 0, 1);
    const night = clamp(1 - li / 1.2, 0, 1);
    grey.multiplyScalar(lerp(1, 0.22, night));
    top.lerp(grey, cloudy * 0.75);
    hor.lerp(grey.clone().multiplyScalar(1.1), cloudy * 0.6);
    li *= 1 - cloudy * 0.55;

    // lightning flash
    if (this.lightning > 0) {
      const f = this.lightning;
      top.lerp(new THREE.Color(0xdde6ff), f * 0.8);
      hor.lerp(new THREE.Color(0xdde6ff), f * 0.8);
      li += f * 3;
      this.lightning = Math.max(0, this.lightning - 0.06);
    }

    const sunAng = ((hour - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(sunAng) * 0.85, Math.sin(sunAng), 0.38).normalize();
    const moonDir = this.sunDir.clone().multiplyScalar(-1);
    moonDir.y = Math.abs(moonDir.y) * 0.8 + 0.15;
    moonDir.normalize();
    this.uniforms.uTop.value.copy(top);
    this.uniforms.uHorizon.value.copy(hor);
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uSunColor.value.copy(lc);
    this.uniforms.uMoonDir.value.copy(moonDir);
    this.uniforms.uNight.value = night;
    this.uniforms.uCloud.value = cloudy;
    this.uniforms.uTime.value = time;
    this.uniforms.uStorm.value = w.storm;
    this.mesh.position.copy(cam);

    const lightDir = this.sunDir.y > 0.05 ? this.sunDir : moonDir;
    this.sun.position.copy(cam).addScaledVector(lightDir, 120);
    this.sun.target.position.copy(cam);
    this.sun.color.copy(lc);
    const caveDim = 1 - inCave * 0.85;
    this.sun.intensity = li * caveDim * (this.sunDir.y > 0.05 ? smoothIn(this.sunDir.y) : 0.55);
    this.hemi.color.copy(top).lerp(new THREE.Color(0xffffff), 0.35);
    this.hemi.groundColor.set(0x3d3522).lerp(new THREE.Color(0x0a0c14), night);
    this.hemi.intensity = lerp(0.8, 0.35, night) * caveDim + 0.05;
    this.ambient.intensity = lerp(0.12, 0.22, night) * caveDim;

    this.fogColor.copy(hor).lerp(top, 0.25);
    if (inCave > 0) this.fogColor.lerp(new THREE.Color(0x05060a), inCave);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(this.fogColor);
    fog.density = 0.0048 + w.fog * 0.045 + w.rain * 0.009 + w.snow * 0.012 + inCave * 0.06;
  }
}

function smoothIn(y: number) {
  return clamp(y * 4, 0, 1);
}
