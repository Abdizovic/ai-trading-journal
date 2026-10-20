// Hand-laid UML diagrams sized to fit a Letter page (automatic layouts come out too wide/tall).
const NAVY = '#1F4E79';

function entity(x, y, w, title, rows, fill) {
  const h = 24 + rows.length * 15 + 6;
  const r = rows
    .map(
      ([k, n, t], i) =>
        `<text x="${x + 7}" y="${y + 39 + i * 15}" font-size="10.5" font-family="Arial"><tspan fill="#B45309" font-weight="700">${k ? k + ' ' : ''}</tspan><tspan fill="#0B1B34">${n}</tspan><tspan fill="#667" font-size="9.5"> ${t ?? ''}</tspan></text>`,
    )
    .join('');
  return {
    h,
    svg: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#fff" stroke="${NAVY}" stroke-width="1.4"/><rect x="${x}" y="${y}" width="${w}" height="22" rx="4" fill="${fill}" stroke="${NAVY}" stroke-width="1.4"/><text x="${x + w / 2}" y="${y + 15}" text-anchor="middle" font-size="11.5" font-weight="700" font-family="Arial" fill="#0B1B34">${title}</text>${r}`,
  };
}

/** Entity Relationship Diagram of the deployed schema (auth.users at the centre). */
export function erdSvg() {
  const W = 640;
  const E = {
    users: { x: 232, y: 262, w: 176, title: 'auth.users', rows: [['PK', 'id', 'uuid'], ['', 'email', 'text'], ['', 'encrypted_password', ''], ['', 'banned_until', 'timestamptz']] },
    profiles: { x: 0, y: 0, w: 188, title: 'profiles', rows: [['PK', 'id', 'uuid'], ['FK', 'user_id', 'uuid'], ['', 'full_name', 'text'], ['', 'role', 'trader | admin'], ['', 'status', 'active | deactivated']] },
    settings: { x: 0, y: 140, w: 188, title: 'user_settings', rows: [['PK FK', 'user_id', 'uuid'], ['', 'ai_include_notes', 'bool'], ['', 'ai_include_emotions', 'bool'], ['', 'ai_default_period', 'text']] },
    goals: { x: 0, y: 268, w: 188, title: 'trading_goals', rows: [['PK', 'id', 'uuid'], ['FK', 'user_id', 'uuid'], ['', 'metric', 'text'], ['', 'target_value', 'numeric'], ['', 'status', 'text']] },
    notif: { x: 0, y: 410, w: 188, title: 'notifications', rows: [['PK', 'id', 'uuid'], ['FK', 'user_id', 'uuid'], ['', 'title / message', 'text'], ['', 'read', 'bool']] },
    trades: { x: 452, y: 0, w: 188, title: 'trades', rows: [['PK', 'id', 'uuid'], ['FK', 'user_id', 'uuid'], ['', 'currency_pair', 'text'], ['', 'direction', 'BUY | SELL'], ['', 'entry / exit / SL / TP', 'numeric'], ['', 'profit_loss', 'numeric'], ['', 'trade_result', 'text'], ['', 'trade_date', 'timestamptz']] },
    analyses: { x: 452, y: 200, w: 188, title: 'ai_analyses', rows: [['PK', 'id', 'uuid'], ['FK', 'user_id', 'uuid'], ['FK', 'trade_id', 'uuid, nullable'], ['', 'analysis_result', 'jsonb'], ['', 'model', 'text']] },
    requests: { x: 452, y: 342, w: 188, title: 'ai_requests', rows: [['PK', 'id', 'uuid'], ['FK', 'user_id', 'uuid'], ['', 'status', 'success | failed'], ['', 'latency_ms', 'int']] },
    audit: { x: 452, y: 470, w: 188, title: 'audit_logs', rows: [['PK', 'id', 'uuid'], ['FK', 'actor_id', 'uuid, nullable'], ['', 'action', 'text'], ['', 'metadata', 'jsonb']] },
    system: { x: 225, y: 440, w: 190, title: 'system_settings', rows: [['PK', 'id', 'bool, singleton'], ['FK', 'updated_by', 'uuid'], ['', 'ai_enabled', 'bool'], ['', 'ai_daily_limit_per_user', 'int']] },
  };
  let boxes = '';
  for (const e of Object.values(E)) {
    const b = entity(e.x, e.y, e.w, e.title, e.rows, e === E.users ? '#FDE9C9' : '#DCE9F7');
    e.h = b.h;
    boxes += b.svg;
  }
  const lab = (x, y, t) => `<text x="${x}" y="${y}" font-size="11" font-weight="700" font-family="Arial" fill="${NAVY}" text-anchor="middle">${t}</text>`;
  const line = ([x1, y1], [x2, y2], ca, cb) => {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${NAVY}" stroke-width="1.4"/>${lab(x1 + ux * 16 + uy * 9, y1 + uy * 16 - ux * 9 + 4, ca)}${lab(x2 - ux * 16 + uy * 9, y2 - uy * 16 - ux * 9 + 4, cb)}`;
  };
  const U = E.users;
  const L = (dy) => [U.x, U.y + dy], R = (dy) => [U.x + U.w, U.y + dy];
  const left = (e) => [e.x, e.y + e.h / 2], right = (e) => [e.x + e.w, e.y + e.h / 2];
  const rels = [
    line(L(12), right(E.profiles), '1', '1'),
    line(L(30), right(E.settings), '1', '1'),
    line(L(52), right(E.goals), '1', 'N'),
    line(L(74), right(E.notif), '1', 'N'),
    line(R(12), left(E.trades), '1', 'N'),
    line(R(32), left(E.analyses), '1', 'N'),
    line(R(56), left(E.requests), '1', 'N'),
    line(R(80), left(E.audit), '0..1', 'N'),
    line([U.x + U.w / 2, U.y + U.h], [E.system.x + E.system.w / 2, E.system.y], '0..1', 'N'),
    line([E.trades.x + E.trades.w / 2, E.trades.y + E.trades.h], [E.analyses.x + E.analyses.w / 2, E.analyses.y], '0..1', 'N'),
  ].join('');
  const H = 560;
  return `<svg width="100%" viewBox="-12 -8 ${W + 24} ${H + 26}" style="max-width:6.5in">${rels}${boxes}<text x="${W / 2}" y="${H + 12}" text-anchor="middle" font-size="10" font-family="Arial" fill="#555">1 = one · N = many · 0..1 = optional · PK = primary key · FK = foreign key · user data cascades on account deletion</text></svg>`;
}

/** UML use-case diagram: two actors, system boundary, external AI service. */
export function useCaseSvg() {
  const W = 640, H = 600;
  const actor = (x, y, label) =>
    `<g stroke="#0B1B34" stroke-width="2" fill="none"><circle cx="${x}" cy="${y}" r="11"/><line x1="${x}" y1="${y + 11}" x2="${x}" y2="${y + 44}"/><line x1="${x - 18}" y1="${y + 22}" x2="${x + 18}" y2="${y + 22}"/><line x1="${x}" y1="${y + 44}" x2="${x - 14}" y2="${y + 68}"/><line x1="${x}" y1="${y + 44}" x2="${x + 14}" y2="${y + 68}"/></g><text x="${x}" y="${y + 86}" text-anchor="middle" font-family="Arial" font-size="12.5" font-weight="700">${label}</text>`;
  const trader = ['Register & verify email', 'Record / edit / delete trade', 'Search & filter journal', 'View dashboard & analytics', 'Manage trading goals', 'Request AI analysis', 'View analysis history'];
  const shared = ['Sign in / reset password', 'Manage profile & settings'];
  const admin = ['View platform statistics', 'Activate / deactivate traders', 'Monitor AI usage', 'Generate & export reports', 'Manage system settings'];
  const ell = (cx, cy, t) =>
    `<ellipse cx="${cx}" cy="${cy}" rx="90" ry="19" fill="#DCE9F7" stroke="${NAVY}" stroke-width="1.3"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="Arial" font-size="10.5" fill="#0B1B34">${t}</text>`;
  const Tx = 40, Ax = 600, C1 = 222, C2 = 418, hub = 262;
  const tY = trader.map((_, i) => 72 + i * 60);
  const aY = admin.map((_, i) => 72 + i * 60);
  const sY = [490, 548];
  const edge = (x1, y1, x2, y2, extra = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#666" stroke-width="1" ${extra}/>`;
  let s = `<rect x="118" y="12" width="404" height="${H - 24}" rx="8" fill="#F7F9FC" stroke="${NAVY}" stroke-width="1.5"/><text x="320" y="36" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700" fill="${NAVY}">AI Trading Journal System</text>`;
  trader.forEach((_, i) => (s += edge(Tx + 18, hub, C1 - 90, tY[i])));
  shared.forEach((_, i) => (s += edge(Tx + 18, hub, 320 - 90, sY[i]) + edge(Ax - 18, hub, 320 + 90, sY[i])));
  admin.forEach((_, i) => (s += edge(Ax - 18, hub, C2 + 90, aY[i])));
  s += `<line x1="${C1 + 90}" y1="${tY[5]}" x2="${C2 - 70}" y2="${404}" stroke="#C28A00" stroke-width="1.3" stroke-dasharray="5,4"/>`;
  trader.forEach((t, i) => (s += ell(C1, tY[i], t)));
  admin.forEach((t, i) => (s += ell(C2, aY[i], t)));
  shared.forEach((t, i) => (s += ell(320, sY[i], t)));
  s += `<rect x="${C2 - 70}" y="386" width="140" height="36" rx="6" fill="#FFF7E0" stroke="#C28A00"/><text x="${C2}" y="401" text-anchor="middle" font-family="Arial" font-size="10.5" font-weight="700">«external system»</text><text x="${C2}" y="415" text-anchor="middle" font-family="Arial" font-size="10.5">Google Gemini AI</text>`;
  s += actor(Tx, 215, 'Trader') + actor(Ax, 215, 'Administrator');
  return `<svg width="100%" viewBox="-14 0 ${W + 28} ${H}" style="max-width:6.5in">${s}</svg>`;
}

/** Layered system architecture: mobile client, Supabase platform, external AI. */
export function architectureSvg() {
  const W = 640, H = 470;
  const panel = (x, y, w, h, title, fill) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${NAVY}" stroke-width="1.5"/><text x="${x + w / 2}" y="${y + 20}" text-anchor="middle" font-family="Arial" font-size="12.5" font-weight="700" fill="${NAVY}">${title}</text>`;
  const node = (x, y, w, h, l1, l2, fill = '#DCE9F7', cyl = false) => {
    const shape = cyl
      ? `<path d="M${x},${y + 7} a${w / 2},7 0 0,1 ${w},0 v${h - 14} a${w / 2},7 0 0,1 -${w},0 z" fill="${fill}" stroke="${NAVY}" stroke-width="1.3"/><path d="M${x},${y + 7} a${w / 2},7 0 0,0 ${w},0" fill="none" stroke="${NAVY}" stroke-width="1.3"/>`
      : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${NAVY}" stroke-width="1.3"/>`;
    return `${shape}<text x="${x + w / 2}" y="${y + h / 2 + (l2 ? -2 : 4)}" text-anchor="middle" font-family="Arial" font-size="11" font-weight="700" fill="#0B1B34">${l1}</text>${l2 ? `<text x="${x + w / 2}" y="${y + h / 2 + 12}" text-anchor="middle" font-family="Arial" font-size="9.5" fill="#445">${l2}</text>` : ''}`;
  };
  const arrow = (x1, y1, x2, y2, label, dy = -5) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${NAVY}" stroke-width="1.5" marker-end="url(#arr)"/>${label ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + dy}" text-anchor="middle" font-family="Arial" font-size="9.5" fill="#333">${label}</text>` : ''}`;
  let s = `<defs><marker id="arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="${NAVY}"/></marker></defs>`;
  // Client
  s += panel(0, 0, 170, 430, 'Mobile App (Expo)', '#F4F7FC');
  s += node(15, 40, 140, 44, 'Screens', 'Expo Router, Paper UI');
  s += node(15, 110, 140, 44, 'Forms & validation', 'React Hook Form + Zod');
  s += node(15, 180, 140, 44, 'React Query cache', 'offline pause / resume');
  s += node(15, 250, 140, 50, 'API client', 'single contract (mock | Supabase)', '#FDE9C9');
  s += node(15, 330, 140, 50, 'SecureStore', 'keychain / keystore tokens', '#EEF3FB', true);
  s += arrow(85, 84, 85, 108) + arrow(85, 154, 85, 178) + arrow(85, 224, 85, 248);
  s += `<line x1="85" y1="300" x2="85" y2="328" stroke="${NAVY}" stroke-width="1.3" stroke-dasharray="4,3"/>`;
  // Supabase
  s += panel(230, 0, 250, 430, 'Supabase Cloud', '#F4F7FC');
  s += node(250, 40, 210, 44, 'Auth', 'JWT, refresh rotation, email OTP');
  s += node(250, 110, 210, 44, 'PostgREST API', 'every request carries the user JWT');
  s += node(250, 190, 210, 64, 'PostgreSQL 17', 'RLS · CHECK constraints · triggers · audit log', '#FDE9C9', true);
  s += node(250, 280, 210, 44, 'Storage', 'private screenshots, signed URLs', '#EEF3FB', true);
  s += node(250, 355, 210, 50, 'Edge Function', 'analyze-performance (Deno)', '#E7DEFF');
  s += arrow(355, 154, 355, 188);
  s += arrow(300, 355, 300, 256, 'trades via RLS', 0);
  // Gemini
  s += panel(530, 300, 110, 130, 'External', '#FFF7E0');
  s += node(542, 345, 86, 50, 'Google', 'Gemini API', '#FFF1CC');
  // client -> supabase arrows
  s += arrow(155, 262, 248, 62, 'sign in / verify', -6);
  s += arrow(155, 270, 248, 132, 'CRUD', -4);
  s += arrow(155, 280, 248, 302, 'upload', 10);
  s += arrow(155, 290, 248, 380, 'analyze', 12);
  s += arrow(460, 380, 540, 372, 'de-identified JSON', -8);
  s += `<text x="${W / 2}" y="${H - 20}" text-anchor="middle" font-family="Arial" font-size="10" fill="#555">Secrets (service-role key, Gemini key) exist only inside Supabase — the app holds only the public URL and anon key.</text>`;
  return `<svg width="100%" viewBox="0 0 ${W} ${H - 10}" style="max-width:6.5in">${s}</svg>`;
}
