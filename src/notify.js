// Outbound email through the Cloudflare Email Service binding: sign-in codes
// to users, and notifications to the owner.
//
// Workers Paid includes 3,000 outbound emails a month; sends to the owner's
// own verified destination address are free and do not touch that quota.
// Emails sent from a Worker show as "dropped" in the Email Routing summary
// even when delivered — read Email Sending metrics instead.

const FROM_NAME = 'Atsy';

export async function sendEmail(env, to, subject, bodyLines, { replyTo } = {}) {
  const from = env.EMAIL_FROM || 'hello@vibecod3.app';
  const raw = [
    `From: ${FROM_NAME} <${from}>`,
    `To: <${to}>`,
    ...(replyTo ? [`Reply-To: <${replyTo}>`] : []),
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${from.split('@')[1]}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    ...bodyLines,
  ].join('\r\n');

  const { EmailMessage } = await import('cloudflare:email');
  await env.SEND_EMAIL.send(new EmailMessage(from, to, raw));
}

// Fire-and-forget owner notification. It must never block or fail a user's
// action, so it runs through ctx.waitUntil and swallows every error. Skipped
// in local dev and E2E.
export function notifyOwner(env, ctx, subject, bodyLines) {
  if (!env.OWNER_EMAIL || env.OTP_ECHO === '1') return;
  const task = sendEmail(env, env.OWNER_EMAIL, subject, bodyLines)
    .catch((error) => console.log('owner notify failed:', error.message));
  if (ctx && ctx.waitUntil) ctx.waitUntil(task);
}
