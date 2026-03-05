#!/usr/bin/env python3
"""
inbox-watcher.py — Mac Mini side of the Brain Ingest pipeline.

Polls Supabase inbox table for pending items, embeds them with Ollama
(nomic-embed-text, 768-dim), chunks if needed, writes to public.thoughts,
and marks inbox item as processed.

Usage:
  pip install supabase requests
  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python3 inbox-watcher.py

Or set vars in a .env file and load with python-dotenv.

Runs as a loop — Ctrl+C to stop.
Schedule via cron or launchd for persistent background service.
"""

import os
import time
import json
import requests
from datetime import datetime
from supabase import create_client, Client

# ── Config ────────────────────────────────────────────────────────
SUPABASE_URL     = os.environ.get('SUPABASE_URL', 'https://otoywcdcndvpuekvenhv.supabase.co')
SUPABASE_KEY     = os.environ.get('SUPABASE_SERVICE_KEY', '')
OLLAMA_URL       = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
EMBED_MODEL      = os.environ.get('EMBED_MODEL', 'nomic-embed-text')  # 768-dim
POLL_INTERVAL    = int(os.environ.get('POLL_INTERVAL', '10'))         # seconds
BATCH_SIZE       = int(os.environ.get('BATCH_SIZE', '5'))             # items per cycle
CHUNK_CHARS      = int(os.environ.get('CHUNK_CHARS', '2000'))         # ~500 tokens

# ── Init ──────────────────────────────────────────────────────────
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def chunk_text(text: str, max_chars: int = CHUNK_CHARS) -> list[str]:
    """Split text into ~500-token chunks at paragraph boundaries."""
    paragraphs = text.split('\n\n')
    chunks, current = [], ''
    for para in paragraphs:
        combined = (current + '\n\n' + para) if current else para
        if len(combined) <= max_chars:
            current = combined
        else:
            if current:
                chunks.append(current.strip())
            # Hard-split oversized paragraphs
            while len(para) > max_chars:
                chunks.append(para[:max_chars])
                para = para[max_chars:]
            current = para
    if current:
        chunks.append(current.strip())
    return [c for c in chunks if c]


def embed(text: str) -> list[float] | None:
    """Call Ollama to get 768-dim embedding via nomic-embed-text."""
    try:
        r = requests.post(
            f'{OLLAMA_URL}/api/embeddings',
            json={'model': EMBED_MODEL, 'prompt': text},
            timeout=30,
        )
        r.raise_for_status()
        return r.json()['embedding']
    except Exception as e:
        print(f'  ⚠️  Ollama embed error: {e}')
        return None


def process_item(item: dict) -> bool:
    """
    Process a single inbox item:
    1. Chunk content
    2. Embed each chunk
    3. Insert into public.thoughts
    4. Mark inbox item processed
    Returns True on success.
    """
    item_id = item['id']
    content = item['content']
    meta    = item.get('metadata') or {}
    src_type = item.get('source_type', 'text')

    print(f'\n  📥 Processing {item_id[:8]}… [{src_type}] {content[:60].replace(chr(10)," ")}…')

    # Mark as processing (claim the item)
    supabase.table('inbox').update({
        'status': 'processing',
    }).eq('id', item_id).execute()

    chunks = chunk_text(content)
    thought_ids = []

    for i, chunk in enumerate(chunks):
        print(f'     Chunk {i+1}/{len(chunks)} ({len(chunk)} chars) → embedding…', end='', flush=True)
        vector = embed(chunk)
        if vector is None:
            print(' ❌ embed failed')
            supabase.table('inbox').update({
                'status':    'error',
                'error_msg': 'Ollama embedding failed',
            }).eq('id', item_id).execute()
            return False

        thought_meta = {
            **meta,
            'inbox_id':   item_id,
            'chunk_index': i,
            'chunk_total': len(chunks),
            'source_type': src_type,
        }

        result = supabase.table('thoughts').insert({
            'content':    chunk,
            'embedding':  vector,
            'metadata':   thought_meta,
        }).execute()

        if result.data:
            thought_ids.append(result.data[0]['id'])
        print(f' ✅')

    # Mark processed
    supabase.table('inbox').update({
        'status':       'processed',
        'processed_at': datetime.utcnow().isoformat() + 'Z',
        'metadata':     {**meta, 'thought_ids': thought_ids},
    }).eq('id', item_id).execute()

    print(f'  ✅ Done — {len(chunks)} chunk(s) → thoughts table')
    return True


def poll_loop():
    print(f'🧠 Brain Inbox Watcher started')
    print(f'   Supabase: {SUPABASE_URL}')
    print(f'   Ollama:   {OLLAMA_URL} [{EMBED_MODEL}]')
    print(f'   Polling every {POLL_INTERVAL}s  •  batch size {BATCH_SIZE}')
    print()

    while True:
        try:
            # Fetch pending items
            result = supabase.table('inbox') \
                .select('id, content, source_type, metadata') \
                .eq('status', 'pending') \
                .order('created_at') \
                .limit(BATCH_SIZE) \
                .execute()

            items = result.data or []
            if items:
                print(f'⚡ {len(items)} pending item(s) found')
                for item in items:
                    try:
                        process_item(item)
                    except Exception as e:
                        print(f'  ❌ Item {item["id"][:8]} failed: {e}')
                        supabase.table('inbox').update({
                            'status':    'error',
                            'error_msg': str(e),
                        }).eq('id', item['id']).execute()
            else:
                print(f'💤 Polling… [{datetime.now().strftime("%H:%M:%S")}]', end='\r', flush=True)

        except KeyboardInterrupt:
            print('\n\n👋 Watcher stopped.')
            break
        except Exception as e:
            print(f'\n⚠️  Poll error: {e}')

        time.sleep(POLL_INTERVAL)


if __name__ == '__main__':
    poll_loop()
