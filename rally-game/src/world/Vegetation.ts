import * as THREE from 'three';
import { mulberry32, smoothstep } from '../core/math';
import { SHOULDER, type Track } from '../track/Track';
import type { CollisionWorld, Obstacle } from '../vehicle/VehicleSim';
import type { Biome } from './Biome';
import type { TerrainField } from './TerrainField';
import { buildBush, buildRock, buildTreeKinds, buildTuft, type TreeKind } from './TreeGeometry';

interface Chunk {
  cx: number;
  cz: number;
  center: THREE.Vector3;
  high: THREE.Object3D[];
  low: THREE.Object3D[];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export const windUniform = { value: 0 };

function patchWind(mat: THREE.Material, strength: number, minY: number): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = windUniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
  vec3 iw = instanceMatrix[3].xyz;
  #else
  vec3 iw = vec3(0.0);
  #endif
  float h = max(position.y - ${minY.toFixed(2)}, 0.0);
  float ph = iw.x * 0.071 + iw.z * 0.053;
  float sway = sin(uWind * 1.3 + ph) * 0.6 + sin(uWind * 2.9 + ph * 1.7) * 0.25;
  transformed.x += sway * h * ${strength.toFixed(4)};
  transformed.z += cos(uWind * 1.1 + ph) * h * ${(strength * 0.6).toFixed(4)};
}`,
      );
  };
}

export class Vegetation implements CollisionWorld {
  readonly group = new THREE.Group();
  readonly kinds: TreeKind[];
  readonly chunks: Chunk[] = [];
  private readonly hash = new Map<number, Obstacle[]>();
  private readonly hcell = 8;
  treeCount = 0;
  tuftCount = 0;
  private readonly treeMat: THREE.MeshLambertMaterial;
  private readonly lowMat: THREE.MeshLambertMaterial;
  private lodTimer = 0;

  constructor(
    readonly field: TerrainField,
    readonly track: Track,
    readonly biome: Biome,
    seed: number,
    reserved: { x: number; z: number; r: number }[] = [],
  ) {
    this.group.name = 'vegetation';
    this.reserved.push(...reserved);
    this.kinds = buildTreeKinds(seed);
    this.treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    patchWind(this.treeMat, 0.006, 3.0);
    this.lowMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.scatter(seed);
  }

  private key(ix: number, iz: number): number {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  private addObstacle(x: number, z: number, r: number, h: number): void {
    const ix = Math.floor(x / this.hcell);
    const iz = Math.floor(z / this.hcell);
    const k = this.key(ix, iz);
    let arr = this.hash.get(k);
    if (!arr) {
      arr = [];
      this.hash.set(k, arr);
    }
    arr.push({ x, z, r, y: this.field.heightAt(x, z) - 0.5, h: h + 0.5 });
  }

  query(x: number, z: number, radius: number, out: Obstacle[]): number {
    let n = 0;
    const r = radius + 1.5;
    const ix0 = Math.floor((x - r) / this.hcell);
    const ix1 = Math.floor((x + r) / this.hcell);
    const iz0 = Math.floor((z - r) / this.hcell);
    const iz1 = Math.floor((z + r) / this.hcell);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const arr = this.hash.get(this.key(ix, iz));
        if (!arr) continue;
        for (const o of arr) out[n++] = o;
      }
    }
    return n;
  }

  /** Is there free space (no tree trunk) within radius of (x,z)? */
  isClear(x: number, z: number, radius: number): boolean {
    const tmp: Obstacle[] = [];
    const n = this.query(x, z, radius, tmp);
    for (let i = 0; i < n; i++) if (Math.hypot(tmp[i].x - x, tmp[i].z - z) < radius + tmp[i].r) return false;
    return true;
  }

  /** Reserve circular areas (props, gates) before scattering. */
  readonly reserved: { x: number; z: number; r: number }[] = [];

  private isReserved(x: number, z: number): boolean {
    for (const r of this.reserved) if ((x - r.x) ** 2 + (z - r.z) ** 2 < r.r * r.r) return true;
    return false;
  }

  private scatter(seed: number): void {
    const F = this.field;
    const T = this.track;
    const B = this.biome;
    const rnd = mulberry32(seed * 31 + 5);
    const chunkSize = F.cell * F.chunkCells;
    const nChunkX = Math.round(((F.nx - 1) * F.cell) / chunkSize);
    const nChunkZ = Math.round(((F.nz - 1) * F.cell) / chunkSize);
    type Inst = { x: number; y: number; z: number; s: number; yaw: number; tilt: number; c: number };
    const per: Inst[][][] = [];
    const bushes: Inst[][] = [];
    const tufts: Inst[][] = [];
    const rocks: Inst[][] = [];
    for (let c = 0; c < nChunkX * nChunkZ; c++) {
      per.push(this.kinds.map(() => []));
      bushes.push([]);
      tufts.push([]);
      rocks.push([]);
    }
    const chunkOf = (x: number, z: number) => {
      const cx = Math.min(nChunkX - 1, Math.max(0, Math.floor((x - F.x0) / chunkSize)));
      const cz = Math.min(nChunkZ - 1, Math.max(0, Math.floor((z - F.z0) / chunkSize)));
      return cz * nChunkX + cx;
    };
    const proj = { i: 0, t: 0, s: 0, d: 0, dist: 0 };
    const xMin = F.x0 + 4;
    const zMin = F.z0 + 4;
    const xMax = F.x0 + (F.nx - 1) * F.cell - 4;
    const zMax = F.z0 + (F.nz - 1) * F.cell - 4;

    // ---------------------------------------------------------- trees
    const cell = 6.5;
    for (let z = zMin; z < zMax; z += cell) {
      for (let x = xMin; x < xMax; x += cell) {
        const px = x + rnd() * cell;
        const pz = z + rnd() * cell;
        const r1 = rnd();
        const r2 = rnd();
        const r3 = rnd();
        const r4 = rnd();
        const forest = B.forest(px, pz);
        let prob = 0.06 + 0.86 * forest;
        const p = T.project(px, pz, 48, proj);
        if (p) {
          const hw = T.hwAt(p.s);
          const u = Math.abs(p.d) - (hw + SHOULDER);
          if (u < 2.2) continue;
          if (u < 11) prob = Math.min(prob, 0.16 + 0.5 * forest);
          const k = T.kappaAt(p.s);
          if (Math.sign(p.d) === Math.sign(k) && Math.abs(k) > 1 / 160 && u < 28) prob *= 0.15;
          if (p.s < T.startS + 60 || Math.abs(p.s - T.finishS) < 50) prob *= 0.4;
        }
        if (this.isReserved(px, pz)) continue;
        if (r1 > prob) continue;
        const conif = 0.2 + 0.65 * B.conifer(px, pz);
        let kind: number;
        if (r2 < conif) kind = r3 < 0.48 ? 0 : r3 < 0.8 ? 1 : 2;
        else kind = r3 < 0.55 ? 3 : 4;
        const s = (kind === 2 ? 0.8 : 0.78) + r4 * 0.5;
        const y = F.heightAt(px, pz) - 0.2;
        per[chunkOf(px, pz)][kind].push({ x: px, y, z: pz, s, yaw: rnd() * Math.PI * 2, tilt: (rnd() - 0.5) * 0.08, c: rnd() });
        this.addObstacle(px, pz, this.kinds[kind].trunkR * s, 12);
        this.treeCount++;
      }
    }
    // ---------------------------------------------------------- bushes, tufts, rocks
    for (let z = zMin; z < zMax; z += 2.4) {
      for (let x = xMin; x < xMax; x += 2.4) {
        const px = x + rnd() * 2.4;
        const pz = z + rnd() * 2.4;
        const r1 = rnd();
        const coarse = F.roadDistance(px, pz);
        if (coarse > 90) {
          if (r1 > 0.04) continue;
        }
        const p = T.project(px, pz, 40, proj);
        let u = 99;
        if (p) u = Math.abs(p.d) - (T.hwAt(p.s) + SHOULDER);
        if (u < 0.3) continue;
        const nearRoad = 1 - smoothstep(4, 22, u);
        const prob = 0.05 + 0.5 * nearRoad;
        if (r1 > prob) continue;
        const y = F.heightAt(px, pz) - 0.03;
        const ci = chunkOf(px, pz);
        const r2 = rnd();
        if (r2 < 0.86) {
          tufts[ci].push({ x: px, y, z: pz, s: 0.7 + rnd() * 0.8, yaw: rnd() * 6.28, tilt: 0, c: rnd() });
          this.tuftCount++;
        } else if (r2 < 0.97 && u > 2.5) {
          bushes[ci].push({ x: px, y, z: pz, s: 0.6 + rnd() * 0.9, yaw: rnd() * 6.28, tilt: 0, c: rnd() });
        } else if (u > 3.5) {
          const s = 0.35 + rnd() * 0.9;
          rocks[ci].push({ x: px, y: y - 0.1, z: pz, s, yaw: rnd() * 6.28, tilt: (rnd() - 0.5) * 0.4, c: rnd() });
          if (s > 0.75) this.addObstacle(px, pz, s * 0.9, s * 0.7);
        }
      }
    }

    // ---------------------------------------------------------- build instanced meshes per chunk
    const bushGeo = buildBush(seed);
    const tuftGeo = buildTuft(seed);
    const rockGeo = buildRock(seed);
    const tuftMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    patchWind(tuftMat, 0.12, 0.0);
    const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const bushMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const make = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Inst[], shadow: boolean, tint: number) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => {
        _e.set(it.tilt, it.yaw, it.tilt * 0.7);
        _q.setFromEuler(_e);
        _p.set(it.x, it.y, it.z);
        _s.setScalar(it.s);
        _m.compose(_p, _q, _s);
        im.setMatrixAt(i, _m);
        const j = (it.c - 0.5) * tint;
        _c.setRGB(1 + j * 0.9, 1 + j * 0.5, 1 - j * 0.6);
        im.setColorAt(i, _c);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = shadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      im.frustumCulled = true;
      return im;
    };
    for (let cz = 0; cz < nChunkZ; cz++) {
      for (let cx = 0; cx < nChunkX; cx++) {
        const ci = cz * nChunkX + cx;
        const center = new THREE.Vector3(F.x0 + (cx + 0.5) * chunkSize, 0, F.z0 + (cz + 0.5) * chunkSize);
        center.y = F.heightAt(center.x, center.z);
        const chunk: Chunk = { cx, cz, center, high: [], low: [] };
        this.kinds.forEach((kind, k) => {
          const list = per[ci][k];
          if (!list.length) return;
          const hi = make(kind.high, this.treeMat, list, true, 0.35);
          const lo = make(kind.low, this.lowMat, list, false, 0.35);
          lo.visible = false;
          chunk.high.push(hi);
          chunk.low.push(lo);
          this.group.add(hi, lo);
        });
        if (bushes[ci].length) {
          const m = make(bushGeo, bushMat, bushes[ci], true, 0.3);
          chunk.high.push(m);
          this.group.add(m);
        }
        if (tufts[ci].length) {
          const m = make(tuftGeo, tuftMat, tufts[ci], false, 0.4);
          m.receiveShadow = true;
          chunk.high.push(m);
          this.group.add(m);
        }
        if (rocks[ci].length) {
          const m = make(rockGeo, rockMat, rocks[ci], true, 0.3);
          chunk.high.push(m);
          this.group.add(m);
        }
        this.chunks.push(chunk);
      }
    }
  }

  /** Swap LODs by distance; cheap enough to run a few times per second. */
  update(dt: number, camPos: THREE.Vector3, time: number): void {
    windUniform.value = time;
    this.lodTimer -= dt;
    if (this.lodTimer > 0) return;
    this.lodTimer = 0.25;
    for (const c of this.chunks) {
      const d = Math.hypot(c.center.x - camPos.x, c.center.z - camPos.z);
      const near = d < 420;
      for (const o of c.high) o.visible = near;
      for (const o of c.low) o.visible = !near && d < 3200;
    }
  }
}
