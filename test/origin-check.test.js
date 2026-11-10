import test from 'node:test';
import assert from 'node:assert/strict';
import { createOriginInspector } from '../src/origin-check.js';

const lookupOf = map => async hostname => {
  if (!(hostname in map)) { const e = new Error('lookup failed'); e.code = 'ENOTFOUND'; throw e; }
  return { address: map[hostname] };
};

test('IP-literal origins need no resolution', async () => {
  const inspect = createOriginInspector({ lookupHost: lookupOf({}) });
  assert.deepEqual(await inspect({ host: '192.168.1.20', publicOrigin: 'http://192.168.1.20:34316' }),
    { kind: 'ip-literal' });
});

test('a hostname resolving to the bind IP reports a direct exposure', async () => {
  const inspect = createOriginInspector({ lookupHost: lookupOf({ 'canvas.lan': '192.168.1.20' }) });
  const result = await inspect({ host: '192.168.1.20', publicOrigin: 'https://canvas.lan' });
  assert.deepEqual(result, {
    kind: 'hostname', hostname: 'canvas.lan', address: '192.168.1.20',
    isPublic: false, matchesBind: true,
  });
});

test('a hostname resolving elsewhere is flagged as not the bind IP', async () => {
  const inspect = createOriginInspector({ lookupHost: lookupOf({ 'canvas.example': '192.168.1.99' }) });
  const result = await inspect({ host: '192.168.1.20', publicOrigin: 'https://canvas.example' });
  assert.equal(result.matchesBind, false);
  assert.equal(result.isPublic, false);
});

test('a hostname resolving to a public address is flagged as public', async () => {
  const inspect = createOriginInspector({ lookupHost: lookupOf({ 'canvas.example': '203.0.113.5' }) });
  const result = await inspect({ host: '192.168.1.20', publicOrigin: 'https://canvas.example' });
  assert.equal(result.isPublic, true);
  assert.equal(result.matchesBind, false);
});

test('a hostname that does not resolve reports an error without throwing', async () => {
  const inspect = createOriginInspector({ lookupHost: lookupOf({}) });
  const result = await inspect({ host: '192.168.1.20', publicOrigin: 'https://canvas.example' });
  assert.equal(result.kind, 'hostname');
  assert.equal(result.address, null);
  assert.equal(result.error, true);
});
