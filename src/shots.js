// Camera shots: a list of [start, (t, u, ctx) -> { pos, look, fov, filter? }], each running until the next one
// starts (hard cuts). u goes 0..1 through the shot. filter (0..1) is a shade-glass look for close arc shots; roll
// (radians) tilts the camera about its view axis; up (a vector) sets the camera's up for shots looking straight down. ctx.shake scales the hand-held breath (default 1).
import { clamp, noise1 } from './kit.js';

export function cameraAt(shots, t, camera, end, ctx) {
  let i = 0;
  while (i + 1 < shots.length && t >= shots[i + 1][0]) i++;
  const a = shots[i][0], b = i + 1 < shots.length ? shots[i + 1][0] : end;
  const s = shots[i][1](t, clamp((t - a) / (b - a)), ctx);
  // A hand-held breath, tiny.
  const sh = 0.0012 * (ctx?.shake ?? 1);
  s.pos.x += sh * noise1(t * 0.7, 81); s.pos.y += sh * noise1(t * 0.6, 82); s.pos.z += sh * noise1(t * 0.5, 83);
  camera.position.copy(s.pos);
  camera.fov = s.fov;
  camera.updateProjectionMatrix();
  if (s.up) camera.up.copy(s.up); else camera.up.set(0, 1, 0);
  camera.lookAt(s.look);
  if (s.roll) camera.rotateZ(s.roll);
  camera.updateMatrixWorld();   // so anything projected through it this frame (labels) uses this frame's view
  return { filter: s.filter || 0, index: i };
}
