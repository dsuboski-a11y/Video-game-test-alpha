/** Dump the baked sprite atlases to PNG so every frame can be eyeballed. */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const OUT = process.env.SHOT_DIR || '/tmp';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium', channel: 'chromium', args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
await page.goto(process.env.URL || 'http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__EK?.renderer?.sprites?.ready, null, { timeout: 20000 });

const info = await page.evaluate(() => {
  const s = window.__EK.renderer.sprites;
  return {
    ms: Math.round(s.bakeMs),
    mech: s.atlases.mech.toDataURL('image/png'),
    units: s.atlases.units.toDataURL('image/png'),
    mechSize: [s.atlases.mech.width, s.atlases.mech.height],
    unitSize: [s.atlases.units.width, s.atlases.units.height],
  };
});
for (const k of ['mech', 'units']) {
  writeFileSync(`${OUT}/atlas-${k}.png`, Buffer.from(info[k].split(',')[1], 'base64'));
}
console.log(`baked in ${info.ms}ms · mech ${info.mechSize.join('x')} · units ${info.unitSize.join('x')}`);
await browser.close();
