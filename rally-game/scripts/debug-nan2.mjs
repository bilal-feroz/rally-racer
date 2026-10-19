import { launchGame } from './lib/harness.mjs';
const start = Number(process.argv[2] ?? 30);
const { browser, page } = await launchGame({ width: 640, height: 360 });
const rows = await page.evaluate((start) => {
  const R = window.__RALLY__; const g = window.game; R.setManual(true); R.setAutopilot(true); R.step(start);
  const rows = [];
  for (let i = 0; i < 240 * 4; i++) {
    g.update(1 / 240);
    const s = g.sim;
    if (i % 4 === 0 || s.angVel.length() > 20) rows.push([i, s.pos.x.toFixed(1), s.pos.y.toFixed(2), s.pos.z.toFixed(1), s.speed.toFixed(1), s.angVel.x.toFixed(2), s.angVel.y.toFixed(2), s.angVel.z.toFixed(2), s.up.y.toFixed(3), s.groundedWheels, s.wheels.map(w=>Math.round(w.load)).join('/'), g.field.heightAt(s.pos.x, s.pos.z).toFixed(2), s.collisionImpact.toFixed(2)].join(' '));
    if (!Number.isFinite(s.vel.x) || s.angVel.length() > 200) break;
  }
  return rows;
}, start);
console.log(rows.slice(-90).join('\n'));
await browser.close();
