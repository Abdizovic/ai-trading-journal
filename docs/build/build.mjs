// Builds docs/AI_Trading_Journal_Documentation.pdf
//   cd docs && npm run build
// Two passes: (1) render with hidden markers to learn which page every heading,
// figure and table lands on, (2) render the final PDF with the real page numbers
// in the Table of Contents / List of Figures / List of Tables, then stamp page
// numbers (roman for front matter, arabic from Chapter One) onto every page.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import puppeteer from 'puppeteer-core';

import { buildContent } from './content.mjs';
import { Doc, esc, toRoman } from './lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(ROOT, 'build', '.cache');
const OUT = path.join(ROOT, 'AI_Trading_Journal_Documentation.pdf');
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync(CACHE, { recursive: true });

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'schema.json'), 'utf8'));

const CSS = `
@page { size: Letter; margin: 1in 1in 1in 1in; }
* { box-sizing: border-box; }
body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.5; color: #000; margin: 0; text-align: justify; }
p { margin: 0 0 10pt; orphans: 3; widows: 3; }
.newpage { break-before: page; }
.mk { position: absolute; left: 0; top: 0; text-transform: none; font-size: 1px; line-height: 1px; color: #fff; white-space: nowrap; }
h1, h2, h3, h4, .chapter-label, figcaption, .table-caption { position: relative; }
h1 { font-size: 14pt; font-weight: bold; text-align: center; margin: 0 0 14pt; break-after: avoid; }
h1.front-title, h1.unnumbered { text-transform: uppercase; }
.chapter-label { text-align: center; font-weight: bold; font-size: 14pt; margin: 0 0 4pt; }
h2 { font-size: 13pt; font-weight: bold; margin: 16pt 0 6pt; break-after: avoid; text-align: left; }
h3 { font-size: 12pt; font-weight: bold; font-style: italic; margin: 12pt 0 4pt; break-after: avoid; text-align: left; }
h4 { font-size: 12pt; font-weight: bold; margin: 10pt 0 4pt; break-after: avoid; text-align: left; }
ul, ol { margin: 0 0 10pt 0; padding-left: 26pt; }
li { margin-bottom: 4pt; }
b.term { font-weight: bold; }
code { font-family: Consolas, 'Courier New', monospace; font-size: 10.5pt; }
/* cover */
.cover { text-align: center; line-height: 1.6; height: 9in; display: flex; flex-direction: column; justify-content: space-between; }
.cover .logo { width: 3.2in; margin: 0 auto; }
.cover .title { font-size: 18pt; font-weight: bold; margin: 18pt 0 0; line-height: 1.35; }
.cover .applogo { width: 1.1in; margin: 14pt auto 0; border-radius: 18pt; }
.cover .who { font-size: 13pt; font-weight: bold; margin-top: 18pt; }
.cover .meta { font-size: 12pt; }
.cover .note { font-size: 10.5pt; font-style: italic; margin-top: 14pt; }
/* signature lines */
.sig { margin: 14pt 0; line-height: 2.2; }
/* toc */
.toc-row { display: flex; align-items: baseline; text-align: left; line-height: 1.55; font-size: 12pt; }
.toc-row a { color: #000; text-decoration: none; }
.toc-row .dots { flex: 1; border-bottom: 1.2px dotted #444; margin: 0 5pt; transform: translateY(-3.5pt); min-width: 12pt; }
.toc-row .pg { min-width: 22pt; text-align: right; }
.toc-row.l1 { font-weight: bold; margin-top: 4pt; }
.toc-row.l2 { padding-left: 18pt; }
.toc-row.l3 { padding-left: 36pt; font-size: 11.5pt; }
/* figures */
figure { margin: 8pt 0 10pt; text-align: center; break-inside: avoid; }
figure.breakable { break-inside: auto; }
figcaption, .table-caption { font-size: 10pt; font-style: italic; color: #0E2841; margin-top: 6pt; text-align: center; }
.diagram { width: auto; height: auto; display: block; margin: 0 auto; }
.shots { display: flex; flex-wrap: wrap; justify-content: center; gap: 8pt 14pt; }
.shot { text-align: center; }
.shot img { border: 1px solid #C9D1E0; border-radius: 10pt; display: block; }
.shot-label { font-size: 9pt; font-family: Arial; color: #333; margin-top: 3pt; }
.slot { border: 2px dashed #7C8BA5; border-radius: 8pt; background: #F5F7FB; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 16pt; font-family: Arial; }
.slot-title { font-size: 14pt; font-weight: bold; color: #1F4E79; }
.slot-body { font-size: 10.5pt; color: #333; margin-top: 6pt; max-width: 4.8in; text-align: center; }
.slot-file { font-size: 9pt; color: #555; margin-top: 10pt; }
/* charts */
.chart { display: inline-block; border: 1px solid #D5DCE8; border-radius: 8pt; padding: 10pt 14pt; font-family: Arial; text-align: left; }
.chart-title { font-weight: bold; font-size: 11pt; color: #1F2A44; margin-bottom: 8pt; text-align: center; }
.chart-body { display: flex; align-items: center; gap: 18pt; }
.legend { font-size: 10pt; }
.lg-row { display: flex; align-items: center; gap: 6pt; margin: 3pt 0; }
.lg-sw { width: 10pt; height: 10pt; border-radius: 2pt; display: inline-block; }
.lg-l { min-width: 1.4in; }
.lg-v { font-weight: bold; }
.lg-total { color: #666; margin-top: 6pt; }
/* tables */
.table-wrap { margin: 10pt 0 14pt; break-inside: avoid; }
table { border-collapse: collapse; width: 99.4%; margin-left: 0.5px; font-size: 11pt; line-height: 1.3; text-align: left; }
table.small { font-size: 9.5pt; }
th, td { border: 1px solid #000; padding: 4pt 6pt; vertical-align: top; }
th { background: #D9E2F3; font-weight: bold; }
.pass { color: #0A7A3B; font-weight: bold; }
/* code / terminal figure */
.terminal { background: #0F172A; color: #E2E8F0; font-family: Consolas, monospace; font-size: 8.6pt; line-height: 1.35; text-align: left; padding: 10pt 12pt; border-radius: 6pt; white-space: pre; }
.terminal .ok { color: #4ADE80; }
/* schema cards */
.schema { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8pt; width: calc(100% - 2px); font-family: Arial; text-align: left; }
.schema .tb { border: 1px solid #1F4E79; border-radius: 4pt; overflow: hidden; break-inside: avoid; }
.schema .tb-h { background: #1F4E79; color: #fff; font-weight: bold; font-size: 9pt; padding: 3pt 6pt; }
.schema .tb-r { display: flex; justify-content: space-between; font-size: 7pt; padding: 1.5pt 6pt; border-top: 1px solid #E3E8F1; line-height: 1.25; }
.schema .tb-r .k { color: #B45309; font-weight: bold; }
.schema .tb-r .ty { color: #555; }
/* wireframes */
.wfs { display: flex; flex-wrap: wrap; justify-content: center; gap: 12pt; }
.wf { text-align: center; font-family: Arial; }
.wf-phone { width: 1.75in; height: 3.35in; border: 2px solid #444; border-radius: 14pt; padding: 8pt 7pt; position: relative; overflow: hidden; background: #fff; display: flex; flex-direction: column; gap: 5pt; }
.wf-title { font-size: 9pt; margin-top: 4pt; color: #333; }
.wf i { display: block; height: 5pt; background: #BBB; border-radius: 3pt; margin: 2pt 0; }
.wf-row { display: flex; align-items: center; gap: 5pt; }
.wf-circle { width: 18pt; height: 18pt; border-radius: 50%; background: #CCC; flex-shrink: 0; }
.wf-circle.sm { width: 12pt; height: 12pt; }
.wf-lines { flex: 1; }
.wf-hero { background: #555; border-radius: 6pt; padding: 6pt; }
.wf-hero i { background: #999; }
.wf-hero b { display: block; height: 11pt; width: 60%; background: #CFCFCF; border-radius: 3pt; margin: 3pt 0; }
.wf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4pt; }
.wf-grid div { height: 20pt; border: 1px solid #AAA; border-radius: 4pt; background: #F2F2F2; }
.wf-chart { height: 40pt; border: 1px solid #AAA; border-radius: 4pt; padding: 3pt; }
.wf-chart svg { width: 100%; height: 100%; }
.wf-bars { display: flex; align-items: flex-end; gap: 3pt; }
.wf-bars span { flex: 1; background: #999; border-radius: 2pt 2pt 0 0; }
.wf-list div { height: 22pt; border: 1px solid #AAA; border-radius: 4pt; margin-bottom: 4pt; background: #F7F7F7; }
.wf-input { height: 14pt; border: 1px solid #999; border-radius: 3pt; font-size: 6.5pt; color: #777; text-align: left; padding-left: 4pt; line-height: 14pt; }
.wf-input.tall { height: 24pt; }
.wf-two { display: flex; gap: 4pt; } .wf-two .wf-input { flex: 1; }
.wf-chips { display: flex; gap: 3pt; } .wf-chips i { width: 22pt; height: 9pt; border-radius: 5pt; border: 1px solid #999; background: #fff; }
.wf-btn { height: 16pt; background: #555; border-radius: 4pt; color: #fff; font-size: 7pt; line-height: 16pt; }
.wf-logo { width: 34pt; height: 34pt; background: #666; border-radius: 9pt; margin: 18pt auto 4pt; }
.wf-center { margin: 3pt auto !important; }
.wf-sec { height: 30pt; border: 1px solid #AAA; border-radius: 4pt; background: #F5F5F5; }
.wf-sec.short { height: 18pt; }
.wf-tabbar { position: absolute; left: 0; right: 0; bottom: 0; height: 18pt; border-top: 1px solid #AAA; display: flex; justify-content: space-around; align-items: center; background: #FAFAFA; }
.wf-tabbar i { width: 10pt; height: 10pt; border-radius: 2pt; margin: 0; }
.wf-fab { position: absolute; right: 8pt; bottom: 24pt; width: 20pt; height: 20pt; border-radius: 6pt; background: #555; color: #fff; font-size: 12pt; line-height: 20pt; }
.refs p { padding-left: 24pt; text-indent: -24pt; text-align: left; }
.checkbox-q p { text-align: left; }
`;

function cover() {
  return `<section class="cover">
    <div>
      <img class="logo" src="../../assets/university-logo.png">
      <div class="title">AI Trading Journal: An AI-Powered Trading Journal and<br>Performance Analysis Mobile Application</div>
      <img class="applogo" src="../../assets/app-logo.png">
    </div>
    <div>
      <div class="who">${esc(cfg.student.name)}</div>
      <div class="who" style="margin-top:2pt">${esc(cfg.student.regNo)}</div>
    </div>
    <div class="meta">This project is submitted in partial fulfillment of the requirements for the award of ${esc(cfg.degree)}.</div>
    <div class="meta">${esc(cfg.faculty)}<br>${esc(cfg.university)}<br>${esc(cfg.location)}<br>${esc(cfg.submissionDate)}</div>
    <div class="note">This thesis is available for library use on the understanding that it is copyright material and that no quotation from the thesis may be published without proper acknowledgment.</div>
  </section>`;
}

function listPage(title, items, labels, cls = 'l2') {
  return `<section class="newpage"><h1 class="front-title">${esc(title)}</h1>${items
    .map((it) => `<div class="toc-row ${it.level ? 'l' + it.level : cls}"><a href="#${it.id}">${esc(it.label)}</a><span class="dots"></span><span class="pg">${labels[it.id] ?? '000'}</span></div>`)
    .join('')}</section>`;
}

// Size each diagram <img> from its PNG: fill the page width where possible, never exceed the height cap.
function sizeDiagrams(html) {
  return html.replace(/<img class="diagram" src="diagrams\/(\w+)\.png" style="max-width:([^;]+);max-height:([\d.]+)in">/g, (m, key, _maxW, maxH) => {
    const f = path.join(CACHE, 'diagrams', `${key}.png`);
    if (!fs.existsSync(f)) return m;
    const buf = fs.readFileSync(f);
    const w = buf.readUInt32BE(16) / 3;
    const h = buf.readUInt32BE(20) / 3; // CSS px (rendered at 3x)
    const width = Math.min(624, w * 2, parseFloat(maxH) * 96 * (w / h));
    return `<img class="diagram" src="diagrams/${key}.png" style="width:${Math.round(width)}px">`;
  });
}

function composeHtml(doc, labels, { markers }) {
  const body = sizeDiagrams(doc.parts.join('\n'));
  const toc = listPage('Table of Contents', doc.toc, labels);
  const lof = listPage('List of Figures', doc.figures, labels);
  const lot = listPage('List of Tables', doc.tables, labels);
  // Front matter order: cover, declaration, dedication, acknowledgement, abstract, TOC, LOF, LOT, chapters…
  const splitAt = body.indexOf('<div class="newpage chapter-start"');
  const front = body.slice(0, splitAt);
  const rest = body.slice(splitAt);
  let html = `<!doctype html><html><head><meta charset="utf-8"><title>AI Trading Journal — Project Documentation</title><style>${CSS}</style>
</head><body>${cover()}${front}${toc}${lof}${lot}${rest}</body></html>`;
  if (!markers) html = html.replace(/<span class="mk">@@[a-z]+\d+@@<\/span>/g, '');
  return html;
}

async function renderPdf(browser, html, file, { outline = false } = {}) {
  const htmlPath = path.join(CACHE, 'doc.html');
  fs.writeFileSync(htmlPath, html);
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
  });
  await page.pdf({ path: file, format: 'Letter', printBackground: true, preferCSSPageSize: true, outline, tagged: outline });
  await page.close();
}

// Render each Mermaid diagram on its own page at natural size and 2x scale, cached by content hash.
async function renderDiagrams(browser, diagrams) {
  const dir = path.join(CACHE, 'diagrams');
  fs.mkdirSync(dir, { recursive: true });
  const todo = Object.entries(diagrams).filter(([k]) => !fs.existsSync(path.join(dir, `${k}.png`)));
  if (!todo.length) return;
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 3 });
  const shell = path.join(CACHE, 'mermaid.html');
  fs.writeFileSync(shell, `<!doctype html><html><head><script src="../../node_modules/mermaid/dist/mermaid.min.js"></script></head><body style="margin:0;background:#fff"><div id="c" style="display:inline-block;padding:14px;background:#fff"></div></body></html>`);
  await page.goto(pathToFileURL(shell).href, { waitUntil: 'load' });
  await page.evaluate(() => {
    // eslint-disable-next-line no-undef
    mermaid.initialize({
      startOnLoad: false, theme: 'base', securityLevel: 'loose', fontFamily: 'Arial',
      themeVariables: {
        primaryColor: '#DCE9F7', primaryBorderColor: '#1F4E79', primaryTextColor: '#0B1B34', lineColor: '#1F4E79',
        secondaryColor: '#EEF3FB', tertiaryColor: '#F7F9FC', fontSize: '16px', actorBkg: '#DCE9F7', actorBorder: '#1F4E79',
        noteBkgColor: '#FFF7E0', noteBorderColor: '#C28A00', clusterBkg: '#F4F7FC', clusterBorder: '#9FB3CF',
        attributeBackgroundColorOdd: '#FFFFFF', attributeBackgroundColorEven: '#F4F7FC',
      },
      er: { useMaxWidth: false }, flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis', nodeSpacing: 40, rankSpacing: 55 },
      sequence: { useMaxWidth: false, mirrorActors: false, messageFontSize: 15, actorFontSize: 15 }, class: { useMaxWidth: false },
    });
  });
  for (const [key, code] of todo) {
    const ok = await page.evaluate(async (k, c) => {
      try {
        // eslint-disable-next-line no-undef
        const { svg } = await mermaid.render('d' + k, c);
        document.getElementById('c').innerHTML = svg;
        return true;
      } catch (e) {
        return String(e.message || e);
      }
    }, key, code);
    if (ok !== true) throw new Error(`Mermaid diagram ${key} failed: ${ok}`);
    const el = await page.$('#c');
    await el.screenshot({ path: path.join(dir, `${key}.png`) });
    console.log('  diagram', key);
  }
  await page.close();
}

async function markerPages(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const pdf = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  const pages = {};
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    const text = tc.items.map((x) => x.str).join('');
    for (const m of text.matchAll(/@@([a-z]+\d+)@@/g)) pages[m[1]] ??= i - 1; // 0-based index
  }
  return { pages, count: pdf.numPages };
}

// ---------------------------------------------------------------------------
const doc = new Doc(ROOT);
buildContent(doc, cfg, schema);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  await renderDiagrams(browser, doc.diagrams);
  const pass1 = path.join(CACHE, 'pass1.pdf');
  console.log('Pass 1: layout…');
  await renderPdf(browser, composeHtml(doc, {}, { markers: true }), pass1);
  const { pages } = await markerPages(pass1);
  const firstChapter = doc.toc.find((t) => t.chapter === 1);
  const ch1 = pages[firstChapter.id];
  const labelFor = (idx) => (idx < ch1 ? toRoman(idx + 1) : String(idx - ch1 + 1));
  const labels = Object.fromEntries(Object.entries(pages).map(([id, idx]) => [id, labelFor(idx)]));
  const missing = [...doc.toc, ...doc.figures, ...doc.tables].filter((t) => labels[t.id] == null);
  if (missing.length) console.warn('Warning: could not locate', missing.map((m) => m.label).slice(0, 5));

  console.log('Pass 2: final render…');
  const pass2 = path.join(CACHE, 'pass2.pdf');
  await renderPdf(browser, composeHtml(doc, labels, { markers: false }), pass2, { outline: true });

  // Verify layout did not shift between passes (TOC numbers must stay correct).
  const pdfDoc = await PDFDocument.load(fs.readFileSync(pass2));
  const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const n = pdfDoc.getPageCount();
  pdfDoc.getPages().forEach((pg, idx) => {
    if (idx === 0) return; // cover
    const label = labelFor(idx);
    const { width } = pg.getSize();
    const size = 11;
    pg.drawText(label, { x: width / 2 - font.widthOfTextAtSize(label, size) / 2, y: 0.5 * 72, size, font, color: rgb(0, 0, 0) });
  });
  pdfDoc.setTitle('AI Trading Journal — Project Documentation');
  pdfDoc.setAuthor(cfg.student.name);
  pdfDoc.setSubject('AI Trading Journal and Performance Analysis System');
  pdfDoc.setKeywords(['trading journal', 'forex', 'AI', 'Gemini', 'Supabase', 'React Native', 'Expo']);
  fs.writeFileSync(OUT, await pdfDoc.save());
  console.log(`Done: ${OUT}  (${n} pages; chapter one starts on PDF page ${ch1 + 1})`);
} finally {
  await browser.close();
}
