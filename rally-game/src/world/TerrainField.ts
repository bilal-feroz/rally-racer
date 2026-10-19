import { clamp, lerp, Noise2D, smoothstep } from '../core/math';
import { SHOULDER, SKIRT, Track, type TrackProjection } from '../track/Track';

export const SURF_ROAD = 0;
export const SURF_SHOULDER = 1;
export const SURF_GRASS = 2;

export interface GroundSample {
  h: number;
  nx: number;
  ny: number;
  nz: number;
  /** 0 road, 1 shoulder, 2 grass/forest floor */
  surface: number;
  /** 0..1 how much this is hardpack (1) vs off-road (0) */
  roadness: number;
  s: number;
  d: number;
  i: number;
  dist: number;
}

interface Feature {
  x: number;
  z: number;
  r: number;
  h: number;
}

/**
 * Terrain height field. Near the stage it is a high-resolution grid built from an analytic
 * function that blends the road cross-section into natural rolling hills. Physics samples the
 * exact same triangulation the renderer draws; on the driven surface it samples the road profile.
 */
export class TerrainField {
  readonly cell = 2.5;
  readonly chunkCells = 64;
  readonly x0: number;
  readonly z0: number;
  /** vertex counts */
  readonly nx: number;
  readonly nz: number;
  readonly heights: Float32Array;
  /** signed road offset at each vertex (NaN if far) — used for colouring */
  readonly roadD: Float32Array;
  readonly roadS: Float32Array;

  // coarse fields (base height and distance to road)
  readonly cc = 40;
  readonly cx0: number;
  readonly cz0: number;
  readonly cnx: number;
  readonly cnz: number;
  readonly cBase: Float32Array;
  readonly cDist: Float32Array;

  readonly noise: Noise2D;
  readonly noise2: Noise2D;
  readonly features: Feature[] = [];
  readonly farExtent = 4200;

  private proj: TrackProjection = {} as TrackProjection;

  constructor(readonly track: Track, seed: number) {
    this.noise = new Noise2D(seed);
    this.noise2 = new Noise2D(seed * 7 + 13);
    const chunkSize = this.cell * this.chunkCells;
    const margin = 300;
    this.x0 = Math.floor((track.minX - margin) / chunkSize) * chunkSize;
    this.z0 = Math.floor((track.minZ - margin) / chunkSize) * chunkSize;
    const x1 = Math.ceil((track.maxX + margin) / chunkSize) * chunkSize;
    const z1 = Math.ceil((track.maxZ + margin) / chunkSize) * chunkSize;
    this.nx = Math.round((x1 - this.x0) / this.cell) + 1;
    this.nz = Math.round((z1 - this.z0) / this.cell) + 1;

    this.buildFeatures();

    // --- coarse fields over the far extent --------------------------------
    const ccx = (track.minX + track.maxX) / 2;
    const ccz = (track.minZ + track.maxZ) / 2;
    this.cx0 = Math.floor((ccx - this.farExtent) / this.cc) * this.cc;
    this.cz0 = Math.floor((ccz - this.farExtent) / this.cc) * this.cc;
    this.cnx = Math.ceil((2 * this.farExtent) / this.cc) + 2;
    this.cnz = this.cnx;
    this.cBase = new Float32Array(this.cnx * this.cnz);
    this.cDist = new Float32Array(this.cnx * this.cnz);
    const sx: number[] = [];
    const sy: number[] = [];
    const sz: number[] = [];
    for (let i = 0; i < track.n; i += 8) {
      sx.push(track.px[i]);
      sy.push(track.py[i]);
      sz.push(track.pz[i]);
    }
    const sig2 = 130 * 130;
    for (let j = 0; j < this.cnz; j++) {
      const z = this.cz0 + j * this.cc;
      for (let i = 0; i < this.cnx; i++) {
        const x = this.cx0 + i * this.cc;
        let wsum = 0;
        let ysum = 0;
        let dmin = Infinity;
        for (let k = 0; k < sx.length; k++) {
          const dx = x - sx[k];
          const dz = z - sz[k];
          const d2 = dx * dx + dz * dz;
          if (d2 < dmin) dmin = d2;
          const q = d2 + sig2;
          const w = 1 / (q * Math.sqrt(q));
          wsum += w;
          ysum += w * sy[k];
        }
        this.cBase[j * this.cnx + i] = ysum / wsum;
        this.cDist[j * this.cnx + i] = Math.sqrt(dmin);
      }
    }

    // --- fine grid ---------------------------------------------------------
    const nv = this.nx * this.nz;
    this.heights = new Float32Array(nv);
    this.roadD = new Float32Array(nv);
    this.roadS = new Float32Array(nv);
    for (let j = 0; j < this.nz; j++) {
      const z = this.z0 + j * this.cell;
      for (let i = 0; i < this.nx; i++) {
        const x = this.x0 + i * this.cell;
        const k = j * this.nx + i;
        this.heights[k] = this.rawHeight(x, z, k);
      }
    }
  }

  private buildFeatures(): void {
    // A broad valley to the outside of the downhill vista and some hills that frame the stage.
    const t = this.track;
    const vista = t.tags.find((g) => g.name === 'vista');
    if (vista) {
      const f = t.frameAt((vista.s0 + vista.s1) / 2);
      // valley on the right side (negative left vector)
      this.features.push({ x: f.x - f.lx * 260, z: f.z - f.lz * 260, r: 170, h: -28 });
    }
    const banked = t.tags.find((g) => g.name === 'banked');
    if (banked) {
      const f = t.frameAt(banked.s0 + 20);
      this.features.push({ x: f.x - f.lx * 120, z: f.z - f.lz * 120, r: 90, h: 14 });
    }
  }

  // ---------------------------------------------------------------------------
  coarse(arr: Float32Array, x: number, z: number): number {
    const fx = clamp((x - this.cx0) / this.cc, 0, this.cnx - 1.001);
    const fz = clamp((z - this.cz0) / this.cc, 0, this.cnz - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const a = arr[j * this.cnx + i];
    const b = arr[j * this.cnx + i + 1];
    const c = arr[(j + 1) * this.cnx + i];
    const d = arr[(j + 1) * this.cnx + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  roadDistance(x: number, z: number): number {
    return this.coarse(this.cDist, x, z);
  }

  /** Natural terrain (no road carving). */
  natural(x: number, z: number): number {
    const n = this.noise;
    const base = this.coarse(this.cBase, x, z);
    const dist = this.coarse(this.cDist, x, z);
    let h = base;
    const amp = 3.5 + 24 * smoothstep(30, 340, dist);
    h += n.fbm(x / 270, z / 270, 4) * amp;
    h += n.fbm(x / 75 + 11.3, z / 75 - 7.1, 3) * (1.4 + 2.2 * smoothstep(20, 160, dist));
    h += this.noise2.noise(x / 18, z / 18) * 0.35;
    const m = smoothstep(500, 1700, dist);
    if (m > 0) {
      h += (this.noise2.ridged(x / 1300, z / 1300, 5) * 420 - 90) * m;
    }
    for (const f of this.features) {
      const dx = x - f.x;
      const dz = z - f.z;
      h += f.h * Math.exp(-(dx * dx + dz * dz) / (2 * f.r * f.r));
    }
    return h;
  }

  /** Full analytic height including road carving. Optionally records road info for vertex k. */
  rawHeight(x: number, z: number, k = -1): number {
    const N = this.natural(x, z);
    if (this.coarse(this.cDist, x, z) > 110) {
      if (k >= 0) {
        this.roadD[k] = NaN;
        this.roadS[k] = NaN;
      }
      return N;
    }
    const p = this.track.project(x, z, 90, this.proj);
    if (!p) {
      if (k >= 0) {
        this.roadD[k] = NaN;
        this.roadS[k] = NaN;
      }
      return N;
    }
    if (k >= 0) {
      this.roadD[k] = p.d;
      this.roadS[k] = p.s;
    }
    const hw = this.track.hw[p.i] + (this.track.hw[p.i + 1] - this.track.hw[p.i]) * p.t;
    const edge = hw + SHOULDER;
    const ad = Math.abs(p.d);
    if (ad <= edge) return this.track.surfaceHeight(p.i, p.t, p.d);
    const u = ad - edge;
    // keep the first ~1.5 m beyond the shoulder coplanar with the road so grid triangles that
    // straddle the ribbon edge never poke through it; then a shallow drainage ditch
    const ditch = 0.3 * Math.sin(Math.PI * clamp((u - 1.4) / 3.4, 0, 1));
    const ext = this.track.extendedHeight(p.i, p.t, p.d) - ditch;
    const side = p.d > 0 ? 1 : -1;
    const bw = 15 + 9 * this.noise2.noise(p.s / 70, side * 3.7);
    const w = smoothstep(2.2, bw, u);
    return lerp(ext, N, w);
  }

  // ---------------------------------------------------------------------------
  // grid queries (exact match with rendered triangles)
  // ---------------------------------------------------------------------------
  inGrid(x: number, z: number): boolean {
    const fx = (x - this.x0) / this.cell;
    const fz = (z - this.z0) / this.cell;
    return fx >= 0 && fz >= 0 && fx < this.nx - 1 && fz < this.nz - 1;
  }

  /** Height from grid triangles; writes the face normal into out if provided. */
  gridHeight(x: number, z: number, out?: { nx: number; ny: number; nz: number }): number {
    let fx = (x - this.x0) / this.cell;
    let fz = (z - this.z0) / this.cell;
    if (fx < 0 || fz < 0 || fx >= this.nx - 1 || fz >= this.nz - 1) {
      fx = clamp(fx, 0, this.nx - 1.001);
      fz = clamp(fz, 0, this.nz - 1.001);
    }
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const H = this.heights;
    const ha = H[j * this.nx + i];
    const hb = H[j * this.nx + i + 1];
    const hc = H[(j + 1) * this.nx + i];
    const hd = H[(j + 1) * this.nx + i + 1];
    const c = this.cell;
    if (u + v <= 1) {
      const dhdx = (hb - ha) / c;
      const dhdz = (hc - ha) / c;
      if (out) this.setNormal(out, dhdx, dhdz);
      return ha + (hb - ha) * u + (hc - ha) * v;
    }
    const dhdx = (hd - hc) / c;
    const dhdz = (hd - hb) / c;
    if (out) this.setNormal(out, dhdx, dhdz);
    return hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
  }

  private setNormal(out: { nx: number; ny: number; nz: number }, dhdx: number, dhdz: number): void {
    const l = Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
    out.nx = -dhdx / l;
    out.ny = 1 / l;
    out.nz = -dhdz / l;
  }

  /** Height anywhere (grid inside the stage area, analytic natural terrain beyond). */
  heightAt(x: number, z: number): number {
    if (this.flatTest !== null) return this.flatTest;
    if (this.inGrid(x, z)) return this.gridHeight(x, z);
    return this.natural(x, z);
  }

  /** Debug: when set, physics sees an infinite flat hardpack plane at this height (dynamics tests). */
  flatTest: number | null = null;

  /**
   * Physics ground query. `hint` is a track segment index for coherent local projection
   * (pass -1 for a global search).
   */
  sample(x: number, z: number, hint: number, out: GroundSample): GroundSample {
    const t = this.track;
    if (this.flatTest !== null) {
      out.h = this.flatTest;
      out.nx = 0;
      out.ny = 1;
      out.nz = 0;
      out.surface = SURF_ROAD;
      out.roadness = 1;
      out.s = 0;
      out.d = 0;
      out.i = -1;
      out.dist = 0;
      return out;
    }
    let p: TrackProjection | null;
    if (hint >= 0) p = t.projectLocal(x, z, hint, 40, this.proj);
    else p = t.project(x, z, 60, this.proj);
    if (p && p.dist > 60) p = null;
    out.s = p ? p.s : -1;
    out.d = p ? p.d : 999;
    out.i = p ? p.i : -1;
    out.dist = p ? p.dist : 999;
    if (p) {
      const hw = t.hw[p.i] + (t.hw[p.i + 1] - t.hw[p.i]) * p.t;
      const ad = Math.abs(p.d);
      const edge = hw + SHOULDER;
      if (ad <= edge) {
        out.h = t.surfaceHeight(p.i, p.t, p.d);
        // analytic normal from track frame
        const th = t.heading[p.i] + (t.heading[p.i + 1] - t.heading[p.i]) * p.t;
        const slope = t.slope[p.i] + (t.slope[p.i + 1] - t.slope[p.i]) * p.t;
        const bank = t.bank[p.i] + (t.bank[p.i + 1] - t.bank[p.i]) * p.t;
        const tx = Math.sin(th);
        const tz = Math.cos(th);
        const lx = tz;
        const lz = -tx;
        // dh/dd including crown
        let dhdd = -Math.tan(bank);
        const u = Math.min(1, ad / hw);
        if (ad < hw) dhdd -= (2 * 0.07 * u * Math.sign(p.d)) / hw;
        // n = T x L
        const Tx = tx;
        const Ty = slope;
        const Tz = tz;
        const Lx = lx;
        const Ly = dhdd;
        const Lz = lz;
        let nx = Ty * Lz - Tz * Ly;
        let ny = Tz * Lx - Tx * Lz;
        let nz = Tx * Ly - Ty * Lx;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx /= l;
        ny /= l;
        nz /= l;
        out.nx = nx;
        out.ny = ny;
        out.nz = nz;
        out.surface = ad <= hw ? SURF_ROAD : SURF_SHOULDER;
        out.roadness = ad <= hw - 0.4 ? 1 : 1 - smoothstep(hw - 0.4, edge, ad) * 0.55;
        return out;
      }
      out.surface = ad <= edge + SKIRT ? SURF_SHOULDER : SURF_GRASS;
      out.roadness = ad <= edge + SKIRT ? 0.35 : 0;
    } else {
      out.surface = SURF_GRASS;
      out.roadness = 0;
    }
    if (this.inGrid(x, z)) {
      out.h = this.gridHeight(x, z, out);
    } else {
      out.h = this.natural(x, z);
      out.nx = 0;
      out.ny = 1;
      out.nz = 0;
    }
    return out;
  }
}
