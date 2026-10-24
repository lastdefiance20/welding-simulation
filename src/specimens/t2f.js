// T-joint specimen, 2F (horizontal fillet).
// Base plate 300 x 180 t16, stiffener 300 x 120 t12 standing on its middle, weld 270 mm (15 mm margin each end).
// The gap (0 / 3 / 5 mm) lifts the stiffener off the plate. Used by projects/example-robot and example-human.
import * as THREE from 'three';
import { plate, tack, obstaclesOf } from '../parts.js';
import { lineSeam } from '../weld/seam.js';

const MM = 0.001;
export const SPEC = {
  plate: { L: 300 * MM, W: 180 * MM, T: 16 * MM },
  stiff: { L: 300 * MM, H: 120 * MM, T: 12 * MM },
  weld: { L: 270 * MM },
};

/** World placement: robot base at the origin facing +x, specimen on the table top (y = 0). */
export const WX = 0.40;                 // x of the stiffener face the robot welds (the weld corner line)
export const PLATE_Y = SPEC.plate.T;    // top of the base plate

/** wx: where the welded corner line sits (x); the robot's cell uses WX. */
export function buildSpecimen({ gap = 0, wx = WX } = {}) {
  const WX = wx;
  const g = new THREE.Group();
  g.name = 'specimen';
  const { plate: P, stiff: S } = SPEC, G = gap * MM;
  g.add(plate([P.W, P.T, P.L], new THREE.Vector3(WX + S.T / 2, P.T / 2, 0), 11, 0.0012));
  g.add(plate([S.T, S.H, S.L], new THREE.Vector3(WX + S.T / 2, P.T + G + S.H / 2, 0), 23, 0.0010));
  // Two tack welds on the far side, as a fitted-up specimen would have.
  for (const z of [S.L / 2 - 0.025, -S.L / 2 + 0.025]) g.add(tack(new THREE.Vector3(WX + S.T + 0.0012, PLATE_Y + 0.0012, z)));

  // The weld runs from +z to -z along the corner on the robot's side.
  const seam = lineSeam({
    from: new THREE.Vector3(WX, PLATE_Y, SPEC.weld.L / 2), to: new THREE.Vector3(WX, PLATE_Y, -SPEC.weld.L / 2),
    nA: new THREE.Vector3(0, 1, 0), nB: new THREE.Vector3(-1, 0, 0),
  });

  /** Sparks bounce off the stiffener face, then off the plate, the stiffener's top edge or the table. */
  const collide = out => {
    const TOP = PLATE_Y + G + S.H, onSpec = Math.abs(out.z) < P.L / 2;
    if (onSpec && out.y < TOP && out.x > WX - 0.0005) out.x = WX - 0.0005 - (out.x - WX + 0.0005) * 0.3;
    const floor = !onSpec ? 0 : out.x < WX - (P.W / 2 - S.T / 2) ? 0 : out.x < WX ? PLATE_Y : TOP;
    if (out.y < floor) out.y = floor + (floor - out.y) * 0.25;
  };
  return { group: g, seam, collide, obstacles: obstaclesOf(g), stiffener: g.children[1] };
}
