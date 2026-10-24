// Picture-in-picture views of the rig cameras (ctx.cameras), drawn into the film's canvas after the main render,
// stacked up from the bottom-right corner, each with its name. The views skip the bloom pass (the arc reads plainer).
import * as THREE from 'three';
import { W, H } from './stage.js';

const _s = new THREE.Vector3();   // (a node's scale is not the camera's)
const IW = 448, IH = 252, PAD = 28, GAP = 14;

export function drawInsets(st, cameras, overlayRoot) {
  const list = Object.entries(cameras);
  let labels = overlayRoot.querySelector('.insets');
  if (!labels) {
    labels = document.createElement('div');
    labels.className = 'insets';
    overlayRoot.appendChild(labels);
  }
  if (labels.dataset.n !== String(list.length)) {
    labels.dataset.n = String(list.length);
    labels.innerHTML = list.map(([name, c], i) => `<div class="inset" style="right:${PAD}px;bottom:${PAD + i * (IH + GAP)}px;width:${IW}px;height:${IH}px"><span>${c.label || name}</span></div>`).join('');
  }
  if (!list.length) return;
  const r = st.renderer;
  r.setScissorTest(true);
  list.forEach(([, { cam }], i) => {
    const x = W - PAD - IW, y = PAD + i * (IH + GAP);         // from the bottom (GL)
    cam.aspect = IW / IH; cam.updateProjectionMatrix();
    r.setScissor(x, y, IW, IH); r.setViewport(x, y, IW, IH);
    r.render(st.scene, cam);
  });
  r.setScissorTest(false); r.setViewport(0, 0, W, H);
}

/** A rig camera (a THREE.PerspectiveCamera) placed at a model's "view" node each frame: call sync() in update()
 *  (it refreshes the node's ancestors first, since the robot or the person moved since the last render). */
export function rigCamera(viewNode, { fov = 60, label } = {}) {
  const cam = new THREE.PerspectiveCamera(fov, 16 / 9, 0.01, 30);
  return {
    cam, label,
    sync() { viewNode.updateWorldMatrix(true, false); viewNode.matrixWorld.decompose(cam.position, cam.quaternion, _s); cam.updateMatrixWorld(); },
  };
}
