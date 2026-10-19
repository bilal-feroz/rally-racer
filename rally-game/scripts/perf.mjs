// Real-time performance probe: the game runs on its own requestAnimationFrame loop (not manual
// stepping) with the autopilot driving; we record every frame delta in-page.
// usage: node scripts/perf.mjs [seconds=30] [width=1920] [height=1080] [headed=0]
import { launchGame } from './lib/harness.mjs';

const secs = Number(process.argv[2] ?? 30);
const W = Number(process.argv[3] ?? 1920);
const H = Number(process.argv[4] ?? 1080);
const headed = process.argv[5] === '1';
const { browser, page, errors } = await launchGame({ width: W, height: H, headless: !headed });
const res = await page.evaluate(async (secs) => {
  const R = window.__RALLY__;
  const g = window.game;
  R.setManual(false);
  R.setAutopilot(true);
  const mem0 = { geo: g.renderer.info.memory.geometries, tex: g.renderer.info.memory.textures, heap: performance.memory?.usedJSHeapSize ?? 0 };
  const deltas = [];
  let calls = 0;
  let tris = 0;
  let n = 0;
  await new Promise((resolve) => {
    let last = performance.now();
    const t0 = last;
    const tick = (now) => {
      deltas.push(now - last);
      last = now;
      calls += g.renderer.info.render.calls;
      tris += g.renderer.info.render.triangles;
      n++;
      if (now - t0 < secs * 1000) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  const t = R.telemetry();
  const mem1 = { geo: g.renderer.info.memory.geometries, tex: g.renderer.info.memory.textures, heap: performance.memory?.usedJSHeapSize ?? 0 };
  deltas.shift();
  const sorted = deltas.slice().sort((a, b) => a - b);
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    frames: deltas.length,
    avgFps: 1000 / avg,
    avgMs: avg,
    p50Ms: pct(0.5),
    p95Ms: pct(0.95),
    p99Ms: pct(0.99),
    worstMs: sorted[sorted.length - 1],
    avgCalls: calls / n,
    avgTrisK: tris / n / 1000,
    pixelRatio: g.renderer.getPixelRatio(),
    raceS: t.s,
    raceState: t.state,
    mem0,
    mem1,
    gpu: (() => {
      const gl = g.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
    })(),
  };
}, secs);
console.log(JSON.stringify(res, null, 1));
console.log('errors', JSON.stringify(errors));
await browser.close();
