// Small environmental details: fireflies at night, drifting pollen motes in
// sunlight, falling leaves in leaf-drop season.
import * as THREE from 'three';

function particleLayer(n: number, vert: string, frag: string, uniforms: Record<string, THREE.IUniform>, blending: THREE.Blending = THREE.NormalBlending) {
  const p = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) p[i] = Math.random();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending }));
  pts.frustumCulled = false;
  return pts;
}

export class Ambient {
  private u = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uFire: { value: 0 },
    uMote: { value: 0 },
    uLeaf: { value: 0 },
    uGround: { value: 0 },
    uWind: { value: 0 },
  };
  constructor(scene: THREE.Scene) {
    const fireflies = particleLayer(260, `
      uniform float uTime; uniform vec3 uCam; uniform float uFire; uniform float uGround; varying float vA;
      void main(){
        vec3 box = vec3(40.0, 3.0, 40.0);
        vec3 p = position * box;
        float t = uTime * 0.35 + position.y * 20.0;
        p.x += sin(t + position.z * 9.0) * 1.5; p.z += cos(t * 0.8 + position.x * 7.0) * 1.5;
        p.y += sin(t * 1.3) * 0.4;
        p.x = mod(p.x - uCam.x, box.x); p.z = mod(p.z - uCam.z, box.z);
        vec3 w = vec3(uCam.x + p.x - box.x * 0.5, uGround + 0.2 + p.y, uCam.z + p.z - box.z * 0.5);
        float blink = smoothstep(0.3, 1.0, sin(uTime * (1.5 + position.x * 2.0) + position.z * 50.0));
        vA = blink * uFire * step(position.x, 0.7 + uFire * 0.3);
        vec4 mv = viewMatrix * vec4(w, 1.0);
        gl_PointSize = 90.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`, `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5 || vA < 0.01) discard; gl_FragColor = vec4(1.0, 0.95, 0.45, vA * pow(1.0 - d * 2.0, 1.5)); }`,
    this.u, THREE.AdditiveBlending);
    scene.add(fireflies);

    const motes = particleLayer(300, `
      uniform float uTime; uniform vec3 uCam; uniform float uMote; uniform float uWind; varying float vA;
      void main(){
        vec3 box = vec3(14.0, 5.0, 14.0);
        vec3 p = position * box;
        float t = uTime * 0.2;
        p.x += sin(t + position.z * 12.0) * 0.8 + uWind * uTime * 0.4; p.y += sin(t * 1.7 + position.x * 8.0) * 0.5;
        p.x = mod(p.x - uCam.x, box.x); p.z = mod(p.z - uCam.z, box.z); p.y = mod(p.y - uCam.y, box.y);
        vec3 w = uCam + p - box * 0.5;
        vA = uMote * 0.5;
        vec4 mv = viewMatrix * vec4(w, 1.0);
        gl_PointSize = 14.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`, `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5 || vA < 0.01) discard; gl_FragColor = vec4(1.0, 0.97, 0.85, vA * (1.0 - d * 2.0)); }`,
    this.u, THREE.AdditiveBlending);
    scene.add(motes);

    const leaves = particleLayer(220, `
      uniform float uTime; uniform vec3 uCam; uniform float uLeaf; uniform float uWind; varying float vA; varying vec3 vC;
      void main(){
        vec3 box = vec3(30.0, 12.0, 30.0);
        vec3 p = position * box;
        float t = uTime;
        p.y = mod(p.y - t * 0.9, box.y);
        p.x += sin(t * 1.5 + position.z * 20.0) * 0.7 + uWind * t * 1.2;
        p.x = mod(p.x - uCam.x, box.x); p.z = mod(p.z + cos(t + position.x * 10.0) * 0.5 - uCam.z, box.z);
        vec3 w = vec3(uCam.x + p.x - box.x * 0.5, uCam.y + p.y - box.y * 0.2, uCam.z + p.z - box.z * 0.5);
        vA = step(position.x, uLeaf);
        vC = mix(vec3(0.9, 0.45, 0.12), vec3(0.95, 0.75, 0.2), position.y);
        vec4 mv = viewMatrix * vec4(w, 1.0);
        gl_PointSize = 70.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`, `varying float vA; varying vec3 vC; void main(){ vec2 c = gl_PointCoord - 0.5; if (abs(c.x) + abs(c.y) * 1.8 > 0.5 || vA < 0.01) discard; gl_FragColor = vec4(vC, 0.95); }`,
    this.u);
    scene.add(leaves);
  }

  update(time: number, cam: THREE.Vector3, ground: number, opts: { night: number; season: string; rain: number; wind: number; day: number; inForest: boolean }) {
    this.u.uTime.value = time;
    this.u.uCam.value.copy(cam);
    this.u.uGround.value = ground;
    this.u.uWind.value = opts.wind;
    const warm = opts.season === 'summer' ? 1 : opts.season === 'spring' ? 0.6 : opts.season === 'autumn' ? 0.2 : 0;
    this.u.uFire.value = opts.night * warm * (1 - opts.rain);
    this.u.uMote.value = (1 - opts.night) * (1 - opts.rain) * (opts.season === 'winter' ? 0.2 : 1);
    this.u.uLeaf.value = opts.season === 'autumn' && opts.inForest ? 0.5 + opts.wind * 0.5 : 0;
  }
}
