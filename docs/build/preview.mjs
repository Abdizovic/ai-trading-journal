// Renders PDF pages to PNG for visual review:  node build/preview.mjs 1,2,12-14
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PDF = path.join(ROOT, 'AI_Trading_Journal_Documentation.pdf');
const OUT = path.join(ROOT, 'build', '.cache', 'preview');
fs.mkdirSync(OUT, { recursive: true });
const spec = process.argv[2] ?? '1-3';
const pages = spec.split(',').flatMap((s) => { const [a, b] = s.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
const html = `<!doctype html><html><body style="margin:0;background:#888"><canvas id="c"></canvas><script type="module">
import * as pdfjs from '${pathToFileURL(path.join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href}';
pdfjs.GlobalWorkerOptions.workerSrc = '${pathToFileURL(path.join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).href}';
let pdf; window.load = async (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); pdf = await pdfjs.getDocument({ data: u }).promise; return pdf.numPages; };
window.renderPage = async (n) => { const p = await pdf.getPage(n); const vp = p.getViewport({ scale: 1.3 }); const c = document.getElementById('c'); c.width = vp.width; c.height = vp.height; await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; return [vp.width, vp.height, pdf.numPages]; };
window.ready = true;</script></body></html>`;
const f = path.join(OUT, 'viewer.html'); fs.writeFileSync(f, html);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--allow-file-access-from-files'] });
const pg = await b.newPage(); await pg.goto(pathToFileURL(f).href); await pg.waitForFunction('window.ready');
const total = await pg.evaluate((b) => window.load(b), fs.readFileSync(PDF).toString('base64'));
console.log('pages:', total);
for (const n of pages) { const [w, h] = await pg.evaluate((n) => window.renderPage(n), n); await pg.setViewport({ width: Math.ceil(w), height: Math.ceil(h) }); await pg.evaluate((n) => window.renderPage(n), n); await pg.screenshot({ path: path.join(OUT, `p${String(n).padStart(3, '0')}.png`) }); }
await b.close(); console.log('rendered', pages.join(','), '->', OUT);
