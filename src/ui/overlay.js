// On-screen type: the project's cards (title, spec, end card...) plus the weld HUD (progress, live joint angles)
// and the ARC indicator. Cards: { cls, from, to, inn?, out?, dy?, html } in film seconds; the classes are styled in
// src/ui/style.css (title, spec, endcard) or the project's own style.css.
import { span, clamp } from '../kit.js';

export function buildOverlay(root, { cards = [], hud, plan }) {
  root.innerHTML = cards.map((c, i) => `<div class="ov ${c.cls}" data-card="${i}">${c.html}</div>`).join('') + `
    <div class="ov arc"><i></i>ARC</div>
    <div class="ov hud">
      <div class="lbl">용접 진행<span class="seam"></span></div>
      <div class="mm"><b class="num">0</b><span class="of"></span></div>
      <div class="bar"><i></i></div>
      <div class="joints">${[1, 2, 3, 4, 5, 6].map(i => `<div class="j"><span>J${i}</span><div class="track"><i></i></div><em>0.0°</em></div>`).join('')}</div>
    </div>`;
  const $ = s => root.querySelector(s);
  const cardEls = cards.map((c, i) => [c, root.querySelector(`[data-card="${i}"]`)]);
  const el = { arc: $('.arc'), hud: $('.hud'), seam: $('.hud .seam'), of: $('.hud .of'), num: $('.hud .num'),
    bar: $('.hud .bar i'), joints: [...root.querySelectorAll('.hud .j')] };
  const fade = (a, b, t, inn = 0.5, out = 0.5) => Math.min(span(a, a + inn, t), 1 - span(b - out, b, t));
  const show = (node, o, dy = 0) => { node.style.opacity = o.toFixed(3); node.style.transform = `translateY(${(dy * (1 - o)).toFixed(1)}px)`; node.style.visibility = o > 0.001 ? 'visible' : 'hidden'; };

  return {
    update(t, q, arcI) {
      for (const [c, node] of cardEls) show(node, fade(c.from, c.to, t, c.inn ?? 0.5, c.out ?? 0.5), c.dy ?? 18);
      show(el.hud, hud ? fade(hud.from, hud.to, t, 0.5, 0.6) : 0, 18);
      el.arc.style.visibility = arcI > 0 ? 'visible' : 'hidden';
      el.arc.style.opacity = arcI > 0 ? '1' : '0';
      const w = plan.weldAt(t), mm = w.deposit(t) * 1000, L = w.length * 1000;
      el.seam.textContent = w.label ? ` · ${w.label}` : '';
      el.of.textContent = ` / ${L.toFixed(0)} mm`;
      el.num.textContent = mm.toFixed(0);
      el.bar.style.transform = `scaleX(${(mm / L).toFixed(4)})`;
      el.joints.forEach((j, i) => {
        const d = q[i] * 180 / Math.PI;
        j.querySelector('em').textContent = `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}°`;
        j.querySelector('i').style.left = `${(clamp(d / 360 + 0.5) * 100).toFixed(2)}%`;
      });
    },
  };
}
