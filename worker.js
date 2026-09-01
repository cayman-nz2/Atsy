// Atsy — entry module. Routing only: no constants are exported from here,
// because workerd rejects non-handler exports on the entry module.
//
// Static assets in dist/ are served ahead of this Worker; only unmatched
// paths (in practice /api/*) reach the fetch handler.

import { VERSION } from './src/version.js';
import { json, err } from './src/util.js';
import { requestCode, verifyCode, currentUser, logout, deleteAccount } from './src/auth.js';
import {
  createScan, listScans, getScan, getScanFile, deleteScan, MAX_UPLOAD_BYTES,
} from './src/scan.js';
import { runRetention } from './src/retention.js';
import { matchScan } from './src/match.js';
import { scanReport } from './src/report-page.js';
import { rewriteBullets } from './src/rewrite.js';
import { submitFeedback, adminStats, adminAiCheck, adminFeedback, resolveFeedback } from './src/admin.js';
import { currentUserOrNull } from './src/auth.js';
import { readJson } from './src/util.js';

// Routes that need a signed-in user. Everything else is public.
async function withUser(request, env, handler) {
  const user = await currentUser(request, env);
  if (!user) return err('unauthorised', 401);
  return handler(user);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path === '/api/health') return json({ ok: true, version: VERSION });

    // Public, non-secret configuration the front end needs. The Turnstile site
    // key is public by design; its secret never leaves the Worker.
    if (path === '/api/config') {
      return json({
        version: VERSION,
        turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
        // The client enforces the same limit before spending a minute on an
        // upload the Worker would refuse. One source, so the two agree.
        maxUploadBytes: MAX_UPLOAD_BYTES,
      });
    }

    if (path === '/api/auth/request-code' && method === 'POST') return requestCode(request, env);
    if (path === '/api/auth/verify' && method === 'POST') return verifyCode(request, env, ctx);
    if (path === '/api/auth/logout' && method === 'POST') return logout(request, env);

    if (path === '/api/me' && method === 'GET') {
      const user = await currentUser(request, env);
      return json({ user: user ? { email: user.email, created_at: user.created_at } : null });
    }
    if (path === '/api/me' && method === 'DELETE') {
      return withUser(request, env, (user) => deleteAccount(request, env, user));
    }

    if (path === '/api/scans' && method === 'POST') {
      return withUser(request, env, (user) => createScan(request, env, user));
    }
    if (path === '/api/scans' && method === 'GET') {
      return withUser(request, env, (user) => listScans(request, env, user));
    }

    // Scan ids are 32 hex characters. Matching the shape here means a
    // malformed id is a 404 from the router rather than a database round trip.
    const reportPath = path.match(/^\/api\/scans\/([0-9a-f]{32})\/report$/);
    if (reportPath && method === 'GET') {
      return withUser(request, env, (user) => scanReport(request, env, user, reportPath[1]));
    }

    const scanPath = path.match(/^\/api\/scans\/([0-9a-f]{32})(\/file)?$/);
    if (scanPath) {
      const [, scanId, fileSuffix] = scanPath;
      if (fileSuffix && method === 'GET') {
        return withUser(request, env, (user) => getScanFile(request, env, user, scanId));
      }
      if (!fileSuffix && method === 'GET') {
        return withUser(request, env, (user) => getScan(request, env, user, scanId));
      }
      if (!fileSuffix && method === 'DELETE') {
        return withUser(request, env, (user) => deleteScan(request, env, user, scanId));
      }
      return err('method_not_allowed', 405);
    }

    // Role Fit and AI rewrites hang off one scan each.
    const scanAction = path.match(/^\/api\/scans\/([0-9a-f]{32})\/(match|rewrite)$/);
    if (scanAction && method === 'POST') {
      const [, scanId, action] = scanAction;
      if (action === 'match') {
        return withUser(request, env, (user) => matchScan(request, env, user, scanId));
      }
      return withUser(request, env, async (user) =>
        rewriteBullets(request, env, user, scanId, await readJson(request)));
    }

    // Feedback is open to anyone: someone who cannot sign in is exactly the
    // person most likely to have something worth hearing.
    if (path === '/api/feedback' && method === 'POST') {
      const user = await currentUserOrNull(request, env);
      return submitFeedback(request, env, ctx, user);
    }

    if (path === '/api/admin/ai' && method === 'GET') {
      return withUser(request, env, (user) => adminAiCheck(request, env, user));
    }
    if (path === '/api/admin/stats' && method === 'GET') {
      return withUser(request, env, (user) => adminStats(request, env, user));
    }
    if (path === '/api/admin/feedback' && method === 'GET') {
      return withUser(request, env, (user) => adminFeedback(request, env, user));
    }
    const feedbackItem = path.match(/^\/api\/admin\/feedback\/(\d+)$/);
    if (feedbackItem && method === 'POST') {
      return withUser(request, env, (user) => resolveFeedback(request, env, user, feedbackItem[1]));
    }

    if (path.startsWith('/api/')) return err('not_found', 404);

    // Anything else that reaches the Worker had no matching asset.
    if (env.ASSETS) {
      const notFound = await env.ASSETS.fetch(new URL('/404.html', url));
      if (notFound.ok) {
        return new Response(notFound.body, {
          status: 404,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'no-referrer',
          },
        });
      }
    }
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  },

  // Retention is not a policy anyone has to remember: it runs every thirty
  // minutes and deletes what is past its window. See src/retention.js.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRetention(env));
  },
};
