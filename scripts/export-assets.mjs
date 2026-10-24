// Bake the assets built in code to GLB: node scripts/export-assets.mjs [--gap 0|3|5]
//   -> assets/specimens/t-2f[-gap<g>].glb, t-3f[-gap<g>].glb (gap 0 has no suffix)
//   -> assets/sensors/tripod-camera.glb, head-camera.glb, wrist-camera.glb, imu.glb, assets/torch/torch.glb (gap 0 only)
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { CHROME, GL_ARGS, arg } from './page.mjs';

const gap = +arg('gap', 0);
const server = await serve(0);
const browser = await chromium.launch({ executablePath: CHROME, args: GL_ARGS });
const page = await browser.newPage();
page.on('pageerror', e => console.error('pageerror', e.message));
await page.goto(`http://localhost:${server.address().port}/scripts/export-assets.html?gap=${gap}`);
await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
for (const [name, data] of Object.entries(await page.evaluate(() => window.__out))) {
  const out = `assets/${name}${gap ? `-gap${gap}` : ''}.glb`;
  fs.writeFileSync(out, Buffer.from(data, 'base64'));
  console.log(out);
}
await browser.close(); server.close();
