import * as THREE from 'three';

/**
 * Global palette + aerial-perspective fog. The built-in fog shader chunks are replaced so every
 * lit material gets distance haze tinted toward the sun, matching the sky's horizon band.
 */
export const PALETTE = {
  sunDir: new THREE.Vector3(-0.45, 0.62, 0.64).normalize(),
  sunColor: new THREE.Color('#fff0d6'),
  sunIntensity: 2.9,
  hemiSky: new THREE.Color('#aecdf2'),
  hemiGround: new THREE.Color('#5d6b3c'),
  hemiIntensity: 1.55,
  zenith: new THREE.Color('#2f78d6'),
  skyMid: new THREE.Color('#62a3ea'),
  horizon: new THREE.Color('#cfe2f2'),
  fog: new THREE.Color('#c4d8ea'),
  fogSun: new THREE.Color('#f4e6cc'),
  fogDensity: 0.00052,
};

function v3(c: THREE.Color | THREE.Vector3): string {
  if (c instanceof THREE.Color) return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
  return `vec3(${c.x.toFixed(4)}, ${c.y.toFixed(4)}, ${c.z.toFixed(4)})`;
}

let installed = false;

export function installAtmosphere(): void {
  if (installed) return;
  installed = true;
  const P = PALETTE;
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorldDir;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogWorldDir = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogDensity;
  varying vec3 vFogWorldDir;
  const vec3 ATM_SUN_DIR = ${v3(P.sunDir)};
  const vec3 ATM_SUN_FOG = ${v3(P.fogSun)};
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  float fogDist = length(vFogWorldDir);
  vec3 fogDirN = vFogWorldDir / max(fogDist, 1e-4);
  float fogH = cameraPosition.y + vFogWorldDir.y;
  // thinner haze higher up so ridgelines stay readable
  float hFall = exp(-max(fogH - 40.0, 0.0) * 0.0016);
  float fogAmt = 1.0 - exp(-pow(fogDist * fogDensity, 1.35) * (0.55 + 0.45 * hFall));
  float sunAmt = pow(max(dot(fogDirN, ATM_SUN_DIR), 0.0), 5.0);
  vec3 fogCol = mix(fogColor, ATM_SUN_FOG, sunAmt * 0.65);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, clamp(fogAmt, 0.0, 1.0));
#endif`;
}

export function createLights(scene: THREE.Scene): { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight } {
  const P = PALETTE;
  const hemi = new THREE.HemisphereLight(P.hemiSky, P.hemiGround, P.hemiIntensity);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(P.sunColor, P.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -85;
  sc.right = 85;
  sc.top = 85;
  sc.bottom = -85;
  sc.near = 1;
  sc.far = 420;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.045;
  sun.shadow.radius = 2.5;
  scene.add(sun);
  scene.add(sun.target);
  return { sun, hemi };
}

/** Keep the shadow frustum centred slightly ahead of the camera focus, snapped to texels. */
export function updateSunShadow(sun: THREE.DirectionalLight, focus: THREE.Vector3): void {
  const dir = PALETTE.sunDir;
  const cam = sun.shadow.camera;
  const texel = (cam.right - cam.left) / sun.shadow.mapSize.x;
  // snap focus in light space to avoid shimmering
  const lightQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().negate());
  const inv = lightQuat.clone().invert();
  const f = focus.clone().applyQuaternion(inv);
  f.x = Math.round(f.x / texel) * texel;
  f.y = Math.round(f.y / texel) * texel;
  f.applyQuaternion(lightQuat);
  sun.target.position.copy(f);
  sun.position.copy(f).addScaledVector(dir, 200);
  sun.target.updateMatrixWorld();
}
