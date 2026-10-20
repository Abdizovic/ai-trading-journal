# AI Trading Journal

**AI Trading Journal and Performance Analysis System** — *Track. Analyze. Improve.*

A mobile trading journal for forex traders. You record completed trades, review your performance analytics, and get AI-generated insights from Google Gemini. It is a journaling and analysis tool only: it does **not** execute trades or connect to a broker.

| Folder | Contents | Status |
|---|---|---|
| `mobile/` | Expo SDK 57 · React Native · TypeScript · Expo Router app | ✅ Complete |
| `supabase/` | Postgres schema, RLS, storage, Auth, Gemini Edge Function | ✅ Live. Only the Gemini API key still needs to be set (see [supabase/README.md](supabase/README.md)) |

---

## Run it on your phone (Expo Go, SDK 57)

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with **Expo Go** (Android) or the Camera app (iOS). Your phone and computer need to be on the same Wi-Fi network. If they can't reach each other, run `npx expo start --tunnel`.

`mobile/.env` chooses the data source with `EXPO_PUBLIC_API_MODE`. It is currently **`supabase`** (the live backend). Set it to `mock` for the offline demo database.

**Demo accounts on the live backend:**

| Role | Email | Password |
|---|---|---|
| Trader | `demo.trader@example.com` | `Trader#Demo2026` |
| Admin | `mahmedmasud9@gmail.com` | `Admin#Secure2026` |

**Demo accounts in mock mode** (the login screen has one-tap fill buttons): `trader@demo.com` / `Trader@123` and `admin@demo.com` / `Admin@123`.

New sign-ups on the live backend get a 6-digit verification code by email. Password resets use an emailed code too.

The demo trader has 78 seeded trades with patterns built in for the AI to find: Breakout is strong, Scalping is weak, the Asian session is poor, and emotional trades lose more often. To restore the seed data, clear the Expo Go app data (or reinstall).

Other commands: `npm run typecheck` · `npm run lint` · `npx expo-doctor` · `npx expo start --web`

---

## Architecture

```
Screens (src/app, Expo Router)
   │  React Query hooks (src/hooks/queries.ts): caching, retries, invalidation
   ▼
ApiClient contract (src/services/api/types.ts)
   ├── mockApi  ← now: local persisted DB that enforces the same rules as the backend
   └── supabaseApi ← phase 2: Supabase Auth / PostgREST / Storage / Edge Functions
                         └── Edge Function → Gemini (API key stays on the server)
```

- The UI depends only on the `ApiClient` interface. To switch to the backend, set `EXPO_PUBLIC_API_MODE=supabase`. No screen code changes.
- The model field names in `src/types/models.ts` match the planned Postgres columns.
- `mock/aiEngine.ts` returns the same structured JSON the Gemini Edge Function will return: summary, strengths, weaknesses, patterns, risk, improvements and questions. `buildAnalysisPayload()` is the de-identified payload that will be sent to Gemini.

```
mobile/src/
  app/            routes: (auth), (trader)/(tabs), admin/(tabs), account, about
  components/     ui/ (cards, states, dialogs), charts/ (SVG), form/, trading/, profile/, brand/
  hooks/          React Query hooks
  lib/            validation (Zod), security, stats engine, logger, storage, network, CSV
  providers/      Auth, Theme, Query, Toast
  services/api/   contract, errors, mock implementation + seed + AI engine
```

---

## Features

**Trader:** splash screen and authentication · Home dashboard (8 KPIs, P/L chart with 7D to All ranges, quick actions, AI summary, recent trades) · Journal (search, quick and advanced filters, virtualised list, FAB) · Add/Edit trade (validated form, auto-calculated R:R, risk, reward and P/L, screenshot upload) · Trade details (edit, delete with confirmation, "Analyze This Trade") · Analytics (12 metrics, 7 charts, 4 filters) · AI Insights (period selector, daily quota, progress steps, sectioned results, disclaimer) · Analysis history · Goals (6 auto-tracked metrics plus custom) · Notifications · Profile, settings, privacy, CSV export · Light/dark theme.

**Admin:** Dashboard (system statistics, DAU/WAU/MAU, 4 charts) · User management (search, filter, activate/deactivate with confirmation; admin accounts are protected) · Aggregated trading data · AI monitoring (service status, usage, recent requests) · Reports (4 types, CSV export) · System settings (AI kill-switch, limits, maintenance mode) · Profile.

---

## Security checklist

| Area | Frontend | Backend (live) |
|---|---|---|
| **Validation** | Zod schemas on every form, including cross-field rules (SL/TP side, P/L vs result). The API layer re-validates and sanitises inputs. | Postgres `CHECK` constraints, Edge Function validation of every payload and of the Gemini response |
| **Auth** | Tokens stored in Keychain/Keystore (`expo-secure-store`), `sessionStorage` on web. Access-token expiry with refresh rotation. Lockout after 5 failed logins. Password reset responses don't reveal whether an account exists. Auto sign-out after inactivity. Cache cleared on logout. Other sessions revoked on password change. | Supabase Auth (bcrypt, JWT), email verification, leaked-password protection |
| **Authorization** | Role-guarded routes (`Stack.Protected`). The mock API enforces ownership like RLS: another user's row returns *not found*. | **Row Level Security** on every table, role from `profiles` (never trusted from the client), admin endpoints only via SECURITY DEFINER aggregate views |
| **Rate limiting** | Sliding-window limits on login, sign-up, password reset, writes, uploads and AI. Daily AI quota. No automatic retries on AI calls. | Per-user limits in Edge Functions plus the Supabase Auth rate limits |
| **Secrets** | No secrets in the app. `.env` is gitignored, `EXPO_PUBLIC_*` holds only public values. | `GEMINI_API_KEY` kept in Edge Function secrets only |
| **CSP / headers** | CSP meta tag (`public/index.html`). HSTS, X-Frame-Options, Permissions-Policy and others in `public/_headers`. | Same headers on the web host |
| **Caching** | React Query: stale-while-revalidate, offline pause and resume, refetch on focus, optimistic settings updates. Long-lived cache for fingerprinted static assets. | Postgres indexes, cached aggregate views |
| **SEO** (web) | Title and meta per route, Open Graph, JSON-LD, `robots.txt`, `noindex` on admin pages | — |
| **Monitoring / logs** | Structured logger with PII and secret redaction, breadcrumbs, error boundary, slow-call detection, pluggable sink (Sentry-ready). The mock API keeps an audit log. | `audit_logs` table (auth, admin actions, AI calls), Edge Function logs, AI usage table |
| **Privacy** | Admins see aggregates only. Emails are masked in reports. Users choose what the AI can read. CSV export neutralises formula injection. | Private storage bucket with signed URLs, data export and deletion |
| **UX** | Loading skeletons, error states with retry, empty states, offline banner, confirmation dialogs, accessibility labels | — |
| **Backups / pooling** | — | Supavisor-managed pooling (PostgREST and Edge Functions). Backups depend on the plan: see [supabase/README.md](supabase/README.md#operations) |

The backend column is **implemented and live**. The full security model and the 38 live security tests are described in [supabase/README.md](supabase/README.md).

---

## Disclaimer

> AI-generated insights are based on the trading data recorded in this journal and are provided for educational and analytical purposes only. They are not guaranteed financial advice or a recommendation to buy or sell any financial instrument.
