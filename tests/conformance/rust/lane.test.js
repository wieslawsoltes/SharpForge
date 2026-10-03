import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../../../scripts/conformance/rust/qualify.py', import.meta.url));
function plan(root) {
  const program = [
    'import importlib.util,json,pathlib,sys',
    "spec=importlib.util.spec_from_file_location('lane',sys.argv[1])",
    'module=importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'print(json.dumps(module.plan(pathlib.Path(sys.argv[2]))))',
  ].join('\n');
  return spawnSync(process.env.PYTHON || 'python3', ['-c', program, script, root], { encoding: 'utf8' });
}
function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'sf-rust-plan-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
test('absent Rust workspace is explicitly not qualified', t => {
  const result = plan(temporary(t));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'not-applicable');
  assert.equal(JSON.parse(result.stdout).qualified, false);
});
test('existing workspace requires locked manifest, exact toolchain and explicit deny policy', t => {
  const root = temporary(t);
  mkdirSync(join(root, 'rust'));
  assert.notEqual(plan(root).status, 0);
  for (const name of ['Cargo.toml', 'Cargo.lock', 'deny.toml']) writeFileSync(join(root, 'rust', name), '');
  writeFileSync(join(root, 'rust/rust-toolchain.toml'), '[toolchain]\nchannel="stable"\n');
  assert.match(plan(root).stderr, /pin an exact release/);
  writeFileSync(join(root, 'rust/rust-toolchain.toml'), '[toolchain]\nchannel="1.90.0"\n');
  const result = plan(root);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.channel, '1.90.0');
  const commands = report.commands.map(args => args.join(' ')).join('\n');
  for (const token of ['fmt --all -- --check', 'clippy --locked', 'test --locked', 'wasm32-unknown-unknown', 'deny --locked check', 'miri test']) {
    assert(commands.includes(token), token);
  }
  assert.equal(report.qualified, false);
});
