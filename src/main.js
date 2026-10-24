// Boot: load the project (?project=<id>, its params from the query), build the scene, the UR5e welder (unless the
// project sets robot: false) and the compiled weld program, then either the player (default) or the render hook
// (?render).
//
// Rig cameras: a project's setup may fill ctx.cameras = { name: { cam: THREE.PerspectiveCamera, label } } and keep
// them posed in update(). The core draws them as picture-in-picture insets (bottom right), and ?view=<name> renders
// the film from that camera alone (full frame, no cards: one recorded stream per render).
import { createStage, W, H } from './stage.js';
import { loadWelder } from './robot/ur5e.js';
import { buildPlan } from './weld/program.js';
import { buildBead } from './weld/bead.js';
import { buildFx } from './weld/fx.js';
import { cameraAt } from './shots.js';
import { buildOverlay } from './ui/overlay.js';
import { span } from './kit.js';
import { drawInsets } from './views.js';

export const DEFAULT_PROJECT = 'example-robot';
const query = new URLSearchParams(location.search);
const RENDER = query.has('render');
if (RENDER) document.body.classList.add('render');
const VIEW = query.get('view');     // ?view=<rig camera>: the film seen from that camera
const CLEAN = query.has('clean') || !!VIEW;   // ?clean: the 3D picture only, no cards, HUD or insets
const DEBUG_CAM = (c => (c && c.length >= 6 ? c : null))(query.get('cam')?.split(',').map(Number));   // ?cam=x,y,z,lookx,looky,lookz[,fov] for probing

const id = query.get('project') || DEFAULT_PROJECT;
const project = (await import(`/projects/${id}/project.js`)).default;
const params = Object.fromEntries(Object.entries(project.params || {}).map(([k, d]) => [k, query.has(k) ? Number(query.get(k)) : d.default]));
document.title = project.title;
if (project.css) {
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = `/projects/${id}/style.css`;
  document.head.appendChild(link);
}

const stageEl = document.getElementById('stage');
const st = createStage(document.getElementById('gl'), project.stage);
const P = project.create(params);
st.scene.add(P.scene);
const overlayRoot = document.getElementById('overlay');
if (CLEAN) overlayRoot.style.display = 'none';
const film = await weldFilm();

async function weldFilm() {
  // ?torch=<name>: another torch GLB in assets/torch (same mount and TCP node), e.g. a CAD torch kept outside the repo.
  const robot = project.robot === false ? null : await loadWelder({ torch: query.get('torch') || undefined });
  if (robot) st.scene.add(robot.root);
  const plan = buildPlan(P, robot);
  const beads = plan.welds.map(buildBead);
  beads.forEach(b => st.scene.add(b.mesh));
  const fx = buildFx(st.scene, plan, P.collide);
  const shots = P.shots(plan);
  const overlay = buildOverlay(overlayRoot, { cards: P.cards?.(plan) || [], hud: P.hud?.(plan), plan });
  // Optional project hooks: setup once; update every frame after the core (robot, beads, camera, fx) and before the
  // render; postRender after it (extra views drawn into the same canvas).
  const ctx = { st, robot, cameras: {}, plan, beads: Object.fromEntries(plan.welds.map((w, i) => [w.id, beads[i]])), fx, overlayRoot };
  await P.setup?.(ctx);     // may load assets
  console.log('[weld] IK', JSON.stringify({ project: id, params, fails: plan.report.fails, worstMm: +(plan.report.worst * 1000).toFixed(3) }));
  return {
    duration: plan.duration, cues: plan.cues, marks: plan.marks,
    /** Draw film second t. Pure: any t, in any order. */
    seek(t) {
      const q = plan.sample(t);
      robot?.setQ(q);
      beads.forEach(b => b.update(t));
      const shot = cameraAt(shots, t, st.camera, plan.duration, { plan });
      debugCam();
      const I = fx.update(t, shot.filter);
      // Welding-camera exposure: the room drops away while an arc burns.
      const arcOn = Math.max(0, ...plan.welds.map(w => Math.min(span(w.arcOn - 0.05, w.arcOn + 0.1, t), 1 - span(w.arcOff, w.arcOff + 1.2, t))));
      // A shot with a weld filter (shade glass) darkens further so the pool reads through the arc.
      st.renderer.toneMappingExposure = (1.0 - 0.5 * arcOn) * (1 - 0.45 * shot.filter * arcOn);
      st.lights.key.intensity = 2.2 * (1 - 0.55 * arcOn);
      st.bloom.strength = 0.45 + 0.5 * arcOn * (1 - 0.6 * shot.filter);
      overlay.update(t, q, I);
      P.update?.(t, ctx, shot);
      if (VIEW) viewFrom(ctx.cameras[VIEW]?.cam);
      st.composer.render();
      P.postRender?.(t, ctx, shot);
      if (!CLEAN && P.insets !== false) drawInsets(st, ctx.cameras, overlayRoot);
    },
  };
}

/** The stage camera takes a rig camera's pose and lens (?view). */
function viewFrom(cam) {
  if (!cam) throw new Error(`no rig camera '${VIEW}'`);
  cam.updateMatrixWorld(true);
  cam.matrixWorld.decompose(st.camera.position, st.camera.quaternion, st.camera.scale);
  st.camera.fov = cam.fov; st.camera.updateProjectionMatrix(); st.camera.updateMatrixWorld();
}

function debugCam() {
  if (!DEBUG_CAM) return;
  const [x, y, z, lx, ly, lz, fov = 30] = DEBUG_CAM;
  st.camera.position.set(x, y, z); st.camera.fov = fov; st.camera.updateProjectionMatrix(); st.camera.lookAt(lx, ly, lz);
  st.camera.updateMatrixWorld();
}
const seek = t => film.seek(t);

window.__film = { id, params, duration: film.duration, fps: 30, seek, cues: { ...film.cues, voice: P.voice || [], bgm: P.bgm || null }, marks: film.marks, scene: st.scene };   // scene: for probes (scripts in a page context)
seek(0);
document.getElementById('loading').remove();

if (!RENDER) {
  const fit = () => {
    const vp = document.getElementById('viewport').getBoundingClientRect();
    const k = Math.min(vp.width / W, vp.height / H);
    stageEl.style.transform = `translate(${-W * k / 2}px, ${-H * k / 2}px) scale(${k})`;
  };
  addEventListener('resize', fit); fit();
  const play = document.getElementById('play'), scrub = document.getElementById('scrub'), time = document.getElementById('time');
  let t = parseFloat((location.hash.match(/t=([\d.]+)/) || [])[1]) || 0, playing = !query.has('paused'), last = performance.now();
  const setPlaying = p => { playing = p; play.textContent = p ? '❚❚' : '▶'; last = performance.now(); };
  play.onclick = () => setPlaying(!playing);
  addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); } });
  scrub.oninput = () => { t = (scrub.value / 1000) * film.duration; seek(t); };
  setPlaying(playing);
  seek(t);
  const loop = now => {
    if (playing) {
      t += (now - last) / 1000;
      if (t > film.duration) t = 0;
      seek(t);
    }
    last = now;
    scrub.value = Math.round((t / film.duration) * 1000);
    time.textContent = t.toFixed(2);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
window.__ready = true;
