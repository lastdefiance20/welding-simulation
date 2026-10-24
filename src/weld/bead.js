// The weld bead: a fillet cross-section swept along the seam, revealed up to the arc and coloured by heat.
// Each vertex knows its arc length along the weld (aS) and its corner point (aC); the shader tapers the bead into
// the pool at the head and glows by the metal's age (time since it was deposited), so it keeps cooling after the
// arc stops.
import * as THREE from 'three';
import { noise1 } from '../kit.js';

const STEP = 0.0005;          // longitudinal sample
const RING = 18;              // cross-section samples

export function buildBead(w) {
  // irregular (0..1): an uneven bead (leg, crown and centre wandering), for a poorly made weld.
  const { leg: LEG, convex: CONVEX, irregular: IRR = 0 } = w.bead;
  const L = w.length, N = Math.round(L / STEP) + 1;
  const pitch = w.speed / w.weaveHz;     // travel per weave cycle: one ripple
  const pos = new Float32Array(N * RING * 3);
  const aS = new Float32Array(N * RING), aK = new Float32Array(N * RING), aC = new Float32Array(N * RING * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const s = Math.min(L, i * STEP), f = w.seam.frame(s), c = f.p;
    // Ripples: the crown swells where the torch dwelt at each toe; the ends round off (start and crater).
    const ph = s / pitch;
    const ripple = 1 + 0.22 * Math.pow(0.5 + 0.5 * Math.cos(ph * Math.PI * 2), 3);
    const r0 = 0.0045, r1 = 0.004;
    const endTaper = Math.min(
      s < r0 ? 0.25 + 0.75 * Math.sqrt(1 - (1 - s / r0) ** 2) : 1,
      L - s < r1 ? 0.5 + 0.5 * Math.sqrt(1 - (1 - (L - s) / r1) ** 2) : 1);
    const leg = LEG * (0.96 + 0.04 * Math.sin(ph * 1.7)) * endTaper * (1 + IRR * (0.28 * noise1(s * 40, 11) + 0.12 * noise1(s * 160, 14)));
    const shift = IRR * 0.0013 * noise1(s * 14, 12);   // the bead's centre wandering between the toes
    for (let j = 0; j < RING; j++) {
      const k = j / (RING - 1);
      // Flat face from the plate-A toe (leg, 0) to the plate-B toe (0, leg), crowned, toes blended slightly below.
      const crown = CONVEX * ripple * endTaper * Math.sin(Math.PI * k) * (1 + IRR * 0.9 * noise1(s * 70 + k, 13));
      const toe = -0.00025 * (Math.pow(1 - Math.sin(Math.PI * k), 6));
      const u = leg * (1 - k) + (crown + toe) * Math.SQRT1_2;
      const v = leg * k + (crown + toe) * Math.SQRT1_2;
      p.copy(c).addScaledVector(f.eA, u + shift * (1 - k)).addScaledVector(f.eB, v - shift * k);
      const o = i * RING + j;
      pos.set([p.x, p.y, p.z], o * 3);
      aS[o] = s;
      aK[o] = k;
      aC.set([c.x, c.y, c.z], o * 3);
    }
  }
  // Winding: the faces must point out of the joint whichever way the seam runs ((eA x eB) . t decides).
  const f0 = w.seam.frame(0), flip = new THREE.Vector3().crossVectors(f0.eA, f0.eB).dot(f0.t) < 0;
  const idx = [];
  const tri = (a, b, c) => (flip ? idx.push(a, c, b) : idx.push(a, b, c));
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < RING - 1; j++) {
    const a = i * RING + j, b = a + RING;
    tri(a, a + 1, b); tri(b, a + 1, b + 1);
  }
  // Caps over the open cross-sections at the start and end: a fan from the corner point.
  const nv = N * RING, capPos = [], capS = [], capC = [];
  for (const [i, cap] of [[0, 0], [N - 1, 1]]) {
    const s = Math.min(L, i * STEP), c = w.seam.frame(s).p;
    capPos.push(c.x, c.y, c.z); capS.push(s); capC.push(c.x, c.y, c.z);
    for (let j = 0; j < RING - 1; j++) {
      const a = i * RING + j;
      if (cap === 0) tri(nv, a + 1, a); else tri(nv + 1, a, a + 1);
    }
  }
  const all = (a, b) => { const r = new Float32Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(all(pos, capPos), 3));
  geo.setAttribute('aS', new THREE.BufferAttribute(all(aS, capS), 1));
  geo.setAttribute('aK', new THREE.BufferAttribute(all(aK, [0.5, 0.5]), 1));
  geo.setAttribute('aC', new THREE.BufferAttribute(all(aC, capC), 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const uniforms = { uHead: { value: 0 }, uTime: { value: 0 }, uT0: { value: w.start }, uV: { value: w.speed } };
  const mat = new THREE.MeshStandardMaterial({ color: '#7a7f86', metalness: 0.8, roughness: 0.36 });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aS; attribute float aK; attribute vec3 aC; uniform float uHead, uTime, uT0, uV;
        varying float vAge; varying float vS; varying float vK;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // Swell out of the pool: the last few mm before the head are still filling.
        float fill = smoothstep(0.0, 0.006, uHead - aS);
        transformed = aC + (transformed - aC) * mix(0.35, 1.0, fill);
        vAge = uTime - (uT0 + aS / uV);
        vS = aS; vK = aK;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vAge; varying float vS; varying float vK; uniform float uHead;
        vec3 heat(float a) {
          // Black-body-ish ramp by age (s): white -> yellow -> orange -> cherry red -> dark.
          vec3 c = mix(vec3(1.0, 0.95, 0.8), vec3(1.0, 0.62, 0.18), smoothstep(0.0, 0.35, a));
          c = mix(c, vec3(0.9, 0.22, 0.04), smoothstep(0.35, 1.6, a));
          c = mix(c, vec3(0.35, 0.04, 0.01), smoothstep(1.6, 4.5, a));
          float k = 1.0 - smoothstep(2.5, 9.0, a);
          return c * k * mix(6.0, 0.4, smoothstep(0.0, 2.5, a));
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (vS > uHead) discard;
        totalEmissiveRadiance += heat(max(vAge, 0.0));`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Cooled weld: grey metal, a blue band and a straw band toward each toe (temper colours).
        float toe = 1.0 - sin(3.14159 * vK);
        vec3 tint = mix(vec3(1.0), vec3(0.62, 0.7, 1.0), smoothstep(0.15, 0.45, toe));
        tint = mix(tint, vec3(1.05, 0.86, 0.55), smoothstep(0.55, 0.9, toe));
        diffuseColor.rgb *= mix(vec3(1.0), tint, smoothstep(2.0, 8.0, vAge));`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'bead:' + w.id;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return {
    mesh,
    update(t) {
      // The crater fill finishes the last few mm (the head taper) after travel stops.
      const crater = Math.min(1, Math.max(0, (t - w.end) / (w.arcOff - w.end)));
      uniforms.uHead.value = t >= w.arcOn ? w.deposit(t) + 0.0004 + 0.0066 * crater : -1;
      uniforms.uTime.value = t;
      mesh.visible = t >= w.arcOn;
    },
  };
}
