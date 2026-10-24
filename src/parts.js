// Specimen parts: steel plates (flat boxes, cylindrically bent plates), tack welds, and the mill-scale material.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { hash } from './kit.js';

/** Procedural mill-scale steel: blue-grey with mottling and faint rolling streaks. */
export function millScale(seed) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#4a4f55'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    const x = hash(i, seed) * 512, y = hash(i, seed + 1) * 512, r = 2 + hash(i, seed + 2) * 18;
    const l = 30 + hash(i, seed + 3) * 22;
    g.fillStyle = `hsla(${205 + hash(i, seed + 4) * 20}, 8%, ${l}%, 0.08)`;
    g.beginPath(); g.ellipse(x, y, r * 2.2, r, 0, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 160; i++) {
    const y = hash(i, seed + 9) * 512;
    g.fillStyle = `rgba(255,255,255,${0.012 + hash(i, seed + 10) * 0.02})`;
    g.fillRect(0, y, 512, 1 + hash(i, seed + 11) * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export const steel = seed => new THREE.MeshStandardMaterial({ map: millScale(seed), metalness: 0.4, roughness: 0.7, envMapIntensity: 0.8 });

/** A flat plate: size [x, y, z] (m), centred at `at`, with slightly rounded edges. */
export function plate(size, at, seed, radius = 0.0011) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(...size, 2, radius), steel(seed));
  m.position.copy(at);
  m.castShadow = m.receiveShadow = true;
  m.userData.obstacle = true;
  return m;
}

/** An oriented box: a local Box3 under a rigid world matrix. Same distanceToPoint as THREE.Box3. */
export function orientedBox(box, matrixWorld) {
  const inv = matrixWorld.clone().invert(), p = new THREE.Vector3();
  return { box, matrixWorld, distanceToPoint: q => box.distanceToPoint(p.copy(q).applyMatrix4(inv)) };
}

/**
 * Collision boxes of a specimen group, for the offline plan check: every flat plate (its geometry's box), and a
 * bent plate as a row of boxes along its curve (userData.obstacleBoxes, local).
 */
export function obstaclesOf(group) {
  group.updateMatrixWorld(true);
  const out = [];
  group.traverse(o => {
    if (o.userData.obstacle) { o.geometry.computeBoundingBox(); out.push(orientedBox(o.geometry.boundingBox.clone(), o.matrixWorld.clone())); }
    for (const b of o.userData.obstacleBoxes || []) out.push(orientedBox(b.clone(), o.matrixWorld.clone()));
  });
  return out;
}

/**
 * A plate bent about an axis parallel to x, concave side up (a curved block's skin): width (x), arc length (z),
 * thickness, bend radius. The top surface's lowest line passes through `at`.
 */
export function bentPlate({ width, length, thickness, radius, at, seed, segments = 64 }) {
  const half = length / 2 / radius, shape = [];
  for (let i = 0; i <= segments; i++) {
    const a = -half + (2 * half * i) / segments;
    shape.push([Math.sin(a) * radius, radius - Math.cos(a) * radius]);
  }
  // Extrude the arc profile (in z-y) across x, as an outer and inner skin joined at the edges.
  const pos = [], idx = [];
  for (const dy of [0, -thickness]) {
    for (const [z, y] of shape) {
      pos.push(-width / 2, y + dy, z, width / 2, y + dy, z);
    }
  }
  const S = segments + 1, base = i => i * 2;
  for (let i = 0; i < segments; i++) {
    const a = base(i), b = base(i + 1);
    idx.push(a, b, a + 1, a + 1, b, b + 1);                         // top
    const c = 2 * S + a, d = 2 * S + b;
    idx.push(c, c + 1, d, c + 1, d + 1, d);                         // bottom
    idx.push(a, c, b, b, c, d);                                     // -x edge
    idx.push(a + 1, b + 1, c + 1, b + 1, d + 1, c + 1);             // +x edge
  }
  for (const [i, flip] of [[0, false], [segments, true]]) {        // ends
    const a = base(i), c = 2 * S + a, q = [a, a + 1, c, a + 1, c + 1, c];
    idx.push(...(flip ? q.reverse() : q));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Planar UVs for the mill-scale texture.
  const uv = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] * 2.5, pos[i + 2] * 2.5);
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const m = new THREE.Mesh(geo, steel(seed));
  m.position.copy(at);
  m.castShadow = m.receiveShadow = true;
  // Collision: one box per few segments along the curve.
  m.userData.obstacleBoxes = [];
  for (let i = 0; i < segments; i += 4) {
    const box = new THREE.Box3();
    for (let k = i; k <= Math.min(segments, i + 4); k++) {
      const [z, y] = shape[k];
      box.expandByPoint(new THREE.Vector3(-width / 2, y - thickness, z)).expandByPoint(new THREE.Vector3(width / 2, y, z));
    }
    m.userData.obstacleBoxes.push(box);
  }
  return m;
}

/**
 * A plate cut to an outline: `outline` is a list of [z, y] points (m), extruded `thickness` along +x from x = 0,
 * then placed at `at`. For a curved block's transverse (straight top, bottom edge following the skin).
 */
export function profilePlate(outline, thickness, at, seed) {
  const shape = new THREE.Shape(outline.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 });
  // Shape is in x-y and extrudes along +z; turn it so the outline is in z-y and the thickness runs along +x.
  geo.rotateY(-Math.PI / 2);
  geo.translate(thickness, 0, 0);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.5, uv.getY(i) * 2.5);
  const m = new THREE.Mesh(geo, steel(seed));
  m.position.copy(at);
  m.castShadow = m.receiveShadow = true;
  m.userData.obstacle = true;
  return m;
}

const tackMat = new THREE.MeshStandardMaterial({ color: '#3b3d40', metalness: 0.7, roughness: 0.45 });
/** A small tack weld along `dir` at `at`. */
export function tack(at, dir = new THREE.Vector3(0, 0, 1)) {
  const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.0035, 0.012, 4, 10), tackMat);
  t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  t.position.copy(at);
  t.castShadow = true;
  return t;
}
