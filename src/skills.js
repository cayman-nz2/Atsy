// The skills taxonomy, loaded from D1.
//
// It lives in the database rather than the bundle so it can grow without a
// deploy — a skill nobody thought of on launch day is an INSERT. That choice
// costs one query per isolate, which is why the result is cached: a Worker
// isolate serves many requests, and the taxonomy changes on the timescale of
// someone editing a table, not of a request.

const CACHE = new WeakMap();

/** Lowercase, punctuation-light, so "Node.js" and "node js" find each other. */
export function normaliseTerm(term) {
  return String(term || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9+#.'&/ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Load the taxonomy and return a matcher.
 *
 * Returns null when the table is missing or empty rather than an empty
 * matcher: the checks that need it stand down on null, and a CV reported as
 * having no recognised skills because the lookup table failed to load would be
 * a lie caused by an outage.
 */
export async function loadTaxonomy(env) {
  if (!env || !env.DB) return null;
  if (CACHE.has(env)) return CACHE.get(env);

  let rows;
  try {
    rows = (await env.DB.prepare('SELECT canonical, alias, family, kind FROM skills').all()).results;
  } catch (error) {
    console.log('skills taxonomy unavailable:', error && error.message);
    return null;
  }
  if (!rows || !rows.length) return null;

  const byAlias = new Map();
  for (const row of rows) {
    byAlias.set(row.alias, { canonical: row.canonical, family: row.family, kind: row.kind });
  }
  const taxonomy = buildMatcher(byAlias);
  CACHE.set(env, taxonomy);
  return taxonomy;
}

/** Build a matcher over an alias map. Exported so tests can supply their own. */
export function buildMatcher(byAlias) {
  return {
    size: byAlias.size,

    /** Exact-ish match for one listed term. */
    match(term) {
      const key = normaliseTerm(term);
      if (!key) return null;
      const direct = byAlias.get(key);
      if (direct) return direct;
      // "Advanced SQL" and "SQL (advanced)" are still SQL. Strip the common
      // qualifiers rather than failing to recognise a skill because someone
      // rated it.
      const stripped = key
        .replace(/\b(advanced|intermediate|basic|beginner|expert|proficient|working knowledge of|experience with|familiar with)\b/g, '')
        .replace(/[()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return stripped && stripped !== key ? byAlias.get(stripped) || null : null;
    },

    /**
     * Every skill mentioned anywhere in a block of free text. Used by Role Fit
     * to read a job description, where skills are in prose rather than a list.
     */
    scan(text) {
      const haystack = ` ${normaliseTerm(text)} `;
      const found = new Map();
      for (const [alias, entry] of byAlias) {
        // Word-boundary containment: "r" must not match "your".
        if (haystack.includes(` ${alias} `) || haystack.includes(` ${alias},`)
          || haystack.includes(` ${alias}.`) || haystack.includes(`(${alias})`)) {
          found.set(entry.canonical, entry);
        }
      }
      return [...found.values()];
    },
  };
}
