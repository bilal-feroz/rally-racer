import * as THREE from 'three';
import { Noise2D } from '../core/math';
import type { TerrainField } from './TerrainField';

/** Tiling ripple normal map generated from periodic noise. */
function rippleNormalMap(size = 256): THREE.DataTexture {
  const n = new Noise2D(99);
  const h = new Float32Array(size * size);
  // periodic noise by sampling a torus-mapped domain
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = (x / size) * Math.PI * 2;
      const b = (y / size) * Math.PI * 2;
      const u = Math.cos(a) * 2.2;
      const v = Math.sin(a) * 2.2;
      const w = Math.cos(b) * 2.2;
      const q = Math.sin(b) * 2.2;
      h[y * size + x] = n.noise(u + w * 0.7, v + q * 0.7) * 0.6 + n.noise(u * 2.1 - q, v * 2.1 + w) * 0.3;
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const d = h[((y - 1 + size) % size) * size + x];
      const u = h[((y + 1) % size) * size + x];
      const nx = (l - r) * 2.5;
      const ny = (d - u) * 2.5;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Lake surface: sky-reflecting PBR water with drifting ripples. */
export class Water {
  readonly mesh: THREE.Mesh | null = null;
  private readonly normal: THREE.DataTexture | null = null;

  constructor(field: TerrainField, envMap: THREE.Texture | null) {
    const L = field.lake;
    if (!L) return;
    this.normal = rippleNormalMap();
    this.normal.repeat.set(36, 36);
    const mat = new THREE.MeshStandardMaterial({
      color: '#2c5d6b',
      roughness: 0.06,
      metalness: 0.0,
      envMap,
      envMapIntensity: 1.1,
      normalMap: this.normal,
      normalScale: new THREE.Vector2(0.28, 0.28),
      transparent: true,
      opacity: 0.93,
    });
    const geo = new THREE.CircleGeometry(L.r, 72);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(L.x, L.level, L.z);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.name = 'lake';
    this.mesh = mesh;
  }

  update(time: number): void {
    if (!this.normal) return;
    this.normal.offset.set(time * 0.004, time * 0.0025);
  }
}
