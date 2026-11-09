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
  await writeFile(path, JSON.stringify({ ip: 42, port: '34316', extra: 'x' }));
  assert.deepEqual(await loadSettings(path), { port: '34316' });
});

test('saving validates atomically, writes only known keys and makes the file private', async t => {
  const path = await temp(t);
  const saved = await saveSettings(path, { ip: ' 192.168.1.20 ', port: '34316', publicOrigin: 'https://canvas.example' });
  assert.deepEqual(saved, { ip: '192.168.1.20', port: '34316', publicOrigin: 'https://canvas.example' });
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), saved);
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
  for (const [label, values] of [
    ['missing ip', { port: '34316' }],
    ['bad ip', { ip: '0.0.0.0', port: '34316' }],
    ['bad port', { ip: '192.168.1.20', port: '70000' }],
    ['bad origin', { ip: '192.168.1.20', port: '34316', publicOrigin: 'ftp://x' }],
  ]) {
    await assert.rejects(saveSettings(path, values), TypeError, label);
  }
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), saved);
});

test('environment overrides saved values only where it sets them', () => {
  const saved = { ip: '192.168.1.20', port: '34316', publicOrigin: 'https://canvas.example' };
  assert.deepEqual(mergeSettings({}, saved), {
    GENTLE_CANVAS_LAN_IP: '192.168.1.20',
    GENTLE_CANVAS_LAN_PORT: '34316',
    GENTLE_CANVAS_LAN_PUBLIC_ORIGIN: 'https://canvas.example',
  });
  assert.deepEqual(mergeSettings({ GENTLE_CANVAS_LAN_PORT: '40000' }, saved), {
    GENTLE_CANVAS_LAN_IP: '192.168.1.20',
    GENTLE_CANVAS_LAN_PORT: '40000',
    GENTLE_CANVAS_LAN_PUBLIC_ORIGIN: 'https://canvas.example',
  });
});

test('reads the legacy "host" key once and writes the renamed "ip" key back', async t => {
  const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'canvas-migrate-'));
  const path = join(dir, 'config.json');
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path, JSON.stringify({ host: '192.168.1.20', port: '34316' }));
  assert.deepEqual(await loadSettings(path), { ip: '192.168.1.20', port: '34316' });
  assert.deepEqual(mergeSettings({}, await loadSettings(path)), { GENTLE_CANVAS_LAN_IP: '192.168.1.20', GENTLE_CANVAS_LAN_PORT: '34316' });
  await saveSettings(path, { ip: '192.168.1.30', port: '35000' });
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { ip: '192.168.1.30', port: '35000' });
});

test('legacy file migration keeps port, origin and private mode on rewrite', async t => {
  const { mkdtemp, readFile, rm, stat, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'canvas-migrate-'));
  const path = join(dir, 'config.json');
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path, JSON.stringify({ host: '192.168.1.20', port: '35000', publicOrigin: 'https://canvas.example' }));
  const loaded = await loadSettings(path);
  assert.deepEqual(loaded, { ip: '192.168.1.20', port: '35000', publicOrigin: 'https://canvas.example' });
  await saveSettings(path, loaded);
  const onDisk = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(onDisk, loaded);
  assert.equal('host' in onDisk, false, 'the legacy key is not rewritten');
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
  const before = await readFile(path, 'utf8');
  await assert.rejects(saveSettings(path, { ip: '0.0.0.0', port: '35000' }), TypeError);
  assert.equal(await readFile(path, 'utf8'), before, 'a rejected save leaves the stored bytes untouched');
});

test('a non-string "ip" falls back to the valid legacy "host" value', async t => {
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'canvas-migrate-'));
  const path = join(dir, 'config.json');
  t.after(() => rm(dir, { recursive: true, force: true }));
  // An empty string is a string: it survives as-is and then fails validation loudly.
  for (const broken of [null, 42]) {
    await writeFile(path, JSON.stringify({ ip: broken, host: '192.168.1.20', port: '34316' }));
    assert.deepEqual(await loadSettings(path), { ip: '192.168.1.20', port: '34316' }, `ip: ${JSON.stringify(broken)}`);
  }
});
