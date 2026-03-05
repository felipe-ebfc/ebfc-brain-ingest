// api/recent.js — Returns recent inbox items for the right-panel feed

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SOURCE_ICON = {
  text: '📝',
  url:  '🔗',
  file: '📄',
};

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  return `${days}d ago`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).end();

  try {
    // Recent items from inbox
    const { data: items, error } = await supabase
      .from('inbox')
      .select('id, content, source_type, metadata, status, created_at')
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    // Stats
    const { count: totalCount } = await supabase
      .from('inbox')
      .select('*', { count: 'exact', head: true });

    const { count: pendingCount } = await supabase
      .from('inbox')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const formatted = (items || []).map(item => {
      const meta = item.metadata || {};
      let name = meta.filename
        || meta.url
        || meta.source
        || item.content.slice(0, 60).replace(/\n/g, ' ');
      if (name.length > 60) name = name.slice(0, 57) + '…';

      return {
        id:     item.id,
        name,
        icon:   SOURCE_ICON[item.source_type] || '📎',
        time:   timeAgo(item.created_at),
        status: item.status,
      };
    });

    return res.status(200).json({
      ok:      true,
      items:   formatted,
      total:   totalCount   || 0,
      pending: pendingCount || 0,
    });

  } catch (err) {
    console.error('Recent error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
