// Single source of truth for the app version.
// Shown at /api/health and in every page footer; a unit test enforces that the
// newest RELEASES entry in src/report.js matches it.
// NOTE: never re-export this from worker.js — workerd rejects non-handler
// exports on the entry module (Pricey incident #14).
export const VERSION = '1.2.0';
