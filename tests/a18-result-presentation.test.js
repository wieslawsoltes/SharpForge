import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {disassemble} from '@sharpforge/bytecode';
import {disassembleAssembly} from '@sharpforge/cil';
import {createToolRegistry} from '../apps/studio/tools/registry.js';
import {registerCompilerResultTools} from '../apps/studio/tools/compiler-result-views.js';
import {sessionDom} from './fixtures/a18-session-dom.js';

const compiled = new Map();
function build(count = 2) {
  if (!compiled.has(count)) {
    const methods = Array.from({length: count}, (_, index) => `static int Method${index}() { return ${index}; }`).join('\n');
    const text = `class Program {\n${methods}\nstatic void Main() { int value = Method0(); Console.WriteLine(value); }\n}`;
    const result = compileToIL([{uri: 'Results.cs', text}]);
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    compiled.set(count, result);
  }
  return compiled.get(count);
}

function fixture({hidden = false, result = build()} = {}) {
  const {document, observers} = sessionDom();
  const writes = {created: 0, text: 0, append: 0, replace: 0, html: 0};
  const create = document.createElement;
  document.createElement = tag => {
    const element = create(tag);
    writes.created++;
    const content = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'textContent');
    Object.defineProperty(element, 'textContent', {
      get: () => content.get.call(element),
      set: value => { writes.text++; content.set.call(element, value); }
    });
    Object.defineProperty(element, 'innerHTML', {
      get: () => element.lastMarkup ?? '',
      set: value => { writes.html++; element.lastMarkup = value; element.replaceChildren(); }
    });
    const append = element.append.bind(element);
    element.append = (...children) => { writes.append++; append(...children); };
    const replace = element.replaceChildren.bind(element);
    element.replaceChildren = (...children) => { writes.replace++; replace(...children); };
    element.contains = candidate => {
      for (let current = candidate; current; current = current.parentElement) if (current === element) return true;
      return false;
    };
    element.getBoundingClientRect = () => { throw new Error('Result visibility must not force layout'); };
    return element;
  };
  const group = document.createElement('aside');
  group.hidden = hidden;
  const panels = new Map(['bytecode', 'generated', 'other'].map(id => [id, document.createElement('section')]));
  group.append(...panels.values());
  document.body.append(group);
  const listeners = new Set();
  const docking = {content: panels, layout: {
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); }
  }};
  const state = {image: result.image, assembly: result.assembly, result, selectedMethod: result.image.methods[0].id,
    ilDump: null, disassemblyFormat: 'ir', buildDirty: false, debug: null};
  const calls = [];
  const fallback = [];
  const registry = createToolRegistry();
  registerCompilerResultTools(registry, [...panels.keys()].map(id => ({id, title: id})), {
    state, docking, empty: title => title, hydrate() {}, formatBytes: bytes => bytes + ' bytes',
    openFile: (...args) => calls.push(args)
  }, (...args) => fallback.push(args));
  const show = () => { group.hidden = false; for (const callback of listeners) callback(); };
  const emit = (panel, name, target) => {
    for (const listener of panels.get(panel).listeners.get(name) ?? []) listener({target});
  };
  return {document, observers, writes, group, panels, listeners, state, calls, fallback, registry, show, emit};
}

test('hidden result tools retain the latest build and generated files without producing DOM or disassembly', () => {
  const host = fixture({hidden: true});
  host.state.disassemblyFormat = 'cil';
  const before = {...host.writes};
  const bytecode = host.registry.mount('bytecode', host.panels.get('bytecode'));
  const generated = host.registry.mount('generated', host.panels.get('generated'));
  for (let version = 0; version < 12; version++) {
    host.state.result = {...build(), generatedSources: [{uri: 'Latest.g.cs', text: `// revision ${version}`} ]};
    bytecode.render();
    generated.render();
  }
  host.state.image = build(4).image;
  host.state.assembly = build(4).assembly;
  host.state.selectedMethod = host.state.image.methods.at(-1).id;
  assert.deepEqual(host.writes, before);
  assert.equal(host.state.ilDump, null);

  host.show();

  assert.equal(host.panels.get('bytecode').querySelector('#bytecode-method').children.length, host.state.image.methods.length);
  assert.equal(host.panels.get('bytecode').querySelector('#bytecode-method').value, String(host.state.selectedMethod));
  assert.equal(host.panels.get('generated').querySelector('pre').textContent, '// revision 11');
  assert.ok(host.state.ilDump.methods.length);
  host.registry.dispose();
});

test('unchanged 2000-method images reuse every native option and instruction row across analysis replies', () => {
  const host = fixture({result: build(2000)});
  const panel = host.panels.get('bytecode');
  const mount = host.registry.mount('bytecode', panel);
  const select = panel.querySelector('#bytecode-method');
  const options = [...select.children];
  const rows = [...panel.querySelector('tbody').children];
  const before = {...host.writes};
  panel.scrollTop = 430;
  select.focus();
  for (let revision = 0; revision < 12; revision++) {
    host.state.result = {...host.state.result, metrics: {revision}};
    mount.render();
  }
  assert.ok(options.length >= 2000);
  assert.equal(options.length, host.state.image.methods.length);
  assert.deepEqual(select.children, options);
  assert.deepEqual(panel.querySelector('tbody').children, rows);
  assert.deepEqual(host.writes, before);
  assert.equal(panel.scrollTop, 430);
  assert.equal(host.document.activeElement, select);
  assert.equal(host.writes.html, 0, 'method inventory never enters an HTML parser');
  host.registry.dispose();
});

test('build status, selected method and current instruction stay live while method options retain identity', () => {
  const host = fixture();
  const panel = host.panels.get('bytecode');
  const mount = host.registry.mount('bytecode', panel);
  const select = panel.querySelector('#bytecode-method');
  const options = [...select.children];
  const selected = host.state.image.methods.find(method => method.name === 'Main');
  host.state.buildDirty = true;
  select.value = String(selected.id);
  host.emit('bytecode', 'change', select);
  assert.equal(host.state.selectedMethod, selected.id);
  assert.equal(panel.querySelector('[data-build-status]').textContent, 'Last successful build');
  assert.deepEqual(select.children, options);
  const rows = [...panel.querySelector('tbody').children];
  const instructions = disassemble(host.state.image, selected.id)[0].instructions;
  assert.deepEqual(rows.map(row => row.children[1].textContent), instructions.map(instruction => instruction.op));

  host.state.debug = {frames: [{methodId: selected.id, pc: instructions[0].offset}]};
  mount.render();
  assert.equal(rows[0].classList.contains('instruction-current'), true);
  host.state.debug.frames[0].pc = instructions[1].offset;
  mount.render();
  assert.equal(rows[0].classList.contains('instruction-current'), false);
  assert.equal(rows[1].classList.contains('instruction-current'), true);
  assert.deepEqual(panel.querySelector('tbody').children, rows);
  host.registry.dispose();
});

test('CIL and decoded VM rows match real assembly data and source navigation uses the current point', () => {
  const host = fixture();
  const panel = host.panels.get('bytecode');
  host.state.selectedMethod = host.state.image.methods.find(method => method.name === 'Main').id;
  host.state.disassemblyFormat = 'cil';
  host.registry.mount('bytecode', panel);
  const selected = host.state.selectedMethod;
  const expected = disassembleAssembly(host.state.assembly).methods.find(method => method.id === selected).instructions;
  const rows = [...panel.querySelector('tbody').children];
  assert.deepEqual(rows.map(row => row.children.map(cell => cell.textContent)), expected.map(instruction => [
    instruction.label, instruction.name, instruction.operandText,
    instruction.point ? 'SEQ ' + instruction.point.uri + ':' + instruction.point.line : ''
  ]));
  const pointRow = rows.find(row => row.dataset.point !== undefined);
  assert.ok(pointRow, 'compiled source supplies a navigable sequence point');
  const point = host.state.image.sequencePoints[Number(pointRow.dataset.point)];
  host.emit('bytecode', 'click', pointRow.children[0]);
  assert.deepEqual(host.calls, [[point.uri, point.start, point.end]]);

  const options = [...panel.querySelector('#bytecode-method').children];
  const format = panel.querySelector('#bytecode-format');
  format.value = 'ir';
  host.emit('bytecode', 'change', format);
  assert.equal(host.state.disassemblyFormat, 'ir');
  assert.deepEqual(panel.querySelector('#bytecode-method').children, options);
  assert.deepEqual(panel.querySelector('tbody').children.map(row => row.children[1].textContent),
    disassemble(host.state.image, selected)[0].instructions.map(instruction => instruction.op));
  host.registry.dispose();
});

test('a new image removes stale methods and an empty workspace releases rendered assembly data', () => {
  const host = fixture({result: build(4)});
  const panel = host.panels.get('bytecode');
  const mount = host.registry.mount('bytecode', panel);
  const options = [...panel.querySelector('#bytecode-method').children];
  host.state.image = build().image;
  host.state.assembly = build().assembly;
  host.state.ilDump = null;
  host.state.selectedMethod = 9999;
  mount.render();
  const select = panel.querySelector('#bytecode-method');
  assert.deepEqual(select.children.map(option => option.textContent), host.state.image.methods.map(method => method.qualifiedName));
  assert.equal(select.value, String(host.state.image.methods[0].id));
  assert.ok(options.slice(select.children.length).every(option => !option.isConnected));
  host.state.image = null;
  host.state.assembly = null;
  mount.render();
  assert.equal(panel.querySelector('#bytecode-method'), null);
  assert.match(panel.innerHTML, /No compiled assembly/);
  host.registry.dispose();
});

test('equal generated snapshots preserve collapsed files and scroll; changed text and removals publish the latest values', () => {
  const host = fixture();
  host.state.result = {generatedSources: [{uri: 'One.g.cs', text: '<literal> & value'}, {uri: 'Two.g.cs', text: '// second'}]};
  const panel = host.panels.get('generated');
  const mount = host.registry.mount('generated', panel);
  const files = panel.querySelectorAll('details');
  files[0].open = false;
  panel.scrollTop = 80;
  const before = {...host.writes};
  host.state.result = {generatedSources: host.state.result.generatedSources.map(file => ({...file}))};
  mount.render();
  assert.deepEqual(host.writes, before);
  assert.equal(files[0].open, false);
  assert.equal(panel.scrollTop, 80);
  assert.equal(panel.querySelector('pre').textContent, '<literal> & value');
  assert.equal(host.writes.html, 0);
  host.state.result = {generatedSources: [{uri: 'One.g.cs', text: '// changed'}]};
  mount.render();
  assert.equal(panel.querySelector('pre').textContent, '// changed');
  assert.equal(files[0].open, false);
  assert.equal(files[1].isConnected, false);
  host.state.result = null;
  mount.render();
  assert.match(panel.innerHTML, /No generated sources/);
  host.registry.dispose();
});

test('visibility observation handles detached, inert and restored panels without guarding unrelated tools', () => {
  const host = fixture({hidden: true});
  host.registry.mount('generated', host.panels.get('generated'));
  host.registry.mount('other', host.panels.get('other'));
  assert.deepEqual(host.fallback, [['other', host.panels.get('other')]]);
  host.group.remove();
  host.group.hidden = false;
  host.state.result = {generatedSources: [{uri: 'Fresh.g.cs', text: '// latest while detached'}]};
  host.observers[0].callback();
  assert.equal(host.panels.get('generated').children.length, 0);
  host.document.body.append(host.group);
  host.group.inert = true;
  host.observers[0].callback();
  assert.equal(host.panels.get('generated').querySelector('pre').textContent, '// latest while detached');
  host.registry.dispose();
});

test('tool disposal releases observers, docking subscribers and source handlers; queued callbacks are inert', () => {
  const host = fixture();
  host.registry.mount('bytecode', host.panels.get('bytecode'));
  host.registry.mount('generated', host.panels.get('generated'));
  host.registry.dispose();
  host.registry.dispose();
  const before = {...host.writes};
  host.state.result = {generatedSources: [{uri: 'After.g.cs', text: '// after close'}]};
  for (const observer of host.observers) observer.callback();
  assert.equal(host.listeners.size, 0);
  assert.ok(host.observers.every(observer => observer.disconnected));
  assert.equal(host.panels.get('bytecode').listeners.get('change').length, 0);
  assert.equal(host.panels.get('bytecode').listeners.get('click').length, 0);
  assert.deepEqual(host.writes, before);
  assert.deepEqual(host.calls, []);
});
