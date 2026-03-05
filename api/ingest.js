// api/ingest.js — Vercel Serverless Function
// Accepts POST with JSON body, stores raw content in Supabase inbox table.
// Mac Mini watcher then embeds + moves to thoughts table.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Chunk text into ~500-token pieces (≈ 2000 chars each).
 * Returns array of string chunks.
 */
function chunkText(text, charsPerChunk = 2000) {
  const chunks = [];
  // Split on paragraph boundaries first, then hard-chunk remaining
  const paragraphs = text.split(/\n{2,}/);
  let current = '';

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length <= charsPerChunk) {
      current = current ? current + '\n\n' + para : para;
    } else {
      if (current) chunks.push(current.trim());
      // If single paragraph > limit, hard split
      if (para.length > charsPerChunk) {
        let i = 0;
        while (i < para.length) {
          chunks.push(para.slice(i, i + charsPerChunk));
          i += charsPerChunk;
        }
        current = '';
      } else {
        current = para;
      }
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.filter(c => c.length > 0);
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = req.body;

    if (!body) {
      return res.status(400).json({ ok: false, error: 'Empty request body' });
    }

    const { text, url, source, category, files } = body;

    if (!text && !url && (!files || files.length === 0)) {
      return res.status(400).json({ ok: false, error: 'No content provided' });
    }

    const metadata = {
      source:   source   || null,
      category: category || null,
      url:      url      || null,
      ingested_via: 'vercel',
      ingested_at: new Date().toISOString(),
    };

    const rows = [];

    // ── Text chunk ──────────────────────────────────────────────
    if (text) {
      const chunks = chunkText(text);
      for (const chunk of chunks) {
        rows.push({
          content:     chunk,
          source_type: url ? 'url' : 'text',
          metadata:    { ...metadata, chunk_of: chunks.length },
          status:      'pending',
        });
      }
    } else if (url && !text) {
      // URL only — store URL as content for watcher to fetch & embed
      rows.push({
        content:     url,
        source_type: 'url',
        metadata,
        status:      'pending',
      });
    }

    // ── Files ────────────────────────────────────────────────────
    if (files && files.length > 0) {
      for (const file of files) {
        // file: { name, type, content } — content is base64 or plain text
        const fileContent = file.content_text || `[FILE:${file.name}] ${file.content_preview || ''}`;
        rows.push({
          content:     fileContent,
          source_type: 'file',
          metadata:    { ...metadata, filename: file.name, mime_type: file.type },
          status:      'pending',
        });
      }
    }

    if (rows.length === 0) {
      return res.status(400).json({ ok: false, error: 'No processable content extracted' });
    }

    // ── Insert into inbox ────────────────────────────────────────
    const { data, error } = await supabase
      .from('inbox')
      .insert(rows)
      .select('id, created_at');

    if (error) {
      console.error('Supabase insert error:', error);
      return res.status(500).json({ ok: false, error: 'Database error: ' + error.message });
    }

    return res.status(200).json({
      ok:       true,
      message:  `Queued ${rows.length} chunk${rows.length !== 1 ? 's' : ''} for embedding. Mac Mini will process shortly.`,
      chunks:   rows.length,
      ids:      data.map(r => r.id),
      queued_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('Ingest error:', err);
    return res.status(500).json({ ok: false, error: 'Server error: ' + err.message });
  }
}
