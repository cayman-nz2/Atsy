// AI-written bullet suggestions. Never scoring.
//
// Five rules from docs/SCORING-SPEC.md §6, each enforced here rather than
// hoped for:
//
//  1. Redaction first. Name, email, phone, URLs and employers are replaced
//     before the text leaves the Worker. The model never receives identity.
//  2. Bullet-level only. One bullet at a time, from its own text plus the
//     check it triggered. The model never sees the whole CV and never writes
//     one.
//  3. No invention. The prompt forbids adding facts. A bullet with no metric
//     comes back with a [add number] placeholder for the reader to fill, never
//     a number the model made up.
//  4. Labelled. Every suggestion is shown as a suggestion, and is copied by
//     the reader rather than applied by us.
//  5. Budgeted. When the daily budget is spent the product still works
//     completely: suggestions fall back to a deterministic template.

import { json, err, nowSec } from './util.js';

export const MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const FALLBACK_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';

// Workers AI gives 10,000 neurons a day free. The budget stops well short so a
// busy day cannot turn into a bill, and so the fallback path is exercised in
// the real world rather than only in a test.
export const DAILY_NEURON_BUDGET = 8000;
// A rough cost per rewrite, used to reserve budget before the call. Being
// approximate is fine; being unbounded is not.
const NEURONS_PER_REWRITE = 12;
export const MAX_BULLETS_PER_REQUEST = 10;
export const PER_USER_DAILY_REWRITES = 40;

// The checks a rewrite can help with. Anything else is a structural problem
// that better wording cannot fix, and offering a rewrite would be a lie.
export const REWRITABLE = ['D02', 'D03', 'D04', 'D06'];

const GUIDANCE = {
  D02: 'It does not start with an action verb.',
  D03: 'It contains no number, so nothing shows the scale or the result.',
  D04: 'It is outside the 8-30 word range.',
  D06: 'It uses filler phrasing instead of saying what changed.',
};

/**
 * Replace identity with placeholders.
 *
 * Order matters: emails and URLs are removed before the name, because a name
 * inside an email address must not leave a bare local-part behind. Employers
 * come from the parsed roles, so a company name the model could search for
 * never reaches it.
 */
export function redact(text, identity = {}) {
  let out = String(text || '');

  out = out.replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[email]');
  out = out.replace(/\bhttps?:\/\/\S+/gi, '[link]');
  out = out.replace(/\b(?:www\.)?[\w-]+\.(?:com|net|org|io|co|dev|me|app|ai|nz|uk|au)(?:\.[a-z]{2})?(?:\/\S*)?/gi, '[link]');
  out = out.replace(/\+?\d[\d\s().-]{6,}\d/g, '[phone]');

  for (const employer of (identity.employers || [])) {
    if (!employer || employer.length < 3) continue;
    out = out.replace(new RegExp(escapeRegExp(employer), 'gi'), '[employer]');
  }
  if (identity.name && identity.name.length > 2) {
    out = out.replace(new RegExp(escapeRegExp(identity.name), 'gi'), '[name]');
    // Also the parts, so "Priya reduced…" does not survive a full-name match.
    for (const part of identity.name.split(/\s+/)) {
      if (part.length > 2) out = out.replace(new RegExp(`\\b${escapeRegExp(part)}\\b`, 'g'), '[name]');
    }
  }
  return out;
}

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The suggestion shown when AI is unavailable. Never a fabricated metric. */
export function templateRewrite(bullet, checkId) {
  const asks = [];
  if (checkId === 'D02') asks.push('start with what you did — Led, Built, Reduced, Delivered');
  if (checkId === 'D03') asks.push('add the number: how many, how much, how fast, how much better');
  if (checkId === 'D04') asks.push('cut it to one idea, 8 to 30 words');
  if (checkId === 'D06') asks.push('replace the filler with what actually changed');
  return {
    suggestion: null,
    guidance: `Rewrite this so it opens with a verb and ends with a result — ${asks.join('; ')}.`,
    source: 'template',
  };
}

const PROMPT = [
  'You rewrite one bullet point from a CV. Reply with the rewritten bullet and nothing else.',
  'Rules you must not break:',
  '- Do not invent facts, numbers, employers, dates or job titles.',
  '- If the bullet has no number and one would help, write the literal text [add number] where it belongs.',
  '- Keep it to one sentence of 8 to 30 words.',
  '- Start with a past-tense action verb.',
  '- Do not use first-person pronouns.',
  '- Placeholders like [name], [employer], [link] must be left exactly as they are.',
].join('\n');

/** Ask the model for one rewrite. Returns null on any failure. */
async function askModel(env, redacted, checkId, model) {
  const response = await env.AI.run(model, {
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: `Problem with this bullet: ${GUIDANCE[checkId] || 'it could be stronger.'}\n\nBullet: ${redacted}` },
    ],
    // Deterministic settings, so the same bullet gives a stable suggestion and
    // the cost stays predictable.
    temperature: 0.2,
    max_tokens: 120,
  });
  const text = (response && (response.response || response.result || '')).toString().trim();
  if (!text) return null;
  return firstUsableBullet(text);
}

// Chat models preface things. "Sure! Here are some thoughts:" is a valid first
// line and a completely invalid CV bullet, and showing it to the reader as
// their rewrite would be worse than showing nothing — so a line has to look
// like a bullet before it is offered as one.
const PREAMBLE = /^(sure|certainly|of course|here (?:is|are)|okay|ok|absolutely|i'?d be happy|rewritten|revised|suggestion|note)/i;

export function firstUsableBullet(text) {
  // Reasoning models (the fallback is one) narrate before they answer, inside
  // <think> blocks. Those lines are ordinary prose of ordinary length, so every
  // test below passes them and the reader would be shown the model's working
  // out as their CV bullet. Drop the block first — including an unclosed one,
  // which is what a response truncated at max_tokens leaves behind.
  const thought = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '');
  const lines = thought.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const cleaned = line
      .replace(/^["'“]|["'”]$/g, '')
      .replace(/^[-*•]\s*/, '')
      .replace(/^\d+[.)]\s*/, '')
      .trim();
    if (cleaned.length < 15 || cleaned.length > 400) continue;
    // A trailing colon means the model is introducing something, not saying it.
    if (cleaned.endsWith(':')) continue;
    if (PREAMBLE.test(cleaned)) continue;
    // Markdown headings and emphasis are formatting, not a bullet.
    if (/^[#>*_]/.test(cleaned)) continue;
    return cleaned;
  }
  return null;
}

/** Neurons spent today, from the shared counter. */
export async function spentToday(env, day) {
  const row = await env.DB.prepare('SELECT neurons FROM ai_usage WHERE day = ?').bind(day).first();
  return row ? row.neurons : 0;
}

export const today = () => new Date().toISOString().slice(0, 10);

// Why the suggestions came back deterministic. "model_unavailable" covered
// four different situations and so identified none of them.
function degradedReason(useAi, env, failures) {
  if (!env.AI) return 'no_ai_binding';
  if (!useAi) return 'daily_budget';
  if (failures.some((line) => /no usable line/.test(line))) return 'model_reply_unusable';
  if (failures.length) return 'model_error';
  return 'daily_budget';
}

/**
 * POST /api/scans/:id/rewrite
 *
 * Body: { bullets: [{ text, checkId }] }
 */
export async function rewriteBullets(request, env, user, scanId, body) {
  const scan = await env.DB.prepare('SELECT id, findings_json FROM scans WHERE id = ? AND user_id = ?')
    .bind(scanId, user.id).first();
  if (!scan) return err('not_found', 404);

  const asked = Array.isArray(body && body.bullets) ? body.bullets : [];
  const bullets = asked
    .filter((item) => item && typeof item.text === 'string' && REWRITABLE.includes(item.checkId))
    .slice(0, MAX_BULLETS_PER_REQUEST);
  if (!bullets.length) return err('nothing_to_rewrite', 400);

  const day = today();
  const userUsed = await env.DB
    .prepare('SELECT calls FROM ai_user_usage WHERE user_id = ? AND day = ?')
    .bind(user.id, day).first();
  if (userUsed && userUsed.calls >= PER_USER_DAILY_REWRITES) {
    return json({
      suggestions: bullets.map((bullet) => ({
        ...templateRewrite(bullet.text, bullet.checkId),
        original: bullet.text,
        checkId: bullet.checkId,
      })),
      degraded: true,
      reason: 'your_daily_limit',
      note: 'You have used your AI rewrites for today. The guidance below is the same advice the model works from.',
    });
  }

  const spent = await spentToday(env, day);
  const budgetLeft = DAILY_NEURON_BUDGET - spent;
  const affordable = Math.max(0, Math.floor(budgetLeft / NEURONS_PER_REWRITE));
  const useAi = !!env.AI && affordable > 0;

  // Identity comes from the request, not the database: it was never stored.
  // The reader's browser holds it, and it is sent here only to be removed.
  const identity = (body && body.identity) || {};

  const suggestions = [];
  const failures = [];
  let used = 0;
  for (const bullet of bullets) {
    const redacted = redact(bullet.text, identity);
    const base = { original: bullet.text, redacted, checkId: bullet.checkId };

    if (!useAi || used >= affordable) {
      suggestions.push({ ...base, ...templateRewrite(bullet.text, bullet.checkId) });
      continue;
    }
    let written = null;
    // Which model, and whether it threw or answered with nothing usable. The
    // old line logged neither, so a degraded response in production could not
    // be told apart from a retired model id, an account without Workers AI, or
    // a reply that came back and was rejected here.
    for (const model of [MODEL, FALLBACK_MODEL]) {
      try {
        written = await askModel(env, redacted, bullet.checkId, model);
        if (written) break;
        failures.push(`${model}: no usable line in the reply`);
      } catch (error) {
        failures.push(`${model}: ${(error && error.message) || error}`);
      }
    }
    if (!written) console.log('rewrite failed —', failures.slice(-2).join(' | '));
    used += 1;
    suggestions.push(written
      ? { ...base, suggestion: written, guidance: null, source: 'ai' }
      : { ...base, ...templateRewrite(bullet.text, bullet.checkId) });
  }

  if (used) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO ai_usage (day, neurons) VALUES (?, ?)
         ON CONFLICT(day) DO UPDATE SET neurons = neurons + excluded.neurons`,
      ).bind(day, used * NEURONS_PER_REWRITE),
      env.DB.prepare(
        `INSERT INTO ai_user_usage (user_id, day, calls) VALUES (?, ?, ?)
         ON CONFLICT(user_id, day) DO UPDATE SET calls = calls + excluded.calls`,
      ).bind(user.id, day, used),
    ]);
  }

  const degraded = suggestions.some((item) => item.source === 'template');
  return json({
    suggestions,
    degraded,
    reason: degraded ? degradedReason(useAi, env, failures) : null,
    note: degraded
      ? 'AI suggestions are unavailable right now, so this is the deterministic guidance instead. Nothing else about your scan changes.'
      : null,
    // Shown next to every suggestion, every time.
    label: 'Suggested rewrite — check it is true before you use it.',
    spentToday: spent + (used * NEURONS_PER_REWRITE),
    budget: DAILY_NEURON_BUDGET,
    generatedAt: nowSec(),
  });
}
