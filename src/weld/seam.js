// A fillet seam: the corner line where plate A meets plate B, parameterised by arc length s (m).
//
// frame(s) -> { p, t, nA, nB, eA, eB }
//   p      the corner point
//   t      the travel direction
//   nA/nB  the face normals of plate A and plate B, pointing into the open side of the joint
//   eA/eB  along plate A (resp. B), away from the corner. For a 90 deg joint eA = nB and eB = nA.
// "A" is the plate the work angle is measured from (the floor in a 2F joint).
import * as THREE from 'three';

function frameFrom(p, t, nA, nB) {
  const eA = nB.clone().addScaledVector(t, -nB.dot(t)).addScaledVector(nA, -nB.dot(nA)).normalize();
  const eB = nA.clone().addScaledVector(t, -nA.dot(t)).addScaledVector(nB, -nA.dot(nB)).normalize();
  return { p, t, nA, nB, eA, eB };
}

/** Straight seam from `from` to `to`; nA, nB constant. */
export function lineSeam({ from, to, nA, nB }) {
  const d = to.clone().sub(from), length = d.length(), t = d.normalize();
  return {
    length,
    frame: s => frameFrom(from.clone().addScaledVector(t, s), t.clone(), nA.clone(), nB.clone()),
  };
}

/**
 * Curved seam from a parametric description fn(u) -> { p, nA, nB }, u in [0, 1], re-parameterised by arc length
 * (sampled, then interpolated). The travel direction is the curve's tangent.
 */
export function curveSeam(fn, { samples = 512 } = {}) {
  const us = [], ss = [0];
  let prev = fn(0).p;
  for (let i = 0; i <= samples; i++) {
    const u = i / samples, p = fn(u).p;
    us.push(u);
    if (i > 0) ss.push(ss[i - 1] + p.distanceTo(prev));
    prev = p;
  }
  const length = ss[samples];
  const uAt = s => {
    s = Math.min(length, Math.max(0, s));
    let lo = 0, hi = samples;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ss[m] <= s) lo = m; else hi = m; }
    const k = (s - ss[lo]) / Math.max(1e-12, ss[hi] - ss[lo]);
    return us[lo] + (us[hi] - us[lo]) * k;
  };
  return {
    length,
    frame: s => {
      const u = uAt(s), e = 0.5 / samples;
      const a = fn(Math.max(0, u - e)).p, b = fn(Math.min(1, u + e)).p;
      const f = fn(u);
      return frameFrom(f.p, b.sub(a).normalize(), f.nA.clone().normalize(), f.nB.clone().normalize());
    },
  };
}

/** The same seam moved by a rigid transform (a specimen placed on a fixture). */
export function transformSeam(seam, matrix) {
  const rot = new THREE.Matrix3().setFromMatrix4(matrix);
  return {
    length: seam.length,
    frame: s => {
      const f = seam.frame(s), m = v => v.clone().applyMatrix3(rot).normalize();
      return { p: f.p.clone().applyMatrix4(matrix), t: m(f.t), nA: m(f.nA), nB: m(f.nB), eA: m(f.eA), eB: m(f.eB) };
    },
  };
}
