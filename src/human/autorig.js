// Auto-rig for a static, unrigged human mesh in a T or A pose: a skeleton from a few landmark joints, skin weights
// from each vertex's distance to the bones (scaled by each bone's thickness), and posing helpers: aim a bone, two-
// bone IK for arms and legs with a pole, and a root transform. The posed mesh is a THREE.SkinnedMesh.
//
// Landmarks are given in the model's own frame (Y up, facing +z, the person's left at +x). Bones run from a joint
// to its child joint; the last bone of a chain gets a tip.
import * as THREE from 'three';

/**
 * joints: { name: { at: Vector3, parent: name|null, tip?: Vector3, r: thickness } }. meshes: the body meshes to skin
 * (geometry in the model frame). rigid: [mesh, boneName, fade?] meshes that ride one bone whole (e.g. a head mesh), or with
 * fade { bone, y0, y1 } blend by height into another bone below (a head's neck into the neck bone).
 * blend: [{ lower, upper, y0, y1, only }] vertices below y1 (and passing only) skinned by height instead of distance:
 * fully lower at y <= y0, fully upper at y >= y1 (a boot's collar riding the shin with the trouser hem over it, so the
 * hem and the boot cannot pass through each other when the foot turns).
 * Returns { root (Group), bones: { name: Bone }, rest: { name: Vector3 world rest position }, skinned: [...] }.
 */
export function autoRig({ joints, meshes, rigid = [], blend = [], falloff = 6, keep = 3 }) {
  const root = new THREE.Group();
  const bones = {}, rest = {};
  for (const [name, j] of Object.entries(joints)) {
    const b = new THREE.Bone();
    b.name = name;
    bones[name] = b;
    rest[name] = j.at.clone();
  }
  for (const [name, j] of Object.entries(joints)) {
    const b = bones[name];
    if (j.parent) { bones[j.parent].add(b); b.position.copy(j.at).sub(joints[j.parent].at); }
    else { root.add(b); b.position.copy(j.at); }
  }
  // Bone segments for the weights: joint -> each child (or its tip).
  const names = Object.keys(joints);
  const segs = names.map(n => {
    const kids = names.filter(k => joints[k].parent === n);
    const end = joints[n].tip || (kids.length === 1 ? joints[kids[0]].at : kids.length ? kids.map(k => joints[k].at).reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(kids.length) : joints[n].at.clone().add(new THREE.Vector3(0, 0.01, 0)));
    return { name: n, a: joints[n].at, b: end, r: joints[n].r || 1, only: joints[n].only };
  });
  const boneList = names.map(n => bones[n]);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(boneList);
  const _ab = new THREE.Vector3(), _ap = new THREE.Vector3(), _c = new THREE.Vector3();
  const segDist = (p, s) => {
    _ab.subVectors(s.b, s.a); _ap.subVectors(p, s.a);
    const t = Math.max(0, Math.min(1, _ap.dot(_ab) / Math.max(1e-9, _ab.lengthSq())));
    return _c.copy(s.a).addScaledVector(_ab, t).distanceTo(p);
  };
  const skinned = [];
  for (const m of meshes) {
    const geo = m.geometry.clone();
    geo.applyMatrix4(m.matrixWorld);
    const P = geo.attributes.position, n = P.count;
    const idx = new Uint16Array(n * 4), wts = new Float32Array(n * 4), p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(P, i);
      const cand = segs.map((s, k) => {
        if (s.only && !s.only(p)) return [k, 0];
        const d = segDist(p, s) / s.r;
        return [k, 1 / Math.pow(Math.max(d, 0.05), falloff)];
      }).sort((a, b) => b[1] - a[1]).slice(0, keep);
      const bl = blend.find(b => p.y < b.y1 && (!b.only || b.only(p)));
      if (bl) {
        const u = Math.min(1, Math.max(0, (p.y - bl.y0) / (bl.y1 - bl.y0))), k = u * u * (3 - 2 * u);
        idx[i * 4] = names.indexOf(bl.upper); idx[i * 4 + 1] = names.indexOf(bl.lower); wts[i * 4] = k; wts[i * 4 + 1] = 1 - k;
        continue;
      }
      const sum = cand.reduce((s, c) => s + c[1], 0) || 1;
      cand.forEach(([k, w], j) => { idx[i * 4 + j] = k; wts[i * 4 + j] = w / sum; });
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
    const sm = new THREE.SkinnedMesh(geo, m.material);
    sm.castShadow = sm.receiveShadow = true;
    sm.frustumCulled = false;
    root.add(sm);
    sm.bind(skeleton, new THREE.Matrix4());
    skinned.push(sm);
  }
  for (const [m, boneName, fade] of rigid) {
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    if (fade) {
      // Skinned to two bones by height: fully fade.bone at y <= fade.y0, fully boneName at y >= fade.y1 (so a head's
      // neck stays in the collar as the head turns, instead of swinging out behind it).
      const P = g.attributes.position, n = P.count, a = boneList.indexOf(bones[boneName]), b = boneList.indexOf(bones[fade.bone]);
      const idx = new Uint16Array(n * 4), wts = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        const u = Math.min(1, Math.max(0, (P.getY(i) - fade.y0) / (fade.y1 - fade.y0))), k = u * u * (3 - 2 * u);
        idx[i * 4] = a; idx[i * 4 + 1] = b; wts[i * 4] = k; wts[i * 4 + 1] = 1 - k;
      }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
      const sm = new THREE.SkinnedMesh(g, m.material);
      sm.castShadow = sm.receiveShadow = true;
      sm.frustumCulled = false;
      root.add(sm);
      sm.bind(skeleton, new THREE.Matrix4());
      skinned.push(sm);
      continue;
    }
    g.translate(-rest[boneName].x, -rest[boneName].y, -rest[boneName].z);
    const mesh = new THREE.Mesh(g, m.material);
    mesh.castShadow = true;
    bones[boneName].add(mesh);
  }
  return { root, bones, rest, skeleton, skinned };
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

/** Reset every bone to its rest orientation. */
export function resetPose(rig) { for (const b of Object.values(rig.bones)) b.quaternion.identity(); }

/** World rotation of a bone's parent chain (rest frames are axis aligned, so this is the posed rotation). */
function parentWorldQ(bone) { const q = new THREE.Quaternion(); bone.parent.getWorldQuaternion(q); return q; }

/**
 * Turn bone so its rest direction (rest[child] - rest[bone], in rest = model frame) points along dir (world, in the
 * root's frame of the model: pass directions already divided by the root's rotation). Call parents first.
 */
export function aimBone(rig, name, childRest, dir, rootQ = new THREE.Quaternion()) {
  const b = rig.bones[name];
  const restDir = _v1.copy(childRest).sub(rig.rest[name]).normalize();
  const want = _v2.copy(dir).normalize();
  // world rotation needed: R such that R * restDir = want (in world), then local = parentWorld^-1 * R
  const R = _q.setFromUnitVectors(restDir.applyQuaternion(rootQ), want);
  b.parent.updateMatrixWorld(true);
  const pw = parentWorldQ(b);
  // R is a world rotation acting on a rest-aligned bone; the bone's world rotation should be R * rootQ.
  b.quaternion.copy(pw.invert().multiply(R).multiply(rootQ));
}

/**
 * Two-bone IK: upper (a) -> lower (b) -> end (c) bones (names), the end reaching target (world), the middle joint
 * bending toward pole (world point). Lengths from the rest pose. Clamps to reach.
 */
export function twoBoneIK(rig, a, b, c, target, pole) {
  const A = rig.bones[a], B = rig.bones[b];
  rig.root.updateMatrixWorld(true);
  const pa = A.getWorldPosition(new THREE.Vector3());
  const s = new THREE.Vector3(); rig.root.getWorldScale(s);
  const l1 = rig.rest[b].distanceTo(rig.rest[a]) * s.x, l2 = rig.rest[c].distanceTo(rig.rest[b]) * s.x;
  const toT = target.clone().sub(pa);
  const d = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, toT.length()));
  const dirT = toT.normalize();
  // Elbow position: in the plane of the target and the pole.
  const toP = pole.clone().sub(pa);
  const n = toP.sub(dirT.clone().multiplyScalar(toP.dot(dirT))).normalize();
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const elbow = pa.clone().addScaledVector(dirT, l1 * cosA).addScaledVector(n, l1 * sinA);
  const wrist = pa.clone().addScaledVector(dirT, d);
  const rootQ = new THREE.Quaternion(); rig.root.getWorldQuaternion(rootQ);
  aimBone(rig, a, rig.rest[b], elbow.clone().sub(pa), rootQ);
  aimBone(rig, b, rig.rest[c], wrist.clone().sub(elbow), rootQ);
  return { elbow, wrist };
}
