import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math';

/** Low-poly vegetation geometry with baked vertex colours (non-indexed for faceted shading). */

function colorize(g: THREE.BufferGeometry, col: THREE.Color, jitter: number, rnd: () => number, topLight = 0): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const pos = ng.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  let maxY = -Infinity;
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) {
    maxY = Math.max(maxY, pos.getY(i));
    minY = Math.min(minY, pos.getY(i));
  }
  for (let f = 0; f < pos.count; f += 3) {
    const k = 1 + (rnd() - 0.5) * jitter;
    for (let v = 0; v < 3; v++) {
      const y = pos.getY(f + v);
      const t = (y - minY) / Math.max(0.001, maxY - minY);
      c.copy(col).multiplyScalar(k * (1 + topLight * (t - 0.5)));
      colors[(f + v) * 3] = c.r;
      colors[(f + v) * 3 + 1] = c.g;
      colors[(f + v) * 3 + 2] = c.b;
    }
  }
  ng.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  ng.deleteAttribute('uv');
  ng.computeVertexNormals();
  return ng;
}

function jitterVerts(g: THREE.BufferGeometry, amt: number, rnd: () => number, keepBase = false): THREE.BufferGeometry {
  // jitter shared positions consistently (indexed geometry) so faces stay connected
  const pos = g.getAttribute('position');
  const map = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let o = map.get(key);
    if (!o) {
      o = [(rnd() - 0.5) * amt, (rnd() - 0.5) * amt * 0.6, (rnd() - 0.5) * amt];
      map.set(key, o);
    }
    if (keepBase && pos.getY(i) < 0.01) continue;
    pos.setXYZ(i, pos.getX(i) + o[0], pos.getY(i) + o[1], pos.getZ(i) + o[2]);
  }
  return g;
}

const TRUNK = new THREE.Color('#5b3a2c');
const TRUNK_DARK = new THREE.Color('#47302a');

function trunk(r0: number, r1: number, h: number, rnd: () => number, col = TRUNK): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, h, 6, 1, true);
  g.translate(0, h / 2, 0);
  return colorize(g, col, 0.15, rnd);
}

function coneTier(r: number, h: number, y: number, segs: number, col: THREE.Color, rnd: () => number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, segs, 1, false);
  g.translate(0, y + h / 2, 0);
  jitterVerts(g, r * 0.22, rnd);
  return colorize(g, col, 0.18, rnd, 0.35);
}

function blob(r: number, x: number, y: number, z: number, col: THREE.Color, rnd: () => number, detail = 0): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail);
  g.scale(1, 0.82, 1);
  jitterVerts(g, r * 0.28, rnd);
  g.translate(x, y, z);
  return colorize(g, col, 0.16, rnd, 0.45);
}

export interface TreeKind {
  name: string;
  high: THREE.BufferGeometry;
  low: THREE.BufferGeometry;
  /** trunk collision radius at scale 1 */
  trunkR: number;
  conifer: boolean;
}

export function buildTreeKinds(seed = 7): TreeKind[] {
  const rnd = mulberry32(seed);
  const kinds: TreeKind[] = [];
  const darkGreen = new THREE.Color('#476b48');
  const midGreen = new THREE.Color('#5d8155');
  const olive = new THREE.Color('#7a8c4f');
  const yellowGreen = new THREE.Color('#8f9f58');
  const leafDark = new THREE.Color('#5f7448');

  // --- tall spruce: stacked faceted tiers
  {
    const parts = [trunk(0.26, 0.12, 4, rnd)];
    const tiers = [
      [2.7, 4.4, 1.6],
      [2.25, 4.0, 4.3],
      [1.8, 3.6, 6.8],
      [1.35, 3.2, 9.0],
      [0.85, 3.0, 11.0],
    ];
    tiers.forEach(([r, h, y], i) => parts.push(coneTier(r, h, y, 7, darkGreen.clone().lerp(midGreen, i / 5), rnd)));
    const low = mergeGeometries([trunk(0.26, 0.12, 3, rnd), coneTier(2.6, 12.5, 1.5, 5, darkGreen, rnd)]);
    kinds.push({ name: 'spruce', high: mergeGeometries(parts), low, trunkR: 0.3, conifer: true });
  }
  // --- tall pine: long bare trunk, crown high up
  {
    const parts = [trunk(0.3, 0.16, 9.5, rnd, TRUNK_DARK)];
    const tiers = [
      [2.4, 3.6, 6.2],
      [2.0, 3.4, 8.4],
      [1.5, 3.1, 10.4],
      [0.9, 2.8, 12.3],
    ];
    tiers.forEach(([r, h, y], i) => parts.push(coneTier(r, h, y, 7, midGreen.clone().lerp(darkGreen, 0.4 + i * 0.1), rnd)));
    const low = mergeGeometries([trunk(0.3, 0.16, 7, rnd, TRUNK_DARK), coneTier(2.3, 9, 6, 5, midGreen, rnd)]);
    kinds.push({ name: 'pine', high: mergeGeometries(parts), low, trunkR: 0.34, conifer: true });
  }
  // --- young fir: short and full
  {
    const parts = [trunk(0.16, 0.08, 1.5, rnd)];
    const tiers = [
      [1.9, 2.8, 0.6],
      [1.5, 2.5, 2.2],
      [1.0, 2.3, 3.7],
    ];
    const c = new THREE.Color('#587e4d');
    tiers.forEach(([r, h, y]) => parts.push(coneTier(r, h, y, 6, c, rnd)));
    const low = mergeGeometries([coneTier(1.9, 5.5, 0.5, 5, c, rnd)]);
    kinds.push({ name: 'fir', high: mergeGeometries(parts), low, trunkR: 0.18, conifer: true });
  }
  // --- broadleaf: tall trunk with chunky faceted crown clusters high up (reference look)
  {
    const parts = [trunk(0.36, 0.2, 9.5, rnd, TRUNK_DARK)];
    // two forked limbs
    for (const sgn of [1, -1]) {
      const limb = new THREE.CylinderGeometry(0.1, 0.16, 3.4, 5, 1, true);
      limb.translate(0, 1.7, 0);
      limb.rotateZ(sgn * 0.5);
      limb.translate(0, 7.4, 0);
      parts.push(colorize(limb, TRUNK_DARK, 0.1, rnd));
    }
    const blobs = [
      [2.8, 0, 11.6, 0],
      [2.3, 1.9, 10.7, 0.8],
      [2.2, -1.8, 10.5, -0.6],
      [2.0, 0.5, 13.0, -1.2],
      [1.9, -0.7, 10.1, 1.7],
    ];
    blobs.forEach(([r, x, y, z], i) => parts.push(blob(r, x, y, z, olive.clone().lerp(yellowGreen, (i % 3) / 3), rnd)));
    const low = mergeGeometries([trunk(0.36, 0.2, 9.5, rnd, TRUNK_DARK), blob(3.5, 0, 11.4, 0, olive, rnd)]);
    kinds.push({ name: 'oak', high: mergeGeometries(parts), low, trunkR: 0.4, conifer: false });
  }
  // --- broadleaf round, lower crown
  {
    const parts = [trunk(0.28, 0.18, 3.8, rnd)];
    const blobs = [
      [2.4, 0, 5.4, 0],
      [1.9, 1.6, 4.6, 0.4],
      [1.8, -1.4, 4.8, -0.7],
      [1.6, 0.2, 6.6, 1.1],
    ];
    blobs.forEach(([r, x, y, z], i) => parts.push(blob(r, x, y, z, leafDark.clone().lerp(olive, i / 4), rnd)));
    const low = mergeGeometries([trunk(0.28, 0.18, 3.8, rnd), blob(2.9, 0, 5.3, 0, leafDark, rnd)]);
    kinds.push({ name: 'maple', high: mergeGeometries(parts), low, trunkR: 0.3, conifer: false });
  }
  return kinds;
}

export function buildBush(seed = 3): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const c = new THREE.Color('#4d7536');
  return mergeGeometries([blob(0.9, 0, 0.55, 0, c, rnd), blob(0.7, 0.75, 0.4, 0.2, c, rnd), blob(0.65, -0.6, 0.38, -0.3, c, rnd)]);
}

/** Pale grass tuft made of tapered blades (like the reference's white-tipped tufts). */
export function buildTuft(seed = 11): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const pos: number[] = [];
  const col: number[] = [];
  const base = new THREE.Color('#7f9a4e');
  const tip = new THREE.Color('#e4e6c8');
  const blades = 7;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rnd() * 0.6;
    const r = 0.06 + rnd() * 0.1;
    const h = 0.45 + rnd() * 0.45;
    const lean = 0.12 + rnd() * 0.2;
    const w = 0.035 + rnd() * 0.02;
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    const tx = bx + Math.cos(a) * lean;
    const tz = bz + Math.sin(a) * lean;
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, tx, h, tz);
    col.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function buildRock(seed = 5): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.scale(1.2, 0.7, 1);
  jitterVerts(g, 0.45, rnd);
  g.translate(0, 0.25, 0);
  return colorize(g, new THREE.Color('#9b968a'), 0.2, rnd, 0.3);
}
