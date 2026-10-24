// UR5e + MIG torch: the arm from its URDF (assets/robots/ur5e), the torch (assets/torch/<torch>.glb, default torch.glb,
// built by src/props/torch.js) on its tool flange (tool0), and the kinematics the weld program needs, in the world frame.
//
// World frame: Y up, metres, the robot's base on the table top at the origin. The URDF is Z up (base_link), so the
// arm's root is turned -90 deg about x: world = (bx, bz, -by).
// The torch GLB's origin is its mounting face, +z out of the flange; its child node "TCP" is the wire tip with the
// nozzle's axis as its +z.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadURDF } from './urdf.js';

export const JOINTS = ['shoulder_pan_joint', 'shoulder_lift_joint', 'elbow_joint', 'wrist_1_joint', 'wrist_2_joint', 'wrist_3_joint'];
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const toBase = v => V(v.x, -v.z, v.y), toWorld = v => V(v.x, v.z, -v.y);
/** Rotation whose columns are a, f (made orthogonal to a) and a x f. */
const frame = (a, f) => {
  const e1 = a.clone().normalize(), e2 = f.clone().addScaledVector(e1, -f.dot(e1)).normalize(), e3 = new THREE.Vector3().crossVectors(e1, e2);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(e1, e2, e3));
};

/**
 * Returns { root, links, setQ(q), tcp, torch, fk, ik, neckCos }.
 *   fk(q)                         -> { p (wire tip), tool (nozzle axis), flange (tool0 +z) }, world frame
 *   ik(q0, p, tool, { fT, iters }) -> { q, ok, err }: the wire tip at p, the nozzle along tool, the flange axis as
 *                                    close to fT as the torch allows (fT omitted: the flange keeps q0's roll)
 */
export async function loadWelder({ base = '/assets', torch: torchName = 'torch' } = {}) {
  const [ur, gltf] = await Promise.all([loadURDF(`${base}/robots/ur5e/ur5e.urdf`), new GLTFLoader().loadAsync(`${base}/torch/${torchName}.glb`)]);
  const torch = gltf.scene;
  torch.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  ur.links.tool0.add(torch);
  const tcp = torch.getObjectByName('TCP');
  const TCP_TOOL0 = tcp.position.clone(), AXIS_TOOL0 = V(0, 0, 1).applyQuaternion(tcp.quaternion);

  // The flange and nozzle axes at q = 0, base frame.
  ur.root.updateMatrixWorld(true);
  const rest = new THREE.Quaternion().setFromRotationMatrix(ur.links.tool0.matrixWorld);
  const restFlange = V(0, 0, 1).applyQuaternion(rest), restTool = AXIS_TOOL0.clone().applyQuaternion(rest);
  const restFrame = frame(restTool, restFlange).invert();

  const { chain } = ur.chain('base_link', 'tool0', TCP_TOOL0);
  const fk = q => {
    const f = chain.fk(q);
    return { p: toWorld(f.p), tool: toWorld(restTool.clone().applyQuaternion(f.r)), flange: toWorld(restFlange.clone().applyQuaternion(f.r)) };
  };
  const ik = (q0, p, tool, { fT = null, iters = 120 } = {}) => {
    const fB = toBase(fT || fk(q0).flange), r = frame(toBase(tool), fB).multiply(restFrame);
    return chain.ik(q0, { p: toBase(p), r }, { iters, tolP: 2e-5, tolR: 2e-4 });
  };

  const root = new THREE.Group();
  root.name = 'ur5e';
  ur.root.rotation.x = -Math.PI / 2;
  root.add(ur.root);
  const setQ = q => ur.setQ(Object.fromEntries(JOINTS.map((n, i) => [n, q[i]])));
  return { root, links: ur.links, setQ, tcp, torch, fk, ik, neckCos: AXIS_TOOL0.z };
}
