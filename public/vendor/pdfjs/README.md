# Vendored PDF.js

Self-hosted, like every other asset Atsy serves. Nothing here is fetched from a
CDN at runtime: a brand font loaded from someone else's server silently stopped
rendering for weeks once already, and a library that draws the reader's CV is a
worse thing to lose.

- **Source:** `pdfjs-dist`, version in `VERSION`, files taken from its `build/`
  and `standard_fonts/` directories unmodified.
- **Licence:** Apache-2.0, see `LICENSE`.
- **Used by:** `public/xray.js`, and nothing else. It is loaded with a dynamic
  `import()` the first time a reader opens the X-ray, so nobody who never opens
  it pays for it.

`cmaps/` is deliberately **not** vendored. It is 1.7 MB and only matters for
PDFs that use predefined CJK character maps. A CV that needs it fails to render
in the X-ray and says so, and the machine view — which is server-side and needs
no renderer — still shows what a parser reads.

To update: bump `pdfjs-dist`, copy `build/pdf.min.mjs` to `pdf.mjs`,
`build/pdf.worker.min.mjs` to `pdf.worker.mjs`, refresh `standard_fonts/`,
`LICENSE` and `VERSION`, then run the suite. `pdf.mjs` and `pdf.worker.mjs`
must come from the same version or the worker refuses to start.
