import { defineConfig } from '@playwright/test';

// Uses the locally installed Google Chrome (real GPU via ANGLE). Set RALLY_CHANNEL=chromium to use
// Playwright's bundled Chromium instead (requires `npx playwright install chromium`).
const channel = process.env.RALLY_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: 'tests',
  timeout: 420_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.RALLY_URL ?? 'http://127.0.0.1:5173/',
    viewport: { width: 1280, height: 720 },
    channel: channel === 'chromium' ? undefined : channel,
    headless: true,
    launchOptions: {
      args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
