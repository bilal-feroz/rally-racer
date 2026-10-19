import * as THREE from 'three';
import { SHOULDER, type Track } from '../track/Track';

/** Shared GLSL noise helpers for procedural surfaces. */
export const GLSL_NOISE = /* glsl */ `
float rHash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
vec2 rHash2(vec2 p) { return vec2(rHash(p), rHash(p + 17.31)); }
float rNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rHash(i), rHash(i + vec2(1.0, 0.0)), u.x), mix(rHash(i + vec2(0.0, 1.0)), rHash(i + vec2(1.0, 1.0)), u.x), u.y); }
float rFbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * rNoise(p); p = p * 2.07 + 3.1; a *= 0.5; } return s; }
// voronoi edge distance (F2 - F1)
float rCells(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float f1 = 8.0, f2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = rHash2(i + g) * 0.85 + 0.075;
    float d = length(g + o - f);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
  }
  return f2 - f1;
}
vec3 srgb2lin(vec3 c) { return pow(c, vec3(2.2)); }
`;

export class RoadMesh {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;

  constructor(readonly track: Track) {
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.material.polygonOffset = true;
    this.material.polygonOffsetFactor = -2;
    this.material.polygonOffsetUnits = -4;
    this.patch(this.material);
    this.build();
    this.group.name = 'road';
  }

  private patch(mat: THREE.MeshLambertMaterial): void {
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aRoad;\nvarying vec3 vRoad;\nvarying vec3 vRoadWP;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRoad = aRoad;\nvRoadWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vRoad;\nvarying vec3 vRoadWP;\n${GLSL_NOISE}`)
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
{
  float d = vRoad.x; float s = vRoad.y; float hw = vRoad.z;
  float ad = abs(d);
  vec2 wp = vRoadWP.xz;
  vec3 hard = srgb2lin(vec3(0.87, 0.75, 0.63));
  vec3 dusty = srgb2lin(vec3(0.93, 0.85, 0.74));
  vec3 packed = srgb2lin(vec3(0.79, 0.66, 0.54));
  vec3 track = srgb2lin(vec3(0.45, 0.4, 0.38));
  vec3 gravel = srgb2lin(vec3(0.88, 0.8, 0.67));
  vec3 sand = srgb2lin(vec3(0.87, 0.78, 0.64));
  float big = rFbm(wp * 0.045);
  vec3 col = mix(packed, hard, smoothstep(0.25, 0.6, big));
  col = mix(col, dusty, smoothstep(0.55, 0.85, rFbm(wp * 0.11 + 7.0)) * 0.7);
  // cracked hardpack cells
  // domain-warped, two-scale voronoi: irregular dried-mud cracks rather than tiles
  vec2 warp = vec2(rNoise(wp * 0.33), rNoise(wp * 0.33 + 17.3)) * 1.4;
  float cells = min(rCells(wp * 0.95 + warp), rCells(wp * 2.1 - warp * 1.7 + 5.0) + 0.035);
  col *= mix(0.84, 1.0, smoothstep(0.0, 0.045, cells));
  // fine grain
  col *= 0.94 + 0.12 * rNoise(wp * 9.0);
  // tyre tracks: meandering racing lines
  float c = 0.55 * sin(s * 0.011) + 0.35 * sin(s * 0.037 + 1.3) + 0.2 * sin(s * 0.09);
  float tr = 0.0;
  for (int k = 0; k < 4; k++) {
    float off = (k == 0) ? -0.86 : (k == 1) ? 0.86 : (k == 2) ? -2.45 : 2.45;
    float wob = 0.18 * sin(s * (0.05 + 0.013 * float(k)) + float(k) * 2.1);
    float dist = abs(d - (c * (k < 2 ? 1.0 : 0.6) + off + wob));
    float w = (k < 2) ? 0.2 : 0.16;
    float strength = (k < 2) ? 0.62 : 0.38;
    strength *= 0.55 + 0.45 * rNoise(vec2(s * 0.03, float(k) * 5.0));
    tr = max(tr, strength * (1.0 - smoothstep(w * 0.45, w, dist)));
  }
  tr *= 1.0 - smoothstep(hw - 0.9, hw - 0.2, ad);
  col = mix(col, track, tr);
  // windrow of loose gravel along edges
  float edgeBand = smoothstep(hw - 1.1, hw - 0.3, ad) * (1.0 - smoothstep(hw + 0.6, hw + 1.3, ad));
  vec2 pc = wp * 5.0; vec2 pi = floor(pc);
  vec2 pf = fract(pc) - 0.5 - (rHash2(pi) - 0.5) * 0.5;
  float peb = (1.0 - smoothstep(0.1, 0.17, length(pf))) * step(0.55, rHash(pi + 3.7));
  col = mix(col, gravel, edgeBand * 0.7);
  col *= 1.0 - peb * (0.12 + 0.2 * edgeBand) * (rHash(pi + 9.1) > 0.5 ? 1.0 : -0.6);
  // shoulder: sandy, greener toward outer edge so it melts into the verge
  float sh = smoothstep(hw + 0.2, hw + 1.0, ad);
  vec3 shoulder = sand * (0.93 + 0.14 * rNoise(wp * 3.0));
  col = mix(col, shoulder, sh);
  diffuseColor.rgb = col;
}`,
        );
    };
  }

  private build(): void {
    const t = this.track;
    const fracs = [-1, -0.5, 0, 0.25, 0.5, 0.75, 1];
    // lateral layout: shoulder (2 verts), road (9 verts), shoulder (2 verts)
    const cols: { kind: 'road' | 'sh'; f: number }[] = [];
    cols.push({ kind: 'sh', f: -1 }, { kind: 'sh', f: -0.5 });
    for (let q = -4; q <= 4; q++) cols.push({ kind: 'road', f: q / 4 });
    cols.push({ kind: 'sh', f: 0.5 }, { kind: 'sh', f: 1 });
    void fracs;
    const nc = cols.length;
    const per = 160;
    for (let start = 0; start < t.n - 1; start += per) {
      const end = Math.min(t.n - 1, start + per);
      const rows = end - start + 1;
      const pos = new Float32Array(rows * nc * 3);
      const road = new Float32Array(rows * nc * 3);
      for (let r = 0; r < rows; r++) {
        const i = start + r;
        const ii = Math.min(i, t.n - 2);
        const tt = i === t.n - 1 ? 1 : 0;
        const th = t.heading[i];
        const lx = Math.cos(th);
        const lz = -Math.sin(th);
        const hw = t.hw[i];
        for (let c = 0; c < nc; c++) {
          const col = cols[c];
          let d: number;
          if (col.kind === 'road') d = col.f * hw;
          else d = Math.sign(col.f) * (hw + Math.abs(col.f) * SHOULDER);
          const x = t.px[i] + lx * d;
          const z = t.pz[i] + lz * d;
          const edge = col.kind === 'sh' && Math.abs(col.f) === 1;
          const y = t.surfaceHeight(ii, tt, d) + (edge ? 0.015 : 0.03);
          const v = r * nc + c;
          pos[v * 3] = x;
          pos[v * 3 + 1] = y;
          pos[v * 3 + 2] = z;
          road[v * 3] = d;
          road[v * 3 + 1] = i * t.ds;
          road[v * 3 + 2] = hw;
        }
      }
      const idx: number[] = [];
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < nc - 1; c++) {
          const a = r * nc + c;
          const b = a + 1;
          const cc = a + nc;
          const d = cc + 1;
          // columns go from right (-d) to left (+d); rows go forward (same handedness as terrain)
          idx.push(a, cc, b, b, cc, d);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aRoad', new THREE.BufferAttribute(road, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = 'road-chunk';
      this.group.add(mesh);
    }
  }
}
