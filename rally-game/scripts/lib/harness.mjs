// Shared Playwright harness: launch system Chrome on the real GPU, open the game in test mode,
// collect console errors, and expose small helpers around window.__RALLY__.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const BASE = process.env.RALLY_URL ?? 'http://127.0.0.1:5173/';

export async function launchGame({ width = 1600, height = 900, query = '', headless = true, recordVideoDir = null } = {}) {
  const browser = await chromium.launch({
    channel: process.env.RALLY_CHANNEL ?? 'chrome',
    headless,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    ...(recordVideoDir ? { recordVideo: { dir: recordVideoDir, size: { width, height } } } : {}),
  });
  const page = await context.newPage();
  const errors = [];
  const warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  const url = `${BASE}?test=1&seed=123${query ? '&' + query : ''}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__RALLY__ && window.__RALLY__.ready, null, { timeout: 60000 });
  return { browser, context, page, errors, warnings };
}

export async function shot(page, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.evaluate(() => window.__RALLY__.render());
  await page.screenshot({ path: file });
}

export const R = (page, fn, arg) => page.evaluate(fn, arg);
