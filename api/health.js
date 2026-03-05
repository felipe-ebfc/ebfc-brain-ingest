// api/health.js — Vercel health check endpoint

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  return res.status(200).json({
    ok:      true,
    message: 'Brain Ingest API online (Vercel)',
    env:     process.env.SUPABASE_URL ? 'configured' : 'missing env vars',
    ts:      new Date().toISOString(),
  });
}
