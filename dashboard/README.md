# dashboard/

Interactive dashboard — **Next.js (App Router)** deployed to **Vercel**, reading
from Supabase. Ranks extensions (highest / lowest) and surfaces the **~3★
opportunity zone** plus Claude-scored opportunities.

## Local dev

```bash
cd dashboard
npm install
cp .env.example .env.local          # fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm run dev                         # http://localhost:3000
```

The page renders fine with no credentials (it shows a setup banner), so the
build never depends on Supabase being configured.

## Deploy on Vercel  (this fixes the failed build)

The earlier build failed because Vercel was pointed at the stale feature branch
and tried to run `vite build`. Set the project up like this:

1. **Root Directory:** `dashboard`  (Project → Settings → Build & Deployment).
2. **Framework Preset:** Next.js (auto-detected once Root Directory is `dashboard`).
3. **Build Command / Install Command:** leave as the Next.js defaults — **remove
   any `vite build` override**.
4. **Production Branch:** `main`  (Settings → Git) — *not* the `claude/...` branch.
5. **Environment Variables** (server-side; do NOT prefix with `NEXT_PUBLIC_`):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   (RLS is locked to the service role, so the dashboard reads with it server-side.)
6. Redeploy.

> If you used the Vercel ↔ Supabase integration, `SUPABASE_URL` /
> `SUPABASE_SERVICE_ROLE_KEY` may already be present — just confirm they're set
> for Production.

## Data it reads

`extensions` (rankings + opportunity zone), `reviews` (counts), and
`opportunities` (Claude's scored shortlist). Apply
`supabase/migrations/999_initial_schema.sql` first; rows appear once the scraper
and ranking layer have run.
