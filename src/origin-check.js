import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// The public origin is trusted by the proxy's Origin gate, so a hostname the
// user does not control turns that gate into a door for its new owner. This
// inspector surfaces where a hostname actually points; it never blocks a
// working reverse-proxy topology (hostname -> another machine).

function isPrivateV4(address) {
  const bytes = address.split('.').map(Number);
  return bytes[0] === 10 || bytes[0] === 127 ||
    (bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31) ||
    (bytes[0] === 192 && bytes[1] === 168) ||
    (bytes[0] === 169 && bytes[1] === 254);
}

function isPrivateV6(address) {
  const word = address.toLowerCase().replace(/%.*$/, '');
  return word === '::1' || word.startsWith('fe80') || word.startsWith('fc') ||
    word.startsWith('fd') || word.startsWith('::ffff:');
}

export function isPrivateAddress(address) {
  const family = isIP(address);
  if (family === 4) return isPrivateV4(address);
  if (family === 6) return isPrivateV6(address);
  return false;
}

function hostnameOf(origin) {
  try {
    const hostname = new URL(origin).hostname;
    return hostname && !isIP(hostname) ? hostname : null;
  } catch {
    return null;
  }
}

/** Async DNS inspection of a configured public origin; lookup is injectable for tests. */
export function createOriginInspector({ lookupHost = lookup } = {}) {
  return async function inspectPublicOrigin(config) {
    const hostname = hostnameOf(config?.publicOrigin);
    if (!hostname) return { kind: 'ip-literal' };
    try {
      const { address } = await lookupHost(hostname);
      return {
        kind: 'hostname', hostname, address,
        isPublic: !isPrivateAddress(address),
        matchesBind: address === config.host,
      };
    } catch {
      return { kind: 'hostname', hostname, address: null, error: true };
    }
  };
}
