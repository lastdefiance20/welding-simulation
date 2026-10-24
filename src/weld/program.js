// A robot program: welds along seams plus the moves between them, compiled into a joint trajectory by IK.
// The robot is an adapter (src/robot/ur5e.js): fk(q) -> { p, tool, flange } and ik(q0, p, tool, { fT, iters }) ->
// { q, ok, err } in the world frame, plus neckCos (the cosine between the torch axis and the flange axis).
// The trajectory is solved once at load (sequentially, each sample seeded by the previous one, so the arm never
// flips configuration) and then sampled, so a frame is a pure function of film time.
import * as THREE from 'three';
import { clamp, span, ease, lerp } from '../kit.js';
import { WEAVES } from './weave.js';

const DEG = Math.PI / 180;

export const WELD_DEFAULTS = {
  duration: 18,            // s of travel in the film
  weave: 'triangleDwell',
  weaveAmp: 0.0028,        // m, half width of the weave across the joint
  weaveHz: 1.5,
  dwell: 0.3,              // share of each half cycle the torch pauses at the toes
  workAngle: 45,           // deg from plate A
  travelAngle: 10,         // deg push (positive leans the torch toward the travel direction)
  arcGap: 0.0025,          // wire tip to the work, along the torch axis
  aim: 0.003,              // aim point out of the corner (the bead face); keep > weaveAmp
  preDwell: 0.5,           // arc on before travel starts
  crater: 0.6,             // arc on after travel stops
  retract: 0.09,           // m along the torch axis for the approach and the retract
  bead: { leg: 0.0075, convex: 0.0011 },
  label: '',
  seed: null,              // joint angles to seed the IK at the weld start (picks the arm configuration)
  actor: 'robot',          // 'human': a weld done by a person (a project animates the torch); the robot holds still
  flangeDir: null,         // rough world direction for the flange axis at the start (e.g. down): sets the torch's
                           // roll about its axis, which otherwise comes from wherever the seed lands
};

/** A weld along a seam. The program gives it its times (arcOn, start, end, arcOff). */
export function defineWeld(id, seam, params = {}) {
  const w = { id, seam, ...WELD_DEFAULTS, ...params, bead: { ...WELD_DEFAULTS.bead, ...params.bead } };
  w.length = seam.length;
  w.speed = w.length / w.duration;
  const weaveFn = WEAVES[w.weave];
  /** Out of the corner at the work angle. */
  w.outDir = s => { const f = seam.frame(s); return f.eA.clone().multiplyScalar(Math.cos(w.workAngle * DEG)).addScaledVector(f.eB, Math.sin(w.workAngle * DEG)).normalize(); };
  /** Torch axis (pointing at the work). */
  w.toolAxis = s => w.outDir(s).negate().multiplyScalar(Math.cos(w.travelAngle * DEG)).addScaledVector(seam.frame(s).t, Math.sin(w.travelAngle * DEG)).normalize();
  /** Across the joint, from the plate-A toe to the plate-B toe. */
  w.weaveDir = s => new THREE.Vector3().crossVectors(w.toolAxis(s), seam.frame(s).t).normalize();
  /** Torch frame basis at s: travel, out of the corner, and their cross product. */
  w.basis = s => { const t = seam.frame(s).t, o = w.outDir(s); return [t, o, new THREE.Vector3().crossVectors(t, o)]; };
  w.deposit = t => w.speed * clamp(t - w.start, 0, w.duration);
  /** Where the arc meets the work at film time t: the weave swings about a point just out of the corner. */
  w.arcPoint = t => {
    const tw = t - w.start, s = w.deposit(t);
    const amp = w.weaveAmp * span(0, 0.6, tw) * (1 - span(w.duration, w.duration + 0.4, tw));
    return seam.frame(s).p.addScaledVector(w.outDir(s), w.aim).addScaledVector(w.weaveDir(s), amp * weaveFn(Math.max(0, tw), { hz: w.weaveHz, dwell: w.dwell }));
  };
  w.tcp = t => w.arcPoint(t).addScaledVector(w.toolAxis(w.deposit(t)), -w.arcGap);
  return w;
}

/**
 * Compile a program.
 *   welds  the welds (defineWeld), each with a `seed`
 *   home   { q: [deg x 6] }, or { like: weldId, p } or { like, back, up }: the home TCP (given, or backed off from
 *          that weld's start along the torch axis by `back` and lifted by `up`), with that weld's start orientation
 *   steps  in order, each optionally with `mark` (a name for its [start, end] in plan.marks):
 *     { hold: s }                       stay
 *     { moveJ: 'home' | { approach: id }, dur }   joint-space move
 *     { approach: id, dur, settle }     straight in along the torch axis to the weld start, then settle
 *     { weld: id }                      arc on, travel, crater fill
 *     { retract: id, dur }              straight out along the torch axis from the weld end
 */
export function buildPlan({ welds, home, steps, rate = 120 }, robot) {
  const { fk, ik } = robot || {};   // (no robot: every weld is a person's, home given as q)
  const byId = Object.fromEntries(welds.map(w => [w.id, w]));
  const get = id => { if (!byId[id]) throw new Error('unknown weld ' + id); return byId[id]; };

  // Torch orientation at s: the tool axis and the flange axis, the flange held in the seam's frame (constant on a
  // straight seam, following the seam on a curved one). The flange axis is taken from the seeded start pose.
  for (const w of welds) {
    if (w.actor !== 'robot') continue;
    const start = w.seam.frame(0).p.addScaledVector(w.outDir(0), w.aim).addScaledVector(w.toolAxis(0), -w.arcGap);
    let fHint = null;
    if (w.flangeDir) {
      // The flange axis sits on a cone around the torch axis (the neck's bend: robot.neckCos).
      const tool = w.toolAxis(0), perp = w.flangeDir.clone().addScaledVector(tool, -w.flangeDir.dot(tool)).normalize();
      const c = robot.neckCos;
      fHint = tool.clone().multiplyScalar(c).addScaledVector(perp, Math.sqrt(1 - c * c));
    }
    w.qStart = ik(w.seed || [0, 0, -1.2, 0, -1.6, 0], start, w.toolAxis(0), { fT: fHint, iters: 1500 });
    const f0 = fk(w.qStart.q).flange, B0 = w.basis(0), local = B0.map(b => f0.dot(b));
    w.flange = s => { const B = w.basis(s); return B[0].clone().multiplyScalar(local[0]).addScaledVector(B[1], local[1]).addScaledVector(B[2], local[2]).normalize(); };
    w.startTcp = start;
    w.apprTcp = start.clone().addScaledVector(w.toolAxis(0), -w.retract);
    w.qAppr = ik(w.qStart.q, w.apprTcp, w.toolAxis(0), { fT: w.flange(0), iters: 800 });
  }
  // Home: joint angles (deg) given, or a TCP given or backed off from a weld's start, in that weld's orientation.
  let qHome;
  if (home.q) qHome = { q: home.q.map(d => d * DEG), ok: true };
  else {
    const like = get(home.like);
    const homeP = home.p || like.startTcp.clone().addScaledVector(like.toolAxis(0), -(home.back ?? 0.25)).add(new THREE.Vector3(0, home.up ?? 0, 0));
    qHome = ik(home.p ? like.qStart.q.map((v, i) => (i === 0 ? 0 : v)) : like.qStart.q, homeP, like.toolAxis(0), { fT: like.flange(0), iters: 1500 });
  }

  // Timeline.
  let t = 0;
  const segs = [], marks = {}, cues = { arcs: [], moves: [] };
  for (const st of steps) {
    const seg = { ...st, t0: t };
    if ('hold' in st) t += st.hold;
    else if ('moveJ' in st) { t += st.dur; cues.moves.push({ from: seg.t0, to: t, gain: 1 }); }
    else if ('approach' in st) { t += st.dur + (st.settle || 0); cues.moves.push({ from: seg.t0, to: t - (st.settle || 0), gain: 0.5 }); }
    else if ('weld' in st) {
      const w = get(st.weld);
      w.arcOn = t; w.start = t + w.preDwell; w.end = w.start + w.duration; w.arcOff = w.end + w.crater;
      t = w.arcOff;
      cues.arcs.push({ on: w.arcOn, off: w.arcOff });
      if (w.actor === 'robot') cues.moves.push({ from: w.start, to: w.end, gain: 0.25 });
    } else if ('retract' in st) { t += st.dur; cues.moves.push({ from: seg.t0, to: t, gain: 0.5 }); }
    else throw new Error('unknown step ' + JSON.stringify(st));
    seg.t1 = t;
    segs.push(seg);
    if (st.mark) marks[st.mark] = [seg.t0, seg.t1];
  }
  const duration = t;

  // Solve.
  const n = Math.ceil(duration * rate) + 1, Q = new Float64Array(n * 6);
  const report = { home: qHome, worst: 0, fails: 0 };
  let q = qHome.q, si = -1, qFrom = null;
  for (let i = 0; i < n; i++) {
    const tt = Math.min(i / rate, duration);
    let k = segs.findIndex(s => tt < s.t1);
    if (k < 0) k = segs.length - 1;
    const sg = segs[k];
    if (k !== si) { si = k; qFrom = q.slice(); }
    let target = null;
    if ('moveJ' in sg) {
      const qTo = sg.moveJ === 'home' ? qHome.q : get(sg.moveJ.approach).qAppr.q;
      const e = ease.inOut(span(sg.t0, sg.t1, tt));
      q = qFrom.map((v, j) => lerp(v, qTo[j], e));
    } else if ('approach' in sg) {
      const w = get(sg.approach);
      target = { p: w.apprTcp.clone().lerp(w.startTcp, ease.inOut(span(sg.t0, sg.t0 + sg.dur, tt))), tool: w.toolAxis(0), fT: w.flange(0) };
    } else if ('weld' in sg && get(sg.weld).actor === 'robot') {
      const w = get(sg.weld), s = w.deposit(tt);
      target = { p: w.tcp(Math.min(tt, w.end)), tool: w.toolAxis(s), fT: w.flange(s) };
    } else if ('retract' in sg) {
      const w = get(sg.retract), L = w.length;
      target = { p: w.tcp(w.end).addScaledVector(w.toolAxis(L), -w.retract * ease.inOut(span(sg.t0, sg.t1, tt))), tool: w.toolAxis(L), fT: w.flange(L) };
    }
    if (target) {
      const r = ik(q, target.p, target.tool, { fT: target.fT, iters: 60 });
      q = r.q;
      if (r.err > 5) { report.fails++; sg.fails = (sg.fails || 0) + 1; }    // > 0.1 mm or > 0.06 deg off
      report.worst = Math.max(report.worst, fk(q).p.distanceTo(target.p));
    }
    Q.set(q, i * 6);
  }
  const sample = tt => {
    const x = clamp(tt, 0, duration) * rate, i = Math.min(n - 2, Math.floor(x)), f = x - i;
    const out = new Array(6);
    for (let j = 0; j < 6; j++) out[j] = lerp(Q[i * 6 + j], Q[(i + 1) * 6 + j], f);
    return out;
  };
  /** The weld whose arc is on at t, else the most recent one (its pool is still cooling), else the first. */
  const weldAt = tt => {
    let cur = welds.filter(w => w.arcOn !== undefined).sort((a, b) => a.arcOn - b.arcOn);
    const started = cur.filter(w => w.arcOn <= tt);
    return started.length ? started[started.length - 1] : cur[0];
  };
  return { welds, sample, weldAt, marks, cues, duration, report, rate, Q, home: qHome, segs };
}
