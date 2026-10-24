// T-joint specimen, 3F (vertical fillet, welded upward), standing on the table.
// Base plate 200 x 180 t16 and stiffener 200 x 120 t12, both upright; weld 170 mm (15 mm margin each end).
// The gap (0 / 3 / 5 mm) sits between the stiffener's edge and the base plate.
//
// Built in a local frame, then turned 45 deg about the vertical so the welded corner faces the robot squarely:
//   local: base plate face in the plane x = 0 (normal -x), stiffener standing out of it toward -x,
//          the welded corner between the base plate face and the stiffener's +z face.
import * as THREE from 'three';
import { plate, tack, obstaclesOf } from '../parts.js';
import { lineSeam } from '../weld/seam.js';

const MM = 0.001;
export const SPEC = {
  plate: { H: 200 * MM, W: 180 * MM, T: 16 * MM },
  stiff: { H: 200 * MM, W: 120 * MM, T: 12 * MM },
  weld: { L: 170 * MM, margin: 15 * MM },
};
/** World x of the welded corner line, and the riser the specimen stands on (the torch works nearly level, so at
 *  table height its body and hose would hit the table at the bottom of the seam). */
export const CX = 0.65;
export const RISER = 0.16;

export function buildSpecimen({ gap = 0 } = {}) {
  const { plate: A, stiff: B } = SPEC, G = gap * MM;
  const g = new THREE.Group();
  g.name = 'specimen';
  g.add(plate([A.T, A.H, A.W], new THREE.Vector3(A.T / 2, A.H / 2, 0), 31, 0.0012));
  g.add(plate([B.W, B.H, B.T], new THREE.Vector3(-G - B.W / 2, B.H / 2, 0), 43, 0.001));
  // Tacks on the far side of the stiffener, top and bottom.
  for (const y of [0.02, A.H - 0.02]) g.add(tack(new THREE.Vector3(-G - 0.0012, y, -B.T / 2 - 0.0012), new THREE.Vector3(0, 1, 0)));

  // Turn so the corner bisector (-1, 0, 1)/sqrt2 points at the robot (-x), corner on x = CX.
  g.rotation.y = -Math.PI / 4;
  const cornerLocal = new THREE.Vector3(0, 0, B.T / 2);
  const rot = new THREE.Quaternion().setFromEuler(g.rotation);
  g.position.set(CX, RISER, 0).sub(cornerLocal.clone().applyQuaternion(rot));
  g.updateMatrixWorld(true);

  // The riser: a steel block under the specimen, kept behind the corner (the torch dips below the seam's start),
  // the stiffener overhanging its front edge.
  const riser = new THREE.Group();
  riser.add(plate([0.18, RISER, 0.24], new THREE.Vector3(CX + 0.08, RISER / 2, 0), 57, 0.002));
  const all = new THREE.Group();
  all.add(g, riser);

  const toWorld = v => v.clone().applyMatrix4(g.matrixWorld);
  const dirWorld = v => v.clone().applyQuaternion(rot);
  const seam = lineSeam({
    from: toWorld(new THREE.Vector3(0, SPEC.weld.margin, B.T / 2)), to: toWorld(new THREE.Vector3(0, A.H - SPEC.weld.margin, B.T / 2)),
    nA: dirWorld(new THREE.Vector3(-1, 0, 0)), nB: dirWorld(new THREE.Vector3(0, 0, 1)),
  });

  const inv = g.matrixWorld.clone().invert(), l = new THREE.Vector3();
  /** Sparks bounce off the base plate face, the stiffener face and the table. */
  const collide = out => {
    l.copy(out).applyMatrix4(inv);
    if (l.y < A.H) {
      if (Math.abs(l.z) < A.W / 2 && l.x > -0.0005) l.x = -0.0005 - (l.x + 0.0005) * 0.3;
      if (l.x > -G - B.W && l.z < B.T / 2 + 0.0005 && l.z > -B.T / 2) l.z = B.T / 2 + 0.0005 + (B.T / 2 + 0.0005 - l.z) * 0.3;
    }
    out.copy(l.applyMatrix4(g.matrixWorld));
    const floor = Math.abs(out.x - CX - 0.08) < 0.09 && Math.abs(out.z) < 0.12 ? RISER : 0;
    if (out.y < floor) out.y = floor + (floor - out.y) * 0.25;
  };
  return { group: all, seam, collide, obstacles: obstaclesOf(all) };
}
