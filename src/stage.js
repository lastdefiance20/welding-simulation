// Renderer, post-processing, lights and the workshop set (welding table, floor).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { hash } from './kit.js';

export const W = 1920, H = 1080;

/** opts: set (false: no welding table and floor), background, fog ([near, far] or false). */
export function createStage(canvasParent, { set = true, background = '#07090c', fog = [3.2, 8], far = 30 } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasParent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  if (fog) scene.fog = new THREE.Fog(background, fog[0], fog[1]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  const camera = new THREE.PerspectiveCamera(35, W / H, 0.01, far);

  // Lights: a soft key from above-front, a cool rim from behind, a dim fill. The arc adds its own.
  const hemi = new THREE.HemisphereLight('#c9d6e8', '#1a1612', 0.35);
  const key = new THREE.DirectionalLight('#fff3e6', 2.2);
  key.position.set(-0.6, 2.2, 1.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -0.9, right: 0.9, top: 0.9, bottom: -0.9, near: 0.5, far: 5 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.01;
  const rim = new THREE.SpotLight('#7fb2ff', 18, 6, 0.6, 0.6, 1.5);
  rim.position.set(1.6, 1.4, -1.6);
  rim.target.position.set(0.25, 0.2, 0);
  const fill = new THREE.PointLight('#ffd2a8', 1.2, 4, 2);
  fill.position.set(-1.0, 0.6, -0.8);
  scene.add(hemi, key, rim, rim.target, fill);

  if (set) scene.add(buildSet());

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(1);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.6, 0.55, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  return { renderer, scene, camera, composer, bloom, lights: { hemi, key, rim, fill } };
}

function tableTexture() {
  // Fixture-table top: blued steel with a 50 mm grid of 16 mm holes.
  const S = 1024, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#2e3236'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(${hash(i, 3) > 0.5 ? '255,255,255' : '0,0,0'},${0.015 + hash(i, 4) * 0.03})`;
    const x = hash(i, 1) * S, y = hash(i, 2) * S;
    g.fillRect(x, y, 2 + hash(i, 5) * 60, 1 + hash(i, 6) * 2);
  }
  const step = S / 8;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const x = (i + 0.5) * step, y = (j + 0.5) * step, r = step * 0.16;
    const gr = g.createRadialGradient(x, y, r * 0.6, x, y, r * 1.15);
    gr.addColorStop(0, '#050505'); gr.addColorStop(0.8, '#0b0c0d'); gr.addColorStop(1, 'rgba(70,75,80,0.6)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 1.15, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function buildSet() {
  const set = new THREE.Group();
  set.name = 'set';
  // Table: 1.6 x 1.0 m top, 25 mm thick, robot bolted at the origin, top surface at y = 0.
  const TX0 = -0.4, TX1 = 1.2, TZ = 0.5, TT = 0.025;
  const tex = tableTexture();
  tex.repeat.set((TX1 - TX0) / 0.4, (2 * TZ) / 0.4);
  const topMat = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.7, roughness: 0.5 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(TX1 - TX0, TT, 2 * TZ), topMat);
  top.position.set((TX0 + TX1) / 2, -TT / 2, 0);
  top.receiveShadow = top.castShadow = true;
  set.add(top);
  const frameMat = new THREE.MeshStandardMaterial({ color: '#1b1d20', metalness: 0.6, roughness: 0.55 });
  const apron = new THREE.Mesh(new THREE.BoxGeometry(TX1 - TX0 - 0.04, 0.12, 2 * TZ - 0.04), frameMat);
  apron.position.set((TX0 + TX1) / 2, -TT - 0.06, 0);
  set.add(apron);
  for (const x of [TX0 + 0.06, TX1 - 0.06]) for (const z of [-TZ + 0.06, TZ - 0.06]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.8, 0.07), frameMat);
    leg.position.set(x, -0.42, z);
    set.add(leg);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: '#111315', roughness: 0.9, metalness: 0.1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.82;
  floor.receiveShadow = true;
  set.add(floor);
  return set;
}
