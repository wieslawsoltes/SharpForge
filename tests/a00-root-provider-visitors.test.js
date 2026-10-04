import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkRootProviders, rootSites, sourceRootSites} from '../scripts/planning/check-root-providers.js';

function fixture(context, source) {
  const root = mkdtempSync(join(tmpdir(), 'sf-visitor-roots-'));
  context.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(join(root, 'packages/runtime/src'), {recursive: true});
  mkdirSync(join(root, 'planning/contracts'), {recursive: true});
  writeFileSync(join(root, 'packages/runtime/src/new.js'), source);
  writeFileSync(join(root, 'planning/contracts/gc-roots.md'), '');
  return root;
}

function review(root, sites = rootSites(root)) {
  writeFileSync(join(root, 'planning/contracts/gc-roots.md'), sites.map(site => '`' + site.id + '`').join('\n'));
}

test('A00 root inventory includes the production visitor and registration boundaries', () => {
  const sites = checkRootProviders();
  for (const api of ['roots', 'visitRoots', 'visitVMRoots', 'visitStrongRoots', 'rootVisitor',
    'rootProvider', 'RootRegistry', 'RootRegistry.register', 'registerContextRoots', 'publishRoots']) {
    assert(sites.some(site => site.api === api), 'Missing production root boundary ' + api);
  }
  assert(sites.some(site => site.id.startsWith('debugger/evaluation.js:roots:')));
});

for (const source of [
  'class Provider { visitRoots(visitor) { visitor(this.selected); } }',
  'provider?.visitRoots?.(visitor);',
  'function visitParkedRoots(context, visitor) { visitor(context.saved); }',
  'heap.rootVisitor = visitor => visitor(selected);',
  'heap["rootProvider"] = () => [selected];',
  "const options = {'rootVisitor': publish};",
  'safepoints.register("context", {publishRoots: publish});'
]) {
  test('A00 undocumented visitor or publication boundary is rejected: ' + source, context => {
    const root = fixture(context, source);
    assert.throws(() => checkRootProviders(root), /Undocumented root site new.js:/);
    review(root);
    assert.equal(checkRootProviders(root).length, 1);
  });
}

test('A00 documenting registry construction does not hide an unreviewed provider registration', context => {
  const root = fixture(context, 'const pending = new RootRegistry(); pending.register(category, publish, owner);');
  const sites = rootSites(root);
  assert.deepEqual(sites.map(site => site.api), ['RootRegistry', 'RootRegistry.register']);
  review(root, sites.slice(0, 1));
  assert.throws(() => checkRootProviders(root), /RootRegistry\.register/);
  review(root);
  assert.equal(checkRootProviders(root).length, 2);
});

test('A00 root-looking comments, strings and regular expressions cannot satisfy provider coverage', () => {
  const source = [
    '// fake.visitRoots(visitor);',
    '/* heap.rootVisitor = publish; */',
    'const documentation = "function roots() {}";',
    'const expression = /visitRoots\\(/;',
    'const metadata = {provider: "visitStrongRoots"};',
    'const roots = []; const options = {roots: []};',
    'const template = `heap.rootProvider = roots;`;'
  ].join('\n');
  assert.deepEqual(sourceRootSites(source, 'comments.js'), []);
  const embedded = 'const template = `${provider.visitRoots(visitor)}`;';
  assert.deepEqual(sourceRootSites(embedded, 'template.js').map(site => site.api), ['visitRoots']);
});

test('A00 debugger root providers require their own review entry', context => {
  const root = fixture(context, '');
  mkdirSync(join(root, 'packages/debugger/src'), {recursive: true});
  writeFileSync(join(root, 'packages/debugger/src/watch.js'), 'session.visitRoots(visitor);');
  assert.throws(() => checkRootProviders(root), /debugger\/watch.js:visitRoots:1/);
  review(root);
  assert.equal(checkRootProviders(root).length, 1);
});
