// Weave patterns: offset in [-1, 1] across the joint as a function of time since the weld started.
import { clamp } from '../kit.js';

/** Triangle wave with a dwell at each toe (dwell = share of each half cycle spent paused), softened. */
export function triangleDwell(time, { hz, dwell }) {
  const ph = time * hz, f = ph - Math.floor(ph);
  const tri = 1 - 4 * Math.abs(f - 0.5);   // starts at -1 (toe on plate A)
  const k = clamp(tri / (1 - dwell), -1, 1);
  return Math.sin(k * Math.PI / 2);
}

export const WEAVES = { triangleDwell };
/** Add a weave pattern (a project's own, e.g. a recorded human weave) under a name welds can use. */
export const registerWeave = (name, fn) => { WEAVES[name] = fn; };
