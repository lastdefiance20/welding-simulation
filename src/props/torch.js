// A robot MIG torch, built in code from plain shapes (no vendor CAD), to the same mounting and TCP as the robot
// expects: origin on the mounting face, +z out of the flange; the wire tip ("TCP" node) at (-0.0028, 0, 0.3294) with
// the nozzle's axis (0.557, 0, 0.830) as its +z (33.9 deg off the flange axis, leaning toward +x).
// Laid out like a robot torch: a straight body parallel to the flange axis, 7 cm to its side (clamped to a bracket on
// the collision sensor), then a swan neck bending 33.9 deg toward +x into the straight front (insulator, nozzle, contact
// tip, wire); the cable hose leaves the body's back and runs back up past the wrist.
// scripts/export-assets.mjs bakes it to assets/torch/torch.glb.
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const TCP = V(-0.0028, 0, 0.3294);
export const AXIS = V(0.557, 0, 0.830).normalize();
/** A point on the torch's axis, s metres back from the wire tip. */
const at = s => TCP.clone().addScaledVector(AXIS, -s);

const mat = (name, color, roughness, metalness) => new THREE.MeshStandardMaterial({ name, color, roughness, metalness });

/** A cylinder along the torch axis from s0 to s1 (back from the tip), radius r0 at s0 and r1 at s1. */
function along(name, s0, s1, r0, r1, m, seg = 32) {
  const g = new THREE.CylinderGeometry(r0, r1, s1 - s0, seg);     // its +y end has radius r0: that end faces the tip
  const mesh = new THREE.Mesh(g, m);
  mesh.name = name;
  mesh.position.copy(at((s0 + s1) / 2));
  mesh.quaternion.setFromUnitVectors(V(0, 1, 0), AXIS);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

// The neck: a circular bend of radius R from the body's front end B (heading +z) to E (heading AXIS), then straight
// for FRONT to the wire tip. B follows from the tip.
const R = 0.08, FRONT = 0.10, TH = Math.acos(AXIS.z);
const E = at(FRONT), B = E.clone().sub(V(R * (1 - Math.cos(TH)), 0, R * Math.sin(TH)));
const BODY = { x: B.x, z0: 0.055, z1: B.z };

export function robotTorch() {
  const g = new THREE.Group();
  g.name = 'torch';
  const alu = mat('aluminium', '#b9bfc6', 0.35, 0.85), dark = mat('body', '#1c1e21', 0.55, 0.2), rubber = mat('hose', '#121314', 0.8, 0.0);
  const copper = mat('copper', '#c46a3a', 0.3, 0.9), brass = mat('brass', '#c9a23a', 0.3, 0.9), chrome = mat('neck', '#d7dadd', 0.18, 1.0);
  const red = mat('nozzle', '#c4262b', 0.35, 0.5), wire = mat('wire', '#e9e2d0', 0.25, 1.0);
  const add = m => { m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  const named = (name, m) => { m.name = name; return add(m); };
  /** A cylinder along z at (x, 0), from z0 to z1, radius r0 at z1 and r1 at z0. */
  const zcyl = (name, x, z0, z1, r0, r1, m, seg = 32) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, z1 - z0, seg), m);
    c.rotation.x = Math.PI / 2; c.position.set(x, 0, (z0 + z1) / 2);
    return named(name, c);
  };

  // Mount: the adapter plate on the flange, the collision sensor, a bracket out to the body's clamp.
  zcyl('adapter', 0, 0, 0.01, 0.0315, 0.0315, alu, 40);
  zcyl('collision_sensor', 0, 0.01, 0.05, 0.03, 0.03, dark, 40);
  zcyl('sensor_ring', 0, 0.028, 0.032, 0.0305, 0.0305, alu, 40);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(-BODY.x + 0.02, 0.036, 0.03), alu);
  bracket.position.set(BODY.x / 2 - 0.004, 0, 0.065);
  named('bracket', bracket);
  zcyl('clamp', BODY.x, 0.05, 0.095, 0.025, 0.025, alu, 6);

  // The body, its grip rings and the cone into the neck.
  zcyl('body', BODY.x, BODY.z0, BODY.z1 - 0.022, 0.018, 0.018, dark);
  for (let z = 0.115; z < 0.15; z += 0.01) zcyl('grip_ring', BODY.x, z, z + 0.004, 0.019, 0.019, alu);
  zcyl('body_cone', BODY.x, BODY.z1 - 0.022, BODY.z1, 0.011, 0.018, dark);
  // The swan neck: the bend, then straight to the insulator.
  const bend = new THREE.Curve();
  bend.getPoint = (u, out = new THREE.Vector3()) => out.set(B.x + R * (1 - Math.cos(u * TH)), 0, B.z + R * Math.sin(u * TH));
  named('neck_bend', new THREE.Mesh(new THREE.TubeGeometry(bend, 24, 0.0105, 24), chrome));
  add(along('neck', 0.08, FRONT + 0.001, 0.0095, 0.0105, chrome));
  // The front, from the tip back: wire, contact tip, nozzle, insulator.
  add(along('wire', 0, 0.013, 0.0006, 0.0006, wire, 8));
  add(along('contact_tip', 0.012, 0.022, 0.0028, 0.0034, copper, 16));
  add(along('nozzle', 0.016, 0.068, 0.0085, 0.0115, red));
  add(along('nozzle_lip', 0.016, 0.019, 0.0088, 0.009, copper));
  add(along('insulator', 0.068, 0.08, 0.0118, 0.0118, brass));

  // The cable hose: out of the body's back end, back past the flange and up the wrist (-z), sagging a little.
  const curve = new THREE.CatmullRomCurve3([V(BODY.x, 0, BODY.z0), V(BODY.x - 0.004, 0, 0.0), V(BODY.x - 0.03, 0.01, -0.1), V(BODY.x - 0.07, 0.03, -0.22)]);
  named('hose', new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.014, 16), rubber));
  for (let u = 0.0; u < 0.4; u += 0.016) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0145, 0.0022, 6, 20), rubber);
    ring.position.copy(curve.getPointAt(u));
    ring.quaternion.setFromUnitVectors(V(0, 0, 1), curve.getTangentAt(u));
    named('hose_ring', ring);
  }

  const tcp = new THREE.Object3D();
  tcp.name = 'TCP';
  tcp.position.copy(TCP);
  tcp.quaternion.setFromUnitVectors(V(0, 0, 1), AXIS);
  g.add(tcp);
  return g;
}
