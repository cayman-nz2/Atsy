// Atsy — entry module. Routing only: no constants are exported from here,
// because workerd rejects non-handler exports on the entry module.
//
// Static assets in dist/ are served ahead of this Worker; only unmatched
// paths (in practice /api/*) reach the fetch handler.

import { VERSION } from './src/version.js';
import { json, err } from './src/util.js';
import { requestCode, verifyCode, currentUser, logout, deleteAccount } from './src/auth.js';

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
      return json({ version: VERSION, turnstileSiteKey: env.TURNSTILE_SITE_KEY || '' });
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
};
