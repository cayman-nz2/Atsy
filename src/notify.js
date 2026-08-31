// Outbound email through the Cloudflare Email Service binding: sign-in codes
// to users, and copies and notifications to the owner.
//
// Workers Paid includes 3,000 outbound emails a month; sends to the owner's
// own verified destination address are free and do not touch that quota, so
// the owner copy of every email costs nothing.
//
// Emails sent from a Worker show as "dropped" in the Email Routing summary
// even when delivered — read Email Sending metrics instead.

const FROM_NAME = 'Atsy';

function buildMessage({ from, to, subject, bodyLines, replyTo }) {
  return [
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
}

/**
 * Send one email, and a blind copy to the owner.
 *
 * The copy is a second send, not a Bcc header: the Email Service envelope
 * carries exactly one recipient, so a header alone would deliver nothing
 * (Pricey learned the same about Cc). `copyLines` lets a caller give the owner
 * a different body from the user's — used to keep live sign-in codes out of a
 * second mailbox.
 */
async function deliver(env, from, to, raw) {
  // `cloudflare:email` only resolves inside workerd, so a binding may offer
  // sendRaw instead — which is how the unit tests exercise this exact path
  // rather than a re-implementation of it.
  if (typeof env.SEND_EMAIL.sendRaw === 'function') {
    await env.SEND_EMAIL.sendRaw({ from, to, raw });
    return;
  }
  const { EmailMessage } = await import('cloudflare:email');
  await env.SEND_EMAIL.send(new EmailMessage(from, to, raw));
}

export async function sendEmail(env, to, subject, bodyLines, { replyTo, copyLines, copySubject } = {}) {
  const from = env.EMAIL_FROM || 'atsyhello@vibecod3.app';
  const replyAddress = replyTo || env.REPLY_TO_EMAIL || env.OWNER_EMAIL || null;

  await deliver(env, from, to,
    buildMessage({ from, to, subject, bodyLines, replyTo: replyAddress }));

  const bcc = env.BCC_EMAIL;
  if (!bcc || bcc.toLowerCase() === to.toLowerCase()) return;

  // The owner's copy says plainly who the original went to, so an inbox full
  // of copies is still readable.
  const copy = [
    `[copy of an email Atsy sent to ${to}]`,
    '',
    ...(copyLines || bodyLines),
  ];
  // The subject needs masking too: a sign-in subject line carries the code.
  await deliver(env, from, bcc, buildMessage({
    from,
    to: bcc,
    subject: `[Atsy copy] ${copySubject || subject}`,
    bodyLines: copy,
    replyTo: replyAddress,
  }));
}

// Fire-and-forget owner notification. It must never block or fail a user's
// action, so it runs through ctx.waitUntil and swallows every error. Skipped
// in local dev and E2E.
export function notifyOwner(env, ctx, subject, bodyLines, options = {}) {
  if (!env.OWNER_EMAIL || env.OTP_ECHO === '1') return;
  // Options reach sendEmail so a feedback notification can carry the sender's
  // address as Reply-To: hitting reply in the owner's mail client should
  // answer the person who wrote in, not Atsy itself.
  const task = sendEmail(env, env.OWNER_EMAIL, subject, bodyLines, options)
    .catch((error) => console.log('owner notify failed:', error.message));
  if (ctx && ctx.waitUntil) ctx.waitUntil(task);
}

/**
 * A sign-in code is a live credential for ten minutes. The owner's copy of it
 * is masked: it shows that a code was sent, to whom and when, without being a
 * key to that person's account — which would also contradict the promise on
 * /privacy that nobody at Atsy can reach a user's data.
 */
export function maskCode(bodyLines, code) {
  return bodyLines.map((line) => line.replaceAll(code, '······'));
}
