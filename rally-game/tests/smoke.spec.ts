import { expect, test } from '@playwright/test';
import { canvasStats, expectFinite, openGame, setInput, step, tel } from './helpers';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

test.describe('smoke', () => {
  test('title screen renders without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Start stage' })).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('#game-canvas')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('WebGL renders a non-blank 3D scene', async ({ page }) => {
    const errors: string[] = [];
    await openGame(page, errors);
    const st = await canvasStats(page);
    expect(st.std).toBeGreaterThan(18);
    expect(st.colors).toBeGreaterThan(60);
    expect(errors).toEqual([]);
  });

  test('throttle, steering both ways, braking and handbrake work', async ({ page }) => {
    const errors: string[] = [];
    await openGame(page, errors);
    const t0 = await tel(page);
    await setInput(page, { throttle: 1 });
    const t1 = await step(page, 4);
    expect(t1.speed).toBeGreaterThan(20);
    expect(t1.s).toBeGreaterThan(t0.s + 30);
    expect(t1.grounded).toBe(4);
    expectFinite(t1);

    // braking in a straight line
    await setInput(page, { brake: 1 });
    const v0 = t1.speed;
    const tb = await step(page, 1.2);
    expect(tb.speed).toBeLessThan(v0 - 8);
    expect(Math.abs(tb.d)).toBeLessThan(1.5);

    // steer left -> heading increases (left is +heading in this world)
    await setInput(page, { throttle: 0.6 });
    await step(page, 1);
    await setInput(page, { throttle: 0.3, steer: -0.35 });
    const h0 = (await tel(page)).heading;
    const tl = await step(page, 0.5);
    expect(wrap(tl.heading - h0)).toBeGreaterThan(0.03);
    // steer right -> heading decreases
    await setInput(page, { throttle: 0.3, steer: 0.35 });
    const tr = await step(page, 0.9);
    expect(wrap(tr.heading - tl.heading)).toBeLessThan(-0.03);
    await setInput(page, { throttle: 0.3, steer: 0 });
    await step(page, 0.5);

    // handbrake from speed induces body slip
    await setInput(page, { throttle: 1 });
    await step(page, 2.5);
    await setInput(page, { steer: -1, handbrake: 1 });
    let maxSlip = 0;
    for (let i = 0; i < 6; i++) {
      const t = await step(page, 0.1);
      maxSlip = Math.max(maxSlip, Math.abs(t.bodySlipDeg));
    }
    expect(maxSlip).toBeGreaterThan(8);
    expect(errors).toEqual([]);
  });

  test('recovery restores a stable, upright pose on the road', async ({ page }) => {
    const errors: string[] = [];
    await openGame(page, errors);
    await setInput(page, { throttle: 1, steer: 1 });
    await step(page, 5); // drive off into the scenery
    await setInput(page, null);
    await page.evaluate(() => (window as any).__RALLY__.recover());
    const t = await step(page, 1.5);
    expect(Math.abs(t.d)).toBeLessThan(2);
    expect(t.upY).toBeGreaterThan(0.95);
    expect(t.grounded).toBe(4);
    expect(t.recoveries).toBe(1);
    expect(errors).toEqual([]);
  });

  test('pause, resume and restart', async ({ page }) => {
    const errors: string[] = [];
    await openGame(page, errors);
    await setInput(page, { throttle: 1 });
    await step(page, 2);
    await page.evaluate(() => (window as any).__RALLY__.pause());
    expect((await tel(page)).state).toBe('paused');
    const tp = await step(page, 1);
    expect(tp.state).toBe('paused');
    await page.evaluate(() => (window as any).__RALLY__.resume());
    expect((await tel(page)).state).toBe('racing');
    await page.evaluate(() => (window as any).__RALLY__.restart());
    const tr = await tel(page);
    expect(tr.time).toBe(0);
    expect(tr.gate).toBe(0);
    expect(errors).toEqual([]);
  });

  test('off-road grass slows the car and is reported as grass', async ({ page }) => {
    const errors: string[] = [];
    await openGame(page, errors);
    // straight section right after the start, drive onto the verge
    await page.evaluate(() => (window as any).__RALLY__.teleport(120, 11, 25));
    await setInput(page, { throttle: 0 });
    const t = await step(page, 0.5);
    expect(t.surfaces.filter((s) => s === 2).length).toBeGreaterThanOrEqual(2);
    // coasting on grass decelerates harder than on the road
    const g0 = t.speed;
    const g1 = (await step(page, 2)).speed;
    await page.evaluate(() => (window as any).__RALLY__.teleport(120, 0, 25));
    const r0 = (await step(page, 0.5)).speed;
    const r1 = (await step(page, 2)).speed;
    expect(g0 - g1).toBeGreaterThan((r0 - r1) * 1.3);
    expect(errors).toEqual([]);
  });
});
