// Example: the UR5e welds the T-joint 2F specimen (horizontal fillet), one weaving pass along 270 mm, recorded by two
// rig cameras: one on the robot's wrist (next to the torch, looking at the wire tip) and one on a tripod behind the
// robot to its right. ?gap=3 / ?gap=5 lifts the stiffener off the plate.
//
// World frame: Y up, metres; the robot's base on the table top at the origin, facing +x (its right is +z); the
// table top at y = 0, the floor at y = -0.82. The specimen's welded corner runs along z at x = WX.
//   npm run render -- --project example-robot                 the film (rig cameras as insets)
//   npm run render -- --project example-robot --query view=wrist   the wrist camera's stream alone
import * as THREE from 'three';
import { defineWeld } from '../../src/weld/program.js';
import { lerp, ease } from '../../src/kit.js';
import { buildSpecimen, SPEC } from '../../src/specimens/t2f.js';
import { tripodCamera, wristCamera } from '../../src/props/sensors.js';
import { rigCamera } from '../../src/views.js';

const WX = 0.50, FLOOR = -0.82;
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const mm = m => Math.round(m * 1000);

export default {
  id: 'example-robot',
  title: 'Example · UR5e T이음 2F 용접',
  params: { gap: { default: 0, options: [0, 3, 5] } },

  create({ gap }) {
    const spec = buildSpecimen({ gap, wx: WX });
    const root = defineWeld('root', spec.seam, {
      // Elbow up, wrist above, the flange pointing down: the torch neck reaches into the corner from the robot's side.
      // (Found by a seed search: 0 IK failures, 0.02 mm worst error along the weld.)
      seed: [0, -1.6, 1.6, -1.6, -1.57, 0],
      flangeDir: v(0, -1, 0),
    });
    // The tripod behind the robot, to its right, aimed at the specimen.
    const tripod = tripodCamera({ height: 2.1 });
    tripod.position.set(-0.8, FLOOR, 0.8);
    const scene = new THREE.Group();
    scene.add(spec.group, tripod);

    return {
      scene,
      collide: spec.collide,
      obstacles: spec.obstacles,
      welds: [root],
      home: { like: 'root', back: 0.25, up: 0.1 },
      steps: [
        { hold: 4.0, mark: 'intro' },
        { moveJ: { approach: 'root' }, dur: 3.0, mark: 'move' },
        { approach: 'root', dur: 1.2, settle: 0.2, mark: 'approach' },
        { weld: 'root' },
        { retract: 'root', dur: 1.2, mark: 'retract' },
        { moveJ: 'home', dur: 3.2, mark: 'return' },
        { hold: 4.0, mark: 'outro' },
      ],

      // The rig cameras: the wrist camera on a bracket off the torch mount (tool0 frame: +z out of the flange, the
      // torch's TCP at about (0, 0, 0.33)), 8 cm off the axis and 12 cm down it, clear of the wrist's own links,
      // looking at the wire tip.
      async setup(ctx) {
        const { robot } = ctx;
        const wrist = wristCamera();
        const tool0 = robot.links.tool0, tip = robot.tcp.position.clone();
        const at = v(0, 0.08, 0.12);
        wrist.matrix.lookAt(at, tip, v(0, 1, 0)).setPosition(at);   // its -z at the tip; up is tool0's +y (upright while the torch points down)
        wrist.matrix.decompose(wrist.position, wrist.quaternion, wrist.scale);
        tool0.add(wrist);
        tripod.userData.aim(v(WX, 0.06, 0));
        ctx.cameras.wrist = rigCamera(wrist.getObjectByName('view'), { fov: 70, label: 'WRIST CAM' });
        ctx.cameras.rear = rigCamera(tripod.getObjectByName('view'), { fov: 42, label: 'REAR-RIGHT CAM' });
      },
      update(t, ctx) {
        for (const c of Object.values(ctx.cameras)) c.sync();
      },

      // Cut times follow the weld (w.start + ...), tuned for its 18 s of travel: retime them if duration changes.
      shots(plan) {
        const w = plan.welds[0], M = plan.marks;
        const arcZ = t => w.arcPoint(Math.min(Math.max(t, w.start), w.end)).z;
        return [
          [0, (t, u) => ({ // establishing: slow orbit around the cell
            pos: v(1.95, 1.05, 1.55).applyAxisAngle(v(0, 1, 0), lerp(0.18, -0.06, ease.sine(u))), look: v(0.22, 0.3, 0), fov: 32 })],
          [M.move[0], (t, u) => ({ // the arm swings in over the specimen
            pos: v(lerp(1.4, 1.3, u), lerp(0.6, 0.52, u), lerp(-1.05, -0.9, u)), look: v(0.4, 0.22, 0.08), fov: 30 })],
          [w.arcOn - 0.25, t => ({ // low close-up on the corner as the arc strikes, following the torch
            pos: v(0.37, 0.05, arcZ(t) - 0.17), look: v(0.50, 0.03, arcZ(t) + 0.01), fov: 30 })],
          [w.start + 4.6, t => ({ // behind the torch, looking along the glowing bead
            pos: v(0.37, 0.12, arcZ(t) + 0.19), look: v(0.50, 0.025, arcZ(t) - 0.01), fov: 28 })],
          [w.start + 9.6, (t, u) => ({ // wide over the robot's shoulder: the whole arm weaving
            pos: v(lerp(-0.1, 0.0, u), lerp(0.95, 0.9, u), lerp(1.05, 0.95, u)), look: v(0.44, 0.1, lerp(0.0, -0.06, u)), fov: 32 })],
          [w.start + 14.2, t => ({ // top-down along the wall: the weave swinging toe to toe, the pool
            pos: v(0.483, 0.28, arcZ(t) + 0.03), look: v(0.497, 0.026, arcZ(t) - 0.004), fov: 20, filter: 1 })],
          [w.arcOff + 0.3, (t, u) => ({ // the bead reveal: a low dolly along the finished weld as it cools
            pos: v(0.40, 0.06, lerp(0.21, -0.12, ease.inOut(u))), look: v(0.505, 0.022, lerp(0.13, -0.2, ease.inOut(u))), fov: 26 })],
          [M.outro[0], (t, u) => ({ // pull back
            pos: v(lerp(1.25, 1.7, ease.out(u)), lerp(0.55, 0.85, ease.out(u)), lerp(0.85, 1.2, ease.out(u))), look: v(0.4, 0.12, 0), fov: 30 })],
        ];
      },

      cards(plan) {
        const w = plan.welds[0], M = plan.marks;
        const gapTxt = `Gap ${gap}`;
        return [
          { cls: 'title', from: 0.4, to: M.move[0] - 0.1, inn: 0.8, out: 0.6, dy: 24, html: `
            <div class="kicker">EXAMPLE · ROBOT</div>
            <h1>T이음 <span>2F</span></h1>
            <div class="sub">수평 필릿 · ${gapTxt} · UR5e 위빙 용접</div>` },
          { cls: 'spec', from: M.move[0] + 0.4, to: w.arcOn - 0.3, inn: 0.6, out: 0.4, html: `
            <div class="row"><b>바닥판</b><span>${mm(SPEC.plate.L)} × ${mm(SPEC.plate.W)} t${mm(SPEC.plate.T)}</span></div>
            <div class="row"><b>보강판</b><span>${mm(SPEC.stiff.L)} × ${mm(SPEC.stiff.H)} t${mm(SPEC.stiff.T)}</span></div>
            <div class="row"><b>용접선</b><span>${mm(SPEC.weld.L)} mm · 수평 필릿</span></div>
            <div class="row"><b>토치</b><span>작업각 ${w.workAngle}° · 진행각 ${w.travelAngle}° 전진</span></div>
            <div class="row"><b>위빙</b><span>폭 ${(w.weaveAmp * 2000).toFixed(1)} mm · ${w.weaveHz} Hz · 양끝 정지</span></div>` },
          { cls: 'endcard', from: M.outro[0] + 0.6, to: plan.duration + 1, inn: 0.9, out: 0.1, dy: 20, html: `
            <div class="kicker">UR5e · MIG · IK + WEAVING</div>
            <h2>${mm(SPEC.weld.L)} mm, 한 번에.</h2>
            <div class="sub">T이음 2F 수평 필릿 · ${gapTxt}</div>` },
        ];
      },
      hud: plan => ({ from: plan.welds[0].arcOn + 0.4, to: plan.welds[0].arcOff + 2.6 }),
    };
  },
};
