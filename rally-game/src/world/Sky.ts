import * as THREE from 'three';
import { PALETTE } from './Atmosphere';

/** Stylised sky dome: vivid gradient, sun glow and soft painterly clouds. */
export function createSky(): THREE.Mesh {
  const P = PALETTE;
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uZenith: { value: P.zenith.clone() },
      uMid: { value: P.skyMid.clone() },
      uHorizon: { value: P.horizon.clone() },
      uSunDir: { value: P.sunDir.clone() },
      uSunCol: { value: new THREE.Color('#fff4dc') },
      uFogSun: { value: P.fogSun.clone() },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
        vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position, 1.0)).xyz, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uMid, uHorizon, uSunDir, uSunCol, uFogSun;
      uniform float uTime;
      varying vec3 vDir;
      float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vnoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      float fbm(vec2 p) {
        float s = 0.0, a = 0.5;
        mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
        for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = r * p * 2.03 + 7.1; a *= 0.5; }
        return s;
      }
      void main() {
        vec3 d = normalize(vDir);
        float e = d.y;
        // gradient
        float t1 = smoothstep(-0.02, 0.22, e);
        float t2 = smoothstep(0.18, 0.75, e);
        vec3 col = mix(uHorizon, uMid, t1);
        col = mix(col, uZenith, t2);
        float sd = max(dot(d, uSunDir), 0.0);
        // warm glow near sun + horizon scattering
        col = mix(col, uFogSun, pow(sd, 6.0) * 0.45 * (1.0 - t2 * 0.5));
        col += uSunCol * (pow(sd, 800.0) * 4.0 + pow(sd, 90.0) * 0.35);
        // clouds on a virtual plane
        if (e > 0.0) {
          vec2 uv = d.xz / (e + 0.12) * 1.35 + vec2(uTime * 0.004, uTime * 0.002);
          float n = fbm(uv * 1.1);
          float cov = smoothstep(0.50, 0.70, n + 0.06 * sin(uv.x * 0.7));
          // fake self-shadow: sample toward the sun
          float n2 = fbm(uv * 1.1 + uSunDir.xz * 0.12);
          float shade = clamp((n2 - n) * 5.0 + 0.6, 0.0, 1.0);
          vec3 cLit = vec3(1.0, 0.99, 0.97);
          vec3 cDark = mix(uMid, vec3(0.82, 0.86, 0.93), 0.55);
          vec3 cloud = mix(cDark, cLit, shade);
          cloud = mix(cloud, uFogSun * 1.05, pow(sd, 8.0) * 0.4);
          float fade = smoothstep(0.0, 0.14, e);
          col = mix(col, cloud, cov * fade * 0.92);
        } else {
          col = mix(uHorizon, uHorizon * 0.9, smoothstep(0.0, -0.2, e));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const geo = new THREE.SphereGeometry(1000, 48, 24);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  return mesh;
}
