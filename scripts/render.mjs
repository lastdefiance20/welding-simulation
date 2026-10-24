// Render a film to MP4: headless Chrome seeks every frame, screenshots the stage, ffmpeg encodes.
//   node scripts/render.mjs [--project ur5e-t2f] [--query gap=3] [--from 0] [--to <end>] [--fps 30] [--out x.mp4] [--draft]
// --draft encodes 1280x720 quickly. Sound: a procedural mix from the film's cues (scripts/sound.mjs: arc crackle,
// servo hum), plus narration lines (P.voice: [{ t, src }], scripts/narrate.mjs) and a music track (P.bgm: { src, gain,
// fx, focus, fadeOut }, scripts/music.mjs) if the project gives them.
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { openFilm, arg } from './page.mjs';
import { synthSound } from './sound.mjs';

const draft = process.argv.includes('--draft');
const fps = +arg('fps', 30);
fs.mkdirSync('out', { recursive: true });
const { page, film, tag, close } = await openFilm();
const from = +arg('from', 0), to = +arg('to', film.duration);
// A part (--from / --to) gets its range in the name, so it never overwrites the whole film.
const range = arg('from') || arg('to') ? `-t${from}-${to}` : '';
const out = arg('out', `out/${tag}${range}${draft ? '-draft' : ''}.mp4`);
const frames = Math.round((to - from) * fps);

const wav = out.replace(/\.mp4$/, '.wav');
fs.writeFileSync(wav, synthSound(film.cues, from, to));
// Narration (film.cues.voice: [{ t, src }]): each line delayed to its cue and mixed over the effects, which duck
// under the voice. The voice track is padded to the film's length (the ducker ends with its sidechain otherwise,
// and -shortest would cut the picture there).
const voice = (film.cues.voice || []).filter(v => v.t + 0.1 >= from && v.t < to);
let audioArgs = ['-i', wav];
if (voice.length) {
  const mixed = out.replace(/\.mp4$/, '.mix.wav');
  const ins = voice.flatMap(v => ['-i', v.src]);
  const parts = voice.map((v, i) => `[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round((v.t - from) * 1000)}:all=1[v${i}]`);
  const fc = [...parts, `${voice.map((_, i) => `[v${i}]`).join('')}amix=inputs=${voice.length}:normalize=0,apad,asplit=2[vo][vk]`,
    `[0:a]volume=0.8[fx]`, `[fx][vk]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350[duck]`,
    `[duck][vo]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[a]`].join(';');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', wav, ...ins, '-filter_complex', fc, '-map', '[a]', '-t', String(to - from), mixed]);
  audioArgs = ['-i', mixed];
  process.on('exit', () => fs.rmSync(mixed, { force: true }));
}

// Background music (film.cues.bgm: { src, gain, fx, focus, fadeOut }): the track from the film's start at `gain`, the
// effects turned down to `fx` under it, faded out over the last `fadeOut` s when the render reaches the film's end. In each focus span [a, b] (film seconds) the music dips to a third and the effects
// come back up to full, with 0.5 s ramps.
const bgm = film.cues.bgm;
if (bgm) {
  const withMusic = out.replace(/\.mp4$/, '.bgm.wav');
  const ramp = ([a, b]) => `max(0,min(1,min((t+${from}-${a})/0.5,(${b}-t-${from})/0.5)))`;
  const f = (bgm.focus || []).map(ramp).reduce((x, y) => `max(${x},${y})`, '0');
  const g = bgm.gain ?? 0.35, fx = bgm.fx ?? 1;
  const fc = [`[1:a]aresample=48000,aformat=channel_layouts=stereo,atrim=start=${from},asetpts=PTS-STARTPTS,volume='${g}*(1-0.67*${f})':eval=frame${bgm.fadeOut && to >= film.duration ? `,afade=t=out:st=${(to - from - bgm.fadeOut).toFixed(3)}:d=${bgm.fadeOut}` : ''},apad[m]`,
    `[0:a]volume='${fx}+${(1.2 - fx).toFixed(3)}*${f}':eval=frame[fx]`,
    `[fx][m]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[a]`].join(';');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...audioArgs, '-i', bgm.src, '-filter_complex', fc, '-map', '[a]', '-t', String(to - from), withMusic]);
  audioArgs = ['-i', withMusic];
  process.on('exit', () => fs.rmSync(withMusic, { force: true }));
}

const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', ...audioArgs,
  ...(draft ? ['-vf', 'scale=1280:720'] : []),
  '-c:v', 'libx264', '-preset', draft ? 'veryfast' : 'slow', '-crf', draft ? '23' : '17', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });

const t0 = Date.now();
for (let f = 0; f < frames; f++) {
  await page.evaluate(t => window.__film.seek(t), from + f / fps);
  const buf = await page.screenshot({ type: 'jpeg', quality: draft ? 85 : 95 });
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  if (f % 30 === 0) process.stdout.write(`\r${f}/${frames}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
fs.unlinkSync(wav);
console.log(`\n${out}  (${frames} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
await close();
