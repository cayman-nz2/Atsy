// Renders the link-preview card (public/og-image.png) that WhatsApp, Slack,
// LinkedIn and iMessage show when someone shares atsy.vibecod3.app.
//
// It is rendered in Chromium with the real self-hosted fonts rather than drawn
// as SVG, because SVG rasterisers substitute their own fonts and the card
// would quietly stop being the brand. Run `npm run og` after changing it and
// commit the PNG — the site must never render this at request time.

import { chromium } from '@playwright/test';
import { mkdtemp, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const WIDTH = 1200;
const HEIGHT = 630;

const HTML = `<!doctype html>
<meta charset="utf-8">
<style>
  @font-face { font-family: 'Bricolage'; src: url('./bricolage.woff2') format('woff2-variations');
               font-weight: 200 800; }
  @font-face { font-family: 'Instrument'; src: url('./instrument.woff2') format('woff2-variations');
               font-weight: 400 700; }
  @font-face { font-family: 'JetBrains'; src: url('./mono.woff2') format('woff2-variations');
               font-weight: 100 800; }
  * { box-sizing: border-box; margin: 0; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; background: #FAF8F4; color: #14161A;
         font-family: Instrument, sans-serif; display: grid;
         grid-template-columns: 1.12fr 0.88fr; }
  .left { padding: 64px 40px 56px 68px; display: flex; flex-direction: column; }
  .mark { display: flex; align-items: center; gap: 14px; font-family: Bricolage;
          font-weight: 800; font-size: 40px; letter-spacing: -.02em; }
  .mark i { width: 22px; height: 22px; background: #3A32E0; transform: rotate(45deg);
            border-radius: 4px; display: block; }
  h1 { font-family: Bricolage; font-weight: 800; font-size: 60px; line-height: 1.02;
       letter-spacing: -.035em; margin-top: 44px; max-width: 13ch; }
  h1 em { font-style: normal; color: #3A32E0; }
  .sub { margin-top: 26px; font-size: 25px; line-height: 1.4; color: #4A4E5C; max-width: 24ch; }
  .foot { margin-top: auto; display: flex; align-items: center; gap: 14px;
          font-family: JetBrains; font-size: 20px; color: #767B8A; }
  .pill { border: 1px solid #E3DFD7; background: #fff; border-radius: 999px;
          padding: 8px 18px; color: #14161A; font-size: 19px; }
  .right { background: #101318; padding: 56px 52px; display: flex; flex-direction: column;
           justify-content: center; gap: 18px; }
  .label { font-family: JetBrains; font-size: 17px; color: #6C7A8C; letter-spacing: .04em; }
  .code { font-family: JetBrains; font-size: 19.5px; line-height: 1.72; color: #C4D0E0;
          white-space: pre-wrap; }
  .code b { color: #FF9E95; font-weight: 400; }
</style>
<div class="left">
  <div class="mark"><i></i>Atsy</div>
  <h1>See your CV the way a <em>hiring machine</em> sees it.</h1>
  <p class="sub">Free CV scanner. Upload a PDF, get the exact fixes.</p>
  <div class="foot"><span class="pill">atsy.vibecod3.app</span><span>no paywall</span></div>
</div>
<div class="right">
  <div class="label">// what the parser extracted</div>
  <div class="code">Priya Raman
Operations Manager
<b>Skills My journey</b>
<b>Process design Operations Manager</b>
<b>SQL Mar 2023 — now</b>
<b>Stakeholders Ran the warehouse team</b>
<b>Education and daily dispatch</b></div>
</div>`;

const workspace = await mkdtemp(join(tmpdir(), 'atsy-og-'));
await writeFile(join(workspace, 'card.html'), HTML);
await cp('public/fonts/bricolage-grotesque-var.woff2', join(workspace, 'bricolage.woff2'));
await cp('public/fonts/instrument-sans-var.woff2', join(workspace, 'instrument.woff2'));
await cp('public/fonts/jetbrains-mono-var.woff2', join(workspace, 'mono.woff2'));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 });
await page.goto(`file://${join(workspace, 'card.html')}`);
await page.evaluate(() => document.fonts.ready);
const shot = await page.screenshot({ type: 'png' });
await browser.close();
await rm(workspace, { recursive: true, force: true });

// Down to the intended pixel size, and small enough that WhatsApp will fetch
// it on a slow connection.
await sharp(shot).resize(WIDTH, HEIGHT).png({ compressionLevel: 9, quality: 90 })
  .toFile('public/og-image.png');
console.log('wrote public/og-image.png');
