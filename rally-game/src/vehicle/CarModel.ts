import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAR } from './VehicleParams';
import type { VehicleSim } from './VehicleSim';

type Ring = { z: number; pts: [number, number][] };

/** Build a closed loft from rings ordered front(+z) -> rear(-z), points CCW seen from the front. */
function loft(rings: Ring[], capFront = true, capRear = true): THREE.BufferGeometry {
  const pos: number[] = [];
  const M = rings[0].pts.length;
  const P = (r: number, k: number) => {
    const ring = rings[r];
    const p = ring.pts[k % M];
    return [p[0], p[1], ring.z];
  };
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  for (let r = 0; r < rings.length - 1; r++) {
    for (let k = 0; k < M; k++) {
      const A = P(r, k);
      const B = P(r, k + 1);
      const C = P(r + 1, k);
      const D = P(r + 1, k + 1);
      tri(A, C, B);
      tri(C, D, B);
    }
  }
  const cap = (r: number, reverse: boolean) => {
    const ring = rings[r];
    let cx = 0;
    let cy = 0;
    for (const p of ring.pts) {
      cx += p[0];
      cy += p[1];
    }
    const c = [cx / M, cy / M, ring.z];
    for (let k = 0; k < M; k++) {
      const a = P(r, k);
      const b = P(r, k + 1);
      if (reverse) tri(c, b, a);
      else tri(c, a, b);
    }
  };
  if (capFront) cap(0, false);
  if (capRear) cap(rings.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Body cross-section. When `cut` is set the lower side steps in to form a boxy wheel opening
 * whose ceiling is at `cut` (m).
 */
function bodyRing(z: number, w: number, yb: number, ym: number, yt: number, crown = 0.02, cut = 0): Ring {
  const cx = 0.6;
  const half: [number, number][] = cut
    ? [
        [cx, yb],
        [cx, yb + 0.1],
        [cx, cut],
        [w - 0.02, Math.max(cut + 0.015, yt - 0.05)],
        [w - 0.13, yt],
      ]
    : [
        [w - 0.07, yb],
        [w, yb + 0.1],
        [w + 0.012, ym],
        [w - 0.02, yt - 0.05],
        [w - 0.13, yt],
      ];
  const pts: [number, number][] = [[0, yb - 0.01]];
  for (const p of half) pts.push(p);
  pts.push([0, yt + crown]);
  for (let i = half.length - 1; i >= 0; i--) pts.push([-half[i][0], half[i][1]]);
  return { z, pts };
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Inset polygon (convex, planar) by distance in its plane, pushed out along its normal. */
function insetPane(corners: THREE.Vector3[], inset: number, lift: number): THREE.BufferGeometry {
  const n = corners.length;
  const centroid = new THREE.Vector3();
  corners.forEach((c) => centroid.add(c));
  centroid.divideScalar(n);
  const normal = new THREE.Vector3()
    .subVectors(corners[1], corners[0])
    .cross(new THREE.Vector3().subVectors(corners[2], corners[0]))
    .normalize();
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const p = corners[i];
    const prev = corners[(i + n - 1) % n];
    const next = corners[(i + 1) % n];
    const e1 = new THREE.Vector3().subVectors(p, prev).normalize();
    const e2 = new THREE.Vector3().subVectors(next, p).normalize();
    // inward normals of the two edges (in plane)
    const n1 = new THREE.Vector3().crossVectors(normal, e1).normalize();
    const n2 = new THREE.Vector3().crossVectors(normal, e2).normalize();
    const bis = new THREE.Vector3().addVectors(n1, n2).normalize();
    const cosHalf = Math.max(0.3, bis.dot(n1));
    // make sure inward points toward centroid
    if (bis.dot(new THREE.Vector3().subVectors(centroid, p)) < 0) bis.negate();
    out.push(p.clone().addScaledVector(bis, inset / cosHalf).addScaledVector(normal, lift));
  }
  const pos: number[] = [];
  for (let i = 1; i < n - 1; i++) pos.push(...out[0].toArray(), ...out[i].toArray(), ...out[i + 1].toArray());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function makeToonGradient(): THREE.DataTexture {
  const data = new Uint8Array([90, 90, 90, 255, 168, 168, 168, 255, 236, 236, 236, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function textTexture(text: string, w: number, h: number, bg: string, fg: string, font: string, border = ''): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = Math.max(2, h * 0.08);
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
  }
  g.fillStyle = fg;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + h * 0.04);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const OUTLINE_VS = /* glsl */ `
uniform float uWidth;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  float w = uWidth * (1.0 + 0.045 * max(-mv.z - 6.0, 0.0));
  mv.xyz += n * w;
  gl_Position = projectionMatrix * mv;
}`;
const OUTLINE_FS = /* glsl */ `
uniform vec3 uColor;
void main() { gl_FragColor = vec4(uColor, 1.0); }`;

export class CarModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly wheels: { pivot: THREE.Group; spin: THREE.Group }[] = [];
  readonly tailMat: THREE.MeshLambertMaterial;
  readonly headMat: THREE.MeshLambertMaterial;
  readonly flame: THREE.Sprite;
  readonly paint: THREE.Material;
  private outlineMat: THREE.ShaderMaterial;
  private readonly cgY = 0.48;

  constructor(envMap: THREE.Texture | null = null) {
    const grad = makeToonGradient();
    // glossy clear-coated paint reflecting the sky; falls back to toon if no env map
    this.paint = envMap
      ? new THREE.MeshPhysicalMaterial({ color: '#d01620', roughness: 0.45, metalness: 0.0, clearcoat: 0.55, clearcoatRoughness: 0.16, envMap, envMapIntensity: 0.32 })
      : new THREE.MeshToonMaterial({ color: '#c3141c', gradientMap: grad });
    const paintDark = envMap
      ? new THREE.MeshPhysicalMaterial({ color: '#8f0d14', roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.2, envMap, envMapIntensity: 0.6 })
      : new THREE.MeshToonMaterial({ color: '#8f0d14', gradientMap: grad });
    const black = new THREE.MeshToonMaterial({ color: '#1d1d21', gradientMap: grad });
    const trim = new THREE.MeshToonMaterial({ color: '#2b2b30', gradientMap: grad });
    const white = new THREE.MeshToonMaterial({ color: '#f2f0ea', gradientMap: grad });
    const glass = envMap
      ? new THREE.MeshPhysicalMaterial({ color: '#0f1a2e', roughness: 0.06, metalness: 0.0, clearcoat: 1, envMap, envMapIntensity: 1.25 })
      : new THREE.MeshPhongMaterial({ color: '#1a2741', specular: '#7a95c0', shininess: 90 });
    const chrome = new THREE.MeshPhongMaterial({ color: '#b9bec6', specular: '#ffffff', shininess: 120 });
    this.tailMat = new THREE.MeshLambertMaterial({ color: '#ff5a2a', emissive: '#ff2a10', emissiveIntensity: 0.55 });
    this.headMat = new THREE.MeshLambertMaterial({ color: '#fffbe8', emissive: '#fff3c4', emissiveIntensity: 0.35 });
    const amber = new THREE.MeshLambertMaterial({ color: '#ffb02e', emissive: '#ff9a00', emissiveIntensity: 0.25 });
    this.outlineMat = new THREE.ShaderMaterial({
      uniforms: { uWidth: { value: 0.021 }, uColor: { value: new THREE.Color('#141014') } },
      vertexShader: OUTLINE_VS,
      fragmentShader: OUTLINE_FS,
      side: THREE.BackSide,
    });

    this.root.add(this.body);
    this.body.position.y = -this.cgY;
    const add = (g: THREE.BufferGeometry, m: THREE.Material, outline = false, shadow = true) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = shadow;
      mesh.receiveShadow = false;
      this.body.add(mesh);
      if (outline) this.addOutline(g);
      return mesh;
    };

    // ------------------------------------------------------------ lower body
    const fa = CAR.frontAxleZ;
    const ra = CAR.rearAxleZ;
    const arch = 0.5;
    const rings: Ring[] = [
      bodyRing(2.09, 0.74, 0.40, 0.53, 0.6, 0.0),
      bodyRing(2.0, 0.83, 0.33, 0.48, 0.69),
      bodyRing(fa + arch + 0.02, 0.86, 0.31, 0.5, 0.74),
      bodyRing(fa + arch, 0.86, 0.31, 0.5, 0.745, 0.02, 0.71),
      bodyRing(fa - arch, 0.87, 0.29, 0.52, 0.83, 0.02, 0.72),
      bodyRing(fa - arch - 0.02, 0.87, 0.29, 0.52, 0.835),
      bodyRing(0.0, 0.87, 0.28, 0.52, 0.87),
      bodyRing(ra + arch + 0.02, 0.87, 0.29, 0.53, 0.89),
      bodyRing(ra + arch, 0.87, 0.29, 0.53, 0.89, 0.02, 0.72),
      bodyRing(ra - arch, 0.86, 0.32, 0.54, 0.925, 0.02, 0.73),
      bodyRing(ra - arch - 0.02, 0.86, 0.32, 0.54, 0.93),
      bodyRing(-1.96, 0.84, 0.35, 0.55, 0.94),
      bodyRing(-2.07, 0.81, 0.38, 0.55, 0.9, 0.0),
    ];
    add(loft(rings), this.paint, true);

    // ------------------------------------------------------------ greenhouse
    const gh: Ring[] = [
      { z: 0.96, pts: [[0.8, 0.84], [0.77, 0.865], [-0.77, 0.865], [-0.8, 0.84]] },
      { z: 0.16, pts: [[0.8, 0.86], [0.62, 1.3], [-0.62, 1.3], [-0.8, 0.86]] },
      { z: -0.86, pts: [[0.81, 0.88], [0.62, 1.31], [-0.62, 1.31], [-0.81, 0.88]] },
      { z: -1.62, pts: [[0.8, 0.9], [0.73, 0.935], [-0.73, 0.935], [-0.8, 0.9]] },
    ];
    add(loft(gh), this.paint, true);
    const ghv = (r: number, k: number) => new THREE.Vector3(gh[r].pts[k][0], gh[r].pts[k][1], gh[r].z);
    // windshield (front pane between ring0 and ring1 top edge)
    add(insetPane([ghv(0, 2), ghv(0, 1), ghv(1, 1), ghv(1, 2)], 0.06, 0.006), glass, false, false);
    // rear window
    add(insetPane([ghv(2, 2), ghv(2, 1), ghv(3, 1), ghv(3, 2)], 0.07, 0.006), glass, false, false);
    // side windows: left (+x) then right (-x)
    for (const side of [1, -1]) {
      const kb = side > 0 ? 0 : 3;
      const kt = side > 0 ? 1 : 2;
      // main door glass between ring 0..2 (pentagon-ish, use quad over ring1-2 plus triangle)
      const quad = [ghv(1, kb), ghv(2, kb), ghv(2, kt), ghv(1, kt)];
      const pane = insetPane(side > 0 ? quad : quad.slice().reverse(), 0.055, 0.006);
      add(pane, glass, false, false);
      const q2 = [ghv(2, kb), ghv(3, kb), ghv(3, kt), ghv(2, kt)];
      add(insetPane(side > 0 ? q2 : q2.slice().reverse(), 0.07, 0.006), glass, false, false);
      const q0 = [ghv(0, kb), ghv(1, kb), ghv(1, kt)];
      add(insetPane(side > 0 ? q0 : q0.slice().reverse(), 0.06, 0.006), glass, false, false);
    }

    // ------------------------------------------------------------ arches / flares
    for (const z of [fa, ra]) {
      for (const side of [1, -1]) {
        // boxy eyebrow flare over each opening
        add(box(0.07, 0.07, 2 * arch + 0.06, side * 0.885, (z === fa ? 0.71 : 0.725) + 0.025, z), paintDark, true);
        // dark liner: ceiling + inner wall of the wheel opening
        add(box(0.3, 0.04, 2 * arch - 0.02, side * 0.74, z === fa ? 0.69 : 0.7, z), black, false, false);
        add(box(0.02, 0.42, 2 * arch - 0.02, side * 0.612, 0.5, z), black, false, false);
      }
    }

    // ------------------------------------------------------------ bumpers / trim
    add(box(1.74, 0.17, 0.2, 0, 0.4, 2.05), this.paint, true);
    add(box(1.6, 0.05, 0.22, 0, 0.3, 2.05), black, false);
    add(box(1.74, 0.16, 0.22, 0, 0.42, -2.06), this.paint, true);
    add(box(1.62, 0.05, 0.24, 0, 0.325, -2.06), black, false);
    // sill skirts
    for (const side of [1, -1]) add(box(0.06, 0.08, 1.4, side * 0.865, 0.31, -0.01), trim, false);
    // rear black panel between tail lamps
    add(box(1.5, 0.22, 0.02, 0, 0.71, -2.082), black, false, false);
    // tail lamps
    for (const side of [1, -1]) {
      add(box(0.36, 0.15, 0.04, side * 0.56, 0.72, -2.08), this.tailMat, false, false);
      add(box(0.12, 0.15, 0.041, side * 0.31, 0.72, -2.081), amber, false, false);
    }
    // centre reflector strip
    add(box(0.32, 0.035, 0.02, 0, 0.79, -2.084), this.tailMat, false, false);
    // plate
    const plateTex = textTexture('TMB 85', 256, 64, '#f4f1e6', '#1a1a1a', 'bold 44px "Arial Narrow", Arial, sans-serif', '#1a1a1a');
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.12), new THREE.MeshLambertMaterial({ map: plateTex }));
    plate.position.set(0, 0.53, -2.095);
    plate.rotation.y = Math.PI;
    this.body.add(plate);
    // badge on rear panel
    const badgeTex = textTexture('TIMBERLINE  4WD', 256, 40, '#1d1d21', '#e9e4d8', 'bold 22px Arial, sans-serif');
    const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.075), new THREE.MeshBasicMaterial({ map: badgeTex }));
    badge.position.set(0, 0.67, -2.094);
    badge.rotation.y = Math.PI;
    this.body.add(badge);
    // exhaust + tow hook
    const ex = new THREE.CylinderGeometry(0.045, 0.05, 0.3, 10);
    ex.rotateX(Math.PI / 2);
    ex.translate(0.42, 0.31, -2.05);
    add(ex, chrome, false);
    const hook = box(0.07, 0.07, 0.14, -0.05, 0.3, -2.15);
    add(hook, chrome, false);

    // headlights + grille
    add(box(1.0, 0.13, 0.03, 0, 0.5, 2.095), black, false, false);
    for (const side of [1, -1]) {
      add(box(0.3, 0.12, 0.03, side * 0.55, 0.53, 2.093), this.headMat, false, false);
      add(box(0.18, 0.09, 0.04, side * 0.3, 0.4, 2.16), this.headMat, false, false);
    }

    // ------------------------------------------------------------ rear wing
    const wing = box(1.56, 0.045, 0.34, 0, 1.08, -1.86);
    add(wing, this.paint, true);
    add(box(1.56, 0.03, 0.06, 0, 1.115, -2.0), white, false);
    for (const side of [1, -1]) {
      add(box(0.04, 0.2, 0.42, side * 0.79, 1.06, -1.86), this.paint, true);
      add(box(0.05, 0.16, 0.12, side * 0.5, 0.99, -1.83), black, false);
    }

    const numTex = textTexture('7', 128, 128, '#f2f0ea', '#151515', 'bold 96px Arial, sans-serif');
    // livery: white belt-line stripe with an orange pinstripe, door number roundels
    for (const side of [1, -1]) {
      add(box(0.012, 0.055, 3.5, side * 0.873, 0.755, -0.05), white, false, false);
      add(box(0.012, 0.018, 3.5, side * 0.874, 0.715, -0.05), amber, false, false);
      const door = new THREE.Mesh(new THREE.CircleGeometry(0.17, 20), new THREE.MeshLambertMaterial({ map: numTex }));
      door.position.set(side * 0.892, 0.52, 0.0);
      door.rotation.y = side * Math.PI / 2;
      this.body.add(door);
    }
    // mirrors
    for (const side of [1, -1]) add(box(0.14, 0.09, 0.12, side * 0.9, 0.95, 0.75), this.paint, true);
    // roof number roundel
    const roundel = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), new THREE.MeshLambertMaterial({ map: numTex }));
    roundel.rotation.x = -Math.PI / 2;
    roundel.rotation.z = Math.PI;
    roundel.position.set(0, 1.313, 0.02);
    this.body.add(roundel);
    // hood stripes / bonnet vent
    add(box(0.36, 0.02, 0.24, 0, 0.83, 1.42), trim, false, false);
    // mud flaps
    for (const side of [1, -1]) add(box(0.24, 0.16, 0.02, side * 0.6, 0.26, CAR.rearAxleZ - 0.46), black, false);

    // ------------------------------------------------------------ wheels
    const tireGeo = new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.25, 18);
    tireGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.255, 14);
    rimGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.27, 8);
    hubGeo.rotateZ(Math.PI / 2);
    const spokeGeo = new THREE.BoxGeometry(0.262, 0.035, 0.36);
    const tireMat = new THREE.MeshToonMaterial({ color: '#34343a', gradientMap: grad });
    const rimMat = new THREE.MeshToonMaterial({ color: '#d8d5cc', gradientMap: grad });
    const rimDark = new THREE.MeshToonMaterial({ color: '#3a3a3f', gradientMap: grad });
    for (let k = 0; k < 4; k++) {
      const pivot = new THREE.Group();
      const spin = new THREE.Group();
      pivot.add(spin);
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      spin.add(tire);
      spin.add(new THREE.Mesh(rimGeo, rimDark));
      spin.add(new THREE.Mesh(hubGeo, rimMat));
      for (let s = 0; s < 3; s++) {
        const sp = new THREE.Mesh(spokeGeo, rimMat);
        sp.rotation.x = (s * Math.PI) / 3;
        spin.add(sp);
      }
      this.root.add(pivot);
      this.wheels.push({ pivot, spin });
    }

    // backfire: a camera-facing fireball sprite at the exhaust tip
    const fireTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d')!;
      const grd = g.createRadialGradient(64, 64, 2, 64, 64, 62);
      grd.addColorStop(0, 'rgba(255,250,220,1)');
      grd.addColorStop(0.25, 'rgba(255,196,80,0.95)');
      grd.addColorStop(0.55, 'rgba(255,110,30,0.55)');
      grd.addColorStop(1, 'rgba(255,60,10,0)');
      g.fillStyle = grd;
      // a few lobes so it reads as a burst, not a disc
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        g.beginPath();
        g.ellipse(64 + Math.cos(a) * 14, 64 + Math.sin(a) * 14, 40, 26, a, 0, Math.PI * 2);
        g.fill();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    this.flame = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: fireTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.95 }),
    );
    this.flame.position.set(0.42, 0.31, -2.32);
    this.flame.visible = false;
    this.body.add(this.flame);

    // soft contact shadow blob under the car
    const blobTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d')!;
      const grd = g.createRadialGradient(64, 64, 8, 64, 64, 64);
      grd.addColorStop(0, 'rgba(10,14,30,0.38)');
      grd.addColorStop(0.6, 'rgba(10,14,30,0.2)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 4.8),
      new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 2;
  }

  readonly blob: THREE.Mesh;

  private addOutline(g: THREE.BufferGeometry): void {
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', g.getAttribute('position').clone());
    const merged = mergeVertices(pg, 1e-3);
    merged.computeVertexNormals();
    const m = new THREE.Mesh(merged, this.outlineMat);
    m.castShadow = false;
    this.body.add(m);
  }

  private readonly _q = new THREE.Quaternion();
  private readonly _v = new THREE.Vector3();
  private readonly _inv = new THREE.Quaternion();

  /** Sync visuals from (interpolated) physics state. */
  update(sim: VehicleSim, pos: THREE.Vector3, quat: THREE.Quaternion, braking: number, dt: number): void {
    this.root.position.copy(pos);
    this.root.quaternion.copy(quat);
    this._inv.copy(quat).invert();
    for (let k = 0; k < 4; k++) {
      const w = sim.wheels[k];
      const vis = this.wheels[k];
      // wheel centre in local space: mount minus extension along local -Y
      const ext = CAR.travel - w.compression;
      vis.pivot.position.set(w.mount.x, w.mount.y - Math.max(0, ext), w.mount.z);
      vis.pivot.rotation.set(0, -w.steer, 0);
      vis.spin.rotation.x = w.spinAngle;
    }
    this.tailMat.emissiveIntensity = 0.5 + braking * 2.6;
    this.tailMat.color.set(braking > 0.1 ? '#ff6a3a' : '#ff5a2a');
    // flame
    if (sim.backfire > 0.05 && Math.random() < 0.55) {
      this.flame.visible = true;
      const s = (0.35 + Math.random() * 0.45) * (0.5 + sim.backfire * 0.6);
      this.flame.scale.set(s * 1.3, s, 1);
      this.flame.material.rotation = Math.random() * Math.PI * 2;
    } else this.flame.visible = false;
    void dt;
  }

  /** Place the blob shadow on the ground under the car. */
  placeBlob(x: number, y: number, z: number, heading: number, nx: number, ny: number, nz: number, height: number): void {
    this.blob.position.set(x, y + 0.03, z);
    this._v.set(nx, ny, nz);
    this._q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this._v);
    this.blob.quaternion.copy(this._q);
    this.blob.rotateY(heading);
    this.blob.rotateX(-Math.PI / 2);
    const fade = Math.max(0, 1 - height / 3);
    (this.blob.material as THREE.MeshBasicMaterial).opacity = fade;
    this.blob.visible = fade > 0.02;
  }
}
