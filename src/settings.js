import { mkdir, readFile, rename, writeFile, chmod, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { readConfig } from './config.js';

export const defaultSettingsPath = (env = process.env) =>
  join(env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), '.config'), 'gentle-canvas-lan', 'config.json');

const KEYS = ['ip', 'port', 'publicOrigin'];
// Settings written before the IP rename still carry the old key.
const LEGACY_KEYS = { host: 'ip' };

/** Read the persisted menu settings; missing or malformed files behave as empty. */
export async function loadSettings(path = defaultSettingsPath()) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const normalized = { ...parsed };
  for (const [legacy, current] of Object.entries(LEGACY_KEYS)) {
    if (typeof normalized[current] !== 'string' && typeof parsed[legacy] === 'string') normalized[current] = parsed[legacy];
  }
  return Object.fromEntries(KEYS.filter(key => typeof normalized[key] === 'string').map(key => [key, normalized[key]]));
}

/** Environment wins for one-off overrides; saved values fill what is absent. */
export function mergeSettings(env = process.env, saved = {}) {
  const merged = { ...env };
  if (env.GENTLE_CANVAS_LAN_IP === undefined && saved.ip !== undefined) merged.GENTLE_CANVAS_LAN_IP = saved.ip;
  if (env.GENTLE_CANVAS_LAN_PORT === undefined && saved.port !== undefined) merged.GENTLE_CANVAS_LAN_PORT = saved.port;
  if (env.GENTLE_CANVAS_LAN_PUBLIC_ORIGIN === undefined && saved.publicOrigin !== undefined) {
    merged.GENTLE_CANVAS_LAN_PUBLIC_ORIGIN = saved.publicOrigin;
  }
  return merged;
}

/** Validate the complete persisted trio before it is used or written. */
export function validateSettings(values = {}) {
  const next = {};
  if (typeof values.ip !== 'string' || !values.ip.trim()) throw new TypeError('IP is required.');
  next.ip = values.ip.trim();
  if (typeof values.port !== 'string' || !values.port.trim()) throw new TypeError('PORT is required.');
  next.port = values.port.trim();
  if (typeof values.publicOrigin === 'string' && values.publicOrigin.trim()) next.publicOrigin = values.publicOrigin.trim();
  readConfig({
    GENTLE_CANVAS_LAN_IP: next.ip,
    GENTLE_CANVAS_LAN_PORT: next.port,
    ...(next.publicOrigin ? { GENTLE_CANVAS_LAN_PUBLIC_ORIGIN: next.publicOrigin } : {}),
  });
  return next;
}

/** Atomic replace of the validated settings; user-only file. */
export async function saveSettings(path, values) {
  const next = validateSettings(values);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return next;
}
