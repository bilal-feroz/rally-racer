import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math';
import type { VehicleSim } from '../vehicle/VehicleSim';
import { SURF_GRASS, type TerrainField } from '../world/TerrainField';

const MAX_DUST = 900;
const MAX_SKID = 5000;

/**
 * Ground-hugging dust plumes (instanced billboards) and tyre marks that follow actual wheel
 * contact. Both scale with speed, slip and surface.
 */
export class Effects {
  // dust
  private readonly dustGeo: THREE.InstancedBufferGeometry;
  private readonly dustMesh: THREE.Mesh;
  private readonly dOff: Float32Array;
  private readonly dSize: Float32Array;
  private readonly dAlpha: Float32Array;
  private readonly dSeed: Float32Array;
  private readonly pVel: Float32Array;
  private readonly pAge: Float32Array;
  private readonly pLife: Float32Array;
  private readonly pS0: Float32Array;
  private readonly pS1: Float32Array;
  private readonly pA0: Float32Array;
  private next = 0;
  private alive = 0;
  private spawnAcc = [0, 0, 0, 0];

  // skids
  private readonly skidGeo: THREE.BufferGeometry;
  private readonly skidPos: Float32Array;
  private readonly skidAlpha: Float32Array;
  private skidNext = 0;
  private readonly lastMark: (THREE.Vector3 | null)[] = [null, null, null, null];
  private readonly lastSide: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly _v = new THREE.Vector3();
  private readonly _d = new THREE.Vector3();
  private readonly _s = new THREE.Vector3();
  private rnd = 0.5;

  constructor(
    scene: THREE.Scene,
    readonly field: TerrainField,
  ) {
    // ------------------------------------------------------------- dust
    const quad = new THREE.PlaneGeometry(1, 1);
    this.dustGeo = new THREE.InstancedBufferGeometry();
    this.dustGeo.index = quad.index;
    this.dustGeo.setAttribute('position', quad.getAttribute('position'));
    this.dustGeo.setAttribute('uv', quad.getAttribute('uv'));
    this.dOff = new Float32Array(MAX_DUST * 3);
    this.dSize = new Float32Array(MAX_DUST);
    this.dAlpha = new Float32Array(MAX_DUST);
    this.dSeed = new Float32Array(MAX_DUST);
    for (let i = 0; i < MAX_DUST; i++) this.dSeed[i] = Math.random();
    this.dustGeo.setAttribute('aOff', new THREE.InstancedBufferAttribute(this.dOff, 3).setUsage(THREE.DynamicDrawUsage));
    this.dustGeo.setAttribute('aSize', new THREE.InstancedBufferAttribute(this.dSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.dustGeo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(this.dAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.dustGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(this.dSeed, 1));
    this.dustGeo.instanceCount = 0;
    this.pVel = new Float32Array(MAX_DUST * 3);
    this.pAge = new Float32Array(MAX_DUST);
    this.pLife = new Float32Array(MAX_DUST);
    this.pS0 = new Float32Array(MAX_DUST);
    this.pS1 = new Float32Array(MAX_DUST);
    this.pA0 = new Float32Array(MAX_DUST);
    const dustMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color('#efe2c6') },
        uShade: { value: new THREE.Color('#b9a284') },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aOff; attribute float aSize; attribute float aAlpha; attribute float aSeed;
        varying vec2 vUv; varying float vAlpha; varying float vSeed;
        void main() {
          vUv = uv; vAlpha = aAlpha; vSeed = aSeed;
          vec4 mv = modelViewMatrix * vec4(aOff, 1.0);
          float a = aSeed * 6.2831;
          vec2 c = position.xy;
          c = vec2(c.x * cos(a) - c.y * sin(a), c.x * sin(a) + c.y * cos(a));
          mv.xy += c * aSize;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform vec3 uShade;
        varying vec2 vUv; varying float vAlpha; varying float vSeed;
        float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), u.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), u.x), u.y); }
        void main() {
          vec2 p = vUv - 0.5;
          float r = length(p) * 2.0;
          float puff = n(vUv * 4.0 + vSeed * 17.0) * 0.5 + n(vUv * 9.0 - vSeed * 5.0) * 0.25;
          float a = smoothstep(1.0, 0.25, r + (puff - 0.35) * 0.6) * vAlpha;
          if (a < 0.003) discard;
          vec3 col = mix(uShade, uColor, clamp(0.5 - p.y * 1.4 + puff * 0.4, 0.0, 1.0));
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    });
    this.dustMesh = new THREE.Mesh(this.dustGeo, dustMat);
    this.dustMesh.frustumCulled = false;
    this.dustMesh.renderOrder = 5;
    scene.add(this.dustMesh);

    // ------------------------------------------------------------- skids
    this.skidPos = new Float32Array(MAX_SKID * 4 * 3);
    this.skidAlpha = new Float32Array(MAX_SKID * 4);
    const idx = new Uint32Array(MAX_SKID * 6);
    for (let i = 0; i < MAX_SKID; i++) {
      const v = i * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    this.skidGeo = new THREE.BufferGeometry();
    this.skidGeo.setAttribute('position', new THREE.BufferAttribute(this.skidPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.skidGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.skidAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.skidGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    const skidMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color('#4a3d33') } },
      vertexShader: /* glsl */ `
        attribute float aAlpha; varying float vA;
        #include <fog_pars_vertex>
        void main() { vA = aAlpha; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vA;
        void main() { if (vA < 0.01) discard; gl_FragColor = vec4(uColor, vA);
        #include <colorspace_fragment>
        }`,
    });
    const skidMesh = new THREE.Mesh(this.skidGeo, skidMat);
    skidMesh.frustumCulled = false;
    skidMesh.renderOrder = 3;
    scene.add(skidMesh);
  }

  reset(): void {
    this.alive = 0;
    this.dustGeo.instanceCount = 0;
    this.pAge.fill(0);
    this.pLife.fill(0);
    this.skidAlpha.fill(0);
    (this.skidGeo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    this.lastMark.fill(null);
  }

  private random(): number {
    // cheap deterministic-ish LCG (visual only)
    this.rnd = (this.rnd * 9301 + 49297) % 233280;
    return this.rnd / 233280;
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, a0: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX_DUST;
    this.dOff[i * 3] = x;
    this.dOff[i * 3 + 1] = y;
    this.dOff[i * 3 + 2] = z;
    this.pVel[i * 3] = vx;
    this.pVel[i * 3 + 1] = vy;
    this.pVel[i * 3 + 2] = vz;
    this.pAge[i] = 0;
    this.pLife[i] = life;
    this.pS0[i] = s0;
    this.pS1[i] = s1;
    this.pA0[i] = a0;
    this.alive = Math.min(MAX_DUST, this.alive + 1);
  }

  update(dt: number, sim: VehicleSim, cam: THREE.Camera, active: boolean): void {
    void cam;
    const speed = sim.speed;
    if (active && dt > 0) {
      for (let k = 0; k < 4; k++) {
        const w = sim.wheels[k];
        if (!w.contact) {
          this.lastMark[k] = null;
          continue;
        }
        const grass = w.surface === SURF_GRASS;
        const sp = smoothstep(5, 38, speed);
        const slide = w.slide;
        // rear wheels kick most of the dust; plumes grow with slip
        const rearF = w.front ? 0.3 : 1;
        const rate = (sp * 16 + slide * 60) * rearF * (grass ? 0.45 : 1);
        this.spawnAcc[k] += rate * dt;
        const side = w.left ? 1 : -1;
        while (this.spawnAcc[k] >= 1) {
          this.spawnAcc[k] -= 1;
          const r1 = this.random();
          const r2 = this.random();
          const r3 = this.random();
          // dust is dragged along by the car's wake: inherit most of its velocity so plumes
          // linger just behind the wheels where the chase camera can see them
          const keep = 0.62 + r1 * 0.22;
          const throwOut = (0.6 + r2 * 1.6 + slide * 2.5) * side;
          const vx = sim.vel.x * keep + sim.right.x * -throwOut + (r3 - 0.5) * 1.2;
          const vz = sim.vel.z * keep + sim.right.z * -throwOut + (r2 - 0.5) * 1.2;
          const vy = 0.5 + r1 * 1.1 + slide * 1.4;
          const life = 0.9 + r2 * 1.1 + slide * 1.0;
          const s0 = 0.35 + slide * 0.35;
          const s1 = 1.6 + sp * 1.6 + slide * 2.6 + r3 * 1.0;
          const a0 = (grass ? 0.16 : 0.3) * (0.4 + 0.6 * sp) + slide * 0.35;
          this.spawn(w.hit.x - sim.fwd.x * 0.45, w.hit.y + 0.15, w.hit.z - sim.fwd.z * 0.45, vx, vy, vz, life, s0, s1, Math.min(0.7, a0));
        }
        // skid marks
        const markStrength = clamp((slide - 0.12) * 1.6, 0, 1) * (grass ? 0.6 : 1);
        if (markStrength > 0.02) this.addMark(k, w.hit, w.normal, markStrength);
        else this.lastMark[k] = null;
      }
    }
    // integrate particles
    const drag = Math.exp(-2.4 * dt);
    let maxIdx = 0;
    for (let i = 0; i < MAX_DUST; i++) {
      if (this.pLife[i] <= 0) {
        this.dAlpha[i] = 0;
        continue;
      }
      this.pAge[i] += dt;
      const t = this.pAge[i] / this.pLife[i];
      if (t >= 1) {
        this.pLife[i] = 0;
        this.dAlpha[i] = 0;
        continue;
      }
      maxIdx = i + 1;
      this.pVel[i * 3] *= drag;
      this.pVel[i * 3 + 1] = this.pVel[i * 3 + 1] * drag - 0.15 * dt;
      this.pVel[i * 3 + 2] *= drag;
      this.dOff[i * 3] += this.pVel[i * 3] * dt;
      this.dOff[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.dOff[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      this.dSize[i] = this.pS0[i] + (this.pS1[i] - this.pS0[i]) * (1 - (1 - t) * (1 - t));
      this.dAlpha[i] = this.pA0[i] * smoothstep(0, 0.08, t) * (1 - t) * (1 - t);
    }
    this.dustGeo.instanceCount = maxIdx;
    for (const name of ['aOff', 'aSize', 'aAlpha']) (this.dustGeo.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  private addMark(k: number, p: THREE.Vector3, n: THREE.Vector3, strength: number): void {
    const last = this.lastMark[k];
    if (!last) {
      this.lastMark[k] = p.clone();
      this.lastSide[k].set(0, 0, 0);
      return;
    }
    const dist = last.distanceTo(p);
    if (dist < 0.35) return;
    if (dist > 4) {
      last.copy(p);
      return;
    }
    const dir = this._d.subVectors(p, last).normalize();
    const side = this._s.crossVectors(dir, n).normalize().multiplyScalar(0.13);
    const i = this.skidNext;
    this.skidNext = (this.skidNext + 1) % MAX_SKID;
    const prevSide = this.lastSide[k].lengthSq() > 0 ? this.lastSide[k] : side;
    const lift = 0.035;
    const set = (vi: number, base: THREE.Vector3, s: THREE.Vector3, sign: number) => {
      const o = (i * 4 + vi) * 3;
      this.skidPos[o] = base.x + s.x * sign + n.x * lift;
      this.skidPos[o + 1] = base.y + s.y * sign + n.y * lift;
      this.skidPos[o + 2] = base.z + s.z * sign + n.z * lift;
    };
    set(0, last, prevSide, -1);
    set(1, last, prevSide, 1);
    set(2, p, side, -1);
    set(3, p, side, 1);
    const a = 0.55 * strength;
    this.skidAlpha.fill(a, i * 4, i * 4 + 4);
    const pa = this.skidGeo.getAttribute('position') as THREE.BufferAttribute;
    const aa = this.skidGeo.getAttribute('aAlpha') as THREE.BufferAttribute;
    pa.addUpdateRange(i * 12, 12);
    aa.addUpdateRange(i * 4, 4);
    pa.needsUpdate = true;
    aa.needsUpdate = true;
    this.lastSide[k].copy(side);
    last.copy(p);
    void this._v;
  }
}
