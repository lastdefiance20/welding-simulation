// Example: a person welds the T-joint 2F specimen (horizontal fillet) by hand with a MIG gun, one weaving pass,
// recorded by two rig cameras: one on the hard hat (looking down at the hands) and one on a tripod behind the person
// to their right. No robot (robot: false). The weld is still a weld (actor 'human'): the core grows the bead and
// throws the sparks along it; this file moves the gun along the weld and the body after the gun.
//
//   person   assets/people/worker.glb, auto-rigged (src/human/worker.js): feet, lean, look and the hands by IK
//   gun      the MIG gun and the welding machine out of assets/people/welder.glb (src/human/welder.js), with an IMU
//
// World frame: Y up, metres; the table top at y = 0, the floor at y = -0.82. The person stands at the table's -x end
// facing +x (their right is +z); the welded corner runs along z at x = WX.
//   npm run render -- --project example-human                 the film (rig cameras as insets)
//   npm run render -- --project example-human --query view=head   the head camera's stream alone
import * as THREE from 'three';
import { defineWeld } from '../../src/weld/program.js';
import { registerWeave, triangleDwell } from '../../src/weld/weave.js';
import { lerp, ease, span, clamp, noise1 } from '../../src/kit.js';
import { buildSpecimen } from '../../src/specimens/t2f.js';
import { loadWelder } from '../../src/human/welder.js';
import { loadWorker, stance } from '../../src/human/worker.js';
import { tripodCamera } from '../../src/props/sensors.js';
import { rigCamera } from '../../src/views.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180, FLOOR = -0.82, UP = v(0, 1, 0);
const WX = -0.22;                                   // the welded corner (x): the plate's near edge about 0.1 m in from the table's end
const FEET = v(-0.64, FLOOR, 0.1), YAW = Math.PI / 2;   // the person stands square to the seam, facing +x
const ARC0 = 4.0, WELD = 20, OUT = 31;              // the arc strikes at 4 s, 20 s of travel, the film ends at 31 s
const HEAD_TILT = 0.3;                              // rad: the head camera tipped down on its mount, at the hands

// A person's weave: triangle-with-dwell with a wandering rhythm and width.
registerWeave('human', (time, o) => {
  const ph = time * o.hz, w = ph + 0.18 * noise1(ph * 0.23, 91);
  return clamp(triangleDwell(w / o.hz, o) * (1 + 0.1 * noise1(ph * 0.87, 92)) + 0.05 * noise1(ph * 4, 93), -1.15, 1.15);
});

// The grip, in the gun's frame (TCP at the origin, nozzle along +z): the right hand round the handle near its front
// end, the hand's line tipped 75 deg down across it, the palm against its right side.
const GRIP_MIX = [Math.cos(75 * DEG), Math.sin(75 * DEG)], GRIP_OFF = v(-0.03, 0.03, 0.01);
const GRIP = v(0, -0.115, -0.215), ALONG = v(0, 0.81, 0.59).normalize(), ACROSS = v(0, -0.58, 0.81).normalize();
const HAND_DIR = ALONG.clone().multiplyScalar(GRIP_MIX[0]).addScaledVector(ACROSS, GRIP_MIX[1]).normalize();
const GRIP_KNUCKLE = GRIP.clone().add(GRIP_OFF), PALM = v(1, 0, 0);
// After the weld: the gun hanging in the right hand by the thigh, nozzle forward and down.
const REST_TOOL = v(0.5, -0.86, 0.05).normalize(), REST_HAND = v(-0.52, 0.06, 0.34);
const REST_TCP = (() => { const x = UP.clone().cross(REST_TOOL).normalize(), m = new THREE.Matrix4().makeBasis(x, REST_TOOL.clone().cross(x), REST_TOOL); return REST_HAND.clone().sub(GRIP_KNUCKLE.clone().applyMatrix4(m)); })();

export default {
  id: 'example-human',
  title: 'Example · 사람 T이음 2F 용접',
  robot: false,
  params: { gap: { default: 0, options: [0, 3, 5] } },

  create({ gap }) {
    const spec = buildSpecimen({ gap, wx: WX });
    const weld = defineWeld('human', spec.seam, { duration: WELD, weave: 'human', weaveAmp: 0.0025, weaveHz: 1.5, travelAngle: 5, actor: 'human', label: '사람 용접' });
    const tripod = tripodCamera({ height: 2.1 });
    tripod.position.set(-1.45, FLOOR, 0.95);           // behind the person, to their right
    const scene = new THREE.Group();
    scene.add(spec.group, tripod);

    // ---- the gun and the body, as functions of film time ------------------------------------------------------
    const tremor = t => v(noise1(t * 9, 1), noise1(t * 9.7, 2), noise1(t * 8.3, 3)).multiplyScalar(0.0004);
    /** The gun: TCP on the weld path (in from above the start before the arc, back out after), the tool axis from
     *  the weld with a hand's few degrees of wander. */
    function torchAt(t) {
      const w = weld, s = w.deposit(t), back = w.outDir(0).multiplyScalar(0.06).add(v(0, 0.03, 0));
      let p;
      if (t < w.arcOn) p = w.tcp(w.start).addScaledVector(back, 1 - ease.inOut(span(0.4, w.arcOn - 0.1, t)));
      else if (t <= w.arcOff) p = w.tcp(Math.min(t, w.end));
      else {                                         // done: lift off the joint, then lower the gun by the right hip
        const end = w.tcp(w.end), lift = end.clone().addScaledVector(w.toolAxis(w.length), -0.06).add(v(0, 0.03, 0));
        p = end.lerp(lift, ease.inOut(span(w.arcOff, w.arcOff + 0.5, t))).lerp(REST_TCP, ease.inOut(span(w.arcOff + 0.4, w.arcOff + 2.0, t)));
      }
      p.add(tremor(t));
      const tool = w.toolAxis(s).lerp(REST_TOOL, ease.inOut(span(w.arcOff + 0.4, w.arcOff + 2.0, t))).normalize(), side = tool.clone().cross(UP).normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(side, 2 * DEG * noise1(t * 0.7, 4)).multiply(new THREE.Quaternion().setFromAxisAngle(UP, 1.5 * DEG * noise1(t * 0.55, 5)));
      tool.applyQuaternion(q);
      return { tcp: p, tool, up: UP.clone() };
    }
    const FEET2 = Object.fromEntries(Object.entries(stance(FEET, YAW)).map(([k, f]) => [k, { ...f, p: f.p.setY(FLOOR) }]));
    /** The body: feet planted, bent at the waist over the joint, hips and shoulders turning after the arc, eyes on
     *  the arc, the right hand on the gun's grip (the left one rests). */
    function bodyAt(t, torch) {
      const w = weld, arc = w.arcPoint(clamp(t, w.start, w.end)), back = ease.inOut(span(w.arcOff + 0.4, w.arcOff + 2.0, t));
      const pos = FEET.clone().add(v(0, 0, 0.45 * arc.z * (1 - back)));
      const to = lerp(Math.atan2(arc.x - pos.x, arc.z - pos.z), YAW, back), hip = YAW + 0.5 * (to - YAW);
      const x = torch.up.clone().cross(torch.tool).normalize();
      const rot = new THREE.Matrix4().makeBasis(x, torch.tool.clone().cross(x), torch.tool);
      const toW = d => d.clone().applyMatrix4(rot);
      return {
        pos, yaw: hip, feet: FEET2, twist: 0.8 * (to - hip),
        lean: lerp(0.58, 0.12, back) + 0.03 * noise1(t * 0.3, 7), look: arc.clone().lerp(REST_HAND, back * 0.5),
        hands: { R: { knuckle: torch.tcp.clone().add(toW(GRIP_KNUCKLE)), dir: toW(HAND_DIR), palm: toW(PALM), w: 1, grip: { curl: 1.0, thumb: 0.7 } }, L: null },
      };
    }

    return {
      scene,
      collide: spec.collide,
      obstacles: spec.obstacles,
      welds: [weld],
      home: { q: [0, 0, 0, 0, 0, 0] },              // (no robot)
      steps: [{ hold: ARC0, mark: 'intro' }, { weld: 'human' }, { hold: OUT - ARC0 - (weld.preDwell + WELD + weld.crater), mark: 'outro' }],

      async setup(ctx) {
        const { st } = ctx;
        const WD = await loadWelder();
        WD.props.matrixAutoUpdate = false;           // the welding machine, gas cylinder and cables, behind the person's right
        WD.props.matrix.makeTranslation(FEET.x - 0.25, FLOOR, FEET.z + 0.35).multiply(new THREE.Matrix4().makeRotationY(-YAW));
        st.scene.add(WD.props);
        const gun = WD.makeTorch();
        st.scene.add(gun.group);
        const person = await loadWorker(undefined, { egoCam: true });
        st.scene.add(person.root);
        // The head camera's view: the camera model looks along its +z; the rig camera along -z, tipped down at the hands,
        // 7 cm out in front of the model (its node is scaled 0.75: 0.093 local) so neither it nor the hat's brim is in shot.
        const head = new THREE.Object3D();
        head.position.set(0, 0.013, 0.093);
        head.quaternion.setFromAxisAngle(v(1, 0, 0), HEAD_TILT).multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI));
        person.root.getObjectByName('egoCam').add(head);
        tripod.userData.aim(v(WX, 0.05, 0));
        ctx.cameras.head = rigCamera(head, { fov: 72, label: 'HEAD CAM' });
        ctx.cameras.rear = rigCamera(tripod.getObjectByName('view'), { fov: 40, label: 'REAR-RIGHT CAM' });
        Object.assign(ctx, { gun, person });
      },
      update(t, ctx) {
        const tp = torchAt(t);
        ctx.gun.setPose(tp.tcp, tp.tool, tp.up);
        ctx.person.setPose(bodyAt(t, tp));
        for (const c of Object.values(ctx.cameras)) c.sync();
      },

      shots(plan) {
        const w = plan.welds[0], M = plan.marks;
        const arcZ = t => w.arcPoint(Math.min(Math.max(t, w.start), w.end)).z;
        return [
          [0, (t, u) => ({ // three-quarter front: the person bent over the table
            pos: v(lerp(0.85, 0.7, ease.out(u)), lerp(0.6, 0.5, u), lerp(1.35, 1.15, ease.out(u))), look: v(-0.45, 0.2, -0.05), fov: 34 })],
          [w.arcOn - 0.3, t => ({ // low along the seam, ahead of the arc: the gun coming toward the camera
            pos: v(WX - 0.12, 0.07, arcZ(t) - 0.26), look: v(WX, 0.03, arcZ(t)), fov: 30 })],
          [w.start + 7, (t, u) => ({ // wide from the side: the whole body, the sparks
            pos: v(lerp(-0.1, 0.0, u), 0.55, lerp(1.9, 1.75, u)), look: v(-0.45, 0.15, 0), fov: 36 })],
          [w.start + 13, t => ({ // top-down along the stiffener: the weave swinging toe to toe, the pool
            pos: v(WX - 0.017, 0.28, arcZ(t) - 0.05), look: v(WX - 0.003, 0.026, arcZ(t) + 0.004), fov: 20, filter: 1 })],
          [w.arcOff + 0.3, (t, u) => ({ // the finished bead, cooling
            pos: v(WX - 0.12, 0.08, lerp(0.22, -0.1, ease.inOut(u))), look: v(WX + 0.005, 0.022, lerp(0.12, -0.2, ease.inOut(u))), fov: 26 })],
          [M.outro[0] + 2.5, (t, u) => ({ // pull back
            pos: v(lerp(0.9, 1.3, ease.out(u)), lerp(0.7, 0.95, ease.out(u)), lerp(1.3, 1.7, ease.out(u))), look: v(-0.5, 0.2, 0), fov: 34 })],
        ];
      },

      cards(plan) {
        const w = plan.welds[0];
        return [
          { cls: 'title', from: 0.4, to: w.arcOn - 0.4, inn: 0.8, out: 0.6, dy: 24, html: `
            <div class="kicker">EXAMPLE · HUMAN</div>
            <h1>T이음 <span>2F</span></h1>
            <div class="sub">수평 필릿 · Gap ${gap} · 사람 위빙 용접</div>` },
          { cls: 'endcard', from: plan.duration - 3, to: plan.duration + 1, inn: 0.9, out: 0.1, dy: 20, html: `
            <div class="kicker">HEAD CAM · REAR-RIGHT CAM · TORCH IMU</div>
            <h2>사람 용접, 같은 시편.</h2>
            <div class="sub" style="max-width: 820px; font-size: 18px">Worker 3D model: "Worker apl" by max_f5_studio, CC BY 4.0 · Welding gear: "009_Male_Worker_Welder_06" by grewe.juergen, CC BY 4.0</div>` },
        ];
      },
    };
  },
};
