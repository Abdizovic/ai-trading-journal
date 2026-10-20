// Edge Function: analyze-performance
//
// POST { period: '30d'|'90d'|'180d'|'365d'|'all', trade_id?: uuid }
// Auth: user JWT (verify_jwt = true). The Gemini key never leaves the server.
//
// Flow: verify user -> check kill-switch / quota / rate limit -> load the
// caller's trades THROUGH RLS (user-scoped client) -> build de-identified
// payload -> Gemini (JSON schema) -> validate -> store with service role.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { buildPayload, RESPONSE_SCHEMA, sanitizeResult, SYSTEM_INSTRUCTION, type TradeRow } from '../_shared/analysis.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
// Primary model first, then fallbacks used when a model is missing or overloaded.
// gemini-2.5-* is closed to new API keys; default to the current Flash model.
const GEMINI_MODELS = [...new Set([Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3-flash-preview'])];
const TRANSIENT = new Set([500, 502, 503, 504]);
const HOURLY_LIMIT = 5;

const PERIODS: Record<string, { days: number | null; label: string }> = {
  '30d': { days: 30, label: 'Last 30 days' },
  '90d': { days: 90, label: 'Last 90 days' },
  '180d': { days: 180, label: 'Last 6 months' },
  '365d': { days: 365, label: 'Last 12 months' },
  all: { days: null, label: 'All time' },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
const fail = (status: number, code: string, message: string) => reply(status, { error: { code, message } });

// Structured log line (visible in Supabase function logs). Never logs secrets or journal text.
const log = (level: 'info' | 'warn' | 'error', msg: string, ctx: Record<string, unknown> = {}) =>
  console[level === 'info' ? 'log' : level](JSON.stringify({ level, msg, fn: 'analyze-performance', ...ctx }));

async function callGemini(payload: unknown): Promise<{ json: unknown; model: string; skipped: string[] }> {
  let lastErr = 'unknown';
  const skipped: string[] = []; // why earlier models were skipped (for monitoring)
  // Stay well inside the 150s Edge Function limit across all fallback attempts.
  const deadline = Date.now() + 110_000;
  for (const model of GEMINI_MODELS) {
   // One attempt per model: when a model is busy (503) the next one in the chain is tried immediately.
   for (let attempt = 0; attempt < 1; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 5_000) { skipped.push(`${model}=no_time`); break; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(75_000, remaining));
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY! },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: 'user', parts: [{ text: `Trading journal data (JSON):\n${JSON.stringify(payload)}` }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0.4, maxOutputTokens: 8192 },
        }),
      });
      if (res.status === 404) { lastErr = `model_not_found:${model}`; skipped.push(`${model}=404`); break; } // model unavailable -> next model
      if (TRANSIENT.has(res.status)) { lastErr = `gemini_http_${res.status}:${model}`; skipped.push(`${model}=${res.status}`); break; } // overloaded -> next model
      if (res.status === 429) throw Object.assign(new Error('gemini_rate_limited'), { code: 'ai_rate_limited' });
      if (!res.ok) throw new Error(`gemini_http_${res.status}`);
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
      if (!text) throw new Error(`gemini_empty:${data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason ?? 'unknown'}`);
      return { json: JSON.parse(text), model, skipped };
    } catch (e) {
      if ((e as Error).name === 'AbortError') { lastErr = `gemini_timeout:${model}`; skipped.push(`${model}=timeout`); break; }
      throw e;
    } finally {
      clearTimeout(timer);
    }
   }
  }
  throw new Error(lastErr);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Method not allowed.');

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return fail(401, 'session_expired', 'Please sign in again.');

  // User-scoped client: every query below is subject to RLS as the caller.
  const userDb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const serviceDb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: auth, error: authErr } = await userDb.auth.getUser(authHeader.slice(7));
  if (authErr || !auth.user) return fail(401, 'session_expired', 'Please sign in again.');
  const userId = auth.user.id;

  // ---- Input validation
  let body: { period?: string; trade_id?: string };
  try {
    body = await req.json();
  } catch {
    return fail(400, 'validation', 'Invalid request body.');
  }
  const period = body.period ?? '90d';
  if (!PERIODS[period]) return fail(400, 'validation', 'Invalid analysis period.');
  if (body.trade_id && !/^[0-9a-f-]{36}$/i.test(body.trade_id)) return fail(400, 'validation', 'Invalid trade id.');

  // ---- Account / platform checks
  const [{ data: profile }, { data: system }, { data: settings }] = await Promise.all([
    userDb.from('profiles').select('status, role').eq('user_id', userId).single(),
    userDb.from('system_settings').select('*').single(),
    userDb.from('user_settings').select('ai_include_notes, ai_include_emotions').eq('user_id', userId).single(),
  ]);
  if (!profile || profile.status !== 'active') return fail(403, 'account_deactivated', 'This account has been deactivated.');
  if (profile.role !== 'trader') return fail(403, 'forbidden', 'AI analysis is available to trader accounts only.');
  if (!system?.ai_enabled) return fail(503, 'ai_unavailable', 'The AI analyst is temporarily disabled.');
  if (!GEMINI_API_KEY) {
    log('error', 'GEMINI_API_KEY secret is not set');
    return fail(503, 'ai_unavailable', 'The AI analyst is not configured yet. Please try again later.');
  }

  // ---- Quota + rate limit (every attempt counts, including failures)
  const now = Date.now();
  const { data: recent } = await serviceDb
    .from('ai_requests').select('created_at').eq('user_id', userId)
    .gte('created_at', new Date(now - 86_400_000).toISOString());
  const usedToday = recent?.length ?? 0;
  const lastHour = (recent ?? []).filter((r) => Date.parse(r.created_at) > now - 3_600_000).length;
  if (usedToday >= system.ai_daily_limit_per_user)
    return fail(429, 'ai_rate_limited', `You have used all ${system.ai_daily_limit_per_user} AI analyses for today. Please try again tomorrow.`);
  if (lastHour >= HOURLY_LIMIT)
    return fail(429, 'ai_rate_limited', 'You are requesting analyses too quickly. Please wait a while before trying again.');

  // ---- Load trades through RLS
  const cols = 'id, currency_pair, direction, entry_price, exit_price, stop_loss, take_profit, position_size, risk_reward_ratio, profit_loss, trading_session, strategy, trade_result, emotional_state, entry_reason, notes, trade_date';
  const days = PERIODS[period].days;
  let q = userDb.from('trades').select(cols).order('trade_date', { ascending: false }).limit(500);
  if (days && !body.trade_id) q = q.gte('trade_date', new Date(now - days * 86_400_000).toISOString());
  const { data: tradesData, error: tradesErr } = await q;
  if (tradesErr) {
    log('error', 'trade query failed', { code: tradesErr.code });
    return fail(500, 'server', 'Could not load your journal. Please try again.');
  }
  const trades = (tradesData ?? []) as TradeRow[];

  let scope: 'portfolio' | 'trade' = 'portfolio';
  let focus: string | null = null;
  let analysedTrades = trades;
  let periodLabel = PERIODS[period].label;
  if (body.trade_id) {
    const target = trades.find((t) => t.id === body.trade_id);
    if (!target) return fail(404, 'not_found', 'This trade could not be found.');
    scope = 'trade';
    focus = `${target.direction} ${target.currency_pair} · ${target.strategy}`;
    periodLabel = 'Single trade';
    // Put the focus trade first; history gives context for comparison.
    analysedTrades = [target, ...trades.filter((t) => t.id !== target.id)];
  } else if (trades.length < system.min_trades_for_ai) {
    return fail(422, 'ai_insufficient_data', `At least ${system.min_trades_for_ai} trades are needed in the selected period. You have ${trades.length}.`);
  }

  const payload = {
    ...buildPayload(analysedTrades, {
      includeNotes: settings?.ai_include_notes ?? true,
      includeEmotions: settings?.ai_include_emotions ?? true,
      period: periodLabel,
    }),
    ...(scope === 'trade' ? { task: 'Analyze ONLY the first trade in `trades` in depth, using the rest of the journal as context for comparison.' } : {}),
  };

  const started = Date.now();
  try {
    const { json, model, skipped } = await callGemini(payload);
    const result = sanitizeResult(json, focus);
    const latency = Date.now() - started;

    const { data: saved, error: saveErr } = await serviceDb
      .from('ai_analyses')
      .insert({
        user_id: userId,
        analysis_period: periodLabel,
        period_start: days && scope === 'portfolio' ? new Date(now - days * 86_400_000).toISOString() : null,
        period_end: new Date(now).toISOString(),
        trades_analyzed: scope === 'trade' ? 1 : trades.length,
        scope,
        trade_id: body.trade_id ?? null,
        summary: result.performance_summary,
        analysis_result: result,
        model,
      })
      .select('*')
      .single();
    if (saveErr) throw new Error(`save_failed:${saveErr.code}`);

    await serviceDb.from('ai_requests').insert({ user_id: userId, status: 'success', scope, trades_analyzed: saved.trades_analyzed, latency_ms: latency, model, error_code: skipped.length ? `fallback ${skipped.join(' ')}`.slice(0, 200) : null });
    await serviceDb.from('audit_logs').insert({ actor_id: userId, action: 'ai.analysis', target: saved.id, metadata: { scope, trades: saved.trades_analyzed, model, latency_ms: latency } });
    log('info', 'analysis complete', { scope, trades: saved.trades_analyzed, model, latency_ms: latency });
    return reply(200, saved);
  } catch (e) {
    const err = e as Error & { code?: string };
    const code = err.code === 'ai_rate_limited' ? 'ai_rate_limited' : 'ai_unavailable';
    await serviceDb.from('ai_requests').insert({ user_id: userId, status: 'failed', scope, trades_analyzed: 0, latency_ms: Date.now() - started, error_code: err.message.slice(0, 60) });
    log('error', 'analysis failed', { reason: err.message.slice(0, 120) });
    return fail(code === 'ai_rate_limited' ? 429 : 503, code,
      code === 'ai_rate_limited' ? 'The AI service is busy. Please try again in a few minutes.' : 'The AI analyst is temporarily unavailable. Please try again later.');
  }
});
