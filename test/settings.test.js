import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSettingsPath, loadSettings, mergeSettings, saveSettings } from '../src/settings.js';

const temp = async t => {
  const dir = await mkdtemp(join(tmpdir(), 'canvas-settings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'config.json');
};

test('default path follows XDG and falls back to the home config directory', () => {
  assert.equal(defaultSettingsPath({ XDG_CONFIG_HOME: '/cfg', HOME: '/home/me' }),
    '/cfg/gentle-canvas-lan/config.json');
  assert.equal(defaultSettingsPath({ HOME: '/home/me' }), '/home/me/.config/gentle-canvas-lan/config.json');
});

test('missing or malformed settings read as empty without throwing', async t => {
  const path = await temp(t);
  assert.deepEqual(await loadSettings(path), {});
  await writeFile(path, 'not json');
  assert.deepEqual(await loadSettings(path), {});
  await writeFile(path, JSON.stringify({ host: 42, port: '34316', extra: 'x' }));
  assert.deepEqual(await loadSettings(path), { port: '34316' });
});

test('saving validates atomically, writes only known keys and makes the file private', async t => {
  const path = await temp(t);
  const saved = await saveSettings(path, { host: ' 192.168.1.20 ', port: '34316', publicOrigin: 'https://canvas.example' });
  assert.deepEqual(saved, { host: '192.168.1.20', port: '34316', publicOrigin: 'https://canvas.example' });
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), saved);
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
  for (const [label, values] of [
    ['missing host', { port: '34316' }],
    ['bad host', { host: '0.0.0.0', port: '34316' }],
    ['bad port', { host: '192.168.1.20', port: '70000' }],
    ['bad origin', { host: '192.168.1.20', port: '34316', publicOrigin: 'ftp://x' }],
  ]) {
    await assert.rejects(saveSettings(path, values), TypeError, label);
  }
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), saved);
});

test('environment overrides saved values only where it sets them', () => {
  const saved = { host: '192.168.1.20', port: '34316', publicOrigin: 'https://canvas.example' };
  assert.deepEqual(mergeSettings({}, saved), {
    GENTLE_CANVAS_LAN_HOST: '192.168.1.20',
    GENTLE_CANVAS_LAN_PORT: '34316',
    GENTLE_CANVAS_LAN_PUBLIC_ORIGIN: 'https://canvas.example',
  });
  assert.deepEqual(mergeSettings({ GENTLE_CANVAS_LAN_PORT: '40000' }, saved), {
    GENTLE_CANVAS_LAN_HOST: '192.168.1.20',
    GENTLE_CANVAS_LAN_PORT: '40000',
    GENTLE_CANVAS_LAN_PUBLIC_ORIGIN: 'https://canvas.example',
  });
});
