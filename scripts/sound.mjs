// Procedural sound for a film, deterministic: MAG arc crackle (filtered noise with short-circuit pops) while an
// arc burns, a soft servo hum while the arm moves, a click at each arc strike. cues = { arcs: [{ on, off }],
// moves: [{ from, to, gain }] } from the compiled program. Returns a 48 kHz 16-bit stereo WAV.
const RATE = 48000;

function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; return s / 4294967296; }; }

export function synthSound(cues, from, to) {
  const n = Math.round((to - from) * RATE), L = new Float32Array(n), R = new Float32Array(n);
  const rand = rng(7);
  let lp1 = 0, lp2 = 0, hp = 0, prev = 0, pop = 0, popDecay = 0, hum = 0;
  const env = (t, a, b, fi, fo) => Math.max(0, Math.min(1, (t - a) / fi, (b - t) / fo));
  for (let i = 0; i < n; i++) {
    const t = from + i / RATE;
    // Arc: band-limited noise around 2-6 kHz, amplitude-modulated by fast random crackle and pops.
    const w = rand() * 2 - 1;
    lp1 += 0.45 * (w - lp1); lp2 += 0.45 * (lp1 - lp2);
    hp = 0.97 * (hp + lp2 - prev); prev = lp2;
    if (rand() < 0.0009) { pop = 0.6 + rand() * 0.8; popDecay = 0.995 - rand() * 0.01; }
    pop *= popDecay;
    const crackle = 0.35 + 0.65 * Math.abs(Math.sin(t * 2 * Math.PI * 100)) * (0.5 + 0.5 * rand());
    let arc = 0, ds = -1;
    for (const a of cues.arcs) { arc = Math.max(arc, env(t, a.on, a.off, 0.01, 0.08)); if (t >= a.on && t < a.on + 0.05) ds = t - a.on; }
    let s = arc * (hp * 0.55 * crackle + (rand() * 2 - 1) * pop * 0.35);
    // Strike: a sharp click.
    if (ds >= 0) s += Math.exp(-ds * 120) * (rand() * 2 - 1) * 0.8;
    // Servo hum while moving: two detuned tones swelling with the moves.
    let mv = 0;
    for (const m of cues.moves) mv = Math.max(mv, env(t, m.from, m.to, 0.3, 0.4) * m.gain);
    hum = 0.06 * mv * (Math.sin(2 * Math.PI * 180 * t) * 0.6 + Math.sin(2 * Math.PI * 362 * t) * 0.3 + Math.sin(2 * Math.PI * 1210 * t) * 0.08);
    // A low room tone so it never drops to dead silence.
    const room = (rand() * 2 - 1) * 0.004;
    L[i] = s * 0.9 + hum + room; R[i] = s * 0.9 + hum * 0.9 + room;
  }
  return wav(L, R);
}

function wav(L, R) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
  }
  return buf;
}
