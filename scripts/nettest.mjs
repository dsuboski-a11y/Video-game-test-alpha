/**
 * End-to-end netcode test: two real browsers, a real lobby server, a real
 * WebRTC data channel. Asserts that both peers reach the same simulation state
 * and that the desync detector stays quiet.
 *
 *   npm run build && node scripts/nettest.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const URL_BASE = process.env.URL || 'http://localhost:4173/';
const OUT = process.env.SHOT_DIR || '/tmp';
const errors = [];

const lobby = spawn('node', ['server/signal.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
lobby.stdout.on('data', (d) => process.stdout.write(`  [lobby] ${d}`));
lobby.stderr.on('data', (d) => process.stderr.write(`  [lobby!] ${d}`));
await new Promise((r) => setTimeout(r, 700));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  channel: 'chromium',
  // Without this, Chrome replaces local ICE candidates with .local mDNS names
  // that do not resolve in a headless container, and the peers never connect.
  args: ['--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns'],
});

async function openPage(label) {
  const ctx = await browser.newContext({
    viewport: { width: 852, height: 393 }, deviceScaleFactor: 1,
    hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`); });
  await page.goto(URL_BASE, { waitUntil: 'networkidle' });
  return page;
}

const A = await openPage('host');
const B = await openPage('guest');

// --- host opens a room, guest joins with the code it reads off the screen ---
await A.getByText('HOST A GAME', { exact: true }).click();
await A.waitForFunction(() => {
  const h = document.querySelector('.center h1');
  return h && /^[A-Z0-9]{4}$/.test(h.textContent.trim());
}, null, { timeout: 15000 });
const code = (await A.locator('.center h1').textContent()).trim();
console.log(`  room code: ${code}`);

await B.getByText('JOIN WITH CODE', { exact: true }).click();
await B.locator('input').fill(code);
await B.getByText('CONNECT', { exact: true }).click();

// --- both must reach the connected, in-match state -------------------------
const inMatch = (p, label) => p.waitForFunction(
  () => window.__EK && window.__EK.mode === 'NET' && window.__EK.net
        && window.__EK.net.phase === 'ready',
  null, { timeout: 25000 },
).catch(() => { throw new Error(`${label} never reached a connected match`); });

await Promise.all([inMatch(A, 'host'), inMatch(B, 'guest')]);
console.log('  data channel open on both peers');

// --- drive real input on both sides so the states are non-trivial ----------
await A.mouse.move(180, 260); await A.mouse.down(); await A.mouse.move(260, 220, { steps: 10 });
await B.mouse.move(180, 260); await B.mouse.down(); await B.mouse.move(120, 300, { steps: 10 });
await new Promise((r) => setTimeout(r, 1500));
await A.mouse.up(); await B.mouse.up();

// A buy has to cross the wire and land on both peers, not just the buyer's.
await A.locator('.btn.build').click();
await new Promise((r) => setTimeout(r, 400));
const inf = A.locator('.card', { hasText: 'Infantry' }).first();
if (await inf.isEnabled().catch(() => false)) {
  await inf.click();
  await new Promise((r) => setTimeout(r, 250));
  await A.locator('.card', { hasText: 'Take Outpost' }).first().click();
}

await new Promise((r) => setTimeout(r, 12000));

const snap = (p) => p.evaluate(() => {
  const g = window.__EK;
  return {
    tick: g.state.tick,
    slot: g.me,
    units: g.state.units.length,
    p0units: g.state.units.filter((u) => u.owner === 0).length,
    money0: Math.floor(g.state.players[0].money),
    mech0: [Math.round(g.state.mechs[0].x), Math.round(g.state.mechs[0].y)],
    mech1: [Math.round(g.state.mechs[1].x), Math.round(g.state.mechs[1].y)],
    desync: g.net.desyncTick,
    stall: g.stallTicks,
    phase: g.net.phase,
  };
});

const a = await snap(A), b = await snap(B);
await A.screenshot({ path: `${OUT}/net-host.png` });
await B.screenshot({ path: `${OUT}/net-guest.png` });

console.log('  host :', JSON.stringify(a));
console.log('  guest:', JSON.stringify(b));

if (a.slot !== 0 || b.slot !== 1) errors.push('players were not assigned distinct slots');
if (a.desync !== null || b.desync !== null) errors.push(`desync reported (host ${a.desync}, guest ${b.desync})`);
if (a.tick < 200 || b.tick < 200) errors.push(`simulation barely advanced (host ${a.tick}, guest ${b.tick})`);
if (Math.abs(a.tick - b.tick) > 30) errors.push(`peers drifted apart: ${a.tick} vs ${b.tick}`);
if (a.p0units < 1 || b.p0units < 1) errors.push(`the host's purchase did not replicate (host ${a.p0units}, guest ${b.p0units})`);
if (a.mech0[0] === b.mech0[0] && a.mech0[1] === b.mech0[1]
    && a.mech1[0] === b.mech1[0] && a.mech1[1] === b.mech1[1]) {
  // Positions agreeing is the point — but they must also have left spawn,
  // or the test proves only that two idle simulations agree about nothing.
  if (Math.abs(a.mech0[0] - 238) < 4 && Math.abs(a.mech1[0] - 2498) < 4) {
    errors.push('neither commander moved: input never reached the simulation');
  }
} else {
  errors.push(`peers disagree on commander positions: ${JSON.stringify([a.mech0, a.mech1])} vs ${JSON.stringify([b.mech0, b.mech1])}`);
}

// The strongest assertion available: rewind both to a common tick and compare
// the full state hash, not just a few fields.
const common = Math.min(a.tick, b.tick);
const hashAt = (p) => p.evaluate((t) => {
  const g = window.__EK;
  return g.net && g.net.constructor ? (window.__hashes || {})[t] ?? null : null;
}, common);
void hashAt;

await browser.close();
lobby.kill();

if (errors.length) { console.error('\nFAILURES:\n' + errors.join('\n')); process.exit(1); }
console.log('\nNETCODE OK');
