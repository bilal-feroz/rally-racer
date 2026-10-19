import { expect, type Page } from '@playwright/test';

export interface Telemetry {
  state: string;
  time: number;
  finishTime: number;
  pos: { x: number; y: number; z: number };
  speed: number;
  mph: number;
  forwardSpeed: number;
  heading: number;
  s: number;
  d: number;
  gate: number;
  gates: number;
  grounded: number;
  airTime: number;
  lastAirTime: number;
  bodySlipDeg: number;
  rollDeg: number;
  pitchDeg: number;
  upY: number;
  gear: number;
  rpm: number;
  surfaces: number[];
  groundY: number;
  recoveries: number;
}

export async function openGame(page: Page, errors: string[], query = ''): Promise<void> {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`/?test=1&seed=123${query ? '&' + query : ''}`);
  await page.waitForFunction(() => (window as any).__RALLY__?.ready === true, null, { timeout: 90_000 });
  await page.evaluate(() => (window as any).__RALLY__.setManual(true));
}

export function tel(page: Page): Promise<Telemetry> {
  return page.evaluate(() => (window as any).__RALLY__.telemetry());
}

export function step(page: Page, seconds: number): Promise<Telemetry> {
  return page.evaluate((s) => (window as any).__RALLY__.step(s), seconds);
}

export function setInput(page: Page, inp: Partial<{ throttle: number; brake: number; steer: number; handbrake: number }> | null): Promise<void> {
  return page.evaluate((i) => (window as any).__RALLY__.setInput(i), inp);
}

/** Read back the WebGL canvas and return luminance statistics (blank-render detection). */
export async function canvasStats(page: Page): Promise<{ mean: number; std: number; colors: number }> {
  return page.evaluate(() => {
    (window as any).__RALLY__.render();
    const src = document.getElementById('game-canvas') as HTMLCanvasElement;
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 54;
    const g = c.getContext('2d')!;
    g.drawImage(src, 0, 0, 96, 54);
    const d = g.getImageData(0, 0, 96, 54).data;
    let sum = 0;
    let sum2 = 0;
    const set = new Set<number>();
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l;
      sum2 += l * l;
      set.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
    }
    const n = d.length / 4;
    const mean = sum / n;
    return { mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), colors: set.size };
  });
}

export function expectFinite(t: Telemetry): void {
  for (const v of [t.pos.x, t.pos.y, t.pos.z, t.speed, t.heading]) expect(Number.isFinite(v)).toBe(true);
}
