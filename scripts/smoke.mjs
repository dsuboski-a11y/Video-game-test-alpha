// Headless smoke test: boot the built game at iPhone-landscape size, play a
// few simulated seconds, and fail loudly on any console error or page error.
import { chromium } from 'playwright';

const OUT = process.env.SHOT_DIR || '/tmp';
const URL_BASE = process.env.URL || 'http://localhost:4173/';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', channel: 'chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 852, height: 393 },   // iPhone 15 Pro, landscape
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();

const errors = [];
page.on('console', (m) => {
  // A bare-served single file has no /favicon.ico and the browser asks anyway;
  // in a real deployment the favicon comes from the host page.
  const where = m.location()?.url ?? '';
  if (m.type() === 'error' && !/favicon/i.test(m.text() + where)) errors.push(`console: ${m.text()}`);
});
page.on('response', (r) => {
  if (r.status() >= 400 && !/favicon/i.test(r.url())) errors.push(`http ${r.status()}: ${r.url()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL_BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/01-title.png` });

// Enter the match.
// First run shows the coached entry point; later runs the plain one.
await page.locator('#play').click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/02-start.png` });

const coachStep = () => page.locator('.coach .n').textContent().catch(() => null);
if (await page.locator('.coach').count()) {
  if ((await coachStep()) !== '1/7') errors.push('coach did not open on step 1');
}

// Open the build sheet while still standing on the HQ pad.
await page.locator('.btn.build').click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/03-build.png` });

// Buy infantry with a capture order.
const infantry = page.locator('.card', { hasText: 'Infantry' }).first();
if (await infantry.count()) {
  await infantry.click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/04-orders.png` });
  await page.locator('.card', { hasText: 'Take Outpost' }).first().click();
  await page.waitForTimeout(300);
}

// Now drive the mech around with the virtual stick, and prove it responded.
const before = await page.evaluate(() => {
  const m = window.__EK.state.mechs[0];
  return [m.x, m.y];
});
await page.mouse.move(180, 260);
await page.mouse.down();
await page.mouse.move(260, 210, { steps: 12 });
await page.waitForTimeout(2600);
await page.mouse.up();
const after = await page.evaluate(() => {
  const m = window.__EK.state.mechs[0];
  return [m.x, m.y];
});
const moved = Math.hypot(after[0] - before[0], after[1] - before[1]);
console.log('stick moved the mech', moved.toFixed(1), 'world units');
if (moved < 20) errors.push(`virtual stick did not move the mech (${moved.toFixed(1)} units)`);
// Moving is the coach's first task; it must notice and move on by itself.
if (await page.locator('.coach').count()) {
  const step = await coachStep();
  console.log('coach advanced to', step);
  if (step === '1/7') errors.push('coach never registered that the player moved');
}

// Let the match run so the bot and unit AI actually exercise themselves.
await page.waitForTimeout(6000);
await page.screenshot({ path: `${OUT}/05-battle.png` });

const report = await page.evaluate(() => {
  const st = window.__EK.state;
  return {
    units: st.units.length,
    myUnits: st.units.filter((u) => u.owner === 0).length,
    botUnits: st.units.filter((u) => u.owner === 1).length,
    money: Math.floor(st.players[0].money),
  };
});

// Long soak: fast-forward a full match's worth of ticks to shake out AI hangs.
await page.waitForTimeout(45000);
await page.screenshot({ path: `${OUT}/06-late.png` });
const late = await page.evaluate(() => {
  const st = window.__EK.state;
  const owned = (p) => st.bases.filter((b) => b.owner === p).length;
  return {
    clock: document.querySelector('.clock')?.textContent,
    units: st.units.length,
    bases: `${owned(0)}/${owned(1)}/${st.bases.filter((b) => b.owner === -1).length}`,
    neutral: st.bases.filter((b) => b.owner === -1).length,
    hq: st.bases.filter((b) => b.isHQ).map((b) => Math.round((b.hp / b.maxHp) * 100) + '%').join(' '),
    stuck: st.units.filter((u) => !u.carried && Math.hypot(u.vx, u.vy) < 0.01).length,
  };
});

await browser.close();

console.log('after 8s:', JSON.stringify(report));
console.log('after 28s:', JSON.stringify(late));
if (report.myUnits < 1) errors.push('bought unit never entered the simulation');
if (late.units < 2) errors.push('almost no units alive late in the match — AI or economy is stalled');
if (late.neutral > 10) errors.push(`no outposts changed hands in ${late.clock} — capture loop is stalled`);
if (errors.length) { console.error('FAILURES:\n' + errors.join('\n')); process.exit(1); }
console.log('SMOKE OK');
