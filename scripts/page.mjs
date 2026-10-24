// Shared: open the film page in headless Chrome. --project <id> picks the project, --query a=b&c=d adds params.
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';

export const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };

export async function openFilm({ project = arg('project', 'ur5e-t2f'), query = arg('query', '') } = {}) {
  const server = await serve(0);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  let fail;
  const failed = new Promise((_, rej) => { fail = rej; });
  page.on('pageerror', e => { console.error('pageerror', e.message); fail(e); });
  page.on('console', m => { if (/\[weld\]|error/i.test(m.text()) && !/404/.test(m.text())) console.log('[page]', m.text()); });
  await page.goto(`http://localhost:${server.address().port}/?render&project=${project}${query ? '&' + query : ''}`);
  await Promise.race([page.waitForFunction(() => window.__ready, null, { timeout: 180000 }), failed]);
  const film = await page.evaluate(() => ({ id: window.__film.id, params: window.__film.params, duration: window.__film.duration, cues: window.__film.cues }));
  const view = query.match(/(?:^|&)view=(\w+)/)?.[1];   // a rig camera's stream: its name in the file name
  const tag = film.id + Object.entries(film.params).filter(([k]) => query.includes(k + '=')).map(([k, v]) => `-${k}${v}`).join('') + (view ? `-${view}` : '');
  return { page, film, tag, close: async () => { await browser.close(); server.close(); } };
}
