// Probe which WebGL renderer Playwright gets with system Chrome in headless vs headed mode.
import { chromium } from '@playwright/test';

for (const headless of [true, false]) {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.setContent('<canvas id=c></canvas>');
  const info = await page.evaluate(() => {
    const gl = document.getElementById('c').getContext('webgl2');
    if (!gl) return 'no webgl2';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  console.log(headless ? 'headless:' : 'headed:  ', info);
  await browser.close();
}
