// Find the first frame where the sim goes non-finite and dump the state around it.
import { launchGame } from './lib/harness.mjs';

const start = Number(process.argv[2] ?? 31);
const { browser, page } = await launchGame({ width: 640, height: 360 });
const res = await page.evaluate((start) => {
  const R = window.__RALLY__;
  const g = window.game;
  R.setManual(true);
  R.setAutopilot(true);
  R.step(start);
  const hist = [];
  for (let i = 0; i < 60 * 8; i++) {
    const sim = g.sim;
    const snap = {
      i,
      pos: sim.pos.toArray().map((v) => +v.toFixed(3)),
      vel: sim.vel.toArray().map((v) => +v.toFixed(3)),
      ang: sim.angVel.toArray().map((v) => +v.toFixed(3)),
      up: sim.up.toArray().map((v) => +v.toFixed(3)),
      wheels: sim.wheels.map((w) => ({ c: w.contact, comp: +w.compression.toFixed(3), load: Math.round(w.load), hint: w.hint, s: w.surface, fx: Math.round(w.fx), fy: Math.round(w.fy) })),
      groundY: +g.field.heightAt(sim.pos.x, sim.pos.z).toFixed(3),
      hint: sim.trackHint,
      inp: { ...sim.input },
    };
    hist.push(snap);
    if (hist.length > 12) hist.shift();
    // step one physics tick at a time
    for (let k = 0; k < 4; k++) {
      g.update(1 / 240);
      if (!Number.isFinite(sim.vel.x) || !Number.isFinite(sim.pos.y) || !Number.isFinite(sim.angVel.x)) {
        return { nanAt: i, sub: k, hist };
      }
    }
  }
  return { nanAt: -1, last: hist.slice(-2) };
}, start);
console.log(JSON.stringify(res, null, 1).slice(0, 12000));
await browser.close();
