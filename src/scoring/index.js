// The scoring engine. Deterministic by construction: pure functions over a
// parsed document, no clock, no randomness, no network, no model.
//
// The same PDF always produces the same score. That is not an implementation
// detail — it is the product promise that makes a re-scan meaningful, and a
// unit test asserts byte-identical JSON across two runs.

import { buildContext } from './context.js';
import { PILLAR_A } from './pillar-a.js';
import { PILLAR_B } from './pillar-b.js';
import { PILLAR_C } from './pillar-c.js';
import { PILLAR_D } from './pillar-d.js';
import { PILLAR_E } from './pillar-e.js';
import { simulateEngines, DISCLAIMER } from './engines.js';

export const PILLARS = [
  { id: 'A', name: 'Parse & structure', weight: 35, question: 'Can a machine extract this at all, in the right order?', checks: PILLAR_A },
  { id: 'B', name: 'Contact & identity', weight: 10, question: 'Can a recruiter reach you, and is the top block clean?', checks: PILLAR_B },
  { id: 'C', name: 'Experience & dates', weight: 20, question: 'Is the work history machine-readable and coherent?', checks: PILLAR_C },
  { id: 'D', name: 'Content & impact', weight: 25, question: 'Would a human be persuaded by it?', checks: PILLAR_D },
  { id: 'E', name: 'Skills presentation', weight: 10, question: 'Are your skills present, findable and honestly stated?', checks: PILLAR_E },
];

export const ALL_CHECKS = PILLARS.flatMap((pillar) =>
  pillar.checks.map((check) => ({ ...check, pillar: pillar.id })));

const SEVERITY_ORDER = { critical: 0, major: 1, minor: 2 };
// docs/SECURITY-PRIVACY.md: evidence snippets never exceed 120 characters, so
// a finding can never become a copy of the CV.
const EVIDENCE_MAX = 120;

export const BANDS = [
  { id: 'excellent', label: 'Excellent', from: 90 },
  { id: 'strong', label: 'Strong', from: 75 },
  { id: 'work', label: 'Needs work', from: 60 },
  { id: 'risk', label: 'At risk', from: 0 },
];

export const bandFor = (score) => BANDS.find((band) => score >= band.from) || BANDS[BANDS.length - 1];

function trimEvidence(evidence) {
  return (evidence || [])
    .filter((item) => item && (item.text || item.box))
    .slice(0, 4)
    .map((item) => {
      const flat = String(item.text || '').replace(/\s+/g, ' ').trim();
      return {
        page: item.page || 1,
        text: flat.length > EVIDENCE_MAX ? `${flat.slice(0, EVIDENCE_MAX - 1)}…` : flat,
        box: item.box || null,
      };
    });
}

/**
 * Run every check against a parsed document.
 *
 * `options.taxonomy` is the skills lookup; when absent, the checks that need
 * it stand down rather than reporting a CV as skill-less.
 */
export function runChecks(model, options = {}) {
  const ctx = buildContext(model, options);

  const findings = [];
  const caps = [];
  for (const pillar of PILLARS) {
    for (const check of pillar.checks) {
      let hit = null;
      try {
        hit = check.run(ctx);
      } catch (error) {
        // One check throwing must never cost the reader their whole scan. The
        // failure is loud in the log and silent on screen — a half-scored CV
        // with an error banner helps nobody.
        console.log(`scoring: ${check.id} threw:`, error && error.message);
        continue;
      }
      if (!hit) continue;

      findings.push({
        id: check.id,
        pillar: pillar.id,
        severity: check.severity,
        points: check.points,
        fatal: !!check.fatal,
        title: check.title,
        message: hit.message,
        evidence: trimEvidence(hit.evidence),
      });
      if (check.fatal) caps.push({ id: check.id, cap: check.cap, title: check.title });
    }
  }

  // A pillar loses its checks' points and never goes below zero. Deductions
  // never cascade: a catastrophic Pillar A leaves Pillar D's points intact,
  // because the content really is that good even if nothing can read it.
  const pillars = PILLARS.map((pillar) => {
    const lost = findings
      .filter((finding) => finding.pillar === pillar.id)
      .reduce((sum, finding) => sum + finding.points, 0);
    return {
      id: pillar.id,
      name: pillar.name,
      question: pillar.question,
      weight: pillar.weight,
      score: Math.max(0, pillar.weight - lost),
      lost: Math.min(lost, pillar.weight),
    };
  });

  const raw = pillars.reduce((sum, pillar) => sum + pillar.score, 0);
  // Fatal checks cap the total outright, because the document is effectively
  // unreadable or dishonest and a high score would be a lie.
  const ceiling = caps.reduce((low, cap) => Math.min(low, cap.cap), 100);
  const score = Math.round(Math.min(raw, ceiling));

  findings.sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || b.points - a.points
    || a.id.localeCompare(b.id));

  const triggeredIds = findings.map((finding) => finding.id);

  return {
    score,
    band: bandFor(score).id,
    bandLabel: bandFor(score).label,
    rawScore: Math.round(raw),
    capped: score < raw,
    caps,
    pillars,
    findings,
    checkIds: triggeredIds,
    engines: simulateEngines(triggeredIds),
    engineDisclaimer: DISCLAIMER,
    // What a reader most wants: the fixes worth the most points, in order.
    topFixes: findings.slice(0, 5).map((finding) => finding.id),
  };
}

/** The published rubric, for /about and the results screen. */
export function rubric() {
  return PILLARS.map((pillar) => ({
    id: pillar.id,
    name: pillar.name,
    weight: pillar.weight,
    question: pillar.question,
    checks: pillar.checks.map((check) => ({
      id: check.id,
      title: check.title,
      points: check.fatal ? `caps at ${check.cap}` : check.points,
      severity: check.severity,
    })),
  }));
}
