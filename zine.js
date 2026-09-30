/* ZINE LAYER — torn photocopies, tape, stamps, handwriting, pen marks, xerox dust.
   Everything here is procedural and seeded, so a sheet tears the same way every visit. */

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SVGNS = 'http://www.w3.org/2000/svg';

/* ---------- pen strokes ---------- */
// smooth path through jittered points: looks drawn, not plotted
export function penPath(points, r, amp = 1.2) {
  const p = points.map(([x, y], i) => (i === 0 || i === points.length - 1 ? [x, y] : [x + (r() - 0.5) * 2 * amp, y + (r() - 0.5) * 2 * amp]));
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
    d += ` Q${p[i][0].toFixed(1)} ${p[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const l = p[p.length - 1];
  return d + ` L${l[0].toFixed(1)} ${l[1].toFixed(1)}`;
}
export function subdivide(pts, n) {
  const out = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
    for (let i = 0; i < n; i++) out.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
// loose ellipse that overshoots its start, like a quick circle around a word
function scribbleEllipse(w, h, r) {
  const cx = w / 2 + (r() - 0.5) * 4, cy = h / 2 + (r() - 0.5) * 3;
  const rx = w / 2 + 8 + r() * 6, ry = h / 2 + 5 + r() * 4;
  const a0 = -2.4 + r() * 0.6, turns = 1.12 + r() * 0.12, n = 34;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i / n) * Math.PI * 2 * turns;
    const wob = 1 + Math.sin(i * 0.7 + r() * 2) * 0.04;
    pts.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob * (1 + i / n * 0.08)]);
  }
  return penPath(pts, r, 1.4);
}
function scribbleUnder(w, h, r) {
  const y = h + 3;
  const a = penPath(subdivide([[-4, y + r() * 2], [w + 6, y - 1 + r() * 3]], 6), r, 1.1);
  const b = penPath(subdivide([[4, y + 5 + r() * 2], [w - 4 + r() * 10, y + 4 + r() * 2]], 6), r, 1.3);
  return `${a} ${b}`;
}
function scribbleBox(w, h, r) {
  const j = () => (r() - 0.5) * 6;
  return penPath(subdivide([[-6 + j(), -4 + j()], [w + 6 + j(), -5 + j()], [w + 5 + j(), h + 4 + j()], [-5 + j(), h + 5 + j()], [-7 + j(), -8 + j()]], 4), r, 1.2);
}
export function arrowPath(x0, y0, x1, y1, r, bend = 0.25) {
  const mx = (x0 + x1) / 2 + (y1 - y0) * bend, my = (y0 + y1) / 2 - (x1 - x0) * bend;
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push([(1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * my + t * t * y1]);
  }
  const ang = Math.atan2(y1 - pts[8][1], x1 - pts[8][0]);
  const hl = 10 + r() * 4;
  const h1 = [x1 - Math.cos(ang - 0.45) * hl, y1 - Math.sin(ang - 0.45) * hl];
  const h2 = [x1 - Math.cos(ang + 0.5) * hl, y1 - Math.sin(ang + 0.5) * hl];
  return `${penPath(pts, r, 1.3)} M${h1[0].toFixed(1)} ${h1[1].toFixed(1)} L${x1} ${y1} L${h2[0].toFixed(1)} ${h2[1].toFixed(1)}`;
}

function svgEl(w, h, cls) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('width', w); s.setAttribute('height', h);
  s.setAttribute('viewBox', `0 0 ${w} ${h}`);
  s.setAttribute('aria-hidden', 'true');
  return s;
}
function addStroke(svg, d, delay = 0) {
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('d', d);
  svg.appendChild(p);
  requestAnimationFrame(() => {
    const len = Math.ceil(p.getTotalLength ? p.getTotalLength() : 400) + 4;
    p.style.setProperty('--len', len);
    p.style.setProperty('--delay', `${delay}s`);
  });
  return p;
}

/* ---------- torn paper ---------- */
export function tornPolygon(w, h, r) {
  const pts = [];
  const edge = (x0, y0, x1, y1, nx, ny, amp, bite) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    let t = 0;
    const biteAt = r(), biteW = 0.04 + r() * 0.05;
    while (t < 1) {
      let a = r() * amp;
      if (bite && Math.abs(t - biteAt) < biteW) a += bite * (1 - Math.abs(t - biteAt) / biteW) * (0.7 + r() * 0.3);
      pts.push([x0 + (x1 - x0) * t + nx * a, y0 + (y1 - y0) * t + ny * a]);
      t += (5 + r() * 11) / len;
    }
  };
  edge(0, 0, w, 0, 0, 1, 5, r() < 0.6 ? 12 : 0);
  edge(w, 0, w, h, -1, 0, 3, 0);
  edge(w, h, 0, h, 0, -1, 6, r() < 0.7 ? 16 : 0);
  edge(0, h, 0, 0, 1, 0, 3, r() < 0.3 ? 10 : 0);
  return `polygon(${pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(',')})`;
}

function tape(r, where) {
  const t = document.createElement('i');
  t.className = 'tape';
  const w = 80 + r() * 50;
  t.style.width = `${w}px`;
  const rot = where === 'l' ? -38 + r() * 14 : where === 'r' ? 32 + r() * 14 : -4 + r() * 8;
  t.style.transform = `rotate(${rot}deg)`;
  if (where === 'l') { t.style.left = `${-20 - r() * 10}px`; t.style.top = `${-6 + r() * 6}px`; }
  else if (where === 'r') { t.style.right = `${-22 - r() * 10}px`; t.style.top = `${-4 + r() * 6}px`; }
  else { t.style.left = `${30 + r() * 40}%`; t.style.top = `${-14 - r() * 4}px`; }
  // ragged torn ends
  const zig = (side) => Array.from({ length: 6 }, (_, i) => `${side ? 100 - r() * 5 : r() * 5}% ${(i / 5) * 100}%`);
  t.style.clipPath = `polygon(${zig(0).join(',')}, ${zig(1).reverse().join(',')})`;
  return t;
}

function stamp(text, r) {
  const s = document.createElement('span');
  s.className = 'stamp';
  s.textContent = text;
  s.style.setProperty('--rot', `${-12 + r() * 20}deg`);
  s.style.right = `${14 + r() * 40}px`;
  s.style.bottom = `${14 + r() * 26}px`;
  return s;
}

function note(text, r, side) {
  const n = document.createElement('div');
  n.className = `note ${side}`;
  n.setAttribute('aria-hidden', 'true');
  n.style.setProperty('--rot', `${-9 + r() * 14}deg`);
  n.style.top = `${10 + r() * 45}%`;
  const t = document.createElement('span');
  t.textContent = text;
  n.appendChild(t);
  const svg = svgEl(90, 60, 'zmark arrow');
  addStroke(svg, side === 'l' ? arrowPath(8, 14 + r() * 10, 84, 30 + r() * 20, r, 0.3) : arrowPath(82, 14 + r() * 10, 6, 30 + r() * 20, r, -0.3), 0.5);
  n.appendChild(svg);
  return n;
}

/* mark a word inside a paper sheet: circle, double underline or box, drawn when the sheet arrives */
export function markWord(el, kind, r, delay = 0.8) {
  const host = el.offsetParent;
  if (!host) return;
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!w || !h) return;
  const pad = 16;
  const svg = svgEl(w + pad * 2, h + pad * 2, 'zmark word');
  svg.style.left = `${el.offsetLeft - pad}px`;
  svg.style.top = `${el.offsetTop - pad}px`;
  const g = document.createElementNS(SVGNS, 'g');
  g.setAttribute('transform', `translate(${pad} ${pad})`);
  svg.appendChild(g);
  const d = kind === 'circle' ? scribbleEllipse(w, h, r) : kind === 'box' ? scribbleBox(w, h, r) : scribbleUnder(w, h, r);
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('d', d);
  g.appendChild(p);
  host.appendChild(svg);
  const len = Math.ceil(p.getTotalLength()) + 4;
  p.style.setProperty('--len', len);
  p.style.setProperty('--delay', `${delay}s`);
}

/* ---------- xerox dust overlay ---------- */
export function xeroxDust() {
  const S = 900;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const r = rng(1981);
  for (let i = 0; i < 2600; i++) {
    const a = 0.15 + r() * 0.6, s = r() < 0.9 ? 1 : 1 + r() * 2.5;
    x.fillStyle = `rgba(255,255,255,${a})`;
    x.fillRect(r() * S, r() * S, s, s * (0.6 + r()));
  }
  x.lineCap = 'round';
  for (let i = 0; i < 40; i++) { // hairs and fibres
    x.strokeStyle = `rgba(255,255,255,${0.2 + r() * 0.4})`;
    x.lineWidth = 0.6 + r() * 0.8;
    x.beginPath();
    let px = r() * S, py = r() * S, ang = r() * 6.28;
    x.moveTo(px, py);
    const n = 6 + r() * 10;
    for (let k = 0; k < n; k++) { ang += (r() - 0.5) * 0.9; px += Math.cos(ang) * 4; py += Math.sin(ang) * 4; x.lineTo(px, py); }
    x.stroke();
  }
  for (let i = 0; i < 6; i++) { // long scratches
    x.strokeStyle = `rgba(255,255,255,${0.12 + r() * 0.2})`;
    x.lineWidth = 0.5;
    x.beginPath();
    const px = r() * S;
    x.moveTo(px, 0);
    x.bezierCurveTo(px + (r() - 0.5) * 40, S / 3, px + (r() - 0.5) * 40, (2 * S) / 3, px + (r() - 0.5) * 30, S);
    x.stroke();
  }
  const el = document.createElement('div');
  el.className = 'xerox';
  el.setAttribute('aria-hidden', 'true');
  el.style.backgroundImage = `url(${c.toDataURL()})`;
  document.body.appendChild(el);
  return el;
}

/* ---------- assemble the zine ---------- */
const NOTES = {
  1: 'их всего сотни\nна 1 мкл крови!',
  2: 'всего ~14 шипов.\nмало — и это хитро',
  3: 'ключ → замок',
  4: 'Δ32 = щит\n(~1% людей)',
  5: 'точка\nневозврата',
  6: 'ошибается\nпостоянно!',
  7: 'навсегда\nв ДНК',
  8: 'каждая 3-я\nкопия — мутант',
  9: '3 лекарства > 1',
};
const STAMPS = { 2: 'образец № 0412', 5: 'необратимо', 7: 'пока неизлечимо', 9: 'одобрено' };
const APPX_STAMPS = { C: 'проверено', D: 'важно', E: 'анонимно', J: 'архив' };

export function buildZine({ chapters, appendices, isMobile }) {
  const papers = [], marks = [];
  chapters.forEach((ch, i) => {
    const card = ch.querySelector('.card');
    if (!card) return;
    const r = rng(1000 + i * 17);
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.style.setProperty('--rot', `${(r() - 0.5) * 3.2}deg`);
    sheet.style.setProperty('--dx', `${(r() - 0.5) * 40}px`);
    card.parentNode.insertBefore(sheet, card);
    sheet.appendChild(card);
    card.classList.add('paper');
    card.style.setProperty('--bx', `${Math.floor(r() * 900)}px`);
    card.style.setProperty('--by', `${Math.floor(r() * 900)}px`);
    sheet.appendChild(tape(r, r() < 0.5 ? 'l' : 'm'));
    if (r() < 0.6) sheet.appendChild(tape(r, 'r'));
    if (STAMPS[i]) card.appendChild(stamp(STAMPS[i], r));
    if (NOTES[i] && !isMobile) sheet.appendChild(note(NOTES[i], r, ch.classList.contains('right') ? 'l' : 'r'));
    papers.push({ el: card, r: rng(5000 + i) });
    // pen marks on the copy
    const words = [...card.querySelectorAll('p b')].filter((b) => b.textContent.length < 22);
    if (words[0]) marks.push(() => markWord(words[0], ['circle', 'under', 'box'][i % 3], rng(77 + i), 1.0));
  });
  appendices.forEach((sec, i) => {
    const r = rng(3000 + i * 31);
    const paper = document.createElement('div');
    paper.className = 'paper';
    while (sec.firstChild) paper.appendChild(sec.firstChild);
    sec.appendChild(paper);
    sec.classList.add('sheet');
    sec.style.setProperty('--rot', `${(r() - 0.5) * 1.4}deg`);
    paper.style.setProperty('--bx', `${Math.floor(r() * 900)}px`);
    paper.style.setProperty('--by', `${Math.floor(r() * 900)}px`);
    sec.appendChild(tape(r, 'l'));
    sec.appendChild(tape(r, r() < 0.5 ? 'r' : 'm'));
    const key = sec.dataset.roman;
    if (APPX_STAMPS[key]) paper.appendChild(stamp(APPX_STAMPS[key], r));
    papers.push({ el: paper, r: rng(7000 + i) });
    const words = [...paper.querySelectorAll('p b')].filter((b) => b.textContent.length < 22);
    if (words[0]) marks.push(() => markWord(words[0], ['under', 'circle'][i % 2], rng(99 + i), 0.9));
  });
  // tear every sheet to its own size, and re-tear when it reflows
  const tear = ({ el, r }) => {
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    const seed = Math.floor(r() * 1e9);
    el.style.clipPath = tornPolygon(w, h, rng(seed));
  };
  const ro = new ResizeObserver((es) => es.forEach((e) => { const p = papers.find((q) => q.el === e.target); if (p) { p.r = rng(p.el.offsetWidth * 13 + 7); tear(p); } }));
  papers.forEach((p) => { tear(p); ro.observe(p.el); });
  // pen marks need final text metrics
  const drawMarks = () => { document.querySelectorAll('.zmark.word').forEach((m) => m.remove()); marks.forEach((f) => f()); };
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => requestAnimationFrame(drawMarks));
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(drawMarks, 300); });
}

/* handwritten scrawl with a drawn underline — used in the hero, archive intro and finale */
export function scrawl(el, seed) {
  const r = rng(seed);
  el.style.setProperty('--rot', `${-5 + r() * 4}deg`);
  requestAnimationFrame(() => {
    const w = el.offsetWidth, h = el.offsetHeight;
    const svg = svgEl(w + 20, 24, 'zmark under-scrawl');
    svg.style.left = '-6px'; svg.style.top = `${h - 6}px`;
    addStroke(svg, penPath(subdivide([[4, 8 + r() * 4], [w * 0.55, 12 + r() * 4], [w + 8, 6 + r() * 5]], 5), r, 1.6), 1.2);
    el.appendChild(svg);
  });
}
