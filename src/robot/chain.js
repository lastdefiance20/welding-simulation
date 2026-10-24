// A generic serial arm: revolute joints given as points on their axes in the rest pose (q = 0), a tool centre
// point, forward kinematics, full-pose damped least squares IK, and a rig that rebuilds a CAD model (links as
// siblings) into nested pivots so the meshes follow the joints.
//
// Poses are { p: Vector3 (TCP position), r: Quaternion (tool rotation relative to the rest pose) } in the arm's
// base frame (the frame the joints are given in).
import * as THREE from 'three';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

/** joints: [{ at, axis, limit: [lo, hi] }], tcp: rest TCP position. */
export function makeChain({ joints, tcp }) {
  const n = joints.length;
  joints = joints.map(j => ({ ...j, at: j.at.clone(), axis: j.axis.clone().normalize() }));

  /** Joint origins and axes (posed), TCP position, tool rotation. */
  function fk(q) {
    const o = [], a = [], pos = new THREE.Vector3(), rot = new THREE.Quaternion();
    let prev = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const j = joints[i];
      pos.add(_v.copy(j.at).sub(prev).applyQuaternion(rot));
      o.push(pos.clone());
      a.push(j.axis.clone().applyQuaternion(rot));
      rot.multiply(_q.setFromAxisAngle(j.axis, q[i]));
      prev = j.at;
    }
    const p = pos.clone().add(_v.copy(tcp).sub(prev).applyQuaternion(rot));
    return { o, a, p, r: rot };
  }

  /** Rotation vector taking rotation a to rotation b (b * a^-1), small-angle safe. */
  const rotErr = (a, b) => {
    const d = b.clone().multiply(a.clone().invert());
    if (d.w < 0) { d.x = -d.x; d.y = -d.y; d.z = -d.z; d.w = -d.w; }
    const s = Math.hypot(d.x, d.y, d.z), ang = 2 * Math.atan2(s, d.w);
    return s < 1e-9 ? new THREE.Vector3(d.x * 2, d.y * 2, d.z * 2) : new THREE.Vector3(d.x, d.y, d.z).multiplyScalar(ang / s);
  };

  /**
   * Full-pose IK from q0 toward { p, r }. wR weighs rotation (rad) against position (m); rest (optional, with
   * wRest) pulls the joints gently toward a preferred posture so long paths do not wander.
   */
  function ik(q0, { p: pT, r: rT }, { iters = 120, tolP = 5e-5, tolR = 5e-4, wR = 0.3, lambda = 0.03, maxStep = 0.2, rest = null, wRest = 0.02 } = {}) {
    const q = q0.slice();
    let k = 0, err = Infinity;
    for (; k < iters; k++) {
      const f = fk(q);
      const ep = pT.clone().sub(f.p), er = rotErr(f.r, rT);
      err = Math.max(ep.length() / tolP, er.length() / tolR);
      if (err < 1) break;
      const e = [ep.x, ep.y, ep.z, er.x * wR, er.y * wR, er.z * wR];
      const J = [[], [], [], [], [], []];
      for (let i = 0; i < n; i++) {
        const lin = new THREE.Vector3().crossVectors(f.a[i], _v.copy(f.p).sub(f.o[i]));
        [lin.x, lin.y, lin.z, f.a[i].x * wR, f.a[i].y * wR, f.a[i].z * wR].forEach((v, r) => { J[r][i] = v; });
      }
      // dq = J^T (J J^T + l^2 I)^-1 e, plus a little of the rest pull projected on what the task leaves free.
      const A = J.map((ri, r) => J.map((rj, c) => ri.reduce((s, v, m) => s + v * rj[m], 0) + (r === c ? lambda * lambda : 0)));
      const y = solve(A, e);
      const dq = Array.from({ length: n }, (_, c) => J.reduce((s, row, r) => s + row[c] * y[r], 0));
      if (rest) {
        const z = q.map((v, i) => wRest * (rest[i] - v));
        const y2 = solve(A, J.map(row => row.reduce((s, v, c) => s + v * z[c], 0)));
        for (let i = 0; i < n; i++) dq[i] += z[i] - J.reduce((s, row, r) => s + row[i] * y2[r], 0);
      }
      const m = Math.hypot(...dq), sc = m > maxStep ? maxStep / m : 1;
      for (let i = 0; i < n; i++) q[i] = Math.min(joints[i].limit[1], Math.max(joints[i].limit[0], q[i] + dq[i] * sc));
    }
    return { q, ok: err < 1, iters: k, err };
  }

  return { n, joints, tcp: tcp.clone(), fk, ik };
}

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/**
 * Rig a model as the chain: base is the object the arm hangs from (its frame is the chain's base frame, unposed when
 * this runs), links[i] the objects joint i moves (link 0 is joint 1's). Pivot groups are nested on the joints and
 * the links re-attached keeping their world transforms. Returns the pivots, a flange object (the last pivot) and
 * setQ.
 */
export function rigChain(chain, base, links) {
  base.updateMatrixWorld(true);
  const pivots = [];
  let parent = base, prev = new THREE.Vector3();
  chain.joints.forEach((j, i) => {
    const g = new THREE.Group();
    g.name = `J${i + 1}`;
    g.position.copy(j.at).sub(prev);
    parent.add(g);
    g.updateMatrixWorld(true);
    pivots.push(g);
    parent = g; prev = j.at;
  });
  links.forEach((objs, i) => objs.forEach(o => pivots[i].attach(o)));
  const tcp = new THREE.Object3D();
  tcp.name = 'TCP';
  tcp.position.copy(chain.tcp).sub(prev);
  pivots[pivots.length - 1].add(tcp);
  const setQ = q => pivots.forEach((p, i) => p.quaternion.setFromAxisAngle(chain.joints[i].axis, q[i]));
  return { pivots, tcp, setQ };
}
