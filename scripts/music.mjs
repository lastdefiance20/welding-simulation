// Background music from a text prompt: Google Lyria 3 Pro over OpenRouter (chat completions, audio output, which
// must stream). The track comes back as base64 MP3 chunks in delta.audio.data. About $0.08 a song.
//   node scripts/music.mjs <prompt.txt> <out.mp3> [--model google/lyria-3-pro-preview]
// The key is OPENROUTER_API_KEY in .env (never printed).
import fs from 'node:fs';
import { arg } from './page.mjs';

const [promptFile, out] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!promptFile || !out) { console.error('usage: node scripts/music.mjs <prompt.txt> <out.mp3>'); process.exit(1); }
const key = fs.readFileSync('.env', 'utf8').match(/OPENROUTER_API_KEY\s*=\s*["']?([^"'\s]+)/)?.[1];
if (!key) { console.error('OPENROUTER_API_KEY missing in .env'); process.exit(1); }
const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: arg('model', 'google/lyria-3-pro-preview'), modalities: ['text', 'audio'], stream: true,
    messages: [{ role: 'user', content: fs.readFileSync(promptFile, 'utf8').trim() }] }),
});
if (!r.ok) { console.error(r.status, await r.text()); process.exit(1); }
const dec = new TextDecoder(), chunks = [];
let buf = '', cost = null;
for await (const part of r.body) {
  buf += dec.decode(part, { stream: true });
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
    let j; try { j = JSON.parse(line.slice(5)); } catch { continue; }
    if (j.error) { console.error(JSON.stringify(j.error)); process.exit(1); }
    const a = j.choices?.[0]?.delta?.audio;
    if (a?.data) chunks.push(Buffer.from(a.data, 'base64'));
    if (j.usage) cost = j.usage.cost;
  }
}
fs.writeFileSync(out, Buffer.concat(chunks));
console.log(`${out}  ${(fs.statSync(out).size / 1e6).toFixed(1)} MB${cost != null ? `, $${cost}` : ''}`);
