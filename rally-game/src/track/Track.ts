import { clamp, DEG, lerp } from '../core/math';
import type { StageDesign } from './stageDesign';

/** Loose-gravel shoulder beyond the driven surface (m). */
export const SHOULDER = 2.4;
/** Extra road-ribbon skirt that blends into terrain (m). */
export const SKIRT = 2.2;
/** Crown height of road centre above its edges (m). */
export const CROWN = 0.07;
/** Extra fall of the outer shoulder edge (m). */
export const SHOULDER_DROP = 0.1;

export interface TrackProjection {
  /** segment index (sample i to i+1) */
  i: number;
  /** 0..1 along that segment */
  t: number;
  /** arc length along centreline (m) */
  s: number;
  /** signed lateral offset, + = left of travel direction (m) */
  d: number;
  /** absolute planar distance to the centreline (m) */
  dist: number;
}

export interface TrackFrame {
  x: number;
  y: number;
  z: number;
  /** horizontal unit tangent */
  tx: number;
  tz: number;
  /** horizontal unit left vector */
  lx: number;
  lz: number;
  heading: number;
  slope: number;
  bank: number;
  hw: number;
  kappa: number;
}

interface Jump {
  s0: number;
  h: number;
  la: number;
  ld: number;
}

function boxSmooth(src: Float64Array, radius: number, passes: number): Float64Array {
  let a = src;
  const n = a.length;
  for (let p = 0; p < passes; p++) {
    const out = new Float64Array(n);
    // prefix sums for O(n)
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - radius);
      const hi = Math.min(n - 1, i + radius);
      out[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1);
    }
    a = out;
  }
  return a;
}

export class Track {
  readonly ds = 1;
  readonly n: number;
  readonly length: number;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly heading: Float32Array;
  readonly slope: Float32Array;
  readonly bank: Float32Array;
  readonly hw: Float32Array;
  readonly kappa: Float32Array;
  readonly tags: { name: string; s0: number; s1: number }[] = [];
  readonly startS: number;
  readonly finishS: number;
  readonly gates: number[] = [];
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;

  // fine spatial grid over segment indices
  private readonly cell = 16;
  private readonly gx0: number;
  private readonly gz0: number;
  private readonly gw: number;
  private readonly gh: number;
  private readonly cellStart: Int32Array;
  private readonly cellItems: Int32Array;

  constructor(design: StageDesign) {
    const h = 0.5;
    const kap: number[] = [];
    const rise: number[] = [];
    const bankT: number[] = [];
    const hwT: number[] = [];
    const jumps: Jump[] = [];
    let s = 0;
    for (const seg of design.segments) {
      const len = seg.kind === 's' ? seg.len! : seg.r! * Math.abs(seg.ang!) * DEG;
      const steps = Math.max(1, Math.round(len / h));
      const realLen = steps * h;
      const k = seg.kind === 'a' ? Math.sign(seg.ang!) / seg.r! : 0;
      const rr = (seg.rise ?? 0) / realLen;
      const bk = seg.kind === 'a' ? Math.sign(seg.ang!) * (seg.bank ?? 2) * DEG : 0;
      const w = seg.hw ?? design.defaultHalfWidth;
      for (let j = 0; j < steps; j++) {
        kap.push(k);
        rise.push(rr);
        bankT.push(bk);
        hwT.push(w);
      }
      if (seg.tag) this.tags.push({ name: seg.tag, s0: s, s1: s + realLen });
      if (seg.jump) jumps.push({ s0: s + seg.jump.at * realLen, h: seg.jump.h, la: seg.jump.la, ld: seg.jump.ld });
      s += realLen;
    }
    const nf = kap.length + 1;
    const kS = boxSmooth(Float64Array.from([...kap, 0]), 22, 2);
    const rS = boxSmooth(Float64Array.from([...rise, 0]), 50, 2);
    const bS = boxSmooth(Float64Array.from([...bankT, 0]), 30, 2);
    const wS = boxSmooth(Float64Array.from([...hwT, hwT[hwT.length - 1]]), 40, 2);

    // integrate heading/position/elevation at fine resolution
    const fx = new Float64Array(nf);
    const fz = new Float64Array(nf);
    const fy = new Float64Array(nf);
    const fth = new Float64Array(nf);
    fx[0] = design.start.x;
    fz[0] = design.start.z;
    fy[0] = design.start.y;
    fth[0] = design.start.heading;
    for (let i = 1; i < nf; i++) {
      const thMid = fth[i - 1] + kS[i - 1] * h * 0.5;
      fx[i] = fx[i - 1] + Math.sin(thMid) * h;
      fz[i] = fz[i - 1] + Math.cos(thMid) * h;
      fth[i] = fth[i - 1] + kS[i - 1] * h;
      fy[i] = fy[i - 1] + rS[i - 1] * h;
    }
    // jumps: concave kicker ramp then smooth fall-off
    for (const j of jumps) {
      for (let i = 0; i < nf; i++) {
        const u = i * h - j.s0;
        if (u < -j.la || u > j.ld) continue;
        let add: number;
        if (u <= 0) {
          const q = 1 + u / j.la;
          add = j.h * q * q;
        } else {
          const q = u / j.ld;
          add = j.h * (1 - q * q * (3 - 2 * q));
        }
        fy[i] += add;
      }
    }
    const fyS = boxSmooth(fy, 3, 1);

    // downsample to 1 m stations
    const step = Math.round(this.ds / h);
    const n = Math.floor((nf - 1) / step) + 1;
    this.n = n;
    this.length = (n - 1) * this.ds;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.heading = new Float32Array(n);
    this.slope = new Float32Array(n);
    this.bank = new Float32Array(n);
    this.hw = new Float32Array(n);
    this.kappa = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const fi = i * step;
      this.px[i] = fx[fi];
      this.py[i] = fyS[fi];
      this.pz[i] = fz[fi];
      this.heading[i] = fth[fi];
      this.bank[i] = bS[fi];
      this.hw[i] = wS[fi];
      this.kappa[i] = kS[fi];
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      this.slope[i] = (this.py[b] - this.py[a]) / ((b - a) * this.ds);
    }

    const tagS = (name: string) => this.tags.find((t) => t.name === name);
    this.startS = 34;
    this.finishS = tagS('runoff')?.s0 ?? this.length - 120;
    this.placeGates();

    // bounds
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, this.px[i]);
      maxX = Math.max(maxX, this.px[i]);
      minZ = Math.min(minZ, this.pz[i]);
      maxZ = Math.max(maxZ, this.pz[i]);
    }
    this.minX = minX;
    this.maxX = maxX;
    this.minZ = minZ;
    this.maxZ = maxZ;

    // spatial grid of segments
    const pad = 4 * this.cell;
    this.gx0 = Math.floor((minX - pad) / this.cell);
    this.gz0 = Math.floor((minZ - pad) / this.cell);
    this.gw = Math.ceil((maxX + pad) / this.cell) - this.gx0 + 1;
    this.gh = Math.ceil((maxZ + pad) / this.cell) - this.gz0 + 1;
    const counts = new Int32Array(this.gw * this.gh);
    const cellOf = (i: number) => {
      const cx = Math.floor((this.px[i] + this.px[i + 1]) * 0.5 / this.cell) - this.gx0;
      const cz = Math.floor((this.pz[i] + this.pz[i + 1]) * 0.5 / this.cell) - this.gz0;
      return cz * this.gw + cx;
    };
    for (let i = 0; i < n - 1; i++) counts[cellOf(i)]++;
    this.cellStart = new Int32Array(this.gw * this.gh + 1);
    for (let c = 0; c < counts.length; c++) this.cellStart[c + 1] = this.cellStart[c] + counts[c];
    this.cellItems = new Int32Array(n - 1);
    const fill = new Int32Array(counts.length);
    for (let i = 0; i < n - 1; i++) {
      const c = cellOf(i);
      this.cellItems[this.cellStart[c] + fill[c]++] = i;
    }
  }

  private placeGates(): void {
    const span = this.finishS - this.startS;
    for (let g = 1; g <= 20; g++) {
      let s = this.startS + (span * g) / 20;
      if (g < 20) {
        // nudge gates off sharp curvature so they sit on readable straights/kinks
        let best = s;
        let bestK = Infinity;
        for (let o = -45; o <= 45; o += 3) {
          const k = Math.abs(this.kappaAt(s + o)) + Math.abs(o) * 0.00004;
          if (k < bestK) {
            bestK = k;
            best = s + o;
          }
        }
        s = best;
      }
      this.gates.push(s);
    }
  }

  // ---------------------------------------------------------------------------
  // station lookups
  // ---------------------------------------------------------------------------
  private idx(s: number): [number, number] {
    const f = clamp(s / this.ds, 0, this.n - 1.0001);
    const i = Math.floor(f);
    return [i, f - i];
  }

  kappaAt(s: number): number {
    const [i, t] = this.idx(s);
    return lerp(this.kappa[i], this.kappa[i + 1], t);
  }

  hwAt(s: number): number {
    const [i, t] = this.idx(s);
    return lerp(this.hw[i], this.hw[i + 1], t);
  }

  frameAt(s: number, out: TrackFrame = {} as TrackFrame): TrackFrame {
    const [i, t] = this.idx(s);
    out.x = lerp(this.px[i], this.px[i + 1], t);
    out.y = lerp(this.py[i], this.py[i + 1], t);
    out.z = lerp(this.pz[i], this.pz[i + 1], t);
    const th = lerp(this.heading[i], this.heading[i + 1], t);
    out.heading = th;
    out.tx = Math.sin(th);
    out.tz = Math.cos(th);
    out.lx = out.tz;
    out.lz = -out.tx;
    out.slope = lerp(this.slope[i], this.slope[i + 1], t);
    out.bank = lerp(this.bank[i], this.bank[i + 1], t);
    out.hw = lerp(this.hw[i], this.hw[i + 1], t);
    out.kappa = lerp(this.kappa[i], this.kappa[i + 1], t);
    return out;
  }

  /** Road surface height at station (i,t) and lateral offset d. Valid for |d| <= hw + SHOULDER + SKIRT. */
  surfaceHeight(i: number, t: number, d: number): number {
    const y = this.py[i] + (this.py[i + 1] - this.py[i]) * t;
    const bank = this.bank[i] + (this.bank[i + 1] - this.bank[i]) * t;
    const hw = this.hw[i] + (this.hw[i + 1] - this.hw[i]) * t;
    const ad = Math.abs(d);
    let h = y - Math.tan(bank) * d;
    const u = Math.min(1, ad / hw);
    h -= CROWN * u * u;
    if (ad > hw) {
      const v = Math.min(1, (ad - hw) / SHOULDER);
      h -= SHOULDER_DROP * v * v;
    }
    return h;
  }

  /** Height of the road plane extended beyond the shoulder (for terrain blending). */
  extendedHeight(i: number, t: number, d: number): number {
    const y = this.py[i] + (this.py[i + 1] - this.py[i]) * t;
    const bank = this.bank[i] + (this.bank[i + 1] - this.bank[i]) * t;
    const hw = this.hw[i] + (this.hw[i + 1] - this.hw[i]) * t;
    const edge = hw + SHOULDER;
    const ad = Math.abs(d);
    const sgn = Math.sign(d) || 1;
    const k = -Math.tan(bank);
    // slope continues on the high (outside) side, flattens on the low side
    const beyond = ad - edge;
    const outsideIsHigh = k * sgn > 0;
    const dEff = sgn * (edge + beyond * (outsideIsHigh ? 0.9 : 0.25));
    return y + k * dEff - CROWN - SHOULDER_DROP;
  }

  // ---------------------------------------------------------------------------
  // projection
  // ---------------------------------------------------------------------------
  private projectSeg(i: number, x: number, z: number, out: TrackProjection): number {
    const ax = this.px[i];
    const az = this.pz[i];
    const bx = this.px[i + 1];
    const bz = this.pz[i + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const len2 = ex * ex + ez * ez;
    let t = ((x - ax) * ex + (z - az) * ez) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + ex * t;
    const cz = az + ez * t;
    const dx = x - cx;
    const dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < out.dist) {
      out.dist = d2;
      out.i = i;
      out.t = t;
    }
    return d2;
  }

  private finishProjection(x: number, z: number, out: TrackProjection): TrackProjection {
    out.dist = Math.sqrt(out.dist);
    const i = out.i;
    const t = out.t;
    const th = this.heading[i] + (this.heading[i + 1] - this.heading[i]) * t;
    const cx = this.px[i] + (this.px[i + 1] - this.px[i]) * t;
    const cz = this.pz[i] + (this.pz[i + 1] - this.pz[i]) * t;
    // left = (cos th, -sin th)
    out.d = (x - cx) * Math.cos(th) - (z - cz) * Math.sin(th);
    out.s = (i + t) * this.ds;
    return out;
  }

  /** Global nearest-point query using the spatial grid. Returns null when nothing within maxDist. */
  project(x: number, z: number, maxDist: number, out: TrackProjection = {} as TrackProjection): TrackProjection | null {
    out.dist = maxDist * maxDist;
    out.i = -1;
    const r = Math.ceil(maxDist / this.cell);
    const cx = Math.floor(x / this.cell) - this.gx0;
    const cz = Math.floor(z / this.cell) - this.gz0;
    for (let jz = cz - r; jz <= cz + r; jz++) {
      if (jz < 0 || jz >= this.gh) continue;
      for (let jx = cx - r; jx <= cx + r; jx++) {
        if (jx < 0 || jx >= this.gw) continue;
        const c = jz * this.gw + jx;
        for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) this.projectSeg(this.cellItems[k], x, z, out);
      }
    }
    if (out.i < 0) return null;
    return this.finishProjection(x, z, out);
  }

  /** Local search around a hint index (track-coherent; ideal for vehicles). */
  projectLocal(x: number, z: number, hint: number, window: number, out: TrackProjection = {} as TrackProjection): TrackProjection {
    out.dist = Infinity;
    out.i = 0;
    const lo = Math.max(0, hint - window);
    const hi = Math.min(this.n - 2, hint + window);
    for (let i = lo; i <= hi; i++) this.projectSeg(i, x, z, out);
    return this.finishProjection(x, z, out);
  }
}
