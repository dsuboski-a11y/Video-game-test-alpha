/**
 * Fold the production build into one self-contained HTML file.
 *
 * The game already has no external assets — art and audio are generated in
 * code — so inlining the one JS chunk makes the whole thing a single file that
 * runs from any host, or from a published Artifact, with no network at all.
 *
 * Emits body-level markup only (no doctype/html/head/body): that is the shape
 * the Artifact publisher expects, and browsers open it fine either way.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const OUT = process.argv[2] ?? 'dist/eisenkrieg.html';

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const jsName = readdirSync(join(DIST, 'assets')).find((f) => f.endsWith('.js'));
if (!jsName) throw new Error('no built JS chunk found — run `npm run build` first');
let js = readFileSync(join(DIST, 'assets', jsName), 'utf8');

// A literal </script> anywhere in the source would close the tag early.
js = js.replace(/<\/script>/gi, '<\\/script>');

const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? 'EISENKRIEG';

const out = `<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
<style>
${style}
/* The page may be embedded, so pin the app to the viewport it is given. */
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #05070d; }
</style>
<div id="app">
  <canvas id="game"></canvas>
  <div id="ui"></div>
</div>
<script>window.__EK_SW = false;</script>
<script type="module">
${js}
</script>
`;

writeFileSync(OUT, out);
const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`${OUT} — ${kb} KB single file`);
