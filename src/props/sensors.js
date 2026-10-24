// Data-collection gear, built in code (metres, Y up): a camera on a tripod, a head-mounted camera for a hard hat, a
// wrist camera for the robot's flange, and the IMU box for a torch handle. Each has a node named "view" where a THREE.PerspectiveCamera goes (add it as a child:
// it looks down the node's -z with +y up), and every part has a name so the GLBs in assets/sensors stay usable.
// scripts/export-assets.mjs bakes these to assets/sensors/*.glb.
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const dark = () => new THREE.MeshStandardMaterial({ name: 'body', color: '#202327', roughness: 0.6, metalness: 0.4 });
const glass = () => new THREE.MeshStandardMaterial({ name: 'glass', color: '#04060a', metalness: 0.9, roughness: 0.06 });
const add = (parent, name, geo, mat, [x, y, z], rx = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.name = name; m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
};

/**
 * A camera on a tripod. Origin: on the floor, centred between the feet. The camera ("head", at `height`) looks down
 * -z; turn the head (rotation.y pan, rotation.x tilt) to aim it, or call aim(worldPoint).
 */
export function tripodCamera({ height = 1.5, spread = 0.3, spin = 0.5 } = {}) {
  const g = new THREE.Group(), mat = dark();
  g.name = 'tripod_camera';
  const top = V(0, height - 0.08, 0);
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094 + spin, foot = V(spread * Math.cos(a), 0, spread * Math.sin(a));
    const leg = add(g, `leg${i}`, new THREE.CylinderGeometry(0.009, 0.009, 1, 8), mat, [0, 0, 0]);
    leg.position.copy(foot).add(top).multiplyScalar(0.5);
    leg.quaternion.setFromUnitVectors(V(0, 1, 0), top.clone().sub(foot).normalize());
    leg.scale.y = top.distanceTo(foot);
  }
  add(g, 'column', new THREE.CylinderGeometry(0.014, 0.014, 0.08, 12), mat, [0, height - 0.04, 0]);
  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, height, 0);
  g.add(head);
  add(head, 'camera_body', new THREE.BoxGeometry(0.1, 0.07, 0.07), mat, [0, 0.035, 0.06]);
  add(head, 'lens', new THREE.CylinderGeometry(0.022, 0.025, 0.05, 20), glass(), [0, 0.035, 0.0], Math.PI / 2);
  const view = new THREE.Object3D();
  view.name = 'view';
  view.position.set(0, 0.035, -0.025);
  head.add(view);
  /** Turn the head so the view looks at p (world). */
  g.userData.aim = p => {
    g.updateMatrixWorld(true);
    const local = g.worldToLocal(p.clone()).sub(head.position).sub(view.position);
    head.rotation.set(Math.atan2(local.y, Math.hypot(local.x, local.z)), Math.atan2(-local.x, -local.z), 0, 'YXZ');
  };
  return g;
}

/**
 * An action camera on a hard-hat mount. Origin: the mount's underside (sit it on the hat's crown, front). The view
 * looks forward (-z) and 0.15 rad down.
 */
export function headCamera() {
  const g = new THREE.Group(), shell = new THREE.MeshStandardMaterial({ name: 'shell', color: '#1a1b1e', roughness: 0.45, metalness: 0.2 });
  g.name = 'head_camera';
  add(g, 'mount', new THREE.BoxGeometry(0.036, 0.008, 0.03), shell, [0, 0.004, 0]);
  add(g, 'knuckle', new THREE.BoxGeometry(0.006, 0.014, 0.012), shell, [0, 0.014, 0]);
  const cam = new THREE.Group();
  cam.name = 'camera';
  cam.position.set(0, 0.03, -0.004); cam.rotation.x = -0.15;
  g.add(cam);
  add(cam, 'camera_body', new THREE.BoxGeometry(0.042, 0.03, 0.024), shell, [0, 0, 0]);
  add(cam, 'lens_housing', new THREE.CylinderGeometry(0.009, 0.01, 0.008, 24), shell, [0.008, 0, -0.015], Math.PI / 2);
  add(cam, 'lens', new THREE.CylinderGeometry(0.0065, 0.0065, 0.002, 24), glass(), [0.008, 0, -0.0195], Math.PI / 2);
  add(cam, 'rec_led', new THREE.SphereGeometry(0.0015, 8, 6), new THREE.MeshStandardMaterial({ name: 'led', color: '#ff2a1f', emissive: '#ff2a1f', emissiveIntensity: 2 }), [-0.014, 0.009, -0.0125]);
  const view = new THREE.Object3D();
  view.name = 'view';
  view.position.set(0.008, 0, -0.021);
  cam.add(view);
  return g;
}

/**
 * A depth camera for a robot wrist (RealSense D405 size: 42 x 42 x 23 mm, two lenses) on an L bracket. Origin: the
 * bracket's foot (bolt it to the flange side); the view looks down -z.
 */
export function wristCamera() {
  const g = new THREE.Group(), mat = dark(), alu = new THREE.MeshStandardMaterial({ name: 'bracket', color: '#9aa1a8', roughness: 0.35, metalness: 0.8 });
  g.name = 'wrist_camera';
  add(g, 'bracket', new THREE.BoxGeometry(0.03, 0.004, 0.05), alu, [0, 0.002, 0]);
  add(g, 'bracket_web', new THREE.BoxGeometry(0.03, 0.03, 0.004), alu, [0, 0.017, 0.023]);
  add(g, 'camera_body', new THREE.BoxGeometry(0.042, 0.042, 0.023), mat, [0, 0.036, 0.0]);
  for (const x of [-0.009, 0.009]) add(g, 'lens', new THREE.CylinderGeometry(0.0045, 0.0045, 0.002, 20), glass(), [x, 0.036, -0.0125], Math.PI / 2);
  const view = new THREE.Object3D();
  view.name = 'view';
  view.position.set(0, 0.036, -0.014);
  g.add(view);
  return g;
}

/** The torch IMU: a 26 x 12 x 34 mm box, its long side along z. Origin: the box centre; x, y, z are its sensing axes. */
export function imu() {
  const g = new THREE.Group();
  g.name = 'imu';
  add(g, 'imu_box', new THREE.BoxGeometry(0.026, 0.012, 0.034), new THREE.MeshStandardMaterial({ name: 'imu', color: '#2f6bff', roughness: 0.4, metalness: 0.3, emissive: '#0b2a8a', emissiveIntensity: 0.6 }), [0, 0, 0]);
  return g;
}
