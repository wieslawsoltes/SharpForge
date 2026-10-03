import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { dynamicCodeUses } from '../../../scripts/conformance/static/code-tokens.js';
import { checkImports, checkDynamicUses } from '../../../scripts/conformance/static/check-imports.js';

const emptyPolicy = { schemaVersion: 1, allow: [] };
function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'sharpforge-imports-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'packages'));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source);
  }
  return root;
}

test('V8 validates named imports, export-star ambiguity and workspace export maps without execution', t => {
  const root = fixture(t, {
    'packages/lib/package.json': JSON.stringify({ name: '@fixture/lib', exports: { '.': './api.js' } }),
    'packages/lib/api.js': 'export const answer = 42;',
    'apps/good.js': 'import {answer} from "@fixture/lib"; import {writeFileSync} from "node:fs"; import test from "node:test"; ' +
      'writeFileSync("SHOULD_NOT_EXIST", answer); throw Error("NEVER_EXECUTED");',
  });
  const options = { root, policy: emptyPolicy, directories: ['packages', 'apps'] };
  assert.equal(checkImports(options).passed, true);
  assert.equal(existsSync('SHOULD_NOT_EXIST'), false);
  writeFileSync(join(root, 'apps/bad.js'), 'import {answre} from "@fixture/lib";');
  const bad = checkImports(options);
  assert.equal(bad.passed, false);
  assert(bad.errors.some(error => error.path === 'apps/bad.js' && /answre/.test(error.message)));
  writeFileSync(join(root, 'apps/bad.js'), 'import {missing} from "node:fs";');
  assert(checkImports(options).errors.some(error => /missing/.test(error.message)));
});

test('cyclic modules link, and conflicting star exports are rejected', t => {
  const root = fixture(t, {
    'apps/a.js': 'import {b} from "./b.js"; export const a = () => b;',
    'apps/b.js': 'import {a} from "./a.js"; export const b = () => a;',
    'apps/one.js': 'export const duplicate = 1;',
    'apps/two.js': 'export const duplicate = 2;',
    'apps/all.js': 'export * from "./one.js"; export * from "./two.js";',
  });
  const options = { root, policy: emptyPolicy, directories: ['apps'] };
  assert.equal(checkImports(options).passed, true);
  writeFileSync(join(root, 'apps/use.js'), 'import {duplicate} from "./all.js";');
  assert.equal(checkImports(options).passed, false);
});

test('workspace conditions retain declared precedence and explicit blocked targets', t => {
  const manifest = { name: '@fixture/lib', exports: { node: './node.js', import: './import.js' } };
  const root = fixture(t, {
    'packages/lib/package.json': JSON.stringify(manifest),
    'packages/lib/node.js': 'export const nodeOnly = 1;',
    'packages/lib/import.js': 'export const importOnly = 2;',
    'apps/use.js': 'import {nodeOnly} from "@fixture/lib";',
  });
  const options = { root, policy: emptyPolicy, directories: ['packages', 'apps'] };
  assert.equal(checkImports(options).passed, true);
  manifest.exports.node = null;
  writeFileSync(join(root, 'packages/lib/package.json'), JSON.stringify(manifest));
  assert(checkImports(options).errors.some(error => /Missing workspace export/.test(error.message)));
});

test('lexical policy ignores comments, ordinary strings and regexes, and scans template expressions', () => {
  const source = '// eval("x")\nconst a = "new Function()"; const r = /import\\(eval\\)/; ' +
    'const t = `literal eval() ${import("./a.js")} ${`nested ${new Function("x")}`}`; ' +
    'const indirect = eval; globalThis.eval("x"); this.eval(node);';
  assert.deepEqual(dynamicCodeUses(source).map(use => use.operation), ['dynamic-import', 'new-Function', 'eval', 'eval']);
  assert.deepEqual(dynamicCodeUses('ev\\u0061l("x"); new F\\u0075nction("x")').map(use => use.operation), ['eval', 'new-Function']);
  assert.deepEqual(dynamicCodeUses('if (true) /eval\\(\\)/.test(text); // import("x")'), []);
});

test('allow-list entries bind exact file bytes, operation and count; stale entries fail', t => {
  const source = 'export const load = () => import("./other.js");';
  const root = fixture(t, { 'apps/load.js': source });
  const entry = { path: 'apps/load.js', operation: 'dynamic-import', count: 1,
    sha256: createHash('sha256').update(source).digest('hex'), reason: 'Trusted module loading in this fixture' };
  const policy = { schemaVersion: 1, allow: [entry] };
  assert.equal(checkDynamicUses(root, ['apps/load.js'], policy).errors.length, 0);
  assert(checkDynamicUses(root, ['apps/load.js'], emptyPolicy).errors.length > 0);
  writeFileSync(join(root, 'apps/load.js'), source + '\n// changed');
  assert(checkDynamicUses(root, ['apps/load.js'], policy).errors.length > 0);
  writeFileSync(join(root, 'apps/load.js'), 'export const load = 1;');
  assert(checkDynamicUses(root, ['apps/load.js'], policy).errors.some(error => /Stale/.test(error.message)));
  assert.throws(() => checkDynamicUses(root, [], { schemaVersion: 1, allow: [entry, entry] }), /duplicate/);
});
