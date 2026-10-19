import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math';
import { SHOULDER, type Track } from '../track/Track';
import type { Obstacle } from '../vehicle/VehicleSim';
import type { TerrainField } from './TerrainField';

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function gatePanelTexture(num: string): THREE.CanvasTexture {
  return canvasTex(128, 512, (g) => {
    g.fillStyle = '#fff6ea';
    g.fillRect(0, 0, 128, 512);
    g.fillStyle = '#ff6b1a';
    g.fillRect(0, 0, 14, 512);
    g.fillRect(114, 0, 14, 512);
    // down chevrons
    g.strokeStyle = '#ff5a14';
    g.lineWidth = 16;
    g.lineJoin = 'miter';
    for (let k = 0; k < 4; k++) {
      const y = 110 + k * 80;
      g.beginPath();
      g.moveTo(30, y);
      g.lineTo(64, y + 34);
      g.lineTo(98, y);
      g.stroke();
    }
    g.fillStyle = '#1b1f27';
    g.font = 'bold 58px Arial';
    g.textAlign = 'center';
    g.fillText(num, 64, 74);
  });
}

function bannerTexture(text: string, checker: boolean): THREE.CanvasTexture {
  return canvasTex(1024, 128, (g) => {
    g.fillStyle = '#1b1f27';
    g.fillRect(0, 0, 1024, 128);
    if (checker) {
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 64; x++) {
          g.fillStyle = (x + y) % 2 ? '#f4f1ea' : '#16181d';
          g.fillRect(x * 16, y * 16, 16, 16);
          g.fillRect(x * 16, 96 + y * 16, 16, 16);
        }
    } else {
      g.fillStyle = '#ff6b1a';
      g.fillRect(0, 0, 1024, 14);
      g.fillRect(0, 114, 1024, 14);
    }
    g.fillStyle = '#f4f1ea';
    g.font = 'bold 72px Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 512, 66);
  });
}

function chevronTexture(): THREE.CanvasTexture {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = '#ffc61a';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#16181d';
    g.beginPath();
    g.moveTo(34, 18);
    g.lineTo(70, 18);
    g.lineTo(104, 64);
    g.lineTo(70, 110);
    g.lineTo(34, 110);
    g.lineTo(68, 64);
    g.closePath();
    g.fill();
    g.strokeStyle = '#16181d';
    g.lineWidth = 8;
    g.strokeRect(4, 4, 120, 120);
  });
}

export interface PropLayout {
  reserved: { x: number; z: number; r: number }[];
}

/** Rally furniture: gate pillars, start/finish arches, chevron boards, spectators, fences, tower. */
export class Props {
  readonly group = new THREE.Group();
  readonly obstacles: Obstacle[] = [];
  readonly reserved: { x: number; z: number; r: number }[] = [];
  private readonly hash = new Map<number, Obstacle[]>();

  constructor(
    readonly track: Track,
    readonly field: TerrainField,
    seed: number,
  ) {
    this.group.name = 'props';
    const T = track;
    // reserve areas so trees don't grow inside the furniture
    for (const s of T.gates) {
      const f = T.frameAt(s);
      for (const side of [1, -1]) {
        const off = f.hw + SHOULDER + 6;
        this.reserved.push({ x: f.x + f.lx * off * side, z: f.z + f.lz * off * side, r: 8 });
      }
    }
    for (const s of [T.startS, T.finishS]) {
      const f = T.frameAt(s);
      this.reserved.push({ x: f.x, z: f.z, r: 30 });
    }
    void seed;
  }

  /** Must be called after terrain heights exist. */
  build(seed: number): void {
    const T = this.track;
    const F = this.field;
    const rnd = mulberry32(seed + 77);
    const dark = new THREE.MeshLambertMaterial({ color: '#2a2d33' });
    const wood = new THREE.MeshLambertMaterial({ color: '#7b5a3f', flatShading: true });
    const metal = new THREE.MeshLambertMaterial({ color: '#c9ccd2' });

    // ---------------------------------------------------------------- gates
    const pillarGeo = new THREE.BoxGeometry(0.62, 3.4, 0.22);
    pillarGeo.translate(0, 2.55, 0);
    const baseGeo = new THREE.BoxGeometry(0.9, 0.5, 0.7);
    baseGeo.translate(0, 0.25, 0);
    const poleGeo = new THREE.BoxGeometry(0.12, 0.9, 0.12);
    poleGeo.translate(0, 0.6, 0);
    T.gates.forEach((s, gi) => {
      if (gi === T.gates.length - 1) return; // finish has its own arch
      const f = T.frameAt(s);
      const tex = gatePanelTexture(String(gi + 1));
      const panelMat = new THREE.MeshLambertMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.45 });
      for (const side of [1, -1]) {
        const off = f.hw + SHOULDER + 0.9;
        const x = f.x + f.lx * off * side;
        const z = f.z + f.lz * off * side;
        const y = F.heightAt(x, z);
        const g = new THREE.Group();
        const pillar = new THREE.Mesh(pillarGeo, [dark, dark, dark, dark, panelMat, panelMat]);
        pillar.castShadow = true;
        const base = new THREE.Mesh(baseGeo, dark);
        base.castShadow = true;
        const pole = new THREE.Mesh(poleGeo, metal);
        g.add(pillar, base, pole);
        g.position.set(x, y, z);
        g.rotation.y = f.heading;
        this.group.add(g);
        this.addObstacle(x, z, 0.45);
        // spectators behind some gates
        if (gi % 3 === 1 && side === (gi % 2 ? 1 : -1)) this.spectators(f.x + f.lx * (off + 5) * side, f.z + f.lz * (off + 5) * side, f.heading, rnd);
      }
    });

    // ---------------------------------------------------------------- start / finish arches
    this.arch(T.startS, bannerTexture('BLACK PINE RIDGE  ·  START', false), dark);
    this.arch(T.finishS, bannerTexture('FINISH', true), dark);

    // ---------------------------------------------------------------- chevron boards at tight corners
    const chevTex = chevronTexture();
    const chevMat = new THREE.MeshLambertMaterial({ map: chevTex, side: THREE.DoubleSide });
    const boardGeo = new THREE.PlaneGeometry(0.9, 0.9);
    const postGeo = new THREE.BoxGeometry(0.08, 1.2, 0.08);
    postGeo.translate(0, 0.6, 0);
    let lastS = -100;
    for (let s = T.startS + 50; s < T.finishS; s += 6) {
      const k = T.kappaAt(s);
      if (Math.abs(k) < 1 / 95) continue;
      if (s - lastS < 13) continue;
      // only place on the visible approach and through the corner
      lastS = s;
      const f = T.frameAt(s);
      const outside = -Math.sign(k); // outside of the turn
      const off = f.hw + SHOULDER + 1.6;
      const x = f.x + f.lx * off * outside;
      const z = f.z + f.lz * off * outside;
      const y = F.heightAt(x, z);
      const g = new THREE.Group();
      const post = new THREE.Mesh(postGeo, wood);
      const board = new THREE.Mesh(boardGeo, chevMat);
      board.position.y = 1.55;
      // face back toward approaching traffic
      board.rotation.y = Math.PI;
      // texture arrow points right; mirror it for left-handers
      if (outside < 0) board.scale.x = -1;
      g.add(post, board);
      g.position.set(x, y, z);
      g.rotation.y = f.heading;
      post.castShadow = true;
      board.castShadow = true;
      this.group.add(g);
      this.addObstacle(x, z, 0.15);
    }

    // ---------------------------------------------------------------- fences along a few straights
    const fenceRail = new THREE.BoxGeometry(0.06, 0.08, 1);
    void fenceRail;
    const banked = T.tags.find((t) => t.name === 'banked');
    if (banked) this.fence(banked.s0 - 60, banked.s0 - 5, 1, wood);
    const valley = T.tags.find((t) => t.name === 'valley');
    if (valley) this.fence(valley.s0 + 10, valley.s1 - 20, -1, wood);
    const fin = T.tags.find((t) => t.name === 'finish');
    if (fin) {
      this.fence(fin.s1 - 140, fin.s1 + 60, 1, wood);
      this.fence(fin.s1 - 140, fin.s1 + 60, -1, wood);
    }

    // ---------------------------------------------------------------- water tower landmark near the banked corner
    if (banked) {
      const f = T.frameAt(banked.s0 + 60);
      const x = f.x + f.lx * 70;
      const z = f.z + f.lz * 70;
      this.waterTower(x, F.heightAt(x, z), z, wood);
    }
    // cabins near the start
    const st = T.frameAt(T.startS + 12);
    for (const side of [1, -1]) {
      const x = st.x + st.lx * (st.hw + 16) * side;
      const z = st.z + st.lz * (st.hw + 16) * side;
      this.cabin(x, F.heightAt(x, z), z, st.heading + (side > 0 ? 0.2 : -0.3), wood);
    }
    // spectators at start/finish
    for (const s of [T.startS + 20, T.finishS - 10, T.finishS + 25]) {
      const f = T.frameAt(s);
      for (const side of [1, -1]) {
        this.spectators(f.x + f.lx * (f.hw + 9) * side, f.z + f.lz * (f.hw + 9) * side, f.heading, rnd);
      }
    }
  }

  private key(ix: number, iz: number): number {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  addObstacle(x: number, z: number, r: number, h = 4): void {
    const o = { x, z, r, y: this.field.heightAt(x, z) - 0.5, h: h + 0.5 };
    this.obstacles.push(o);
    const k = this.key(Math.floor(x / 8), Math.floor(z / 8));
    let arr = this.hash.get(k);
    if (!arr) this.hash.set(k, (arr = []));
    arr.push(o);
  }

  query(x: number, z: number, radius: number, out: Obstacle[], start: number): number {
    let n = start;
    const r = radius + 1.5;
    for (let iz = Math.floor((z - r) / 8); iz <= Math.floor((z + r) / 8); iz++)
      for (let ix = Math.floor((x - r) / 8); ix <= Math.floor((x + r) / 8); ix++) {
        const arr = this.hash.get(this.key(ix, iz));
        if (arr) for (const o of arr) out[n++] = o;
      }
    return n;
  }

  private arch(s: number, tex: THREE.Texture, mat: THREE.Material): void {
    const T = this.track;
    const F = this.field;
    const f = T.frameAt(s);
    const half = f.hw + SHOULDER + 1.2;
    const g = new THREE.Group();
    const postGeo = new THREE.BoxGeometry(0.45, 6.2, 0.45);
    postGeo.translate(0, 3.1, 0);
    for (const side of [1, -1]) {
      const x = f.x + f.lx * half * side;
      const z = f.z + f.lz * half * side;
      const p = new THREE.Mesh(postGeo, mat);
      p.position.set(x, F.heightAt(x, z), z);
      p.castShadow = true;
      g.add(p);
      this.addObstacle(x, z, 0.4);
    }
    const bannerMat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 1.25), bannerMat);
    banner.position.set(f.x, f.y + 5.4, f.z);
    banner.rotation.y = f.heading + Math.PI;
    banner.castShadow = true;
    g.add(banner);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.4, 0.3, 0.3), mat);
    beam.position.set(f.x, f.y + 6.1, f.z);
    beam.rotation.y = f.heading;
    beam.castShadow = true;
    g.add(beam);
    this.group.add(g);
  }

  private spectators(x: number, z: number, heading: number, rnd: () => number): void {
    const F = this.field;
    const jackets = ['#d64545', '#3f7bd6', '#f2b233', '#3fa66b', '#e8e2d6', '#7a4fd0', '#ff7b2e'];
    const parts: THREE.BufferGeometry[] = [];
    const colors: THREE.Color[] = [];
    const n = 4 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
      const px = x + (rnd() - 0.5) * 6;
      const pz = z + (rnd() - 0.5) * 3;
      const y = F.heightAt(px, pz);
      const h = 1.6 + rnd() * 0.25;
      const body = new THREE.BoxGeometry(0.46, h * 0.5, 0.3);
      body.translate(px, y + h * 0.55, pz);
      const legs = new THREE.BoxGeometry(0.36, h * 0.32, 0.24);
      legs.translate(px, y + h * 0.16, pz);
      const head = new THREE.IcosahedronGeometry(0.15, 0);
      head.translate(px, y + h * 0.9, pz);
      parts.push(body, legs, head);
      colors.push(new THREE.Color(jackets[Math.floor(rnd() * jackets.length)]), new THREE.Color('#2e3440'), new THREE.Color('#e0b48e'));
      this.addObstacle(px, pz, 0.35);
    }
    // bake vertex colours
    const colored = parts.map((p, i) => {
      const g = p.index ? p.toNonIndexed() : p;
      const c = colors[i];
      const arr = new Float32Array(g.getAttribute('position').count * 3);
      for (let k = 0; k < arr.length; k += 3) {
        arr[k] = c.r;
        arr[k + 1] = c.g;
        arr[k + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      g.deleteAttribute('uv');
      return g;
    });
    const merged = mergeGeometries(colored);
    const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    mesh.castShadow = true;
    void heading;
    this.group.add(mesh);
  }

  private fence(s0: number, s1: number, side: number, mat: THREE.Material): void {
    const T = this.track;
    const F = this.field;
    const parts: THREE.BufferGeometry[] = [];
    const step = 3;
    let prev: THREE.Vector3 | null = null;
    for (let s = s0; s <= s1; s += step) {
      const f = T.frameAt(s);
      const off = f.hw + SHOULDER + 3.2;
      const x = f.x + f.lx * off * side;
      const z = f.z + f.lz * off * side;
      const y = F.heightAt(x, z);
      const post = new THREE.BoxGeometry(0.14, 1.2, 0.14);
      post.translate(x, y + 0.55, z);
      parts.push(post);
      const cur = new THREE.Vector3(x, y, z);
      if (prev) {
        for (const h of [0.55, 0.95]) {
          const len = prev.distanceTo(cur);
          const rail = new THREE.BoxGeometry(0.06, 0.1, len + 0.1);
          const mid = prev.clone().lerp(cur, 0.5);
          const yaw = Math.atan2(cur.x - prev.x, cur.z - prev.z);
          const pitch = Math.atan2(cur.y - prev.y, Math.hypot(cur.x - prev.x, cur.z - prev.z));
          rail.rotateX(-pitch);
          rail.rotateY(yaw);
          rail.translate(mid.x, mid.y + h, mid.z);
          parts.push(rail);
        }
      }
      this.addObstacle(x, z, 0.2);
      prev = cur;
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts.map((p) => p.toNonIndexed())), mat);
    mesh.castShadow = true;
    this.group.add(mesh);
  }

  private waterTower(x: number, y: number, z: number, wood: THREE.Material): void {
    const g = new THREE.Group();
    const legGeo = new THREE.BoxGeometry(0.35, 12, 0.35);
    legGeo.translate(0, 6, 0);
    for (const [dx, dz] of [
      [-2, -2],
      [2, -2],
      [-2, 2],
      [2, 2],
    ]) {
      const l = new THREE.Mesh(legGeo, wood);
      l.position.set(dx, 0, dz);
      l.castShadow = true;
      g.add(l);
    }
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 4.5, 12), new THREE.MeshLambertMaterial({ color: '#cfc3ad', flatShading: true }));
    tank.position.y = 14.2;
    tank.castShadow = true;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 2.2, 12), new THREE.MeshLambertMaterial({ color: '#9a4b3a', flatShading: true }));
    roof.position.y = 17.5;
    roof.castShadow = true;
    g.add(tank, roof);
    g.position.set(x, y, z);
    this.group.add(g);
    this.addObstacle(x, z, 3.2);
  }

  private cabin(x: number, y: number, z: number, yaw: number, wood: THREE.Material): void {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 5), wood);
    body.position.y = 1.4;
    body.castShadow = true;
    const roofMat = new THREE.MeshLambertMaterial({ color: '#8e3b32', flatShading: true });
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 4.2, 2.4, 4, 1), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1.25, 1, 0.9);
    roof.position.y = 4.1;
    roof.castShadow = true;
    g.add(body, roof);
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    this.group.add(g);
    this.addObstacle(x, z, 3.6);
  }
}
