/**
 * DentVault Handbook — PDF Generator
 *
 * Converts docs/handbook.html → docs/DentVault-Handbook.pdf
 *
 * Usage:
 *   node docs/generate-pdf.js
 *
 * Requirements:
 *   npm install -D playwright
 *   npx playwright install chromium
 */

import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HANDBOOK_PATH = resolve(__dirname, 'handbook.html');
const OUTPUT_PATH   = resolve(__dirname, 'DentVault-Handbook.pdf');

if (!existsSync(HANDBOOK_PATH)) {
  console.error('❌  docs/handbook.html not found.');
  process.exit(1);
}

console.log('🚀  Launching Chromium…');
const browser = await chromium.launch();
const page    = await browser.newPage();

// Load the handbook HTML as a local file
await page.goto(`file://${HANDBOOK_PATH}`, { waitUntil: 'networkidle' });

// Give fonts and images a moment to settle
await page.waitForTimeout(800);

console.log('📄  Generating PDF…');
await page.pdf({
  path:   OUTPUT_PATH,
  format: 'A4',
  printBackground: true,
  margin: {
    top:    '20mm',
    bottom: '20mm',
    left:   '18mm',
    right:  '18mm',
  },
  // The handbook uses @page CSS for margins, but we set them here too
  // so Playwright's header/footer don't overlap content.
  displayHeaderFooter: false,
});

await browser.close();

console.log(`✅  Saved → ${OUTPUT_PATH}`);
console.log('');
console.log('Tip: open the PDF in Preview or Acrobat to verify page breaks.');
