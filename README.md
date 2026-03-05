# 🧠 Open Brain Ingester — EBFC AI

Vercel-hosted frontend + API that accepts text/URL/file submissions, queues them in a Supabase `inbox` table, and lets the Mac Mini process them locally with Ollama embeddings.

## Architecture

```
Browser (index.html on Vercel)
  │
  ├── POST /api/ingest  ──►  Supabase inbox table (pending)
  ├── GET  /api/health  ──►  Health check
  └── GET  /api/recent  ──►  Recent items from inbox

Mac Mini (inbox-watcher.py — running locally)
  │
  ├── Poll inbox WHERE status='pending'
  ├── Embed chunks with Ollama (nomic-embed-text, 768-dim)
  ├── Insert into public.thoughts (content, embedding, metadata)
  └── Mark inbox item → processed
```

## Live URLs

| URL | Status |
|-----|--------|
| https://ebfc-brain-ingest.vercel.app | ✅ Live (production) |
| https://ingest.ebfc.ai | ⏳ Pending DNS (see below) |

## GitHub

- **Repo:** https://github.com/felipe-ebfc/ebfc-brain-ingest
- **Branches:** `main` (production) · `dev` (development)

---

## ⚠️ Manual Step: DNS for ingest.ebfc.ai

Add this record in Cloudflare (ebfc.ai zone → DNS → Add record):

| Type | Name   | Value        | Proxy |
|------|--------|--------------|-------|
| A    | ingest | 76.76.21.21  | ✅ Proxied |

Once added, `https://ingest.ebfc.ai` will serve the ingester.

---

## Supabase Schema

Run `schema.sql` in the Supabase SQL Editor:
- **Project:** https://otoywcdcndvpuekvenhv.supabase.co
- **Table:** `public.inbox` (id, content, source_type, metadata, status, created_at)

---

## Running the Mac Mini Watcher

```bash
# Install deps
pip install supabase requests

# Set env vars (or use .env + python-dotenv)
export SUPABASE_URL=https://otoywcdcndvpuekvenhv.supabase.co
export SUPABASE_SERVICE_KEY=your_key_here
export OLLAMA_URL=http://localhost:11434
export EMBED_MODEL=nomic-embed-text

# Run
cd /Volumes/Osito2T/Projects/ebfc-brain-ingest
python3 scripts/inbox-watcher.py
```

To run as a background launchd service on Mac, create:
`~/Library/LaunchAgents/ai.ebfc.brain-watcher.plist`

---

## Environment Variables (Vercel — already set)

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | https://otoywcdcndvpuekvenhv.supabase.co |
| `SUPABASE_SERVICE_KEY` | *(set in Vercel dashboard — do not commit)* |

---

## Mode Toggle (index.html)

The frontend **auto-detects** the mode:
- **localhost / 127.0.0.1** → Local Mode (POST to `localhost:7788`)
- **Any other host** → Cloud Mode (POST to `/api/ingest`)

The toggle in the header lets you override manually.
