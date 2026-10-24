// A small URDF loader: links with their STL or COLLADA visuals, joints as nested groups (origin, then the joint motion about or
// along its axis), and a kinematic chain (makeChain) between two links for IK. Enough for arms like i2rt's YAM.
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { makeChain } from './chain.js';

const num = (s, d = '0 0 0') => (s || d).trim().split(/\s+/).map(Number);
/** URDF rpy is fixed-axis roll, pitch, yaw: R = Rz(y) Ry(p) Rx(r), three's 'ZYX' Euler. */
const originOf = el => {
  const o = el?.querySelector(':scope > origin');
  const [x, y, z] = num(o?.getAttribute('xyz')), [r, p, yw] = num(o?.getAttribute('rpy'));
  return { p: new THREE.Vector3(x, y, z), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(r, p, yw, 'ZYX')) };
};

/**
 * Load a URDF. material(linkName) gives each STL link's material; COLLADA (.dae) visuals keep their own colours (as
 * MeshStandardMaterial), unless daeMaterial(linkName, standardMaterial) returns another. skip: link names whose visuals are left out.
 * Returns { root, links: { name: Group }, joints: { name: { type, axis, set(v) } }, setQ({ name: v }), chain(from, to,
 * tcp) } — chain gives makeChain over the revolute joints between two links (tcp: a point in the last link's frame).
 */
export async function loadURDF(url, { material = () => new THREE.MeshStandardMaterial({ color: '#444' }), daeMaterial = (n, m) => m, skip = [] } = {}) {
  const base = url.slice(0, url.lastIndexOf('/') + 1);
  const doc = new DOMParser().parseFromString(await (await fetch(url)).text(), 'application/xml');
  const stl = new STLLoader(), dae = new ColladaLoader(), links = {}, joints = {}, loads = [];
  for (const L of doc.querySelectorAll('robot > link')) {
    const name = L.getAttribute('name'), g = new THREE.Group();
    g.name = name; links[name] = g;
    if (skip.includes(name)) continue;
    for (const vis of L.querySelectorAll(':scope > visual')) {
      const file = vis.querySelector('mesh')?.getAttribute('filename');
      if (!file) continue;
      const o = originOf(vis);
      if (file.endsWith('.dae')) {
        loads.push(dae.loadAsync(base + file).then(({ scene }) => {
          scene.rotation.set(0, 0, 0); // the loader turns Z-up files to Y-up; URDF frames are Z-up already
          scene.position.copy(o.p); scene.quaternion.copy(o.q);
          scene.traverse(m => {
            if (!m.isMesh) return;
            const std = old => daeMaterial(name, new THREE.MeshStandardMaterial({ color: old.color, roughness: 0.55, metalness: 0.1, side: old.side }));
            m.material = Array.isArray(m.material) ? m.material.map(std) : std(m.material);
            m.castShadow = m.receiveShadow = true;
          });
          g.add(scene);
        }));
        continue;
      }
      loads.push(stl.loadAsync(base + file).then(geo => {
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, material(name));
        m.position.copy(o.p); m.quaternion.copy(o.q); m.castShadow = m.receiveShadow = true;
        g.add(m);
      }));
    }
  }
  const children = new Set();
  for (const J of doc.querySelectorAll('robot > joint')) {
    const name = J.getAttribute('name'), type = J.getAttribute('type');
    const parent = J.querySelector('parent').getAttribute('link'), child = J.querySelector('child').getAttribute('link');
    const o = originOf(J), axis = new THREE.Vector3(...num(J.querySelector('axis')?.getAttribute('xyz'), '1 0 0')).normalize();
    const frame = new THREE.Group(), motion = new THREE.Group();
    frame.name = name; frame.position.copy(o.p); frame.quaternion.copy(o.q);
    links[parent].add(frame); frame.add(motion); motion.add(links[child]);
    children.add(child);
    const set = v => { if (type === 'prismatic') motion.position.copy(axis).multiplyScalar(v); else if (type !== 'fixed') motion.quaternion.setFromAxisAngle(axis, v); };
    const lim = J.querySelector('limit'), limit = lim ? [Number(lim.getAttribute('lower')), Number(lim.getAttribute('upper'))] : [-6.2, 6.2];
    joints[name] = { type, axis, limit, parent, child, frame, motion, set };
  }
  const rootName = Object.keys(links).find(n => !children.has(n));
  const root = new THREE.Group();
  root.add(links[rootName]);
  await Promise.all(loads);
  /** makeChain over the movable joints from link a down to link b; tcp in b's frame. Rest pose, root frame. */
  const chain = (a, b, tcp = new THREE.Vector3()) => {
    const path = [];
    for (let l = b; l !== a;) { const j = Object.values(joints).find(j => j.child === l); if (!j) throw new Error('no path ' + a + ' -> ' + b); path.unshift(j); l = j.parent; }
    const saved = path.map(j => j.motion.quaternion.clone());
    path.forEach(j => j.motion.quaternion.identity());
    root.updateMatrixWorld(true);
    const inv = root.matrixWorld.clone().invert(), local = m => m.clone().premultiply(inv);
    const js = path.filter(j => j.type === 'revolute' || j.type === 'continuous').map(j => {
      const m = local(j.frame.matrixWorld), at = new THREE.Vector3().setFromMatrixPosition(m);
      const axis = j.axis.clone().transformDirection(m);
      return { at, axis, limit: j.limit };
    });
    const t = tcp.clone().applyMatrix4(local(links[b].matrixWorld));
    path.forEach((j, i) => j.motion.quaternion.copy(saved[i]));
    return { chain: makeChain({ joints: js, tcp: t }), joints: path.filter(j => j.type === 'revolute' || j.type === 'continuous') };
  };
  return { root, links, joints, setQ: q => Object.entries(q).forEach(([n, v]) => joints[n]?.set(v)), chain };
}
