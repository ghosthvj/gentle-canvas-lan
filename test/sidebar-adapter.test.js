import test from 'node:test';
import assert from 'node:assert/strict';
import { attachSidebar } from '../src/sidebar-adapter.js';

const STATE = Symbol.for('gentle-pi.experimental-sidebar.state');
function component(rows) {
  return {
    revision: 0, invalidations: 0, events: [], widths: [],
    render(width) { this.widths.push(width); return rows.map(row => row.slice(0, width)); },
    invalidate() { this.invalidations++; },
    digest() { return String(this.revision); },
    handleMouse(event) { this.events.push(event); return { handled: true, render: true }; },
  };
}
function fixture() {
  const previous = component(['status', 'detail', 'hint']);
  previous.cardGroups = () => ({ groups: [{ start: 0, end: 2 }], loose: [2] });
  const panel = component(['Canvas LAN', 'LAN link']);
  const host = { active: true, ownsHost: () => true, statusHidden: () => false,
    parts: new Map([['footer', previous]]) };
  const tui = { mode: 'fullscreen', terminal: { [STATE]: host }, renders: 0,
    requestRender() { this.renders++; } };
  return { tui, host, previous, panel, footer: () => host.parts.get('footer') };
}

test('incompatible hosts and components are left untouched', () => {
  for (const tui of [null, {}, { mode: 'regular' }, { mode: 'fullscreen', terminal: {} },
    { mode: 'fullscreen', terminal: { [STATE]: { parts: {} } } }]) {
    assert.equal(attachSidebar(tui, component(['panel'])), null);
  }
  const f = fixture();
  assert.equal(attachSidebar(f.tui, {}), null);
  f.host.parts.set('footer', { render() {} });
  assert.equal(attachSidebar(f.tui, f.panel), null);
});

test('previous rows, grouped cards, loose rows, heights and mouse coordinates survive', () => {
  const f = fixture();
  const attachment = attachSidebar(f.tui, f.panel);
  assert.equal(attachment.isMounted(), true);
  assert.equal(attachment.isActive(), true);
  assert.deepEqual(f.footer().render(40), ['status', 'detail', 'hint', 'Canvas LAN', 'LAN link']);
  assert.deepEqual(f.footer().cardGroups(40), {
    groups: [{ start: 0, end: 2 }, { start: 3, end: 5 }], loose: [2],
  });
  const event = { x: 4, y: 1, height: 5, button: 'left' };
  assert.deepEqual(f.footer().handleMouse(event), { handled: true, render: true });
  assert.deepEqual(f.previous.events, [{ ...event, height: 3 }]);
  f.footer().handleMouse({ ...event, y: 4 });
  assert.deepEqual(f.panel.events, [{ ...event, y: 1, height: 2 }]);
  assert.equal(f.footer().handleMouse({ ...event, y: 5 }), undefined);
  assert.equal(f.footer().handleMouse({ ...event, y: -1 }), undefined);
  f.footer().render(4);
  assert.deepEqual(f.previous.widths, [40, 4]);
  assert.deepEqual(f.panel.widths, [40, 4]);
  attachment.dispose();
  assert.equal(f.footer(), f.previous);
});

test('ungrouped original gets its own card, empty panel gets no card', () => {
  const f = fixture();
  delete f.previous.cardGroups;
  f.panel.render = () => [];
  attachSidebar(f.tui, f.panel);
  assert.deepEqual(f.footer().cardGroups(20), { groups: [{ start: 0, end: 3 }], loose: [] });
});

test('digest tracks previous, panel, invalidation, resize and visibility without unsafe serialization', () => {
  const f = fixture();
  const a = attachSidebar(f.tui, f.panel);
  const changes = [() => f.previous.revision++, () => f.panel.revision++,
    () => a.invalidate(), () => f.footer().invalidate(), () => { f.host.active = false; }];
  for (const change of changes) {
    const before = f.footer().digest();
    change();
    assert.notEqual(f.footer().digest(), before);
  }
  assert.equal(f.previous.invalidations, 1);
  assert.equal(f.panel.invalidations, 1);
  for (const value of [1n, {}, undefined, Symbol('bad')]) {
    f.previous.digest = () => value;
    f.panel.digest = () => value;
    assert.equal(typeof f.footer().digest(), 'string');
  }
  f.previous.digest = f.panel.digest = () => { throw Error('optional digest'); };
  assert.equal(typeof f.footer().digest(), 'string');
  assert.ok(f.tui.renders > 0);
});

test('narrow, hidden, lost ownership and mismatched state never paint or route panel', () => {
  for (const disable of [f => { f.host.active = false; },
    f => { f.host.ownsHost = () => false; },
    f => { f.host.ownsHost = () => { throw Error('owner'); }; },
    f => { f.host.statusHidden = () => true; },
    f => { f.host.statusHidden = () => { throw Error('hidden'); }; },
    f => { f.tui.mode = 'regular'; },
    f => { f.tui.terminal[STATE] = { ...f.host }; }]) {
    const f = fixture();
    const a = attachSidebar(f.tui, f.panel);
    const wrapper = f.footer();
    wrapper.render(30);
    const before = wrapper.digest();
    disable(f);
    assert.equal(a.isActive(), false);
    assert.notEqual(wrapper.digest(), before);
    assert.deepEqual(wrapper.render(30), ['status', 'detail', 'hint']);
    assert.deepEqual(wrapper.cardGroups(30), { groups: [{ start: 0, end: 2 }], loose: [2] });
    wrapper.handleMouse({ y: 4, height: 5 });
    assert.deepEqual(f.panel.events, []);
    assert.equal(f.panel.widths.length, 1);
    a.dispose();
  }
});

for (const order of [[0, 1], [1, 0]]) {
  test(`double attachment disposes safely in order ${order}`, () => {
    const f = fixture();
    const second = component(['second']);
    const a = [attachSidebar(f.tui, f.panel), attachSidebar(f.tui, second)];
    assert.ok(a.every(entry => entry.isMounted() && entry.isActive()));
    assert.deepEqual(f.footer().render(30), ['status', 'detail', 'hint', 'Canvas LAN', 'LAN link', 'second']);
    a[order[0]].dispose();
    a[order[0]].dispose();
    assert.equal(a[order[0]].isMounted(), false);
    const remaining = order[0] === 0 ? ['second'] : ['Canvas LAN', 'LAN link'];
    assert.deepEqual(f.footer().render(30), ['status', 'detail', 'hint', ...remaining]);
    a[order[1]].dispose();
    assert.equal(f.footer(), f.previous);
    const renders = f.tui.renders;
    a[0].invalidate(); a[1].invalidate();
    assert.equal(f.tui.renders, renders);
  });
}

test('newer MCP-style owner is not clobbered; captured disposed wrapper delegates', () => {
  const f = fixture();
  const a = attachSidebar(f.tui, f.panel);
  const captured = f.footer();
  const foreign = { render: width => [...captured.render(width), 'MCP'], invalidate() {} };
  const key = Symbol.for('mcp-sidebar.gentle-shell-rail-stack');
  const foreignState = {};
  f.tui.terminal[key] = foreignState;
  f.host.parts.set('footer', foreign);
  assert.equal(a.isMounted(), false);
  a.dispose();
  assert.equal(f.footer(), foreign);
  assert.equal(f.tui.terminal[key], foreignState);
  assert.deepEqual(f.footer().render(30), ['status', 'detail', 'hint', 'MCP']);
  assert.deepEqual(captured.cardGroups(30), f.previous.cardGroups(30));
  const previousInvalidations = f.previous.invalidations;
  captured.invalidate();
  assert.equal(f.previous.invalidations, previousInvalidations + 1);
  assert.equal(f.panel.invalidations, 0);
});

test('MCP-style existing footer remains first and restores unchanged', () => {
  const f = fixture();
  const mcp = component(['MCP']);
  f.host.parts.set('footer', mcp);
  const a = attachSidebar(f.tui, f.panel);
  assert.deepEqual(f.footer().render(20), ['MCP', 'Canvas LAN', 'LAN link']);
  a.dispose();
  assert.equal(f.footer(), mcp);
});
