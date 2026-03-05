-- ════════════════════════════════════════════════════════════════
-- EBFC Brain Ingest — Supabase Schema
-- Run this in the Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════

-- inbox table: receives raw submissions from Vercel frontend
-- Mac Mini watcher polls this, embeds with Ollama, writes to thoughts
CREATE TABLE IF NOT EXISTS public.inbox (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  content      TEXT        NOT NULL,
  source_type  TEXT        DEFAULT 'text',   -- 'text' | 'url' | 'file'
  metadata     JSONB       DEFAULT '{}',     -- source, category, filename, url, etc.
  status       TEXT        DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'error')),
  error_msg    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- Index for the watcher to quickly find pending items
CREATE INDEX IF NOT EXISTS idx_inbox_status_created
  ON public.inbox (status, created_at);

-- Row Level Security (optional but recommended)
ALTER TABLE public.inbox ENABLE ROW LEVEL SECURITY;

-- Allow service key to do everything (server-side)
CREATE POLICY "service_full_access" ON public.inbox
  USING (true)
  WITH CHECK (true);

-- ── Reference: existing thoughts table structure ──────────────────
-- CREATE TABLE IF NOT EXISTS public.thoughts (
--   id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
--   content    TEXT        NOT NULL,
--   embedding  vector(768),
--   metadata   JSONB       DEFAULT '{}',
--   created_at TIMESTAMPTZ DEFAULT NOW()
-- );
