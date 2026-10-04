import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceSymbolPresentation, sourcePanelVisible} from '../apps/studio/source-symbol-presentation.js';
import {sessionDom} from './fixtures/a18-session-dom.js';

function symbols(count = 3, uri = 'A.cs', shift = 0) {
  return Array.from({length: count}, (_, index) => ({
    uri, name: 'Method' + index, owner: 'Sample', kind: 'method', start: 50 * index + shift, end: 50 * index + shift + 8
  }));
}

function presentationHost({values = symbols(), hidden = false} = {}) {
  const {document, observers} = sessionDom();
  const writes = {created: 0, text: 0, appended: 0, replaced: 0};
  const createElement = document.createElement;
  document.createElement = tag => {
    const element = createElement(tag);
    writes.created++;
    const content = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'textContent');
    Object.defineProperty(element, 'textContent', {
      get: () => content.get.call(element),
      set: value => { writes.text++; content.set.call(element, value); }
    });
    const append = element.append.bind(element);
    element.append = (...children) => { writes.appended++; append(...children); };
    const replace = element.replaceChildren.bind(element);
    element.replaceChildren = (...children) => { writes.replaced++; replace(...children); };
    element.contains = target => {
      for (let current = target; current; current = current.parentElement) {
        if (current === element) return true;
      }
      return false;
    };
    element.getBoundingClientRect = () => { throw new Error('Symbol presentation must not force layout'); };
    return element;
  };
  const breadcrumb = document.createElement('span');
  const navigation = document.createElement('select');
  const outline = document.createElement('section');
  const group = document.createElement('aside');
  group.hidden = hidden;
  group.append(outline);
  document.body.append(breadcrumb, navigation, group);
  const listeners = new Set();
  const docking = {content: new Map([['outline', outline]]), layout: {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  }};
  const state = {active: 'A.cs', revision: 1, result: {symbols: values}};
  const calls = [];
  const presentation = new SourceSymbolPresentation({
    state, docking, breadcrumb, navigation, openSource: (...args) => calls.push(args)
  });
  const click = index => {
    const row = outline.querySelector(`[data-outline="${index}"]`);
    for (const listener of outline.listeners.get('click') ?? []) listener({target: row.children[1]});
  };
  const show = () => {
    group.hidden = false;
    for (const listener of listeners) listener();
  };
  presentation.update();
  return {presentation, state, document, breadcrumb, navigation, outline, group, writes, calls, observers, listeners, click, show};
}

test('3000 accepted symbols keep every option and row while shifted source locations make no DOM writes', () => {
  const host = presentationHost({values: symbols(3000)});
  const options = [...host.navigation.children];
  const rows = host.outline.querySelectorAll('[data-outline]');
  const before = {...host.writes};
  host.navigation.value = '2500';
  host.outline.scrollTop = 320;
  host.state.revision++;
  host.state.result = {symbols: symbols(3000, 'A.cs', 13)};

  host.presentation.update();

  assert.equal(host.navigation.children.length, 3001);
  assert.equal(host.outline.querySelectorAll('[data-outline]').length, 3000);
  assert.deepEqual(host.navigation.children, options);
  assert.deepEqual(host.outline.querySelectorAll('[data-outline]'), rows);
  assert.deepEqual(host.writes, before);
  assert.equal(host.navigation.value, '2500');
  assert.equal(host.outline.scrollTop, 320);
  assert.deepEqual(host.calls, []);
  host.presentation.dispose();
});

test('breadcrumb and Outline clicks resolve the latest spans even when labels and DOM are unchanged', async () => {
  const values = symbols(2).map(symbol => ({...symbol, name: 'Overload'}));
  const host = presentationHost({values});
  host.state.result = {symbols: values.map(symbol => ({...symbol, start: symbol.start + 20, end: symbol.end + 20}))};
  host.presentation.update();

  host.navigation.value = '1';
  await host.navigation.fire('change');
  host.click(1);

  assert.deepEqual(host.calls, [['A.cs', 70], ['A.cs', 70, 78]]);
  assert.equal(host.navigation.children[2].textContent, 'Sample.Overload(…)');
  assert.equal(host.outline.querySelector('[data-outline="1"]').children[1].textContent, 'Sample.Overload');
  host.presentation.dispose();
});

test('changing one symbol label updates that label while preserving the other options and outline buttons', () => {
  const host = presentationHost({values: symbols(3000)});
  const option = host.navigation.children[1501];
  const row = host.outline.querySelector('[data-outline="1500"]');
  const before = {...host.writes};
  host.state.result = {symbols: symbols(3000).map((symbol, index) => index === 1500 ? {...symbol, name: 'Renamed'} : symbol)};

  host.presentation.update();

  assert.equal(host.navigation.children[1501], option);
  assert.equal(host.outline.querySelector('[data-outline="1500"]'), row);
  assert.equal(option.textContent, 'Sample.Renamed(…)');
  assert.equal(row.children[1].textContent, 'Sample.Renamed');
  assert.equal(host.writes.created, before.created);
  assert.equal(host.writes.text - before.text, 2);
  host.presentation.dispose();
});

test('hidden Outline defers its DOM and showing its dock group renders all symbols from only the latest result', () => {
  const host = presentationHost({values: symbols(3000), hidden: true});
  assert.equal(sourcePanelVisible(host.outline), false);
  assert.equal(host.outline.children.length, 0);
  assert.equal(host.navigation.children.length, 3001);
  host.state.result = {symbols: symbols(3000, 'A.cs', 4).map(symbol => ({...symbol, name: 'Old' + symbol.name}))};
  host.presentation.update();
  host.state.result = {symbols: symbols(3000, 'A.cs', 9).map(symbol => ({...symbol, name: 'Latest' + symbol.name}))};
  host.presentation.update();
  assert.equal(host.outline.children.length, 0);

  host.show();
  host.click(2999);

  assert.equal(sourcePanelVisible(host.outline), true);
  assert.equal(host.outline.querySelectorAll('[data-outline]').length, 3000);
  assert.equal(host.outline.querySelector('[data-outline="2999"]').children[1].textContent, 'Sample.LatestMethod2999');
  assert.deepEqual(host.calls, [['A.cs', 149959, 149967]]);
  host.presentation.dispose();
});

test('visibility observation flushes a detached or hidden Outline without relying on a docking activation event', () => {
  const host = presentationHost({hidden: true});
  host.group.remove();
  host.state.result = {symbols: symbols(4, 'A.cs', 3)};
  host.presentation.update();
  assert.equal(host.outline.children.length, 0);
  host.document.body.append(host.group);
  host.group.hidden = false;

  host.observers[0].callback();

  assert.equal(host.outline.querySelectorAll('[data-outline]').length, 4);
  host.click(3);
  assert.deepEqual(host.calls, [['A.cs', 153, 161]]);
  host.presentation.dispose();
});

test('an inert but visible tool remains current while a modal owns keyboard input', () => {
  const host = presentationHost();
  host.group.inert = true;
  host.state.result = {symbols: symbols(4)};

  host.presentation.update();

  assert.equal(sourcePanelVisible(host.outline), true);
  assert.equal(host.outline.querySelectorAll('[data-outline]').length, 4);
  host.group.inert = false;
  host.click(3);
  assert.deepEqual(host.calls, [['A.cs', 150, 158]]);
  host.presentation.dispose();
});

test('file changes and symbol removal update both navigation views without moving the caret during rendering', async () => {
  const values = [...symbols(3), ...symbols(2, 'B.cs', 100),
    {uri: 'B.cs', name: 'local', kind: 'local', start: 0, end: 1},
    {uri: 'B.cs', name: '<generated>', kind: 'method', start: 1, end: 2}];
  const host = presentationHost({values});
  host.state.active = 'B.cs';
  host.presentation.update();
  assert.equal(host.breadcrumb.textContent, 'C#B.cs');
  assert.equal(host.navigation.children.length, 3);
  assert.equal(host.outline.querySelectorAll('[data-outline]').length, 2);
  assert.equal(host.outline.children[0].textContent, 'B.cs');
  assert.deepEqual(host.calls, []);
  host.navigation.value = '1';
  await host.navigation.fire('change');
  assert.deepEqual(host.calls, [['B.cs', 150]]);

  host.state.result = {symbols: []};
  host.presentation.update();

  assert.equal(host.navigation.children.length, 1);
  assert.equal(host.navigation.value, '');
  assert.equal(host.outline.querySelectorAll('[data-outline]').length, 0);
  assert.deepEqual(host.calls, [['B.cs', 150]]);
  host.presentation.dispose();
});

test('a stale displayed label is refreshed instead of navigating to a different symbol after an unpresented result', async () => {
  const host = presentationHost();
  host.state.result = {symbols: [{uri: 'A.cs', name: 'Replacement', kind: 'field', start: 500, end: 511}]};
  host.navigation.value = '1';

  await host.navigation.fire('change');

  assert.deepEqual(host.calls, []);
  assert.equal(host.navigation.children.length, 2);
  assert.equal(host.navigation.children[1].textContent, 'Replacement');
  host.navigation.value = '0';
  await host.navigation.fire('change');
  assert.deepEqual(host.calls, [['A.cs', 500]]);
  host.presentation.dispose();
});

test('disposal releases docking, visibility and navigation handlers and makes queued visibility notifications inert', async () => {
  const host = presentationHost();
  host.presentation.dispose();
  host.presentation.dispose();
  const before = {...host.writes};
  host.state.result = {symbols: symbols(4)};
  host.observers[0].callback();
  host.navigation.value = '0';
  await host.navigation.fire('change');

  assert.equal(host.listeners.size, 0);
  assert.ok(host.observers.every(observer => observer.disconnected));
  assert.equal(host.navigation.listeners.get('change').length, 0);
  assert.equal(host.outline.listeners.get('click').length, 0);
  assert.deepEqual(host.writes, before);
  assert.deepEqual(host.calls, []);
});
