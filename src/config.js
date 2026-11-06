import { isIP } from 'node:net';

function invalid(message) {
  // Never echo capability URLs or environment values in errors.
  throw new TypeError(message);
}

function parsePort(value, label) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    invalid(`${label} must be an integer from 1 to 65535.`);
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    invalid(`${label} must be an integer from 1 to 65535.`);
  }
  return port;
}

function forbiddenIPv4(address) {
  const bytes = address.split('.').map(Number);
  return bytes.every((byte) => byte === 0) || (bytes[0] >= 224 && bytes[0] <= 239);
}

function forbiddenIPv6(address) {
  // Expand a validated literal, including IPv4-mapped forms, for range checks.
  const hex = address.toLowerCase().replace(/\d+\.\d+\.\d+\.\d+$/, (ipv4) => {
    const bytes = ipv4.split('.').map(Number);
    return `${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  });
  const halves = hex.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const words = (halves.length === 1 ? left : [
    ...left, ...Array(8 - left.length - right.length).fill('0'), ...right,
  ]).map((word) => Number.parseInt(word, 16));
  if (words.every((word) => word === 0) || (words[0] & 0xff00) === 0xff00) return true;
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return forbiddenIPv4(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
  }
  return false;
}

function parsePublicOrigin(value) {
  if (typeof value !== 'string' || /[\s\\]/.test(value)) {
    invalid('GENTLE_CANVAS_LAN_PUBLIC_ORIGIN must be an HTTP or HTTPS origin only.');
  }
  const match = /^(https?):\/\/(\[[0-9a-f: .]+\]|[^:/?#@%]+)(?::([0-9]+))?$/i.exec(value);
  if (!match) invalid('GENTLE_CANVAS_LAN_PUBLIC_ORIGIN must be an HTTP or HTTPS origin only.');
  if (match[3] !== undefined) parsePort(match[3], 'Public origin port');
  try {
    return new URL(value).origin;
  } catch {
    invalid('GENTLE_CANVAS_LAN_PUBLIC_ORIGIN must be an HTTP or HTTPS origin only.');
  }
}

export function readConfig(env = process.env) {
  const host = env.GENTLE_CANVAS_LAN_HOST;
  const family = typeof host === 'string' && !host.includes('%') ? isIP(host) : 0;
  if (!family || (family === 4 ? forbiddenIPv4(host) : forbiddenIPv6(host))) {
    invalid('GENTLE_CANVAS_LAN_HOST must be an explicit concrete IP address, not unspecified or multicast.');
  }
  const port = env.GENTLE_CANVAS_LAN_PORT === undefined
    ? 34316 : parsePort(env.GENTLE_CANVAS_LAN_PORT, 'GENTLE_CANVAS_LAN_PORT');
  const authority = family === 6 ? `[${host}]` : host;
  const publicOrigin = env.GENTLE_CANVAS_LAN_PUBLIC_ORIGIN === undefined
    ? new URL(`http://${authority}:${port}`).origin
    : parsePublicOrigin(env.GENTLE_CANVAS_LAN_PUBLIC_ORIGIN);
  return Object.freeze({ host, port, publicOrigin });
}

export function parseCanvasUrl(value) {
  // Validate raw input before WHATWG URL parsing can hide host/path tricks.
  if (typeof value !== 'string' || /[\s\\#\x00-\x1f\x7f]/.test(value)) {
    invalid('Canvas URL must be a loopback HTTP URL with an explicit port and token path.');
  }
  const match = /^http:\/\/(127\.0\.0\.1|localhost):([0-9]+)(\/[^?]*)(\?.*)?$/i.exec(value);
  if (!match) invalid('Canvas URL must be a loopback HTTP URL with an explicit port and token path.');
  const port = parsePort(match[2], 'Canvas port');
  const path = match[3];
  const segments = path.slice(1).split('/');
  const token = segments[0];
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    invalid('Canvas token must contain 16 to 128 ASCII letters, digits, underscores or hyphens.');
  }
  if (/%(?:2f|5c)/i.test(path) || segments.some((segment) => {
    const dots = segment.replace(/%2e/ig, '.');
    return dots === '.' || dots === '..';
  })) {
    invalid('Canvas path must not contain dot segments or encoded separators.');
  }
  const origin = new URL(`http://127.0.0.1:${port}`).origin;
  return Object.freeze({ url: `${origin}${path}${match[4] ?? ''}`, origin, token });
}

export function createCanvasRegistry() {
  let current = null;
  return {
    register(url) {
      const parsed = parseCanvasUrl(url);
      current = parsed;
      return parsed;
    },
    clear() {
      current = null;
    },
    get current() {
      return current;
    },
  };
}
