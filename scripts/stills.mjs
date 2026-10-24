// node scripts/stills.mjs 3,10.5,20 [--project ur5e-t2f] [--query gap=3] -> out/stills/<project>/t<sec>.jpg
import fs from 'node:fs';
import { openFilm } from './page.mjs';
const times = (process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && !(all[i - 1] || '').startsWith('--')) || '0').split(',').map(Number);
const { page, tag, close } = await openFilm();
fs.mkdirSync(`out/stills/${tag}`, { recursive: true });
for (const t of times) {
  await page.evaluate(t => window.__film.seek(t), t);
  const out = `out/stills/${tag}/t${t.toFixed(2)}.jpg`;
  await page.screenshot({ path: out, type: 'jpeg', quality: 88 });
  console.log(out);
}
await close();
