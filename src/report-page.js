// GET /api/scans/:id/report — a printable report of one scan.
//
// Server-rendered HTML rather than a PDF: a Worker has no renderer, and the
// browser's own "Save as PDF" produces a better file than anything Atsy could
// generate. It is a page the reader can print, save, or send to someone who
// asked why their CV is not getting replies.
//
// It contains the reader's own findings and nothing else. Every value is
// escaped on the way in — a finding's evidence is text lifted out of a PDF a
// stranger uploaded, and it is going into HTML.

import { err, escapeHtml } from './util.js';
import { SECURITY_HEADERS } from './util.js';

const BAND_LABEL = { excellent: 'Excellent', strong: 'Strong', work: 'Needs work', risk: 'At risk' };
const SEVERITY_LABEL = { critical: 'Critical', major: 'Major', minor: 'Minor' };

const e = (value) => escapeHtml(String(value === null || value === undefined ? '' : value));

export async function scanReport(request, env, user, scanId) {
  const row = await env.DB.prepare('SELECT * FROM scans WHERE id = ? AND user_id = ?')
    .bind(scanId, user.id).first();
  if (!row) return err('not_found', 404);
  if (row.status !== 'complete') return err('scan_not_complete', 409);

  const parse = (value) => {
    if (!value) return null;
    try { return JSON.parse(value); } catch { return null; }
  };
  const findingsBlob = parse(row.findings_json) || {};
  const findings = findingsBlob.findings || [];
  const pillars = parse(row.pillars_json) || [];
  const engineBlob = parse(row.engines_json) || {};
  const engines = engineBlob.engines || [];

  const when = new Date(row.created_at * 1000).toISOString().slice(0, 10);

  const pillarRows = pillars.map((pillar) => `
      <tr>
        <th scope="row">${e(pillar.name)}</th>
        <td>${e(pillar.score)} / ${e(pillar.weight)}</td>
      </tr>`).join('');

  const findingBlocks = findings.map((finding, index) => `
    <li>
      <h3>${index + 1}. ${e(finding.title)}
        <span class="tag">${e(SEVERITY_LABEL[finding.severity] || finding.severity)}</span>
        <span class="cost">${finding.fatal ? 'caps your score' : `${e(finding.points)} point${finding.points === 1 ? '' : 's'}`}</span>
      </h3>
      <p>${e(finding.message)}</p>
      ${finding.evidence.length ? `<ul class="ev">${finding.evidence
    .map((piece) => `<li>page ${e(piece.page)} — ${e(piece.text)}</li>`).join('')}</ul>` : ''}
    </li>`).join('');

  const engineRows = engines.map((engine) => `
      <tr>
        <th scope="row">${e(engine.name)}</th>
        <td>${e(engine.band)} risk</td>
        <td>${e(engine.reasons.join('; '))}</td>
      </tr>`).join('');

  const capNote = (findingsBlob.caps || []).length
    ? `<p class="cap">This score is capped at ${e(row.score)} because ${(findingsBlob.caps || [])
      .map((cap) => e(cap.title.toLowerCase())).join(' and ')}. Uncapped it would be ${e(findingsBlob.rawScore)}.</p>`
    : '';

  // Self-contained: no stylesheet, no script, no image. It has to survive
  // being saved to disk and opened a month later with no network.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Atsy report — ${e(row.filename)}</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0 auto; padding: 32px 24px 64px; max-width: 720px;
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #14161A; background: #fff;
  }
  h1 { font-size: 26px; letter-spacing: -.02em; margin: 0 0 4px; }
  h2 { font-size: 17px; margin: 32px 0 8px; border-bottom: 1px solid #E3DFD7; padding-bottom: 6px; }
  h3 { font-size: 15px; margin: 0 0 4px; }
  p { margin: 0 0 10px; color: #33363F; }
  .meta { color: #767B8A; font-size: 13px; margin-bottom: 18px; }
  .score { font-size: 44px; font-weight: 700; letter-spacing: -.03em; }
  .band { font-size: 15px; color: #4A4E5C; }
  .cap { border-left: 3px solid #B3261E; padding-left: 12px; color: #B3261E; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #EFECE6; vertical-align: top; }
  th[scope="row"] { font-weight: 600; width: 40%; }
  ol { padding-left: 0; list-style: none; margin: 0; }
  ol > li { border: 1px solid #E3DFD7; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
  .tag, .cost { font-size: 11px; font-weight: 600; color: #767B8A; margin-left: 6px; }
  .ev { margin: 8px 0 0; padding-left: 16px; color: #767B8A; font-size: 12.5px; }
  .foot { margin-top: 40px; color: #767B8A; font-size: 12px; border-top: 1px solid #E3DFD7; padding-top: 12px; }
  @media print { body { padding: 0; max-width: none; } ol > li { break-inside: avoid; } }
</style>
</head>
<body>
<h1>Atsy report</h1>
<p class="meta">${e(row.filename)} · scanned ${e(when)} · ${e(row.page_count)} page${row.page_count === 1 ? '' : 's'}</p>

<p><span class="score">${e(row.score)}</span> <span class="band">/ 100 — ${e(BAND_LABEL[row.band] || row.band)}</span></p>
${capNote}

<h2>Where the points went</h2>
<table><tbody>${pillarRows}</tbody></table>

<h2>What to fix${findings.length ? `, worst first (${findings.length})` : ''}</h2>
${findings.length ? `<ol>${findingBlocks}</ol>` : '<p>Nothing to fix. This CV came through cleanly.</p>'}

<h2>How six systems would read it</h2>
<table><tbody>${engineRows}</tbody></table>
<p class="meta">${e(engineBlob.disclaimer || '')}</p>

<div class="foot">
  Generated by Atsy — a free CV scanner. Scoring is deterministic: the same PDF always
  produces this score. The full rubric is published at atsy.vibecod3.app/about.
</div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Somebody's CV findings. Never cached anywhere shared.
      'cache-control': 'no-store, private',
      ...SECURITY_HEADERS,
      // The report is self-contained, so it needs nothing at all.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}
