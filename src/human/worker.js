// The worker: assets/people/worker.glb ("Worker apl" by max_f5_studio, CC BY 4.0), a static A-pose figure in
// coveralls and a hard hat. Auto-rigged (src/human/autorig.js) from landmarks measured on the mesh; posed each frame
// from a state: where the feet are, which way the person faces, where the hands go (IK) and a walk phase.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { autoRig, resetPose, twoBoneIK, aimBone } from './autorig.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
export const HEIGHT = 1.76, MODEL_H = 72.92, S = HEIGHT / MODEL_H;

// Landmarks in model units (Y up, facing +z, the person's left at +x), from slices of the mesh.
function joints() {
  const J = {
    hips: { at: v(0, 37, 0), parent: null, r: 6, only: p => Math.abs(p.x) < 10 },
    spine: { at: v(0, 44, 0.3), parent: 'hips', r: 6.5, only: p => Math.abs(p.x) < 10 },
    chest: { at: v(0, 52, 0), parent: 'spine', r: 6.5, only: p => Math.abs(p.x) < 10 && p.y > 40 },
    neck: { at: v(0, 60.5, -0.3), parent: 'chest', r: 2.6, only: p => p.y > 54 && Math.abs(p.x) < 6 },
    head: { at: v(0, 64.5, 0), parent: 'neck', r: 4.5, tip: v(0, 72.5, 0), only: p => p.y > 58 && Math.abs(p.x) < 6 },
  };
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    const m = (x, y, z) => v(s * x, y, z), side = p => s * p.x > 0;
    Object.assign(J, {
      [`clav${k}`]: { at: m(2.5, 57, -0.5), parent: 'chest', r: 3, only: p => side(p) && p.y > 50 },
      [`upper${k}`]: { at: m(7.5, 56.5, -0.5), parent: `clav${k}`, r: 2.2, only: p => s * p.x > 5.5 && p.y > 42 },
      [`fore${k}`]: { at: m(12.8, 47, -0.3), parent: `upper${k}`, r: 1.9, only: p => s * p.x > 9 },
      // The hand: palm to the knuckle line (aim: the old wrist-to-fingertip line the poses are written against);
      // the four fingers as one two-joint bone (they lie side by side at x 20.4, z 1.8..4.6), the thumb forward.
      [`hand${k}`]: { at: m(17.8, 40.2, 0.3), parent: `fore${k}`, r: 1.6, tip: m(20.3, 36.4, 2.9), aim: m(20.3, 34, 0.8), only: p => s * p.x > 13 },
      [`fing${k}`]: { at: m(20.35, 36.4, 3.0), parent: `hand${k}`, r: 0.8, only: p => s * p.x > 19.2 && p.y < 37 && p.z < 5.1 },
      [`fing2${k}`]: { at: m(20.45, 34.7, 3.1), parent: `fing${k}`, r: 0.8, tip: m(20.4, 32.6, 3.2), only: p => s * p.x > 19.2 && p.y < 36 && p.z < 5.1 },
      [`thumb${k}`]: { at: m(18.4, 38.4, 4.4), parent: `hand${k}`, r: 0.8, only: p => s * p.x > 15 && p.y < 38.6 && p.y > 33 && p.z > 5.0 },
      [`thumb2${k}`]: { at: m(19.3, 36.3, 6.0), parent: `thumb${k}`, r: 0.8, tip: m(20.4, 33.9, 5.8), only: p => s * p.x > 15 && p.z > 5.1 && p.y < 37.5 && p.y > 33 },
      [`thigh${k}`]: { at: m(4.2, 35, 0), parent: 'hips', r: 3.4, only: p => side(p) && p.y < 40 && Math.abs(p.x) < 11 },
      [`shin${k}`]: { at: m(5.8, 19.5, 0.3), parent: `thigh${k}`, r: 2.5, only: p => side(p) && p.y < 28 },
      [`foot${k}`]: { at: m(7.0, 3.5, -0.8), parent: `shin${k}`, r: 2.2, tip: m(8.0, 0.5, 4.5), only: p => side(p) && p.y < 9 },
    });
  }
  return J;
}

/** A small action camera on a curved adhesive mount on the hat, its lens forward and ~20 deg down. */
function egoCamera() {
  const g = new THREE.Group(), cam = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: '#1a1b1e', roughness: 0.45, metalness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({ color: '#04060a', metalness: 0.9, roughness: 0.06 });
  const add = (p, geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; p.add(m); return m; };
  add(g, new THREE.BoxGeometry(0.036, 0.008, 0.03), shell, 0, 0.004, 0);                   // the mount on the hat
  add(g, new THREE.BoxGeometry(0.006, 0.014, 0.012), shell, 0, 0.014, 0);                  // its knuckle
  add(cam, new THREE.BoxGeometry(0.042, 0.03, 0.024), shell, 0, 0, 0);                     // body
  add(cam, new THREE.CylinderGeometry(0.009, 0.01, 0.008, 24), shell, 0.008, 0, 0.015, Math.PI / 2);   // lens housing
  add(cam, new THREE.CylinderGeometry(0.0065, 0.0065, 0.002, 24), glass, 0.008, 0, 0.0195, Math.PI / 2);
  add(cam, new THREE.SphereGeometry(0.0015, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2a1f' }), -0.014, 0.009, 0.0125);   // REC
  cam.position.set(0, 0.03, 0.004); cam.rotation.x = -0.15;
  cam.name = 'egoCam';                                         // the view: its +z, its up +y
  g.add(cam);
  g.position.set(0, 72.0 - 64.5, 2.0); g.rotation.x = 0.5;    // on the hat's crown, front (model units, head-bone frame)
  g.scale.setScalar(0.75 / S);
  return g;
}

/** Repaint the coverall's teal hi-vis bands as silver retro-reflective tape, its grey sleeves hi-vis orange and the white
 *  boots (a grid shows on them) dark leather, as on the workers in a real plant. */
function silverBands(mesh) {
  const mat = mesh.material, src = mat.map, img = src.image, c = document.createElement('canvas');
  const W = c.width = img.width, H = c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  // Where the sleeves are in the texture: the arm triangles (shoulder to wrist, model units) drawn in UV space.
  const m = document.createElement('canvas'); m.width = W; m.height = H;
  const mg = m.getContext('2d'), geo = mesh.geometry, P = geo.attributes.position, U = geo.attributes.uv, I = geo.index;
  const arm = k => { const x = Math.abs(P.getX(k)), y = P.getY(k); return x > 6.5 && x < 17.5 && y > 38 && y < 58; };
  const boot = k => P.getY(k) < 7;
  const paint = (inside, color) => {
    mg.clearRect(0, 0, W, H); mg.fillStyle = color;
    for (let t = 0; t < (I ? I.count : P.count); t += 3) {
      const k = [0, 1, 2].map(j => (I ? I.getX(t + j) : t + j));
      if (!k.every(inside)) continue;
      mg.beginPath(); k.forEach((q, j) => mg[j ? 'lineTo' : 'moveTo'](U.getX(q) * W, (src.flipY ? 1 - U.getY(q) : U.getY(q)) * H)); mg.closePath(); mg.fill();
    }
    return mg.getImageData(0, 0, W, H).data;
  };
  const sleeve = paint(arm, '#fff'), boots = paint(boot, '#fff');
  const d = g.getImageData(0, 0, W, H), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], gr = p[i + 1], b = p[i + 2], mx = Math.max(r, gr, b), mn = Math.min(r, gr, b);
    if (boots[i + 3] > 0 && mx > 90 && mx - mn < 0.12 * mx) {                       // white boot leather: dark brown-black
      const l = 0.35 + 0.65 * mx / 255; p[i] = 46 * l; p[i + 1] = 40 * l; p[i + 2] = 35 * l; continue;
    }
    if (sleeve[i + 3] > 0 && mx > 110 && mx < 225 && mx - mn < 0.1 * mx) {                                // light grey cloth: orange, keeping its shading
      const l = mx / 180; p[i] = Math.min(255, 236 * l); p[i + 1] = Math.min(255, 104 * l); p[i + 2] = Math.min(255, 38 * l); continue;
    }
    if (mx < 30 || mx - mn < 0.22 * mx || r >= 0.75 * Math.min(gr, b) || gr < 0.75 * b || b < 0.6 * gr) continue;   // teal (green ~ blue, both over red), not navy
    const k = Math.min(1, (mx - mn) / mx / 0.4), y = 150 + 0.45 * mx;                  // blend in by saturation
    p[i] = r + (y - r) * k; p[i + 1] = gr + (y + 2 - gr) * k; p[i + 2] = b + (y + 6 - b) * k;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  for (const k of ['flipY', 'colorSpace', 'wrapS', 'wrapT', 'anisotropy']) t[k] = src[k];
  mat.map = t; mat.needsUpdate = true;
}

/** Feet planted square under a body at pos (feet centre) facing yaw, for setPose's feet. */
export const stance = (pos, yaw) => Object.fromEntries([['L', 1], ['R', -1]].map(([k, s]) => [k, { p: pos.clone().setY(0).add(v(s * 0.17, 0, 0).applyAxisAngle(v(0, 1, 0), yaw)), yaw, lift: 0 }]));

export async function loadWorker(url = '/assets/people/worker.glb', { egoCam = false, silver = false } = {}) {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const meshes = [];
  gltf.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
  const body = meshes.find(m => m.geometry.attributes.position.count > 10000), head = meshes.find(m => m !== body);
  // The head mesh's neck fades into the neck bone (y 60.5 .. 64): riding the head whole, it swung out behind the
  // collar whenever the head tipped down.
  // The head material is BLEND in the file: its eyes and teeth then sort wrongly through the face. Cut it instead.
  for (const m of [body.material, head.material]) {
    m.transparent = false; m.alphaTest = 0.5; m.depthWrite = true;
    m.emissiveIntensity = 0.0;
  }
  if (silver) silverBands(body);
  const J = joints();
  // The boots: the sole rides the foot, the collar (and the hem over it) the shin, blended through the ankle; skinned by
  // distance, the hem and the boot's upper went separate ways and the boot poked out through the trousers.
  const legBlend = [1, -1].map(s => ({ lower: s > 0 ? 'footL' : 'footR', upper: s > 0 ? 'shinL' : 'shinR', y0: 2.2, y1: 6.5, only: p => s * p.x > 0 }));
  const rig = autoRig({ joints: J, meshes: [body], rigid: [[head, 'head', { bone: 'neck', y0: 60.5, y1: 64 }]], blend: legBlend });
  const root = new THREE.Group();
  root.name = 'worker';
  rig.root.scale.setScalar(S);
  root.add(rig.root);
  const B = rig.bones;
  // An egocentric camera on the front of the hard hat (for data collection), tipped down at the hands.
  if (egoCam) B.head.add(egoCamera());

  // Model-frame helpers (metres, person's frame: x left, y up, z forward; feet centre at the origin).
  const toWorld = p => p.clone().applyMatrix4(root.matrixWorld);

  /**
   * Pose: { pos (feet centre, world), yaw (0 faces +z), hands: { L, R } world wrist targets, { p, dir, palm, w, grip } to
   *   also turn the hand's line toward dir and the palm toward palm (world) by w 0..1 and close it by grip { curl, thumb }
   *   (0..1 each), or { knuckle, from, dir, palm, w, grip }: the knuckle line at knuckle (blended from the wrist at from
   *   by w), or null (relaxed),
   * walk: { phase (cycles), amount 0..1, stride (m) }, lean (rad, forward bend at the hips), look: world point|null,
   * sit: { drop (m the hips come down), feet (m forward of the hips) } | null,
   * feet: { L, R: { p (world, on the floor), yaw, lift (m) } } | null: planted feet instead of feet under the hips (so the
   *   body can turn over them and step; stance() gives them for a pos and yaw), twist (rad): the shoulders turned past
   *   the hips about the vertical (an upper body that leads a turn) }.
   */
  // Like aimBone, but also rolls the hand about its line so its palm (rest: facing the thigh) faces palm.
  function handRot(name, tipRest, palmRest, dir, palm, rootQ) {
    const basis = (d, n) => {
      const x = d.clone().normalize(), y = n.clone().sub(x.clone().multiplyScalar(n.dot(x))).normalize();
      return new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y));
    };
    const d0 = tipRest.clone().sub(rig.rest[name]).applyQuaternion(rootQ), n0 = palmRest.clone().applyQuaternion(rootQ);
    return new THREE.Quaternion().setFromRotationMatrix(basis(dir, palm).multiply(basis(d0, n0).transpose()));
  }
  function aimHand(name, tipRest, palmRest, dir, palm, rootQ) {
    const b = B[name], R = handRot(name, tipRest, palmRest, dir, palm, rootQ);
    const pw = new THREE.Quaternion(); b.parent.updateMatrixWorld(true); b.parent.getWorldQuaternion(pw);
    b.quaternion.copy(pw.invert().multiply(R).multiply(rootQ));
  }

  // The thumb closes across the palm toward the fingers: about the axis normal to its line and that direction.
  const THUMB_AXIS = {};
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    const d = J[`thumb2${k}`].at.clone().sub(J[`thumb${k}`].at).normalize(), n = v(-s * 0.7, 0, -0.7).normalize();
    THUMB_AXIS[k] = d.cross(n).normalize();
  }

  function setPose({ pos, yaw = 0, hands = {}, walk = null, lean = 0, look = null, sit = null, feet = null, twist = 0 }) {
    resetPose(rig);
    const w = walk ? walk.amount : 0, ph = walk ? walk.phase * Math.PI * 2 : 0, stride = walk?.stride ?? 0.55;
    const bob = w * 0.018 * Math.cos(2 * ph);
    const drop = sit ? sit.drop : 0;                             // seated: the hips come down onto the chair
    root.position.copy(pos).add(v(0, bob - w * 0.01 - drop, 0));
    root.rotation.set(0, yaw, 0);
    root.updateMatrixWorld(true);
    // Torso: a forward lean, a little counter-twist while walking.
    B.spine.quaternion.setFromEuler(new THREE.Euler(lean * 0.6, -w * 0.08 * Math.sin(ph) + 0.4 * twist, 0, 'YXZ'));
    B.chest.quaternion.setFromEuler(new THREE.Euler(lean * 0.4, -w * 0.06 * Math.sin(ph) + 0.6 * twist, 0, 'YXZ'));
    root.updateMatrixWorld(true);
    // Legs: feet on the floor, swinging with the walk (L and R half a cycle apart).
    for (const [s, k, off] of [[1, 'L', 0], [-1, 'R', Math.PI]]) {
      const a = ph + off, fwd = w * (stride / 2) * Math.sin(a), lift = w * 0.07 * Math.max(0, Math.cos(a));
      const F = !sit && feet?.[k], fy = F ? F.yaw : yaw;
      const foot = sit ? toWorld(v(s * 0.15, 0.085 + drop, sit.feet)) : F ? F.p.clone().add(v(0, 0.085 + (F.lift || 0), 0)) : toWorld(v(s * 0.17, 0.085 + lift, fwd));
      // The knee points between where the hips and that foot face.
      const knee = sit ? toWorld(v(s * 0.2, 1.2, 1.5)) : root.position.clone().add(v(s * 0.16, 0.5, 1.5).applyAxisAngle(v(0, 1, 0), (yaw + fy) / 2));
      twoBoneIK(rig, `thigh${k}`, `shin${k}`, `foot${k}`, foot, knee);
      // The foot stays level, turned its own way (left on the shin, the sole tipped with every lean of the leg).
      const fq = new THREE.Quaternion().setFromAxisAngle(v(0, 1, 0), fy);
      aimBone(rig, `foot${k}`, J[`foot${k}`].tip, J[`foot${k}`].tip.clone().sub(J[`foot${k}`].at).applyQuaternion(fq), fq);
    }
    root.updateMatrixWorld(true);
    // Arms: to the hand targets, elbows out and down; relaxed by the sides, swinging when walking.
    for (const [s, k, off] of [[1, 'L', Math.PI], [-1, 'R', 0]]) {
      let tgt = hands[k], dir = null, palm = null, aw = 1;
      if (tgt && !tgt.isVector3) {
        const h = tgt;
        ({ p: tgt, dir, palm = null, w: aw = 1 } = h);
        // Placed by the knuckle line instead: the wrist goes where that puts the knuckles, for this dir and palm.
        if (h.knuckle) {
          const rq = new THREE.Quaternion(); rig.root.getWorldQuaternion(rq);
          const off = J[`fing${k}`].at.clone().sub(J[`hand${k}`].at).multiplyScalar(S).applyQuaternion(rq)
            .applyQuaternion(handRot(`hand${k}`, J[`hand${k}`].aim, v(-s, 0, 0), dir, palm, rq));
          tgt = h.knuckle.clone().sub(off);
          if (h.from) tgt = h.from.clone().lerp(tgt, aw);
        }
      }
      if (!tgt) tgt = toWorld(v(s * 0.24, 0.8, 0.04 + w * 0.12 * Math.sin(ph + off)));
      const pole = toWorld(v(s * 0.55, 0.9, -0.35));
      const { elbow, wrist } = twoBoneIK(rig, `upper${k}`, `fore${k}`, `hand${k}`, tgt, pole);
      // The hand keeps on the forearm's line unless told where the fingers point.
      if (dir && aw > 0) {
        const rq = new THREE.Quaternion(); rig.root.getWorldQuaternion(rq);
        const fore = wrist.clone().sub(elbow).normalize(), want = fore.clone().lerp(dir.clone().normalize(), aw);
        if (palm) {
          // The whole hand turns from its natural pose on the forearm to the target by aw (blending only the line
          // and setting the palm at once rolled the hand ~90 deg in one frame as aw left 0).
          aimBone(rig, `hand${k}`, J[`hand${k}`].aim, fore, rq);
          const q0 = B[`hand${k}`].quaternion.clone();
          aimHand(`hand${k}`, J[`hand${k}`].aim, v(-s, 0, 0), dir, palm, rq);
          B[`hand${k}`].quaternion.copy(q0.slerp(B[`hand${k}`].quaternion, aw));
        } else aimBone(rig, `hand${k}`, J[`hand${k}`].aim, want, rq);
      }
      // Fingers and thumb curl toward the palm (rest frames are the model's axes): curl 0 flat .. 1 a fist.
      const g = hands[k]?.grip ?? {}, curl = g.curl ?? 0.22, th = g.thumb ?? 0;
      B[`fing${k}`].quaternion.setFromAxisAngle(v(0, 0, -s), 1.15 * curl);
      B[`fing2${k}`].quaternion.setFromAxisAngle(v(0, 0, -s), 1.35 * curl);
      B[`thumb${k}`].quaternion.setFromAxisAngle(THUMB_AXIS[k], 0.25 * th);   // small: the low-poly thumb shears
      B[`thumb2${k}`].quaternion.setFromAxisAngle(THUMB_AXIS[k], 0.35 * th);
    }
    if (look) {
      root.updateMatrixWorld(true);
      const hp = B.head.getWorldPosition(new THREE.Vector3());
      const rq = new THREE.Quaternion(); root.getWorldQuaternion(rq);
      const d = look.clone().sub(hp).normalize();
      const fwd = v(0, 0, 1).applyQuaternion(rq);
      const blend = fwd.clone().lerp(d, 0.6).normalize();
      aimBone(rig, 'head', rig.rest.head.clone().add(v(0, 0, 1)), blend, rq);
    }
    root.updateMatrixWorld(true);
  }
  // Hand keypoints as a hand tracker reports them (21: the wrist; thumb CMC, MCP, IP, tip; four fingers MCP, PIP,
  // DIP, tip), from the posed bones. The four fingers share one bone pair, so each finger is that pair at its own
  // offset across the palm (model z 1.9 .. 4.4).
  function handPoints(k) {
    const s = k === 'L' ? 1 : -1, m = (x, y, z) => v(s * x, y, z);
    const at = (bone, p) => B[bone + k].localToWorld(p.clone().sub(rig.rest[bone + k]));
    const pts = [at('hand', m(17.9, 40.0, 2.0))];
    pts.push(at('hand', m(18.1, 39.2, 3.9)), at('thumb', m(18.6, 38.0, 4.9)), at('thumb2', m(19.3, 36.3, 6.0)), at('thumb2', m(20.3, 34.0, 5.8)));
    for (const z of [4.4, 3.6, 2.8, 1.9]) {
      const L = 1 - 0.12 * Math.abs(z - 3.4);                               // the middle fingers longest
      pts.push(at('fing', m(20.35, 36.4, z)), at('fing2', m(20.45, 34.7, z)), at('fing2', m(20.45, 34.7 - 1.1 * L, z)), at('fing2', m(20.4, 34.7 - 2.1 * L, z)));
    }
    return pts;
  }
  setPose({ pos: v(0, 0, 0) });
  return { root, rig, setPose, handPoints };
}
