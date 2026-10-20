// Building blocks for the documentation: numbering, headings, figures, tables, charts, placeholders.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------------------
// Document model with automatic numbering + index of headings/figures/tables
// ---------------------------------------------------------------------------
export class Doc {
  constructor(root) {
    this.root = root;
    this.parts = [];
    this.toc = []; // {id, level, label}
    this.figures = [];
    this.tables = [];
    this.ch = 0;
    this.h2n = 0;
    this.h3n = 0;
    this.figN = 0;
    this.tabN = 0;
    this.ids = 0;
    this.appendix = false;
    this.diagrams = {}; // key -> mermaid code, rendered to PNG by build.mjs
  }
  id(prefix) {
    return `${prefix}${++this.ids}`;
  }
  mk(id) {
    return `<span class="mk">@@${id}@@</span>`;
  }
  raw(html) {
    this.parts.push(html);
  }
  // Front-matter section (roman numbered pages), each on a new page
  front(title, html, { toc = true } = {}) {
    const id = this.id('f');
    if (toc) this.toc.push({ id, level: 1, label: title });
    this.parts.push(`<section class="front newpage"><h1 id="${id}" class="front-title">${this.mk(id)}${esc(title)}</h1>${html}</section>`);
  }
  chapter(word, title) {
    this.ch++;
    this.h2n = 0;
    this.figN = 0;
    this.tabN = 0;
    const id = this.id('c');
    this.toc.push({ id, level: 1, label: `${this.ch}. ${title.toUpperCase()}`, chapter: this.ch });
    this.parts.push(`<div class="newpage chapter-start" data-chapter="${this.ch}"><p class="chapter-label">CHAPTER ${word}</p><h1 id="${id}">${this.mk(id)}${this.ch}. ${esc(title.toUpperCase())}</h1></div>`);
  }
  unnumbered(title, { level = 1 } = {}) {
    const id = this.id('u');
    this.toc.push({ id, level, label: title });
    const tag = level === 1 ? 'h1' : 'h2';
    this.parts.push(`<${tag} id="${id}" class="${level === 1 ? 'newpage unnumbered' : ''}">${this.mk(id)}${esc(title)}</${tag}>`);
  }
  h2(title) {
    this.h2n++;
    this.h3n = 0;
    const id = this.id('s');
    const num = `${this.ch}.${this.h2n}`;
    this.toc.push({ id, level: 2, label: `${num} ${title}` });
    this.parts.push(`<h2 id="${id}">${this.mk(id)}${num} ${esc(title)}</h2>`);
  }
  h3(title) {
    this.h3n++;
    const id = this.id('s');
    const num = `${this.ch}.${this.h2n}.${this.h3n}`;
    this.toc.push({ id, level: 3, label: `${num} ${title}` });
    this.parts.push(`<h3 id="${id}">${this.mk(id)}${num} ${esc(title)}</h3>`);
  }
  h4(title) {
    this.parts.push(`<h4>${esc(title)}</h4>`);
  }
  p(...paras) {
    for (const t of paras) this.parts.push(`<p>${t}</p>`);
  }
  ul(items, { ordered = false } = {}) {
    const tag = ordered ? 'ol' : 'ul';
    this.parts.push(`<${tag}>${items.map((i) => `<li>${i}</li>`).join('')}</${tag}>`);
  }
  // Figures ------------------------------------------------------------------
  figure(caption, inner, { cls = '' } = {}) {
    this.figN++;
    const id = this.id('fig');
    const label = `Figure ${this.ch}.${this.figN} ${caption}`;
    this.figures.push({ id, label });
    this.parts.push(`<figure class="${cls}">${inner}<figcaption id="${id}">${this.mk(id)}${esc(label)}</figcaption></figure>`);
    return `Figure ${this.ch}.${this.figN}`;
  }
  img(caption, src, { width = '100%', maxHeight = '7.4in' } = {}) {
    return this.figure(caption, `<img src="${src}" style="width:${width};max-height:${maxHeight};object-fit:contain">`);
  }
  mermaid(caption, code, { width = '100%', maxHeight = '7.6in' } = {}) {
    const key = crypto.createHash('sha1').update(code).digest('hex').slice(0, 12);
    this.diagrams[key] = code;
    return this.figure(caption, `<img class="diagram" src="diagrams/${key}.png" style="max-width:${width};max-height:${maxHeight}">`);
  }
  screens(caption, files, { cols = 3 } = {}) {
    const w = cols === 1 ? '2.3in' : '1.62in';
    const cells = files
      .map(([file, label]) => `<div class="shot"><img src="${file}" style="width:${w}"><div class="shot-label">${esc(label)}</div></div>`)
      .join('');
    return this.figure(caption, `<div class="shots">${cells}</div>`);
  }
  /** A slot for an image the author adds later. Shows the image automatically once the file exists. */
  slot(caption, file, instructions, { height = '3.2in' } = {}) {
    const abs = path.join(this.root, 'your-screenshots', file);
    const found = ['.png', '.jpg', '.jpeg'].map((ext) => abs.replace(/\.(png|jpe?g)$/i, ext)).find((f) => fs.existsSync(f));
    if (found) return this.img(caption, `../../your-screenshots/${path.basename(found)}`);
    return this.figure(
      caption,
      `<div class="slot" style="height:${height}"><div class="slot-title">Insert screenshot here</div><div class="slot-body">${esc(instructions)}</div><div class="slot-file">Save the image as <b>docs/your-screenshots/${esc(file)}</b> and run <b>npm run build</b></div></div>`,
    );
  }
  // Tables -------------------------------------------------------------------
  table(caption, cols, rows, { widths, small = false } = {}) {
    this.tabN++;
    const id = this.id('tab');
    const label = `Table ${this.ch}.${this.tabN} ${caption}`;
    this.tables.push({ id, label });
    const colgroup = widths ? `<colgroup>${widths.map((w) => `<col style="width:${w}">`).join('')}</colgroup>` : '';
    this.parts.push(
      `<div class="table-wrap"><table class="${small ? 'small' : ''}">${colgroup}<thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
        .join('')}</tbody></table><div class="table-caption" id="${id}">${this.mk(id)}${esc(label)}</div></div>`,
    );
  }
}

// ---------------------------------------------------------------------------
// Charts (inline SVG — crisp in print)
// ---------------------------------------------------------------------------
// Categorical palette validated with the dataviz validator (light surface).
const PALETTE = ['#2F6BFF', '#0EA5B7', '#7C5CFF', '#F59E0B', '#12A150', '#E11D48'];

export function pieChart(title, data, { size = 230 } = {}) {
  const total = data.reduce((s, [, v]) => s + v, 0);
  const r = size / 2 - 6;
  const cx = size / 2, cy = size / 2;
  let a0 = -Math.PI / 2;
  const slices = data.map(([label, v], i) => {
    const frac = v / total;
    const a1 = a0 + frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    const mid = (a0 + a1) / 2;
    const [lx, ly] = [cx + r * 0.62 * Math.cos(mid), cy + r * 0.62 * Math.sin(mid)];
    const d = frac >= 0.999 ? `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 -${2 * r},0` : `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`;
    a0 = a1;
    const pct = Math.round(frac * 100);
    return { d, color: PALETTE[i % PALETTE.length], lx, ly, pct, label, v };
  });
  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${slices
    .map((s) => `<path d="${s.d}" fill="${s.color}" stroke="#fff" stroke-width="2"/>`)
    .join('')}${slices
    .filter((s) => s.pct >= 7)
    .map((s) => `<text x="${s.lx}" y="${s.ly + 4}" text-anchor="middle" font-family="Arial" font-size="12" font-weight="700" fill="#fff">${s.pct}%</text>`)
    .join('')}</svg>`;
  const legend = slices
    .map((s) => `<div class="lg-row"><span class="lg-sw" style="background:${s.color}"></span><span class="lg-l">${esc(s.label)}</span><span class="lg-v">${s.v} (${s.pct}%)</span></div>`)
    .join('');
  return `<div class="chart"><div class="chart-title">${esc(title)}</div><div class="chart-body">${svg}<div class="legend">${legend}<div class="lg-total">n = ${total}</div></div></div></div>`;
}

export function agileCycle() {
  const phases = ['Requirements', 'Design', 'Development', 'Testing', 'Deployment', 'Review'];
  const cx = 300, cy = 190, R = 140;
  const nodes = phases.map((p, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / phases.length;
    return { p, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), a };
  });
  const arrows = nodes
    .map((n, i) => {
      const m = nodes[(i + 1) % nodes.length];
      const a1 = n.a + 0.33, a2 = m.a - 0.33 + (i === nodes.length - 1 ? 2 * Math.PI : 0);
      const p1 = [cx + R * Math.cos(a1), cy + R * Math.sin(a1)], p2 = [cx + R * Math.cos(a2), cy + R * Math.sin(a2)];
      return `<path d="M${p1[0]},${p1[1]} A${R},${R} 0 0 1 ${p2[0]},${p2[1]}" fill="none" stroke="#1F4E79" stroke-width="3" marker-end="url(#ah)"/>`;
    })
    .join('');
  const boxes = nodes
    .map((n, i) => `<g><rect x="${n.x - 62}" y="${n.y - 22}" width="124" height="44" rx="22" fill="${PALETTE[i % 6]}"/><text x="${n.x}" y="${n.y + 5}" text-anchor="middle" font-family="Arial" font-size="14" font-weight="700" fill="#fff">${n.p}</text></g>`)
    .join('');
  return `<svg width="600" height="385" viewBox="0 0 600 385"><defs><marker id="ah" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#1F4E79"/></marker></defs>${arrows}${boxes}
  <circle cx="${cx}" cy="${cy}" r="62" fill="#EEF3FB" stroke="#1F4E79" stroke-width="2"/><text x="${cx}" y="${cy - 6}" text-anchor="middle" font-family="Arial" font-size="15" font-weight="700" fill="#0B1B34">Iterative</text><text x="${cx}" y="${cy + 14}" text-anchor="middle" font-family="Arial" font-size="15" font-weight="700" fill="#0B1B34">Sprints</text></svg>`;
}

// Low-fidelity wireframe of a phone screen built from block types.
export function wireframe(title, blocks) {
  const B = {
    header: '<div class="wf-row wf-head"><div class="wf-circle"></div><div class="wf-lines"><i style="width:40%"></i><i style="width:65%"></i></div><div class="wf-circle sm"></div></div>',
    hero: '<div class="wf-hero"><i style="width:45%"></i><b></b><i style="width:80%"></i></div>',
    cards: '<div class="wf-grid"><div></div><div></div><div></div><div></div></div>',
    chart: '<div class="wf-chart"><svg viewBox="0 0 100 40" preserveAspectRatio="none"><polyline points="0,34 15,28 30,30 45,20 60,22 75,12 100,6" fill="none" stroke="#777" stroke-width="1.5"/></svg></div>',
    bars: '<div class="wf-chart wf-bars"><span style="height:40%"></span><span style="height:70%"></span><span style="height:30%"></span><span style="height:85%"></span><span style="height:55%"></span><span style="height:65%"></span></div>',
    list: '<div class="wf-list"><div></div><div></div><div></div></div>',
    search: '<div class="wf-input">&#9906; Search</div><div class="wf-chips"><i></i><i></i><i></i><i></i></div>',
    form: '<div class="wf-input"></div><div class="wf-two"><div class="wf-input"></div><div class="wf-input"></div></div><div class="wf-input"></div><div class="wf-chips"><i></i><i></i><i></i></div><div class="wf-input tall"></div>',
    button: '<div class="wf-btn">Button</div>',
    logo: '<div class="wf-logo"></div><i class="wf-center" style="width:55%"></i>',
    login: '<div class="wf-input"></div><div class="wf-input"></div><div class="wf-btn">Sign in</div><i class="wf-center" style="width:50%"></i>',
    sections: '<div class="wf-sec"></div><div class="wf-sec"></div><div class="wf-sec short"></div>',
    tabbar: '<div class="wf-tabbar"><i></i><i></i><i></i><i></i><i></i></div>',
    fab: '<div class="wf-fab">+</div>',
  };
  return `<div class="wf"><div class="wf-phone">${blocks.map((b) => B[b] ?? '').join('')}</div><div class="wf-title">${esc(title)}</div></div>`;
}

export const toRoman = (n) => {
  const map = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
};
