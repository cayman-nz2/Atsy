// Feedback, and the owner's view of how Atsy is doing.
//
// The rule that shapes this whole file: **no admin endpoint returns CV
// content.** Not the text, not a finding's evidence, not a filename, not a
// stored file. The owner can see how many people hit a given problem and
// nothing about whose CV it was. A unit test asserts it against every endpoint
// here, because a promise on /privacy that only holds while nobody adds a
// convenient field is not a promise.

import { json, err, nowSec, validEmail, readJson, escapeHtml } from './util.js';
import { isAdmin } from './auth.js';
import { MODEL, FALLBACK_MODEL } from './rewrite.js';
import { notifyOwner } from './notify.js';
import { ALL_CHECKS } from './scoring/index.js';

const FEEDBACK_TYPES = ['bug', 'wrong-score', 'idea', 'other'];
const MAX_MESSAGE = 4000;
const FEEDBACK_PER_HOUR = 5;

/** POST /api/feedback — open to signed-in readers and to anyone else. */
export async function submitFeedback(request, env, ctx, user) {
  const body = await readJson(request);
  if (!body) return err('invalid_request', 400);

  const email = String(body.email || (user && user.email) || '').trim().toLowerCase();
  if (!validEmail(email)) return err('invalid_email', 400);

  const type = FEEDBACK_TYPES.includes(body.type) ? body.type : 'other';
  const message = String(body.message || '').trim();
  if (message.length < 10) return err('message_too_short', 400);
  if (message.length > MAX_MESSAGE) return err('message_too_long', 413);

  const hourAgo = nowSec() - 3600;
  const { count } = await env.DB
    .prepare('SELECT COUNT(*) AS count FROM feedback WHERE email = ? AND created_at > ?')
    .bind(email, hourAgo).first();
  if (count >= FEEDBACK_PER_HOUR) return err('too_many_requests', 429);

  await env.DB.prepare(
    'INSERT INTO feedback (user_id, email, type, message, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(user ? user.id : null, email, type, message, nowSec()).run();

  // The message is untrusted user content. It reaches the owner's inbox as
  // text and is never interpreted as an instruction by anything.
  notifyOwner(env, ctx, `Atsy feedback: ${type}`, [
    `Type: ${type}`,
    `From: ${email}`,
    `Signed in: ${user ? 'yes' : 'no'}`,
    '',
    'Message (verbatim, untrusted):',
    message,
  ], { replyTo: email });

  return json({ ok: true, message: 'Thank you — this goes straight to the person who runs Atsy, and you will get a reply.' });
}

function adminOnly(env, user) {
  return isAdmin(env, user) ? null : err('not_found', 404);
}

/**
 * GET /api/admin/ai — does the AI binding actually answer?
 *
 * Rewrites degrade to deterministic guidance and return 200 when the model
 * cannot be reached, which is the right behaviour and a terrible symptom: the
 * page says "AI suggestions are unavailable right now" and nothing anywhere
 * says why. The deploy cannot answer it either — it holds an API token, and
 * the Worker uses a binding, which is a different thing with different
 * permissions; asking Cloudflare's REST API tests the token, not this.
 *
 * So the probe runs here, through the same binding a rewrite uses, and returns
 * the error verbatim. Admin-only and 404 to everyone else, because it spends
 * neurons. Capped at 16 tokens so it stays close to free.
 */
export async function adminAiCheck(request, env, user) {
  const denied = adminOnly(env, user);
  if (denied) return denied;

  if (!env.AI) return json({ ok: false, stage: 'binding', error: 'no AI binding on this Worker' });

  const results = [];
  for (const model of [MODEL, FALLBACK_MODEL]) {
    const started = Date.now();
    try {
      const reply = await env.AI.run(model, {
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        max_tokens: 16,
      });
      const text = (reply && (reply.response || reply.result || '')).toString().trim();
      results.push({ model, ok: true, ms: Date.now() - started, reply: text.slice(0, 200) });
    } catch (error) {
      results.push({
        model,
        ok: false,
        ms: Date.now() - started,
        // The whole message, not just its first clause: "Model not found" and
        // "Unauthorized" and "account not entitled" all arrive here and call
        // for different fixes.
        error: String((error && error.message) || error).slice(0, 500),
      });
    }
  }
  return json({ ok: results.some((r) => r.ok), models: results });
}

/**
 * GET /api/admin/stats — aggregates only.
 *
 * Every figure here is a COUNT. There is deliberately no endpoint that returns
 * a scan, a filename, a finding's evidence, or a stored file.
 */
export async function adminStats(request, env, user) {
  const denied = adminOnly(env, user);
  if (denied) return denied;

  const now = nowSec();
  const day = now - 86400;
  const week = now - 7 * 86400;

  const one = async (sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).first()) || {};

  const users = await one('SELECT COUNT(*) AS total FROM users');
  const newUsers = await one('SELECT COUNT(*) AS total FROM users WHERE created_at > ?', week);
  const scans = await one('SELECT COUNT(*) AS total FROM scans');
  const scansDay = await one('SELECT COUNT(*) AS total FROM scans WHERE created_at > ?', day);
  const scores = await one(
    "SELECT AVG(score) AS mean, MIN(score) AS low, MAX(score) AS high FROM scans WHERE status = 'complete'",
  );
  const failures = (await env.DB.prepare(
    "SELECT failure_reason AS reason, COUNT(*) AS count FROM scans WHERE status = 'failed' GROUP BY failure_reason ORDER BY count DESC",
  ).all()).results;
  const bands = (await env.DB.prepare(
    "SELECT band, COUNT(*) AS count FROM scans WHERE status = 'complete' GROUP BY band",
  ).all()).results;

  // Which problems are common. This is the reason scan_checks exists: it
  // answers the question without any scan being readable.
  const checkRows = (await env.DB.prepare(
    'SELECT check_id, COUNT(*) AS count FROM scan_checks GROUP BY check_id ORDER BY count DESC LIMIT 20',
  ).all()).results;
  const titles = new Map(ALL_CHECKS.map((check) => [check.id, check.title]));
  const commonProblems = checkRows.map((row) => ({
    id: row.check_id,
    title: titles.get(row.check_id) || row.check_id,
    count: row.count,
    share: scans.total ? Math.round((row.count / scans.total) * 100) : 0,
  }));

  const feedback = await one(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS unread FROM feedback",
  );
  const ai = await one('SELECT neurons FROM ai_usage WHERE day = ?', new Date().toISOString().slice(0, 10));
  const storage = await one('SELECT COUNT(*) AS files FROM scans WHERE r2_key IS NOT NULL');

  return json({
    generated_at: now,
    users: { total: users.total, newThisWeek: newUsers.total },
    scans: {
      total: scans.total,
      today: scansDay.total,
      averageScore: scores.mean === null ? null : Math.round(scores.mean),
      lowestScore: scores.low,
      highestScore: scores.high,
      bands,
      failures,
      filesAwaitingPurge: storage.files,
    },
    commonProblems,
    feedback: { total: feedback.total || 0, unread: feedback.unread || 0 },
    ai: { neuronsToday: ai.neurons || 0 },
  });
}

/** GET /api/admin/feedback — the inbox. Messages are people's own words. */
export async function adminFeedback(request, env, user) {
  const denied = adminOnly(env, user);
  if (denied) return denied;

  const { results } = await env.DB.prepare(
    `SELECT id, email, type, message, status, resolution_note, created_at, notified_at
       FROM feedback ORDER BY status = 'new' DESC, created_at DESC LIMIT 100`,
  ).all();
  return json({
    feedback: results.map((row) => ({
      ...row,
      // Escaped at the boundary: this reaches an HTML view, and a feedback
      // message is text a stranger wrote.
      message: escapeHtml(row.message),
    })),
  });
}

/** POST /api/admin/feedback/:id — mark one item resolved. */
export async function resolveFeedback(request, env, user, id) {
  const denied = adminOnly(env, user);
  if (denied) return denied;

  const body = await readJson(request);
  const note = String((body && body.note) || '').slice(0, 500);
  const status = (body && body.status) === 'new' ? 'new' : 'done';

  const updated = await env.DB
    .prepare('UPDATE feedback SET status = ?, resolution_note = ? WHERE id = ?')
    .bind(status, note || null, Number(id)).run();
  if (!updated.meta.changes) return err('not_found', 404);
  return json({ ok: true });
}
