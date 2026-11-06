import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { attachSidebar } from '../src/sidebar-adapter.js';
import { createLanPanel } from '../src/lan-panel.js';

const rootPath = process.env.GENTLE_PI_ROOT;
if (!rootPath) throw new Error('Set GENTLE_PI_ROOT to the installed gentle-pi directory.');
const tuiEntry = join(rootPath, 'node_modules/@earendil-works/pi-tui/dist/index.js');
const { ScrollView, VStack, truncateToWidth, visibleWidth } = await import(pathToFileURL(tuiEntry).href);
const { renderLayoutFrame } = await import(pathToFileURL(join(rootPath, 'node_modules/@earendil-works/pi-tui/dist/layout.js')).href);
const { createJiti } = await import(pathToFileURL(join(rootPath, 'node_modules/jiti/lib/jiti.mjs')).href);
const jiti = createJiti(import.meta.url, { fsCache: false, alias: { '@earendil-works/pi-tui': tuiEntry } });
const { installSidebar } = await jiti.import(join(rootPath, 'lib/shell-sidebar-layout.ts'));
const { sidebarPart, sidebarState } = await jiti.import(join(rootPath, 'lib/shell-sidebar.ts'));

// Runs the installed preparation/cache/render code, not a hand-written active flag.
// The terminal and conversation are synthetic; no private sessions or real TTY.
test('installed sidebar layout renders LAN during prepare and cached frames, with narrow fallback', t => {
  const theme = { fg: (_role, text) => text, bold: text => text };
  const host = { mode: 'fullscreen', terminal: { columns: 180 }, layoutRoot: undefined, requestRender() {} };
  sidebarPart(host, 'footer', { render: () => ['STATUS'], invalidate() {}, digest: () => 'status' });
  const panel = createLanPanel({ theme, truncateToWidth, visibleWidth });
  panel.setUrl('http://192.168.1.20:34316/abcdefghijklmnop/d/demo/');
  const attachment = attachSidebar(host, panel);
  assert.ok(attachment);
  const fallback = { render: width => attachment.isActive() ? [] : panel.render(width), invalidate() {} };
  const conversation = new ScrollView({ render: () => ['Synthetic conversation'], invalidate() {} }, { primary: true, follow: 'end' });
  const editor = { render: () => ['EDITOR'], invalidate() {} };
  host.layoutRoot = new VStack([
    { component: conversation, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    { component: new VStack([{ component: editor }, { component: fallback }]) },
  ]);
  const disposeLayout = installSidebar(host, theme);
  t.after(() => { attachment.dispose(); disposeLayout(); });
  const frame = () => renderLayoutFrame(host.layoutRoot, host.terminal.columns, 28, () => {}).lines.join('\n');
  for (let pass = 0; pass < 3; pass++) {
    const text = frame();
    assert.match(text, /CANVAS LAN/, `wide frame ${pass} must include the card`);
    assert.match(text, /http:\/\/192\.168\.1\.20:34316\//);
    assert.equal(attachment.isActive(), true);
    assert.deepEqual(fallback.render(80), []);
  }
  host.terminal.columns = 100;
  assert.match(frame(), /CANVAS LAN/);
  assert.equal(attachment.isActive(), false);
  assert.match(fallback.render(80).join('\n'), /http:\/\/192\.168\.1\.20/);
  host.terminal.columns = 180;
  assert.match(frame(), /CANVAS LAN/);
  assert.equal(sidebarState(host).active, true);
  assert.deepEqual(fallback.render(80), []);
});
