// Parse-risk simulation for six applicant tracking systems.
//
// This is the part of Atsy most likely to be misread, so the honesty rules are
// strict. No engine score is invented and none is obtained from a vendor. What
// is modelled is SENSITIVITY: how much each documented parser behaviour is
// affected by each defect Atsy actually found. The output is a risk band and
// the reasons for it, and every card carries the disclaimer below.
//
// The weights come from docs/SCORING-SPEC.md §4, which in turn cites
// docs/RESEARCH.md §1.3. They are a model, not a measurement, and the wording
// on screen says so.

export const ENGINES = [
  { id: 'taleo', name: 'Oracle Taleo' },
  { id: 'workday', name: 'Workday' },
  { id: 'icims', name: 'iCIMS' },
  { id: 'greenhouse', name: 'Greenhouse' },
  { id: 'lever', name: 'Lever' },
  { id: 'ashby', name: 'Ashby' },
];

// check id -> per-engine weight, in the order of ENGINES.
const SENSITIVITY = {
  P01: [100, 100, 100, 100, 100, 100],
  P02: [60, 55, 45, 35, 25, 20],
  P03: [40, 35, 30, 25, 20, 20],
  P04: [30, 30, 25, 25, 15, 15],
  P05: [45, 35, 30, 30, 20, 15],
  P06: [35, 25, 40, 20, 20, 15],
  P07: [35, 25, 40, 20, 20, 15],
  P11: [45, 30, 25, 20, 15, 15],
  C02: [30, 20, 20, 15, 10, 10],
  P17: [25, 10, 15, 10, 10, 5],
};

// Every CV Atsy scans is a PDF, so this one always applies. It is listed
// rather than hidden because it is a real part of the risk and a reader
// deserves to know a DOCX would score better with some engines.
const PDF_FORMAT_WEIGHT = [15, 15, 10, 5, 5, 5];

const PLAIN_REASONS = {
  P01: 'the file has no text layer',
  P02: 'the layout is in more than one column',
  P03: 'the stored text order is not the reading order',
  P04: 'content sits in a page header or footer',
  P05: 'content sits in a table',
  P06: 'a font is not embedded',
  P07: 'the extracted text is corrupted',
  P11: 'the section headings are non-standard',
  C02: 'the date formats are inconsistent',
  P17: 'the text mixes scripts, or declares no language',
  FORMAT: 'the file is a PDF rather than a DOCX',
};

export const DISCLAIMER = 'Every ATS ships its own parser, and most are configured per employer. This is a risk estimate based on how each engine is documented to behave — not a score from the engine itself, and not a prediction of one.';

export const riskBand = (risk) => (risk >= 50 ? 'high' : (risk >= 20 ? 'medium' : 'low'));

/**
 * Risk = the highest single triggered weight, plus a quarter of the sum of the
 * rest, clamped to 100.
 *
 * Highest-plus-a-quarter rather than a plain sum because defects overlap: a
 * two-column CV whose headings are therefore unrecognised is one problem
 * showing up twice, and adding both at full weight would double-count it.
 */
export function simulateEngines(triggeredIds) {
  const applicable = triggeredIds.filter((id) => SENSITIVITY[id]);

  return ENGINES.map((engine, index) => {
    const weights = applicable
      .map((id) => ({ id, weight: SENSITIVITY[id][index] }))
      .concat([{ id: 'FORMAT', weight: PDF_FORMAT_WEIGHT[index] }])
      .filter((entry) => entry.weight > 0)
      .sort((a, b) => b.weight - a.weight);

    const [worst, ...rest] = weights;
    const risk = worst
      ? Math.min(100, Math.round(worst.weight + (rest.reduce((sum, entry) => sum + entry.weight, 0) * 0.25)))
      : 0;

    return {
      id: engine.id,
      name: engine.name,
      risk,
      band: riskBand(risk),
      // Top three, in the reader's words rather than check ids.
      reasons: weights.slice(0, 3).map((entry) => PLAIN_REASONS[entry.id]).filter(Boolean),
    };
  });
}
