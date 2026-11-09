import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, parseCanvasUrl, createCanvasRegistry } from '../src/config.js';

const token = 'Abcd_0123456789-x';
const target = `http://127.0.0.1:43210/${token}/`;
const env = { GENTLE_CANVAS_LAN_IP: '192.168.1.20' };

function rejectsWithoutReplacing(action) {
  const registry = createCanvasRegistry();
  const previous = registry.register(target);
  assert.throws(() => action(registry), { name: 'TypeError' });
  assert.equal(registry.current, previous);
  assert.deepEqual(registry.current, parseCanvasUrl(target));
}

test('explicit bind address, fixed default port and immutable configuration', () => {
  const config = readConfig(env);
  assert.deepEqual(config, {
    host: '192.168.1.20', port: 34316, publicOrigin: 'http://192.168.1.20:34316',
  });
  assert.ok(Object.isFrozen(config));
});

for (const host of ['127.0.0.1', '::1', '2001:db8::1234', '::ffff:127.0.0.1']) {
  test(`concrete bind address ${host}`, () => {
    const config = readConfig({ GENTLE_CANVAS_LAN_IP: host });
    assert.equal(config.host, host);
    assert.equal(config.publicOrigin, new URL(`http://${host.includes(':') ? `[${host}]` : host}:34316`).origin);
  });
}

for (const host of [undefined, '', 'localhost', '0.0.0.0', '::', '0:0:0:0:0:0:0:0',
  '224.0.0.1', '239.255.255.255', 'ff02::1', '::ffff:224.0.0.1', '::ffff:0.0.0.0',
  '::ffff:e000:1', '[::1]', 'fe80::1%eth0', '192.168.1.1 ', '127.1', 123]) {
  test(`reject bind address ${String(host)}`, () => {
    rejectsWithoutReplacing(() => readConfig({ GENTLE_CANVAS_LAN_IP: host }));
  });
}

test('optional body cap and connection cap override proxy defaults', () => {
  const config = readConfig({ ...env, GENTLE_CANVAS_LAN_MAX_BODY_BYTES: '1048576', GENTLE_CANVAS_LAN_MAX_CONNECTIONS: '32' });
  assert.equal(config.maxBodyBytes, 1048576);
  assert.equal(config.maxConnections, 32);
  const absent = readConfig(env);
  assert.equal('maxBodyBytes' in absent, false, 'unset keeps the proxy default');
  assert.equal('maxConnections' in absent, false, 'unset keeps the proxy default');
});

for (const cap of ['0', '-5', '2147483648', '1.5', 'abc', '']) {
  test(`reject body cap ${String(cap)}`, () => {
    rejectsWithoutReplacing(() => readConfig({ ...env, GENTLE_CANVAS_LAN_MAX_BODY_BYTES: cap }));
  });
  test(`reject connection cap ${String(cap)}`, () => {
    rejectsWithoutReplacing(() => readConfig({ ...env, GENTLE_CANVAS_LAN_MAX_CONNECTIONS: cap }));
  });
}

for (const port of ['1', '80', '65535', '34316']) {
  test(`explicit port ${port}`, () => {
    const config = readConfig({ ...env, GENTLE_CANVAS_LAN_PORT: port });
    assert.equal(config.port, Number(port));
    assert.equal(config.publicOrigin, new URL(`http://192.168.1.20:${port}`).origin);
  });
}

for (const port of ['', '0', '65536', '-1', '1.5', '1e3', ' 80', '80 ', '+80', 'abc', null, 80]) {
  test(`reject explicit port ${JSON.stringify(port)}`, () => {
    rejectsWithoutReplacing(() => readConfig({ ...env, GENTLE_CANVAS_LAN_PORT: port }));
  });
}

for (const origin of ['https://canvas.example', 'http://canvas.example:8080', 'https://[::1]:8443']) {
  test(`external origin ${origin}`, () => {
    assert.equal(readConfig({ ...env, GENTLE_CANVAS_LAN_PUBLIC_ORIGIN: origin }).publicOrigin, origin);
  });
}

for (const origin of ['', 'ftp://canvas.example', 'https://user:pass@canvas.example',
  'https://canvas.example/', 'https://canvas.example/path', 'https://canvas.example?',
  'https://canvas.example#', 'https://canvas.example:0', 'https://canvas.example:65536',
  'https://canvas.example:', ' https://canvas.example', 'https://canvas.example\\path',
  'https://canvas.\nexample', '//canvas.example', null, 123]) {
  test(`reject external origin ${JSON.stringify(origin)}`, () => {
    rejectsWithoutReplacing(() => readConfig({ ...env, GENTLE_CANVAS_LAN_PUBLIC_ORIGIN: origin }));
  });
}

test('selected path and query survive localhost normalization', () => {
  const suffix = `/${token}/files/design%20one.html?name=a%2Fb&name=c+e`;
  const parsed = parseCanvasUrl(`http://localhost:43210${suffix}`);
  assert.deepEqual(parsed, { url: `http://127.0.0.1:43210${suffix}`, origin: 'http://127.0.0.1:43210', token });
  assert.ok(Object.isFrozen(parsed));
});

for (const length of [16, 128]) {
  test(`accept token length ${length} without trailing slash`, () => {
    const value = '_'.repeat(length);
    assert.deepEqual(parseCanvasUrl(`http://127.0.0.1:80/${value}?x=1`), {
      url: `http://127.0.0.1/${value}?x=1`, origin: 'http://127.0.0.1', token: value,
    });
  });
}

const invalidUrls = [
  undefined, null, 123, {}, new URL(target), '',
  `https://127.0.0.1:43210/${token}/`, `http://192.168.1.20:43210/${token}/`,
  `http://[::1]:43210/${token}/`, `http://127.0.0.2:43210/${token}/`,
  `http://127.1:43210/${token}/`, `http://2130706433:43210/${token}/`,
  `http://0x7f000001:43210/${token}/`, `http://localhost.:43210/${token}/`,
  `http://%6cocalhost:43210/${token}/`, `http://localhost/${token}/`,
  `http://localhost:/${token}/`, `http://localhost:0/${token}/`,
  `http://localhost:65536/${token}/`, `http://localhost:+80/${token}/`,
  `http://user@localhost:43210/${token}/`, `${target}#`, `${target}#fragment`,
  ` ${target}`, `${target}\n`, `http://local\thost:43210/${token}/`,
  `http://localhost:43210\\${token}/`, `${target}files\\x`,
  'http://localhost:43210/', `http://localhost:43210//${token}/`,
  `http://localhost:43210/${'a'.repeat(15)}/`, `http://localhost:43210/${'a'.repeat(129)}/`,
  `http://localhost:43210/${token}!/`, `http://localhost:43210/%41${token.slice(1)}/`,
  `${target}../other`, `${target}./other`, `${target}%2e%2e/other`,
  `${target}.%2E/other`, `${target}files/%2fother`, `${target}files/%5cother`,
];
for (const [index, value] of invalidUrls.entries()) {
  test(`reject untrusted canvas URL ${index}`, () => {
    rejectsWithoutReplacing((registry) => registry.register(value));
    rejectsWithoutReplacing(() => parseCanvasUrl(value));
  });
}

test('registration rotates atomically and clear is repeatable', () => {
  const registry = createCanvasRegistry();
  assert.equal(registry.current, null);
  const first = registry.register(target);
  assert.equal(registry.current, first);
  const second = registry.register(`http://localhost:54321/${'z'.repeat(32)}/?view=2`);
  assert.equal(registry.current, second);
  assert.notEqual(second, first);
  assert.equal(second.origin, 'http://127.0.0.1:54321');
  assert.equal(second.token, 'z'.repeat(32));
  assert.equal(first.url, target);
  registry.clear();
  assert.equal(registry.current, null);
  registry.clear();
  assert.equal(registry.current, null);
});
