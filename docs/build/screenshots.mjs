// Captures app screenshots from the web build (live Supabase backend) for the documentation.
// Usage: node build/screenshots.mjs   (expects ../mobile to be exportable; uses the demo accounts)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WEB = path.join(ROOT, 'build', '.web');
const OUT = path.join(ROOT, 'screenshots');
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TRADER = { email: 'demo.trader@example.com', password: 'Trader#Demo2026' };
const ADMIN = { email: 'mahmedmasud9@gmail.com', password: 'Admin#Secure2026' };

if (!process.argv.includes('--no-export')) {
  console.log('Exporting web build…');
  execSync(`npx expo export --platform web --output-dir "${WEB}"`, { cwd: path.join(ROOT, '..', 'mobile'), stdio: 'inherit' });
}
fs.mkdirSync(OUT, { recursive: true });

const types = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = path.join(WEB, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(WEB, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] ?? 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(8790, r));
const BASE = 'http://localhost:8790';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

const shot = async (name, wait = 1200) => {
  await sleep(wait);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('  ✓', name);
};
const go = async (route, wait = 2800) => {
  await page.goto(BASE + route, { waitUntil: 'networkidle0' });
  await sleep(wait);
};
const scroll = async (dy) => {
  await page.mouse.move(195, 500);
  await page.mouse.wheel({ deltaY: dy });
  await sleep(700);
};
const clickText = async (text) => {
  const box = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('div,span')].filter((e) => e.innerText?.trim() === t && e.getBoundingClientRect().height > 0).pop();
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, text);
  if (!box) throw new Error(`not found: ${text}`);
  await page.mouse.click(box.x, box.y);
};
const login = async ({ email, password }) => {
  await go('/login', 3000);
  for (const [label, value] of [['Email', email], ['Password', password]]) {
    await page.click(`input[aria-label="${label}"]`, { clickCount: 3 });
    await page.type(`input[aria-label="${label}"]`, value);
  }
  await clickText('Sign in');
  await sleep(4500);
};
const logout = async () => {
  await page.evaluate(() => sessionStorage.clear());
};

// ---- Public screens
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await shot('01-splash', 900);
await sleep(2500);
await shot('02-login', 800);
await go('/register');
await shot('03-register');
await go('/verify-email?email=trader%40example.com');
await shot('04-verify-email');
await go('/forgot-password');
await shot('05-forgot-password');

// ---- Trader
console.log('Trader screens');
await login(TRADER);
await shot('10-trader-home');
await scroll(700);
await shot('11-trader-home-chart', 400);
await scroll(900);
await shot('12-trader-home-ai-summary', 400);
await go('/journal');
await shot('13-journal');
await go('/trade/new');
await shot('14-add-trade');
await scroll(900);
await shot('15-add-trade-prices', 400);
await go('/journal');
await clickText('SL');
await sleep(2500);
await shot('16-trade-details');
await go('/analytics');
await shot('17-analytics');
await scroll(1600);
await shot('18-analytics-charts', 400);
await scroll(1300);
await shot('19-analytics-breakdown', 400);
await go('/insights', 3500);
await shot('20-ai-insights');
await scroll(800);
await shot('21-ai-insights-result', 400);
await go('/analysis/history');
await shot('22-analysis-history');
await clickText('Last 90 days').catch(() => clickText('All time'));
await sleep(2500);
await shot('23-analysis-detail');
await go('/goals');
await shot('24-goals');
await go('/goals/edit');
await shot('25-goal-new');
await go('/notifications');
await shot('26-notifications');
await go('/profile');
await shot('27-profile');
await go('/settings/ai');
await shot('28-ai-settings');
await go('/settings/privacy');
await shot('29-privacy');
await go('/about');
await shot('30-about');
await logout();

// ---- Admin
console.log('Admin screens');
await login(ADMIN);
await shot('40-admin-dashboard');
await scroll(900);
await shot('41-admin-dashboard-charts', 400);
await go('/admin/users');
await shot('42-admin-users');
await clickText('View');
await sleep(2500);
await shot('43-admin-user-detail');
await go('/admin/data');
await shot('44-admin-trading-data');
await go('/admin/ai');
await shot('45-admin-ai-monitor');
await go('/admin/reports');
await shot('46-admin-reports');
await go('/admin/settings');
await shot('47-admin-settings');
await go('/admin/profile');
await shot('48-admin-profile');

await browser.close();
server.close();
console.log(`Saved screenshots to ${OUT}`);
