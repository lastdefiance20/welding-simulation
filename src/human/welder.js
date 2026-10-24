// The welder: a posed character (assets/people/welder.glb, no rig) holding a MIG gun at chest height
// and a hand shield. It is split into the person (moves as one rigid body), the gun (found by where it is: in front
// of the chest), and the props (welding machine, gas cylinder, floor cables) that stay put.
// The gun's frame is measured from its nozzle; the head camera sits on top of the hard hat.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const CHARACTER = /^(old_caucasian|Eye_brown|riding_helmet|MC-BodySuit|mhair01black|mind_eyebrows|elvs_mens_apron|materialMaterial)/;

function pca(points) {
  const c = new THREE.Vector3(); points.forEach(p => c.add(p)); c.divideScalar(points.length);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  points.forEach(p => { const d = [p.x - c.x, p.y - c.y, p.z - c.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]; });
  let v = [0.3, 0.2, 1];
  for (let k = 0; k < 300; k++) { const w = [0, 1, 2].map(i => C[i][0] * v[0] + C[i][1] * v[1] + C[i][2] * v[2]); const n = Math.hypot(...w); v = w.map(x => x / n); }
  const a = new THREE.Vector3(...v);
  let lo = 1e9, hi = -1e9; points.forEach(p => { const s = p.clone().sub(c).dot(a); lo = Math.min(lo, s); hi = Math.max(hi, s); });
  return { c, a, lo, hi };
}

/** An IMU box with its axes and a glow shell, at `at` (in the parent's frame), its long side along `along`. */
function makeImu(at, along, ghost) {
  const imu = new THREE.Group();
  imu.position.copy(at);
  imu.quaternion.setFromUnitVectors(V(0, 0, 1), along.clone().normalize());
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.012, 0.034), ghost || new THREE.MeshStandardMaterial({ color: '#2f6bff', roughness: 0.4, metalness: 0.3, emissive: '#0b2a8a', emissiveIntensity: 0.6 }));
  box.castShadow = !ghost;
  imu.add(box);
  const halo = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.02, 0.042), new THREE.MeshBasicMaterial({ color: '#5fe3ff', transparent: true, opacity: 0.35, side: THREE.BackSide, depthWrite: false }));
  halo.visible = false; imu.add(halo);
  const axes = new THREE.Group();
  for (const [d, c] of [[V(1, 0, 0), '#ff4d4d'], [V(0, 1, 0), '#4dff88'], [V(0, 0, 1), '#4d9dff']]) {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(0, 0, 0), d.multiplyScalar(0.05)]), new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true }));
    l.renderOrder = 20; axes.add(l);
  }
  axes.visible = false; imu.add(axes);
  return { imu, axes, halo };
}

export async function loadWelder(url = '/assets/people/welder.glb') {
  const src = (await new GLTFLoader().loadAsync(url)).scene;
  src.updateMatrixWorld(true);
  const meshes = [];
  src.traverse(o => { if (o.isMesh) meshes.push(o); });
  const person = new THREE.Group(), props = new THREE.Group(), gun = [], body = [];
  for (const m of meshes) {
    const b = new THREE.Box3().setFromObject(m), c = b.getCenter(V(0, 0, 0));
    const isGun = c.z < -0.38 && c.y > 1.3 && Math.abs(c.x) < 0.06;          // in front of the chest
    const onPerson = CHARACTER.test(m.material.name) || isGun || (c.z < 0.35 && b.max.z - b.min.z < 1.0 && b.min.y > 0.2);
    (onPerson ? person : props).attach(m);
    m.castShadow = true; m.receiveShadow = true;
    (isGun ? gun : onPerson ? body : []).push(m);
  }
  // The gun's frame (model space): the nozzle's axis, its front end is the TCP; 'up' as close to world up as can be.
  const nozzle = gun.find(m => /^52722df2/.test(m.material.name));
  const pts = []; const pa = nozzle.geometry.attributes.position;
  for (let i = 0; i < pa.count; i++) pts.push(V(0, 0, 0).fromBufferAttribute(pa, i).applyMatrix4(nozzle.matrixWorld));
  const r = pca(pts), e0 = r.c.clone().addScaledVector(r.a, r.lo), e1 = r.c.clone().addScaledVector(r.a, r.hi);
  const tip = e0.z < e1.z ? e0 : e1, back = e0.z < e1.z ? e1 : e0;
  const tool = tip.clone().sub(back).normalize();
  const x = V(0, 1, 0).cross(tool).normalize(), up = tool.clone().cross(x);
  const torchFrame = new THREE.Matrix4().makeBasis(x, up, tool).setPosition(tip);        // torch local -> model
  const toLocal = torchFrame.clone().invert();
  // The IMU on the gun, just above the gooseneck; the head camera on top of the hard hat.
  const imuAt = V(0.013, 1.539, -0.6), imuAlong = tool.clone();
  const real = makeImu(imuAt, imuAlong, null);
  person.add(real.imu);
  // The head camera on a short post on the hard hat's crown, high enough to see over the hand shield.
  const camEye = V(0, 1.832, -0.16);
  const dark = new THREE.MeshStandardMaterial({ color: '#111317', roughness: 0.4, metalness: 0.3 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.06, 10), dark);
  post.position.set(0, 1.79, -0.1);
  const mount = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.032, 0.055), dark);
  mount.position.set(0, 1.828, -0.115);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 16), new THREE.MeshStandardMaterial({ color: '#1f3b6b', roughness: 0.1, metalness: 0.8 }));
  lens.rotation.x = Math.PI / 2; lens.position.set(0, 1.828, -0.146);
  person.add(post, mount, lens);
  // The white hard hat blows out under the arc and the key light; take it down a little.
  body.filter(m => /^riding_helmet/.test(m.material.name)).forEach(m => m.material.color.multiplyScalar(0.72));
  const bodyMats = [...new Set(body.map(m => m.material))];
  bodyMats.forEach(m => { m.transparent = true; });

  /** A copy of the gun alone in its own frame (TCP at the origin, nozzle along +z), with an IMU: same API as before. */
  function makeTorch({ ghost = false } = {}) {
    const g = new THREE.Group();
    const gm = ghost ? new THREE.MeshBasicMaterial({ color: '#5fe3ff', transparent: true, opacity: 0.3, depthWrite: false }) : null;
    for (const m of gun) {
      const c = new THREE.Mesh(m.geometry, gm || m.material);
      c.matrixAutoUpdate = false;
      c.matrix.copy(toLocal).multiply(m.matrixWorld);
      c.castShadow = !ghost;
      g.add(c);
    }
    const parts = makeImu(imuAt.clone().applyMatrix4(toLocal), imuAlong.clone().transformDirection(toLocal), gm);
    g.add(parts.imu);
    const basis = new THREE.Matrix4(), bx = V(0, 0, 0), by = V(0, 0, 0);
    return {
      group: g, ...parts,
      setPose(tcp, t, u = V(0, 1, 0)) { bx.crossVectors(u, t).normalize(); by.crossVectors(t, bx); basis.makeBasis(bx, by, t); g.quaternion.setFromRotationMatrix(basis); g.position.copy(tcp); g.updateMatrixWorld(true); },
      setFrame(tcp, q) { g.position.copy(tcp); g.quaternion.copy(q); g.updateMatrixWorld(true); },
      local: p => p.clone().applyMatrix4(g.matrixWorld),
    };
  }

  return {
    person, props, gun, imu: real.imu, imuAxes: real.axes, imuHalo: real.halo, camEye,
    tipModel: tip, toolModel: tool, upModel: up, makeTorch,
    /** Fade the person (not the gun) in and out. */
    setBodyOpacity(o) { body.forEach(m => { m.visible = o > 0.002; }); bodyMats.forEach(m => { m.opacity = o; m.depthWrite = o > 0.99; }); },
  };
}
