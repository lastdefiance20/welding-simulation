// Try IK seeds and flange directions for a robot film's welds and rank them: the plan is rebuilt in the page for each
// combination (every weld gets the same seed and flangeDir), scored by IK failures, worst TCP error and total joint
// travel (less travel: smoother, no wrist flips).
//   node scripts/seed-search.mjs --project <id> [--query gap=3] [--seeds '[[0,-1.6,1.6,-1.6,-1.57,0], ...]'] [--top 8]
// Copy the winning seed (radians) and flangeDir into the project's defineWeld options.
import { openFilm, arg } from './page.mjs';

const SEEDS = JSON.parse(arg('seeds', 'null')) || [
  [0, -1.6, 1.6, -1.6, -1.57, 0], [0, -1.2, 1.8, -2.2, -1.57, 0], [0, -1.9, 2.0, -1.7, 1.57, 0],
  [0.3, -1.4, 1.9, -2.0, -1.57, 1.0], [-0.3, -1.4, 1.9, -2.0, -1.57, -1.0], [0, -2.2, -1.6, -0.9, 1.57, 0],
  [0.5, -1.0, 1.4, -1.9, -1.57, 0], [-0.5, -1.0, 1.4, -1.9, -1.57, 0],
];
const FLANGE = [null, [0, -1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 0], [0, 0, 1], [0, 0, -1]];

const { page, close } = await openFilm();
const rows = await page.evaluate(({ SEEDS, FLANGE }) => {
  const { P, robot, buildPlan } = window.__film.weld;
  const V = window.__film.scene.position.constructor;           // THREE.Vector3, from the page's own three
  const out = [];
  for (const seed of SEEDS) for (const fd of FLANGE) {
    for (const w of P.welds) { w.seed = seed; w.flangeDir = fd ? new V(...fd).normalize() : null; }
    try {
      const pl = buildPlan(P, robot);
      let travel = 0;
      for (let i = 6; i < pl.Q.length; i++) travel += Math.abs(pl.Q[i] - pl.Q[i - 6]);
      out.push({ seed, flangeDir: fd, fails: pl.report.fails, worstMm: +(pl.report.worst * 1000).toFixed(2), travel: +travel.toFixed(1) });
    } catch (e) { out.push({ seed, flangeDir: fd, error: e.message }); }
  }
  return out;
}, { SEEDS, FLANGE });
await close();

rows.sort((a, b) => (a.error ? 1 : 0) - (b.error ? 1 : 0) || a.fails - b.fails || a.worstMm - b.worstMm || a.travel - b.travel);
for (const r of rows.slice(0, +arg('top', 8))) console.log(JSON.stringify(r));
