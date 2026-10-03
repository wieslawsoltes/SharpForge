import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const checker = fileURLToPath(new URL('../../../scripts/check.js', import.meta.url));

function fixture(context, files) {
  const root = mkdtempSync(join(tmpdir(), 'sharpforge-syntax-check-'));
  context.after(() => rmSync(root, {recursive: true, force: true}));
  for (const [name, source] of Object.entries(files)) {
    const filename = join(root, name);
    mkdirSync(dirname(filename), {recursive: true});
    writeFileSync(filename, source);
  }
  return root;
}

function check(root, env = process.env) {
  return spawnSync(process.execPath, [checker], {cwd: root, encoding: 'utf8', env});
}

test('syntax check parses ESM and hashbangs without linking or executing code', context => {
  const root = fixture(context, {
    'package.json': '{"type":"module"}',
    'valid.js': 'import "./missing.js"; export const value = await Promise.resolve(1);',
    'hashbang.mjs': '#!/usr/bin/env node\nexport default import.meta.url;',
    'bom.js': '\uFEFFexport const value = 1;',
    'effects.js': 'import {writeFileSync} from "node:fs"; writeFileSync("executed", "bad"); process.exit(17);',
    'cjs/package.json': '{"type":"commonjs"}',
    'cjs/effects.js': 'require("node:fs").writeFileSync("executed", "bad"); process.exit(17);',
  });
  const result = check(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Checked 5 JavaScript modules; 0 syntax errors.\n');
  assert.equal(existsSync(join(root, 'executed')), false);
});

test('syntax check reports every invalid module with its filename and an unsuccessful exit', context => {
  const root = fixture(context, {
    'package.json': '{"type":"module"}',
    'bad.js': 'export const = 1;',
    'nested/strict.mjs': 'return 1;',
    'valid.js': 'export const value = 1;',
  });
  const result = check(root);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, 'Checked 3 JavaScript modules; 2 syntax errors.\n');
  assert.ok(result.stderr.includes(join(root, 'bad.js')));
  assert.ok(result.stderr.includes(join(root, 'nested/strict.mjs')));
  assert.match(result.stderr, /SyntaxError/);
});

test('syntax check preserves exclusions and does not expand its file-extension coverage', context => {
  const root = fixture(context, {
    'package.json': '{"type":"module"}',
    'valid.js': 'export {};',
    'node_modules/bad.js': '!',
    'nested/dist/bad.mjs': '!',
    '.git/bad.js': '!',
    'ignored.cjs': '!',
    'ignored.JS': '!',
  });
  const result = check(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Checked 1 JavaScript modules; 0 syntax errors.\n');
});

const modes = [
  ['module', '{"type":"module"}', 'import.meta.url;'],
  ['strict module', '{"type":"module"}', 'return 1;'],
  ['commonjs', '{"type":"commonjs"}', '#!/usr/bin/env node\nreturn module.exports;'],
  ['commonjs import', '{"type":"commonjs"}', 'import.meta.url;'],
  ['ambiguous script', '{}', 'return 1;'],
  ['ambiguous module', '{}', 'export default await Promise.resolve(1);'],
  ['invalid package', '{ broken', 'const value = 1;'],
];

for (const [name, packageText, source] of modes) {
  test(`syntax check agrees with Node --check for ${name} package mode`, context => {
    const root = fixture(context, {
      'package.json': '{"type":"module"}',
      'nested/package.json': packageText,
      'nested/input.js': source,
    });
    const filename = join(root, 'nested/input.js');
    const reference = spawnSync(process.execPath, ['--check', filename], {encoding: 'utf8'});
    const result = check(root);
    assert.equal(result.status, reference.status === 0 ? 0 : 1, result.stderr);
    assert.match(result.stdout, new RegExp(`Checked 1 JavaScript modules; ${reference.status === 0 ? 0 : 1} syntax errors\\.`));
  });
}

test('syntax check inherits its package scope when started below package.json', context => {
  const root = fixture(context, {
    'package.json': '{"type":"module"}',
    'nested/input.js': 'return 1;',
  });
  const result = check(join(root, 'nested'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SyntaxError/);
});

test('syntax check preserves Node handling of .mjs beside malformed package.json', context => {
  const root = fixture(context, {
    'package.json': '{ broken',
    'input.mjs': 'export default 1;',
  });
  const reference = spawnSync(process.execPath, ['--check', join(root, 'input.mjs')], {encoding: 'utf8'});
  const result = check(root);
  assert.equal(result.status, reference.status === 0 ? 0 : 1, result.stderr);
});

test('syntax check preserves inherited Node diagnostic options', context => {
  const root = fixture(context, {
    'package.json': '{"type":"commonjs"}',
    'input.js': 'function {',
  });
  const env = {...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --stack-trace-limit=1`};
  const reference = spawnSync(process.execPath, ['--check', join(root, 'input.js')], {encoding: 'utf8', env});
  const result = check(root, env);
  assert.equal(reference.status, 1, reference.stderr);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), reference.stderr.trim());
  assert.match(result.stderr, /SyntaxError/);
  assert.ok(result.stderr.split('\n').filter(line => /^\s+at /.test(line)).length <= 1);
});

test('syntax check delegates symbolic links to Node realpath and package-mode handling', context => {
  const root = fixture(context, {
    'package.json': '{"type":"module"}',
    'target/package.json': '{"type":"commonjs"}',
    'target/input.js': 'return 1;',
  });
  try {
    symlinkSync(join(root, 'target/input.js'), join(root, 'link.js'), 'file');
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      context.skip('This Windows account cannot create symbolic links');
      return;
    }
    throw error;
  }
  const result = check(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Checked 2 JavaScript modules; 0 syntax errors.\n');
});
