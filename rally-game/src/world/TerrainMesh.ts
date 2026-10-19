import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math';
import { SHOULDER } from '../track/Track';
import { Biome, GROUND } from './Biome';
import type { TerrainField } from './TerrainField';

const _c = new THREE.Color();
const _c2 = new THREE.Color();

/** Adds a world-space painterly speckle to vertex-coloured lambert materials. */
function patchGroundMaterial(mat: THREE.MeshLambertMaterial, strength: number): void {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundWP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vGroundWP;
float gHash(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
float gNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 gp = vGroundWP.xz;
  float n1 = gNoise(gp * 0.33) * 0.6 + gNoise(gp * 1.1) * 0.4;
  float n2 = gNoise(gp * 4.0);
  diffuseColor.rgb *= 1.0 + ${strength.toFixed(3)} * ((n1 - 0.5) * 0.9 + (n2 - 0.5) * 0.35);
}`,
      );
  };
}

export class TerrainMesh {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;
  readonly farMaterial: THREE.MeshLambertMaterial;

  constructor(
    readonly field: TerrainField,
    readonly biome: Biome,
  ) {
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    patchGroundMaterial(this.material, 0.22);
    this.farMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    patchGroundMaterial(this.farMaterial, 0.12);
    this.group.name = 'terrain';
    this.buildNear();
    this.buildFar();
  }

  private vertexColor(k: number, x: number, z: number, out: THREE.Color): void {
    const F = this.field;
    const B = this.biome;
    const t = B.tint(x, z);
    out.copy(GROUND.grassA).lerp(GROUND.grassB, smoothstep(-0.4, 0.5, t));
    out.lerp(GROUND.grassDry, smoothstep(0.25, 0.8, B.speckle(x * 0.7, z * 0.7)) * 0.55);
    const forest = B.forest(x, z);
    out.lerp(_c2.copy(GROUND.forestFloor).lerp(GROUND.forestDark, smoothstep(0, 0.6, t)), forest * 0.75);

    // slope based bare earth
    const i = Math.round((x - F.x0) / F.cell);
    const j = Math.round((z - F.z0) / F.cell);
    const H = F.heights;
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(F.nx - 1, i + 1);
    const j0 = Math.max(0, j - 1);
    const j1 = Math.min(F.nz - 1, j + 1);
    const dx = (H[j * F.nx + i1] - H[j * F.nx + i0]) / ((i1 - i0) * F.cell);
    const dz = (H[j1 * F.nx + i] - H[j0 * F.nx + i]) / ((j1 - j0) * F.cell);
    const slope = Math.sqrt(dx * dx + dz * dz);

    const d = F.roadD[k];
    if (!Number.isNaN(d)) {
      const s = F.roadS[k];
      const tr = F.track;
      const si = clamp(Math.floor(s), 0, tr.n - 1);
      const edge = tr.hw[si] + SHOULDER;
      const u = Math.abs(d) - edge;
      // sandy verge blending to grass
      const sand = 1 - smoothstep(-0.5, 3.2 + 1.5 * B.speckle(s * 0.15, d), u);
      out.lerp(_c2.copy(GROUND.sand).lerp(GROUND.sandDark, 0.4 + 0.3 * B.speckle(x * 3, z * 3)), sand);
      // cut banks: steep ground near the road shows earth
      const bank = smoothstep(0.42, 0.75, slope) * (1 - smoothstep(6, 18, u));
      out.lerp(GROUND.dirtBank, bank * 0.85);
    } else {
      out.lerp(GROUND.rock, smoothstep(0.75, 1.2, slope) * 0.6);
    }
    // lake shore: muddy sand band, darker below the waterline
    const L = this.field.lake;
    if (L && (x - L.x) ** 2 + (z - L.z) ** 2 < (L.r + 20) ** 2) {
      const h = this.field.heights[k];
      const shore = 1 - smoothstep(0.4, 2.2, h - L.level);
      out.lerp(GROUND.shore, shore * 0.85);
      if (h < L.level) out.multiplyScalar(0.7);
    }
  }

  private buildNear(): void {
    const F = this.field;
    const cpc = F.chunkCells;
    const chunksX = (F.nx - 1) / cpc;
    const chunksZ = (F.nz - 1) / cpc;
    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const mesh = this.buildChunk(cx * cpc, cz * cpc, cpc, cx === 0, cx === chunksX - 1, cz === 0, cz === chunksZ - 1);
        this.group.add(mesh);
      }
    }
  }

  private buildChunk(i0: number, j0: number, n: number, skirtW: boolean, skirtE: boolean, skirtN: boolean, skirtS: boolean): THREE.Mesh {
    const F = this.field;
    const vw = n + 1;
    const vertCount = vw * vw;
    const skirts: [number, number][][] = [];
    const edgeRow = (fixedJ: number | null, fixedI: number | null) => {
      const arr: [number, number][] = [];
      for (let q = 0; q <= n; q++) arr.push(fixedJ !== null ? [i0 + q, fixedJ] : [fixedI!, j0 + q]);
      return arr;
    };
    if (skirtN) skirts.push(edgeRow(j0, null));
    if (skirtS) skirts.push(edgeRow(j0 + n, null));
    if (skirtW) skirts.push(edgeRow(null, i0));
    if (skirtE) skirts.push(edgeRow(null, i0 + n));
    const extra = skirts.length * vw * 2;
    const pos = new Float32Array((vertCount + extra) * 3);
    const col = new Float32Array((vertCount + extra) * 3);
    const idx: number[] = [];
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const gi = i0 + i;
        const gj = j0 + j;
        const k = gj * F.nx + gi;
        const x = F.x0 + gi * F.cell;
        const z = F.z0 + gj * F.cell;
        const v = j * vw + i;
        pos[v * 3] = x;
        pos[v * 3 + 1] = F.heights[k];
        pos[v * 3 + 2] = z;
        this.vertexColor(k, x, z, _c);
        col[v * 3] = _c.r;
        col[v * 3 + 1] = _c.g;
        col[v * 3 + 2] = _c.b;
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * vw + i;
        const b = a + 1;
        const c = a + vw;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    // skirts hide cracks against the coarse far terrain
    let v = vertCount;
    for (const row of skirts) {
      const start = v;
      for (const [gi, gj] of row) {
        const k = gj * F.nx + gi;
        const x = F.x0 + gi * F.cell;
        const z = F.z0 + gj * F.cell;
        this.vertexColor(k, x, z, _c);
        for (let r = 0; r < 2; r++) {
          pos[v * 3] = x;
          pos[v * 3 + 1] = F.heights[k] - r * 25;
          pos[v * 3 + 2] = z;
          col[v * 3] = _c.r * 0.8;
          col[v * 3 + 1] = _c.g * 0.8;
          col[v * 3 + 2] = _c.b * 0.8;
          v++;
        }
      }
      for (let q = 0; q < n; q++) {
        const a = start + q * 2;
        // double sided via both windings
        idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
        idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'terrain-chunk';
    return mesh;
  }

  private buildFar(): void {
    const F = this.field;
    const cell = 80;
    const cxm = (F.track.minX + F.track.maxX) / 2;
    const czm = (F.track.minZ + F.track.maxZ) / 2;
    const ext = F.farExtent;
    const x0 = Math.floor((cxm - ext) / 160) * 160;
    const z0 = Math.floor((czm - ext) / 160) * 160;
    const n = Math.ceil((2 * ext) / cell);
    const nearX0 = F.x0;
    const nearZ0 = F.z0;
    const nearX1 = F.x0 + (F.nx - 1) * F.cell;
    const nearZ1 = F.z0 + (F.nz - 1) * F.cell;
    const vw = n + 1;
    const pos = new Float32Array(vw * vw * 3);
    const col = new Float32Array(vw * vw * 3);
    const B = this.biome;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = x0 + i * cell;
        const z = z0 + j * cell;
        const onNear = x >= nearX0 - 0.01 && x <= nearX1 + 0.01 && z >= nearZ0 - 0.01 && z <= nearZ1 + 0.01;
        const h = onNear ? F.heightAt(x, z) - (x > nearX0 + 1 && x < nearX1 - 1 && z > nearZ0 + 1 && z < nearZ1 - 1 ? 30 : 0) : F.natural(x, z);
        const v = j * vw + i;
        pos[v * 3] = x;
        pos[v * 3 + 1] = h;
        pos[v * 3 + 2] = z;
        const forest = B.forest(x * 0.6, z * 0.6);
        _c.copy(GROUND.farMeadow).lerp(GROUND.farForest, 0.35 + 0.65 * forest);
        const hn = clamp((h - F.coarse(F.cBase, x, z)) / 260, 0, 1);
        _c.lerp(GROUND.rock, smoothstep(0.45, 0.9, hn) * 0.5);
        col[v * 3] = _c.r;
        col[v * 3 + 1] = _c.g;
        col[v * 3 + 2] = _c.b;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const xa = x0 + i * cell;
        const za = z0 + j * cell;
        const inside = xa >= nearX0 - 0.01 && xa + cell <= nearX1 + 0.01 && za >= nearZ0 - 0.01 && za + cell <= nearZ1 + 0.01;
        if (inside) continue;
        const a = j * vw + i;
        const b = a + 1;
        const c = a + vw;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.farMaterial);
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'terrain-far';
    this.group.add(mesh);
  }
}
