// api/provision.js — EBFC AI Provisioning Glue Route
// POST /api/provision
//
// Receives intake JSON from the signup form, validates it, writes it to
// public.intakes, then queues a provisioning job in public.provision_queue.
// The Mac Mini provision_watcher.py picks up the queue record and does the
// actual workspace/container creation.
//
// Required body fields:
//   email, name, ai_name
// Optional:
//   role, domain, timezone, language, ai_vibe, goals, priorities, friction

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY;

const VALID_DOMAINS  = ['construction','business','creative','science','engineering','education','tech','other'];
const REQUIRED_FIELDS = ['email', 'name', 'ai_name'];

// Estimated provisioning time in minutes (shown to user)
const EST_MINUTES = 5;

/**
 * Normalise and validate the raw request body.
 * Returns { ok, errors, data }
 */
function validateIntake(raw) {
  const errors = [];

  // Required
  for (const f of REQUIRED_FIELDS) {
    if (!raw[f] || !String(raw[f]).trim()) {
      errors.push(`Missing required field: ${f}`);
    }
  }

  // Email format
  if (raw.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email)) {
    errors.push('Invalid email address');
  }

  // Domain normalisation (not required — defaults to 'other')
  const domain = VALID_DOMAINS.includes(raw.domain) ? raw.domain : 'other';

  if (errors.length > 0) return { ok: false, errors };

  const data = {
    email:     String(raw.email).toLowerCase().trim(),
    name:      String(raw.name).trim(),
    ai_name:   String(raw.ai_name).trim(),
    domain,
    role:      raw.role      ? String(raw.role).trim()      : null,
    timezone:  raw.timezone  ? String(raw.timezone).trim()  : 'America/Los_Angeles',
    language:  raw.language  ? String(raw.language).trim()  : 'en',
    ai_vibe:   raw.ai_vibe   ? String(raw.ai_vibe).trim()   : null,
    goals:     raw.goals     ? String(raw.goals).trim()     : null,
    priorities:raw.priorities? String(raw.priorities).trim(): null,
    friction:  raw.friction  ? String(raw.friction).trim()  : null,
  };

  return { ok: true, data };
}

export default async function handler(req, res) {
  // ── CORS ────────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // ── Config guard ─────────────────────────────────────────────────────────────
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
    return res.status(500).json({ ok: false, error: 'Server configuration error' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ ok: false, error: 'Request body must be JSON' });
    }

    // ── Validate ───────────────────────────────────────────────────────────────
    const validation = validateIntake(body);
    if (!validation.ok) {
      return res.status(422).json({ ok: false, errors: validation.errors });
    }

    const intake = validation.data;

    // ── Duplicate check ────────────────────────────────────────────────────────
    const { data: existing } = await supabase
      .from('intakes')
      .select('id, status, created_at')
      .eq('email', intake.email)
      .not('status', 'eq', 'error')    // allow re-attempt after error
      .maybeSingle();

    if (existing) {
      const statusMsg = existing.status === 'active'
        ? 'Your AI companion is already active!'
        : `Your provisioning is already in progress (status: ${existing.status}).`;
      return res.status(409).json({
        ok:      false,
        error:   'duplicate',
        message: statusMsg,
        intake_id: existing.id,
        status:  existing.status,
      });
    }

    // ── Insert intake record ───────────────────────────────────────────────────
    const { data: intakeRow, error: intakeErr } = await supabase
      .from('intakes')
      .insert({
        ...intake,
        status: 'pending',
      })
      .select('id')
      .single();

    if (intakeErr) {
      console.error('intakes insert error:', intakeErr);
      return res.status(500).json({ ok: false, error: 'Failed to store intake: ' + intakeErr.message });
    }

    const intakeId = intakeRow.id;

    // ── Queue provisioning job ─────────────────────────────────────────────────
    const { error: queueErr } = await supabase
      .from('provision_queue')
      .insert({
        intake_id: intakeId,
        action:    'full',         // full = provision + seed + start
        domain:    intake.domain,
        status:    'pending',
      });

    if (queueErr) {
      // Non-fatal: intake is saved, but we log the queue failure
      console.error('provision_queue insert error:', queueErr);
      // Revert intake to error state so ops can retry
      await supabase
        .from('intakes')
        .update({ status: 'error' })
        .eq('id', intakeId);

      return res.status(500).json({ ok: false, error: 'Failed to queue provisioning job: ' + queueErr.message });
    }

    // ── Done ───────────────────────────────────────────────────────────────────
    console.log(`✅ Intake queued — id=${intakeId}, email=${intake.email}, domain=${intake.domain}`);

    return res.status(200).json({
      ok:          true,
      intake_id:   intakeId,
      message:     `Welcome, ${intake.name}! Your AI companion "${intake.ai_name}" is being set up.`,
      est_minutes: EST_MINUTES,
      next_step:   'Check your email for your access link once provisioning is complete.',
    });

  } catch (err) {
    console.error('provision handler error:', err);
    return res.status(500).json({ ok: false, error: 'Server error: ' + err.message });
  }
}
