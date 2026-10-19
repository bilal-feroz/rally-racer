import { expect, test } from '@playwright/test';
import { expectFinite, openGame, step, tel } from './helpers';

test.describe('full stage drive', () => {
  test('autopilot completes all 20 gates in order through the real physics', async ({ page }) => {
    const errors: string[] = [];
    await openGame(page, errors);
    await page.evaluate(() => (window as any).__RALLY__.setAutopilot(true));
    let lastGate = 0;
    let maxAbsD = 0;
    let minClearance = Infinity;
    let maxAir = 0;
    let t = await tel(page);
    const log: string[] = [];
    for (let i = 0; i < 300 && t.state !== 'finished'; i++) {
      t = await step(page, 0.5);
      expectFinite(t);
      // gates only ever advance by one at a time and never go backwards
      expect(t.gate).toBeGreaterThanOrEqual(lastGate);
      expect(t.gate - lastGate).toBeLessThanOrEqual(1);
      lastGate = t.gate;
      maxAbsD = Math.max(maxAbsD, Math.abs(t.d));
      minClearance = Math.min(minClearance, t.pos.y - t.groundY);
      maxAir = Math.max(maxAir, t.lastAirTime);
      if (i % 10 === 0) log.push(`t=${t.time.toFixed(1)} s=${t.s.toFixed(0)} gate=${t.gate} mph=${t.mph.toFixed(0)} d=${t.d.toFixed(1)}`);
    }
    console.log(log.join('\n'));
    console.log(`finish=${t.finishTime.toFixed(3)}s maxAbsD=${maxAbsD.toFixed(2)} minClearance=${minClearance.toFixed(2)} maxAir=${maxAir.toFixed(2)} recoveries=${t.recoveries}`);
    expect(t.state).toBe('finished');
    expect(t.gate).toBe(20);
    expect(t.finishTime).toBeGreaterThan(55);
    expect(t.finishTime).toBeLessThan(150);
    // car never sank through the world
    expect(minClearance).toBeGreaterThan(-0.2);
    // there is at least one real jump on the stage
    expect(maxAir).toBeGreaterThan(0.3);
    expect(t.recoveries).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test('jump: the car gets airborne over the crest and lands on its wheels', async ({ page }) => {
    const errors: string[] = [];
    await openGame(page, errors);
    const track = await page.evaluate(() => (window as any).__RALLY__.track());
    const jump = track.tags.find((g: { name: string }) => g.name === 'jump1');
    await page.evaluate((s) => {
      const R = (window as any).__RALLY__;
      R.teleport(s - 140, 0, 30);
      R.setAutopilot(true);
    }, jump.s0);
    let air = 0;
    let t = await tel(page);
    for (let i = 0; i < 80; i++) {
      t = await step(page, 0.1);
      air = Math.max(air, t.airTime, t.lastAirTime);
    }
    expect(air).toBeGreaterThan(0.3);
    expect(t.upY).toBeGreaterThan(0.9);
    expect(t.grounded).toBeGreaterThanOrEqual(3);
    expect(errors).toEqual([]);
  });

  test('banked corner tilts the car with the road and keeps it on the surface', async ({ page }) => {
    const errors: string[] = [];
    await openGame(page, errors);
    const track = await page.evaluate(() => (window as any).__RALLY__.track());
    const banked = track.tags.find((g: { name: string }) => g.name === 'banked');
    await page.evaluate((s) => {
      const R = (window as any).__RALLY__;
      R.teleport(s - 60, 0, 22);
      R.setAutopilot(true);
    }, banked.s0);
    let maxRoll = 0;
    let maxD = 0;
    for (let i = 0; i < 40; i++) {
      const t = await step(page, 0.1);
      maxRoll = Math.max(maxRoll, Math.abs(t.rollDeg));
      maxD = Math.max(maxD, Math.abs(t.d));
      expect(t.pos.y - t.groundY).toBeGreaterThan(-0.2);
    }
    // the road is banked ~15 degrees: the car must visibly lean with it
    expect(maxRoll).toBeGreaterThan(9);
    expect(maxD).toBeLessThan(5);
    expect(errors).toEqual([]);
  });
});
