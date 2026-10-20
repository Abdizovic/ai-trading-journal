# Backend (Supabase)

Project: **Ai journal** · ref `gzkllnwjxwalnedfljag` · region eu-central-1 · Postgres 17

```
supabase/
  migrations/                  applied in order (all already applied to the live project)
    ..._core_schema.sql        tables, constraints, indexes, triggers, grants, RLS
    ..._admin_and_rpc.sql      admin aggregate functions, ai_quota()
    ..._storage.sql            buckets + storage policies
    ..._harden_helpers.sql     advisor fixes (helpers moved to non-exposed schema)
    ..._fix_ban_timestamp.sql  deactivation uses a far-future ban date
  functions/
    analyze-performance/       Gemini AI analysis (Edge Function, deployed)
    _shared/analysis.ts        statistics + de-identified payload + response validation
  sql/
    promote_admin.sql          make an existing account an administrator
    remove_demo_data.sql       delete the demo accounts and all their data
```

## Remaining setup: the Gemini API key

The Edge Function is deployed, but it returns "AI analyst is not configured" until the key is set. The key must **never** go in the app or in `EXPO_PUBLIC_*`. Set it as a server secret using either option:

- **Dashboard:** Project → Edge Functions → Secrets → add `GEMINI_API_KEY`
- **CLI** (from the project root):
  ```bash
  npx supabase secrets set GEMINI_API_KEY=your-key --project-ref gzkllnwjxwalnedfljag
  # optional: pin a model (default gemini-3.8-flash; falls back to 3.5-flash, flash-latest, 3-flash-preview)
  npx supabase secrets set GEMINI_MODEL=gemini-3.8-flash --project-ref gzkllnwjxwalnedfljag
  ```

No redeploy is needed. Secrets are read on the next request.

## Deploying changes

```bash
# Edge Function (no Docker needed)
npx supabase functions deploy analyze-performance --project-ref gzkllnwjxwalnedfljag --use-api
```

For a new migration, add a file to `migrations/` and run it in the SQL editor, or with `npx supabase db push` once the CLI is linked.

## Demo accounts (live backend)

| Role | Email | Password |
|---|---|---|
| Trader (78 trades, 4 goals) | `demo.trader@example.com` | `Trader#Demo2026` |
| Admin | `mahmedmasud9@gmail.com` | `Admin#Secure2026` |

`example.com` is a reserved domain that can never receive email. Remove these accounts before real users join (`sql/remove_demo_data.sql`).

## Security model

| Layer | What is enforced |
|---|---|
| **Auth** | Email and password with 6-digit email verification. Password policy: 8+ characters with upper and lower case, a digit and a symbol. 1-hour JWTs with refresh-token rotation. Custom SMTP (Gmail). Codes expire after 30 minutes. |
| **RLS** | Enabled on every table. Traders can read and write only rows where `user_id = auth.uid()`, and only while their account is active (`private.can_use_app()`, which also enforces maintenance mode). |
| **Privileges** | `anon` has no table access. `authenticated` can UPDATE only specific columns: a user can never change their own `role`, `status`, `user_id` or timestamps. |
| **Roles** | Every new account is created as `trader` by a trigger, and any client-supplied role is ignored. Admins can only be created with SQL (`sql/promote_admin.sql`). |
| **Admin access** | Only through SECURITY DEFINER RPCs that call `private.assert_admin()` and return aggregates. Admins have **no** access to raw trade rows, notes, emotions or screenshots. |
| **Deactivation** | `admin_set_user_status` bans the auth user, revokes all their sessions, and cuts off data access immediately through RLS. Admin accounts can't be deactivated this way. |
| **Validation** | CHECK constraints: prices > 0, stop loss and take profit on the correct side of the entry, result matching the sign of P/L, no future dates, pair format, and text length limits. |
| **Rate limits** | 30 trades per minute per user (DB trigger). AI: per-user daily quota (admin-configurable) and 5 per hour (Edge Function). Auth: Supabase's built-in limits plus 30 emails per hour. |
| **Storage** | `trade-screenshots` is private and served through 1-hour signed URLs. `avatars` is public-read. Writes are allowed only inside the user's own `<uid>/` folder. Buckets enforce size and MIME limits. |
| **AI** | The Gemini key lives only in Edge Function secrets. The payload contains no names, emails or IDs, and journal text is sent only if the user allows it (AI Settings). The model's output is validated and sanitised before it's stored. |
| **Audit** | `audit_logs` records sign-up, login, trade deletes, admin status changes, settings changes, reports and AI calls. No API role can read or write it directly. |
| **Advisors** | Supabase's security advisor is clean apart from two by-design items: the admin RPCs are intentionally callable, and leaked-password protection needs the Pro plan. |

Live tests (38 checks) covered cross-user reads, updates, deletes and inserts, privilege escalation, forged AI rows, anonymous REST access, constraint rejection, admin privacy, and deactivation (sign-in blocked, data access cut, audit written).

## Operations

- **Connection pooling:** the app talks to Postgres only through PostgREST and the Edge Functions, which use Supabase's managed pool (Supavisor). If you add a server that uses a direct Postgres driver, use the pooler connection string (port 6543) rather than `db.<ref>.supabase.co:5432`.
- **Backups:** the Free plan has no downloadable backups. On Pro, daily backups are kept for 7 days and point-in-time recovery is available as an add-on. Until then, take manual logical backups: `npx supabase db dump --db-url "$SUPABASE_DB_URL" -f backup.sql` (and `--data-only` for data).
- **Logs:** Edge Function logs are structured JSON (Dashboard → Edge Functions → Logs). Auth and Postgres logs are in the dashboard Logs Explorer. App-level events are in `audit_logs`.
- **Plan-gated hardening** to enable on Pro: leaked-password protection (HaveIBeenPwned), session inactivity timeout, point-in-time recovery.
