// Arc effects, all pure functions of film time: arc light and glow, weld pool, sparks (spatter), smoke, and the
// glow the arc throws on the plates.
import * as THREE from 'three';
import { hash, noise1, clamp, span } from '../kit.js';

function radialTexture(stops, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function smokeTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  for (let i = 0; i < 40; i++) {
    const x = S / 2 + (hash(i, 71) - 0.5) * S * 0.45, y = S / 2 + (hash(i, 72) - 0.5) * S * 0.45, r = S * (0.12 + hash(i, 73) * 0.2);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }
  return new THREE.CanvasTexture(c);
}

const MAX_SPARKS = 1400, SPARK_RATE = 140, SPARK_LIFE = 0.9, MAX_SMOKE = 48, SMOKE_RATE = 9, SMOKE_LIFE = 3.2;
const G = -9.81;

/** Arc intensity in 0..1+ of weld w at film time t: strike flash, flicker with short-circuit dips, crater fade. */
export function arcIntensity(t, w) {
  if (!w || t < w.arcOn || t >= w.arcOff) return 0;
  const strike = 1 + 1.6 * Math.exp(-(t - w.arcOn) / 0.06);
  const f = 0.82 + 0.12 * noise1(t * 60, 1) + 0.08 * noise1(t * 173, 2);
  const dip = hash(Math.floor(t * 90), 5) < 0.06 ? 0.45 : 1;      // short-circuit transfer flickers
  const fade = 1 - 0.5 * span(w.end, w.arcOff, t);
  return strike * f * dip * fade * span(w.arcOn, w.arcOn + 0.03, t);
}

/**
 * plan: the compiled program (its welds carry their times and geometry).
 * collide(p): pushes a spark position out of the specimen and the table (project-specific), mutating p.
 */
export function buildFx(scene, plan, collide = p => { if (p.y < 0) p.y = -p.y * 0.25; }) {
  const g = new THREE.Group();
  g.name = 'fx';
  scene.add(g);

  // Arc light: lights the torch, plates and the arm from the corner.
  // Linear falloff: with inverse-square this close to the plates, the spot under the light saturates into a disc.
  const light = new THREE.PointLight('#cfdcff', 0, 1.2, 1);
  // No shadows: from this close the torch's shadow cuts the plates into hard wedges.
  g.add(light);
  const warm = new THREE.PointLight('#ff8a3a', 0, 0.5, 2);   // the pool's own orange
  // Spill: the arc lighting the cell (arm, table) without the inverse-square blow-out next to the arc.
  const spill = new THREE.PointLight('#b9c8ff', 0, 1.6, 0.6);
  g.add(warm, spill);

  const add = (tex, color, size) => {
    const m = new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const s = new THREE.Sprite(m);
    s.scale.setScalar(size);
    g.add(s);
    return s;
  };
  const coreTex = radialTexture([[0, '#ffffff'], [0.15, '#f4f7ff'], [0.4, 'rgba(150,170,255,0.5)'], [1, 'rgba(60,70,255,0)']]);
  const haloTex = radialTexture([[0, 'rgba(220,230,255,0.7)'], [0.3, 'rgba(120,140,255,0.18)'], [1, 'rgba(40,40,120,0)']]);
  const core = add(coreTex, new THREE.Color(2.5, 2.5, 2.8), 0.01);
  const halo = add(haloTex, new THREE.Color(0.9, 0.95, 1.3), 0.04);
  core.renderOrder = halo.renderOrder = 10;
  core.material.depthTest = false;      // the arc burns through the nozzle's edge on camera

  // Weld pool: a bright molten ellipsoid in the corner.
  const pool = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.4, 0.9) }));
  pool.scale.set(0.0042, 0.0042, 0.0055);
  g.add(pool);

  // Glow on the plate and the wall around the arc.
  const glowTex = radialTexture([[0, 'rgba(255,150,70,0.7)'], [0.2, 'rgba(255,100,30,0.25)'], [1, 'rgba(255,60,0,0)']]);
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const plateGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat);    // on plate A
  const wallGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat);     // on plate B
  g.add(plateGlow, wallGlow);

  // Sparks: streaks, each from its position now back to where it was a moment ago.
  const sparkPos = new Float32Array(MAX_SPARKS * 6), sparkCol = new Float32Array(MAX_SPARKS * 6);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
  const sparks = new THREE.LineSegments(sparkGeo, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  sparks.frustumCulled = false;
  g.add(sparks);
  // Spark heads as points, for a little body on top of the 1px streaks.
  const headGeo = new THREE.BufferGeometry();
  const headPos = new Float32Array(MAX_SPARKS * 3), headCol = new Float32Array(MAX_SPARKS * 3);
  headGeo.setAttribute('position', new THREE.BufferAttribute(headPos, 3).setUsage(THREE.DynamicDrawUsage));
  headGeo.setAttribute('color', new THREE.BufferAttribute(headCol, 3).setUsage(THREE.DynamicDrawUsage));
  const heads = new THREE.Points(headGeo, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  heads.frustumCulled = false;
  g.add(heads);

  // Smoke: soft sprites rising and spreading.
  const smokeTex = smokeTexture();
  const smoke = [];
  for (let i = 0; i < MAX_SMOKE; i++) {
    const m = new THREE.SpriteMaterial({ map: smokeTex, color: '#8e9296', transparent: true, depthWrite: false, opacity: 0 });
    const s = new THREE.Sprite(m);
    s.visible = false;
    g.add(s);
    smoke.push(s);
  }

  const tmp = new THREE.Vector3(), Zp = new THREE.Vector3(0, 0, 1);

  function sparkAt(w, wi, i, t, out) {
    // Born at tb from the arc, flying out of the corner (around the out direction), with drag and gravity,
    // bouncing off the work. Returns age/life, or -1 if not alive.
    const tb = w.arcOn + (i + hash(i, 11 + wi * 1000)) / SPARK_RATE;
    if (tb >= w.arcOff) return -1;
    const life = 0.18 + Math.pow(hash(i, 12 + wi * 1000), 1.5) * (SPARK_LIFE - 0.18);
    const a = t - tb;
    if (a < 0 || a > life) return -1;
    const o = w.arcPoint(tb), s = w.deposit(tb), out0 = w.outDir(s), trav = w.seam.frame(s).t;
    const side = new THREE.Vector3().crossVectors(out0, trav).normalize();
    const th = (hash(i, 13 + wi * 1000) - 0.5) * 2.6, ph = (hash(i, 14 + wi * 1000) - 0.2) * 1.3;
    const dir = tmp.copy(out0).multiplyScalar(Math.cos(ph)).addScaledVector(trav, Math.sin(ph) * 0.8)
      .applyAxisAngle(trav, th * 0.6).addScaledVector(side, Math.sin(th) * 0.4).normalize();
    const v = 0.5 + Math.pow(hash(i, 15 + wi * 1000), 2) * 2.4, k = 2.2;
    const d = (1 - Math.exp(-k * a)) / k;
    out.set(o.x + dir.x * v * d, o.y + dir.y * v * d + 0.5 * G * a * a * 0.6, o.z + dir.z * v * d);
    collide(out);
    return a / life;
  }

  const P = new THREE.Vector3(), Q = new THREE.Vector3(), col = new THREE.Color();
  return {
    update(t, filter = 0) {
      const w = plan.weldAt(t);
      const I = arcIntensity(t, w);
      const on = I > 0;
      const ap = w.arcPoint(Math.min(t, w.end)), sNow = w.deposit(t), fr = w.seam.frame(sNow);
      const OUT = w.outDir(sNow), TOOL = w.toolAxis(sNow);
      // A little out of the corner: right on the surface its specular highlight saturates into a hard disc.
      const lp = ap.clone().addScaledVector(OUT, 0.02).addScaledVector(TOOL, -0.002);
      light.position.copy(lp);
      light.intensity = I * 0.05;
      // Far enough back that its highlight on the plates stays soft (close in, it reads as a white disc).
      spill.position.copy(ap).addScaledVector(OUT, 0.35).add(new THREE.Vector3(0, 0.15, 0));
      spill.intensity = I * 1.3;
      warm.position.copy(ap).addScaledVector(OUT, 0.01);
      warm.intensity = 0.012 * (on ? 1 + 0.3 * noise1(t * 7, 9) : (t > w.arcOff ? Math.max(0, 1 - (t - w.arcOff) / 1.2) : 0));
      core.visible = halo.visible = on;
      core.position.copy(ap).addScaledVector(TOOL, -0.0012);
      halo.position.copy(core.position);
      core.scale.setScalar(0.005 + 0.004 * I);
      halo.scale.setScalar(0.022 + 0.018 * I);
      core.material.opacity = Math.min(1, I) * (1 - 0.6 * filter);
      halo.material.opacity = Math.min(1, I * 0.8) * (1 - 0.85 * filter);
      pool.visible = t >= w.arcOn && t < w.arcOff + 0.8;
      pool.position.copy(ap).addScaledVector(OUT, 0.0012);
      pool.quaternion.setFromUnitVectors(Zp, fr.t);
      const cool = clamp(1 - (t - w.arcOff) / 0.8);
      pool.material.color.setRGB(4 * cool, 2.4 * cool * cool, 0.9 * cool * cool * cool);

      const gI = on ? 0.5 + 0.5 * Math.min(1, I) : 0;
      // Each glow sits on its plate's face: the arc point projected onto the face, moved out along it.
      const onFace = (n, e) => ap.clone().addScaledVector(n, -ap.clone().sub(fr.p).dot(n)).addScaledVector(e, 0.006).addScaledVector(n, 0.0004);
      plateGlow.position.copy(onFace(fr.nA, fr.eA));
      plateGlow.quaternion.setFromUnitVectors(Zp, fr.nA);
      plateGlow.scale.setScalar(0.05 + 0.01 * I);
      wallGlow.position.copy(onFace(fr.nB, fr.eB));
      wallGlow.quaternion.setFromUnitVectors(Zp, fr.nB);
      wallGlow.scale.setScalar(0.05 + 0.01 * I);
      glowMat.opacity = gI * 0.22 * (1 - 0.6 * filter);
      plateGlow.visible = wallGlow.visible = on;

      // Sparks alive now were born within the last SPARK_LIFE seconds of some weld's arc.
      let n = 0;
      plan.welds.forEach((w, wi) => {
        if (!(t >= w.arcOn && t < w.arcOff + SPARK_LIFE)) return;
        const i0 = Math.max(0, Math.floor((t - SPARK_LIFE - w.arcOn) * SPARK_RATE) - 1);
        const i1 = Math.floor((t - w.arcOn) * SPARK_RATE) + 1;
        for (let i = i0; i <= i1 && n < MAX_SPARKS; i++) {
          const u = sparkAt(w, wi, i, t, P);
          if (u < 0) continue;
          if (sparkAt(w, wi, i, t - 0.012, Q) < 0) Q.copy(P);
          // White-yellow, cooling to orange and red, fading.
          const heat = 1 - u;
          col.setRGB(1, 0.35 + 0.6 * heat * heat, 0.08 + 0.5 * Math.pow(heat, 4)).multiplyScalar(2.2 * Math.pow(heat, 0.7));
          sparkPos.set([P.x, P.y, P.z, Q.x, Q.y, Q.z], n * 6);
          sparkCol.set([col.r, col.g, col.b, col.r * 0.25, col.g * 0.15, col.b * 0.1], n * 6);
          headPos.set([P.x, P.y, P.z], n * 3);
          headCol.set([col.r, col.g, col.b], n * 3);
          n++;
        }
      });
      sparkGeo.setDrawRange(0, n * 2);
      headGeo.setDrawRange(0, n);
      sparkGeo.attributes.position.needsUpdate = sparkGeo.attributes.color.needsUpdate = true;
      headGeo.attributes.position.needsUpdate = headGeo.attributes.color.needsUpdate = true;

      // Smoke puffs born at the arc, rising and drifting out along plate A.
      let m = 0;
      for (const w of plan.welds) {
        if (!(t >= w.arcOn && t < w.arcOff + SMOKE_LIFE)) continue;
        const s0 = Math.max(0, Math.floor((t - SMOKE_LIFE - w.arcOn) * SMOKE_RATE)), s1 = Math.floor((t - w.arcOn) * SMOKE_RATE);
        for (let i = s0; i <= s1 && m < MAX_SMOKE; i++) {
          const tb = w.arcOn + (i + hash(i, 31)) / SMOKE_RATE;
          if (tb > w.arcOff) break;
          const a = t - tb;
          if (a < 0 || a > SMOKE_LIFE) continue;
          const u = a / SMOKE_LIFE, o = w.arcPoint(tb), sp = smoke[m++], fb = w.seam.frame(w.deposit(tb));
          sp.visible = true;
          sp.position.copy(o).addScaledVector(fb.eA, 0.02 * a + 0.03 * u * hash(i, 32)).addScaledVector(fb.t, -0.03 * noise1(a * 0.8 + i, 33));
          sp.position.y += 0.012 + 0.07 * a + 0.01 * a * a;
          sp.scale.setScalar(0.02 + 0.09 * Math.sqrt(u) * (0.7 + 0.6 * hash(i, 34)));
          sp.material.rotation = hash(i, 35) * 6.28 + a * (hash(i, 36) - 0.5);
          sp.material.opacity = 0.2 * (1 - 0.6 * filter) * Math.sin(Math.PI * Math.pow(u, 0.6)) * (0.6 + 0.4 * hash(i, 37));
          sp.material.color.setRGB(0.55 + 0.6 * I * (1 - u), 0.56 + 0.4 * I * (1 - u), 0.6 + 0.5 * I * (1 - u));
        }
      }
      for (let i = m; i < MAX_SMOKE; i++) smoke[i].visible = false;
      return I;
    },
  };
}
