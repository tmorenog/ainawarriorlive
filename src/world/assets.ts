// Shared stylized geometries and materials for vegetation, rocks and props.
// Vertex colours carry baked shading (painterly gradients); per-instance
// colours carry hue so thousands of plants can share one draw call.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Simplex2 } from '../core/noise';

export const sharedUniforms = {
  uTime: { value: 0 },
  uWind: { value: 0.4 },
  uPlayer: { value: new THREE.Vector3() },
  uSnow: { value: 0 },
  uWet: { value: 0 },
};

const noise = new Simplex2(1234);

type ColorFn = (x: number, y: number, z: number) => [number, number, number];

/** Convert to non-indexed geometry with only position/normal/color attributes. */
export function prep(geo: THREE.BufferGeometry, color: ColorFn | [number, number, number]): THREE.BufferGeometry {
  let g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = typeof color === 'function' ? color(pos.getX(i), pos.getY(i), pos.getZ(i)) : color;
    cols[i * 3] = c[0];
    cols[i * 3 + 1] = c[1];
    cols[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

function displace(geo: THREE.BufferGeometry, amount: number, freq: number, seed = 0) {
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = noise.noise(x * freq + seed, z * freq + y * freq * 0.7 - seed);
    const l = Math.hypot(x, y, z) || 1;
    const k = 1 + n * amount;
    pos.setXYZ(i, x * k, y * (1 + n * amount * 0.6), z * k);
    void l;
  }
  geo.computeVertexNormals();
  return geo;
}

/** Soft, rounded shading: blend face normals toward the radial direction. */
function radialNormals(geo: THREE.BufferGeometry, keep: number) {
  geo.computeVertexNormals();
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const l = Math.hypot(x, y, z) || 1;
    let nx = x / l * (1 - keep) + nrm.getX(i) * keep;
    let ny = y / l * (1 - keep) + nrm.getY(i) * keep + 0.15;
    let nz = z / l * (1 - keep) + nrm.getZ(i) * keep;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nrm.setXYZ(i, nx / nl, ny / nl, nz / nl);
  }
}

const shade = (lo: number, hi: number, y0: number, y1: number): ColorFn => (_x, y) => {
  const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
  const v = lo + (hi - lo) * t;
  return [v, v, v];
};

// ---------------------------------------------------------------- geometries

function makeTrunk(h: number, r0: number, r1: number, seg = 7): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 3);
  g.translate(0, h / 2, 0);
  return g;
}

export function deciduousCanopyGeo(detail = 2): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const all: [number, number, number, number][] = [
    [0, 0, 0, 1],
    [0.55, -0.15, 0.2, 0.72],
    [-0.5, -0.1, -0.25, 0.75],
    [0.1, 0.45, -0.1, 0.7],
    [-0.2, -0.2, 0.55, 0.62],
  ];
  const blobs = detail >= 2 ? all : all.slice(0, 4);
  blobs.forEach(([x, y, z, r], i) => {
    const s = new THREE.IcosahedronGeometry(r, detail);
    displace(s, 0.16, 2.2, i * 7);
    radialNormals(s, 0.35);
    s.translate(x, y, z);
    parts.push(prep(s, (px, py, pz) => {
      const v = 0.55 + 0.45 * Math.min(1, Math.max(0, (py + 0.9) / 1.8));
      const n = noise.noise(px * 3, pz * 3 + py) * 0.08;
      return [v + n, v + n, v + n];
    }));
  });
  return mergeGeometries(parts)!;
}

export function trunkGeo(): THREE.BufferGeometry {
  const g = makeTrunk(1, 0.13, 0.08, 7);
  // a couple of branch stubs
  const b1 = new THREE.CylinderGeometry(0.02, 0.04, 0.35, 5);
  b1.rotateZ(0.9);
  b1.translate(0.12, 0.72, 0);
  const b2 = new THREE.CylinderGeometry(0.02, 0.035, 0.3, 5);
  b2.rotateX(-0.9);
  b2.translate(0, 0.62, 0.1);
  return mergeGeometries([
    prep(g, shade(0.45, 1.0, 0, 1)),
    prep(b1, [0.9, 0.9, 0.9]),
    prep(b2, [0.85, 0.85, 0.85]),
  ])!;
}

export function pineGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const r = 0.42 * (1 - t * 0.72);
    const h = 0.34 - t * 0.05;
    const c = new THREE.ConeGeometry(r, h, 9, 2);
    displace(c, 0.08, 6, i * 3);
    c.translate(0, 0.25 + t * 0.62 + h / 2, 0);
    parts.push(prep(c, (x, y, z) => {
      const rr = Math.hypot(x, z) / r;
      const v = 0.5 + rr * 0.25 + t * 0.25 + noise.noise(x * 20, z * 20) * 0.06;
      return [v, v, v];
    }));
  }
  const trunk = makeTrunk(0.4, 0.035, 0.025, 6);
  parts.push(prep(trunk, [0.35, 0.26, 0.18]));
  return mergeGeometries(parts)!;
}

export function bushGeo(detail = 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const blobs: [number, number, number, number][] = [
    [0, 0.35, 0, 0.5], [0.35, 0.25, 0.1, 0.36], [-0.3, 0.28, -0.1, 0.38], [0.05, 0.3, 0.35, 0.33],
  ];
  blobs.forEach(([x, y, z, r], i) => {
    const s = new THREE.IcosahedronGeometry(r, detail);
    displace(s, 0.18, 4, i * 11);
    radialNormals(s, 0.4);
    s.translate(x, y, z);
    parts.push(prep(s, (_px, py) => {
      const v = 0.5 + 0.5 * Math.min(1, Math.max(0, py / 0.8));
      return [v, v, v];
    }));
  });
  return mergeGeometries(parts)!;
}

function bladeTri(parts: THREE.BufferGeometry[], angle: number, lean: number, h: number, w: number, ox: number, oz: number, base: number, tip: number) {
  const g = new THREE.BufferGeometry();
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const lx = Math.cos(angle + Math.PI / 2) * lean, lz = Math.sin(angle + Math.PI / 2) * lean;
  const verts = new Float32Array([
    ox - ca * w, 0, oz - sa * w,
    ox + ca * w, 0, oz + sa * w,
    ox + lx, h, oz + lz,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array([base, base, base, base, base, base, tip, tip, tip]), 3));
  parts.push(g);
}

export function grassTuftGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + i;
    bladeTri(parts, a, 0.1 + (i % 3) * 0.08, 0.7 + (i % 4) * 0.12, 0.035, Math.cos(a * 1.7) * 0.07, Math.sin(a * 1.3) * 0.07, 0.35, 1.05);
  }
  return mergeGeometries(parts)!;
}

export function fernGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const fronds = 7;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    // frond as a chain of leaflets along an arch
    for (let s = 0; s < 6; s++) {
      const t = s / 6;
      const r = 0.1 + t * 0.55;
      const y = 0.08 + Math.sin(t * Math.PI * 0.8) * 0.3;
      const w = 0.09 * (1 - t * 0.6);
      const g = new THREE.BufferGeometry();
      const px = ca * r, pz = sa * r;
      const nx = -sa * w, nz = ca * w;
      const v = new Float32Array([
        px - nx, y, pz - nz,
        px + ca * 0.1, y + 0.02, pz + sa * 0.1,
        px + nx, y, pz + nz,
      ]);
      g.setAttribute('position', new THREE.BufferAttribute(v, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
      const c = 0.6 + t * 0.4;
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array([c, c, c, c * 1.05, c * 1.05, c * 1.05, c, c, c]), 3));
      parts.push(g);
    }
  }
  return mergeGeometries(parts)!;
}

export function flowerGeo(): THREE.BufferGeometry {
  const stem = new THREE.CylinderGeometry(0.006, 0.008, 0.22, 3);
  stem.translate(0, 0.11, 0);
  const head = new THREE.IcosahedronGeometry(0.035, 0);
  head.scale(1, 0.5, 1);
  head.translate(0, 0.23, 0);
  return mergeGeometries([prep(stem, [0.35, 0.55, 0.25]), prep(head, [1, 1, 1])])!;
}

export function rockGeo(seed: number): THREE.BufferGeometry {
  const g = new THREE.DodecahedronGeometry(0.5, 1);
  displace(g, 0.28, 1.6, seed);
  g.scale(1, 0.62, 1);
  g.translate(0, 0.12, 0);
  return prep(g, (x, y, z) => {
    const v = 0.62 + y * 0.5 + noise.noise(x * 5 + seed, z * 5) * 0.08;
    // mossy tops
    const moss = y > 0.25 ? 0.15 : 0;
    return [v - moss, v + moss * 0.3, v - moss];
  });
}

export function reedGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 2.4;
    const h = 0.9 + (i % 3) * 0.3;
    const c = new THREE.CylinderGeometry(0.008, 0.014, h, 3);
    c.translate(Math.cos(a) * 0.08, h / 2, Math.sin(a) * 0.08);
    parts.push(prep(c, shade(0.5, 1, 0, h)));
    if (i % 2 === 0) {
      const top = new THREE.CylinderGeometry(0.022, 0.022, 0.12, 5);
      top.translate(Math.cos(a) * 0.08, h - 0.06, Math.sin(a) * 0.08);
      parts.push(prep(top, [0.45, 0.3, 0.18]));
    }
  }
  return mergeGeometries(parts)!;
}

export function mushroomGeo(): THREE.BufferGeometry {
  const stem = new THREE.CylinderGeometry(0.012, 0.016, 0.06, 5);
  stem.translate(0, 0.03, 0);
  const cap = new THREE.SphereGeometry(0.035, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.translate(0, 0.055, 0);
  return mergeGeometries([prep(stem, [0.95, 0.92, 0.85]), prep(cap, [1, 1, 1])])!;
}

export function logGeo(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.5, 0.55, 1, 9, 4);
  displace(g, 0.06, 3, 5);
  g.rotateZ(Math.PI / 2);
  return prep(g, (x, y, z) => {
    const v = 0.55 + y * 0.35 + noise.noise(x * 6, z * 6) * 0.08;
    const moss = y > 0.3 ? 0.12 : 0;
    return [v * 0.62 - moss, v * 0.5 + moss, v * 0.36];
  });
}

export function deadTreeGeo(): THREE.BufferGeometry {
  const trunk = makeTrunk(1, 0.12, 0.05, 6);
  const parts = [prep(trunk, shade(0.5, 0.9, 0, 1))];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.CylinderGeometry(0.012, 0.03, 0.35, 4);
    b.rotateZ(0.8 + i * 0.2);
    b.rotateY(i * 1.7);
    b.translate(Math.cos(i * 1.7) * 0.1, 0.55 + i * 0.1, -Math.sin(i * 1.7) * 0.1);
    parts.push(prep(b, [0.8, 0.8, 0.8]));
  }
  return mergeGeometries(parts)!;
}

export function herbGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const l = new THREE.SphereGeometry(0.06, 5, 3);
    l.scale(1, 0.25, 0.5);
    l.rotateY(-a);
    l.translate(Math.cos(a) * 0.07, 0.05, Math.sin(a) * 0.07);
    parts.push(prep(l, [0.55, 0.8, 0.5]));
  }
  const bloom = new THREE.IcosahedronGeometry(0.04, 0);
  bloom.translate(0, 0.14, 0);
  parts.push(prep(bloom, [1, 1, 1]));
  const stem = new THREE.CylinderGeometry(0.005, 0.006, 0.12, 3);
  stem.translate(0, 0.07, 0);
  parts.push(prep(stem, [0.4, 0.6, 0.3]));
  return mergeGeometries(parts)!;
}

export function deathberryGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const blobs: [number, number, number, number][] = [[0, 0.22, 0, 0.26], [0.18, 0.16, 0.08, 0.18], [-0.16, 0.17, -0.06, 0.2]];
  blobs.forEach(([x, y, z, r], i) => {
    const s = new THREE.IcosahedronGeometry(r, 1);
    displace(s, 0.2, 5, i * 5);
    radialNormals(s, 0.4);
    s.translate(x, y, z);
    parts.push(prep(s, (_px, py) => { const v = 0.55 + py; return [0.13 * v, 0.3 * v, 0.14 * v]; }));
  });
  // clusters of glossy red berries
  for (let i = 0; i < 16; i++) {
    const a = i * 2.39, h = 0.12 + (i % 5) * 0.06, r = 0.2 + (i % 3) * 0.04;
    const b = new THREE.SphereGeometry(0.022, 6, 5);
    b.translate(Math.cos(a) * r, h, Math.sin(a) * r);
    parts.push(prep(b, [1.4, 0.08, 0.1]));
  }
  return mergeGeometries(parts)!;
}

export function mossGeo(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.18, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, 0.35, 1);
  displace(g, 0.2, 9, 3);
  return prep(g, (_x, y) => {
    const v = 0.7 + y * 3;
    return [v * 0.45, v * 0.7, v * 0.3];
  });
}

// ------------------------------------------------------------------ materials

export function windMaterial(opts: { sway: number; grass?: boolean; flat?: boolean; emissive?: number }): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: opts.grass ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: !!opts.flat,
  });
  if (opts.emissive) mat.emissive = new THREE.Color(opts.emissive);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uWind = sharedUniforms.uWind;
    shader.uniforms.uPlayer = sharedUniforms.uPlayer;
    shader.uniforms.uSnow = sharedUniforms.uSnow;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime; uniform float uWind; uniform vec3 uPlayer;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 iw = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float hgt = max(position.y, 0.0);
          float ph = iw.x * 0.21 + iw.z * 0.17;
          float s = sin(uTime * 1.6 + ph) * 0.6 + sin(uTime * 2.9 + ph * 1.7) * 0.25;
          float amt = ${opts.sway.toFixed(3)} * uWind * hgt * (0.6 + 0.4 * s);
          transformed.x += amt * (0.8 + s * 0.5);
          transformed.z += amt * 0.45 * (s + 0.3);
          ${opts.grass ? `
          vec2 dp = iw.xz - uPlayer.xz;
          float dl = length(dp);
          float push = (1.0 - smoothstep(0.1, 0.7, dl)) * hgt * 0.9;
          transformed.xz += normalize(dp + 0.0001) * push;
          transformed.y -= push * 0.4;
          ` : ''}
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uSnow;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 1.0), uSnow * ${opts.grass ? '0.75' : '0.35'} * smoothstep(0.55, 1.0, vColor.g));`,
      );
  };
  mat.customProgramCacheKey = () => `wind-${opts.sway}-${!!opts.grass}-${!!opts.flat}`;
  return mat;
}

export function terrainMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSnow = sharedUniforms.uSnow;
    shader.uniforms.uWet = sharedUniforms.uWet;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWN; varying vec3 vWP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWN = normal; vWP = (modelMatrix * vec4(position, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uSnow; uniform float uWet; varying vec3 vWN; varying vec3 vWP;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float flatness = smoothstep(0.6, 0.95, vWN.y);
        float grain = fract(sin(dot(floor(vWP.xz * 3.0), vec2(12.9898, 78.233))) * 43758.5453);
        diffuseColor.rgb *= 0.94 + grain * 0.1;
        diffuseColor.rgb *= 1.0 - uWet * 0.22;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 0.99), uSnow * flatness * 0.9);`,
      );
  };
  mat.customProgramCacheKey = () => 'terrain';
  return mat;
}

export function waterMaterial(): THREE.MeshPhongMaterial {
  const mat = new THREE.MeshPhongMaterial({
    color: 0x3f7f86,
    specular: 0xfff2d8,
    shininess: 90,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; varying vec2 vWXZ;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wpos = modelMatrix * vec4(position, 1.0);
        vWXZ = wpos.xz;
        transformed.y += sin(wpos.x * 0.8 + uTime * 1.3) * 0.03 + cos(wpos.z * 0.7 + uTime * 1.1) * 0.03;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; varying vec2 vWXZ;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 q = vWXZ;
        float w1 = sin(q.x * 2.1 + uTime * 1.7 + sin(q.y * 1.3)) + cos(q.y * 2.4 - uTime * 1.3 + sin(q.x * 0.9));
        float w2 = sin((q.x + q.y) * 3.7 + uTime * 2.3) * 0.5;
        normal = normalize(normal + vec3(w1 * 0.06 + w2 * 0.04, 0.0, w2 * 0.05 - w1 * 0.03));`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sparkle = smoothstep(1.55, 1.95, sin(vWXZ.x * 4.3 + uTime * 2.1) + cos(vWXZ.y * 3.9 - uTime * 1.7));
        diffuseColor.rgb += sparkle * 0.08;`);
  };
  mat.customProgramCacheKey = () => 'water';
  return mat;
}

// Shared singletons (lazily created)
let _assets: ReturnType<typeof buildAssets> | null = null;
function buildAssets() {
  return {
    trunk: trunkGeo(),
    canopy: deciduousCanopyGeo(2),
    canopyLo: deciduousCanopyGeo(1),
    pine: pineGeo(),
    bush: bushGeo(1),
    bushLo: bushGeo(0),
    grass: grassTuftGeo(),
    fern: fernGeo(),
    flower: flowerGeo(),
    rocks: [rockGeo(1), rockGeo(7), rockGeo(13)],
    reed: reedGeo(),
    mushroom: mushroomGeo(),
    log: logGeo(),
    deadTree: deadTreeGeo(),
    herb: herbGeo(),
    deathberry: deathberryGeo(),
    moss: mossGeo(),
    mat: {
      trunk: windMaterial({ sway: 0.0 }),
      canopy: windMaterial({ sway: 0.035 }),
      pine: windMaterial({ sway: 0.02 }),
      bush: windMaterial({ sway: 0.05 }),
      grass: windMaterial({ sway: 0.35, grass: true }),
      fern: windMaterial({ sway: 0.15, grass: true }),
      flower: windMaterial({ sway: 0.3 }),
      rock: windMaterial({ sway: 0.0, flat: true }),
      reed: windMaterial({ sway: 0.12 }),
      static: windMaterial({ sway: 0.0 }),
      herb: windMaterial({ sway: 0.2, emissive: 0x1a2a10 }),
      terrain: terrainMaterial(),
      water: waterMaterial(),
    },
  };
}
export function assets() {
  if (!_assets) _assets = buildAssets();
  return _assets;
}
