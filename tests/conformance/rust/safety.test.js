import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const bridge = fileURLToPath(new URL('./safety-fixture.py', import.meta.url));
function invoke(request, expected = 0) {
  const result = spawnSync(process.env.PYTHON || 'python3', [bridge], {
    input: JSON.stringify(request), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30_000,
  });
  assert.equal(result.status, expected, result.stderr || result.error?.message);
  return expected === 0 ? JSON.parse(result.stdout) : result.stderr;
}
const scan = source => invoke({ operation: 'scan', source });
function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'sf-rust-safety-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function write(directory, path, value) {
  const parts = path.split('/');
  parts.pop();
  mkdirSync(join(directory, ...parts), { recursive: true });
  writeFileSync(join(directory, path), value);
}
function metadata(t, { loom = false, source = 'pub fn fixture() {}\n' } = {}) {
  const directory = temporary(t);
  write(directory, 'rust/Cargo.toml', '[workspace]\nmembers=["gc"]\n');
  const lock = `[[package]]\nname="loom"\nversion="0.7.2"\nchecksum="${'a'.repeat(64)}"\n`;
  write(directory, 'rust/Cargo.lock', loom ? lock : 'version=4\n');
  write(directory, 'rust/rust-toolchain.toml', '[toolchain]\nchannel="1.90.0"\n');
  write(directory, 'rust/deny.toml', '');
  write(directory, 'rust/gc/Cargo.toml', '[package]\nname="fixture-only"\nversion="0.0.0"\n'
    + (loom ? '[dev-dependencies]\nloom="0.7"\n' : ''));
  write(directory, 'rust/gc/src/lib.rs', source);
  if (loom) write(directory, 'rust/gc/tests/loom.rs', '// Fixture path only; no model is compiled or claimed.\n');
  return directory;
}

test('actual product crates are inventoried without Rust execution', () => {
  for (const crate of ['gc', 'runtime']) {
    const result = invoke({ operation: 'inventory', root, crate });
    assert(['passed', 'unsupported'].includes(result.status), JSON.stringify(result));
    assert.equal(result.violations, 0);
    assert.equal(result.qualified, false);
  }
});

test('unsafe block requires a directly associated nonempty SAFETY rationale', () => {
  const rows = scan('// SAFETY: pointer refers to the live allocation.\nlet value = unsafe { *pointer };');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].line, 2);
  assert.equal(rows[0].violation, false);
  assert.match(rows[0].safetyComment, /live allocation/);
  assert.equal(scan('/* SAFETY: allocation is live. */ unsafe { access(); }')[0].violation, false);
  assert.equal(scan('unsafe { access(); }')[0].violation, true);
  assert.equal(scan('// SAFETY:\nunsafe {}')[0].violation, true);
  assert.equal(scan('/* SAFETY: */ unsafe {}')[0].violation, true);
});

test('a comment cannot authorize a later, nested, separated or trailing statement', () => {
  const rows = scan('// SAFETY: first access is valid.\nunsafe { unsafe { access(); } } unsafe {}');
  assert.deepEqual(rows.map(row => row.violation), [false, true, true]);
  assert.equal(scan('// SAFETY: stale rationale.\n\nunsafe {}')[0].violation, true);
  assert.equal(scan('done(); // SAFETY: unrelated.\nunsafe {}')[0].violation, true);
  assert.equal(scan('/* SAFETY: unrelated. */ done(); unsafe {}')[0].violation, true);
});

test('Rust literals, raw identifiers, lifetime syntax and nested comments do not invent unsafe blocks', () => {
  const source = [
    'let a = "unsafe { /*";', 'let b = r###"unsafe { //"###;',
    'let c = br#"unsafe {"#;', 'let d = cr##"unsafe {"##;',
    String.raw`let c = '"'; let b = b'\'';`, "fn borrow<'a>(x: &'a str) {}",
    '// unsafe {', '/* outer /* unsafe { */ unsafe { */', 'let r#unsafe = 1;',
    'unsafe fn raw() {}', 'unsafe impl Send for Type {}', 'unsafe trait Trait {}',
    'unsafe extern "C" {}', '#[unsafe(no_mangle)] fn exposed() {}',
  ].join('\n');
  assert.deepEqual(scan(source).map(row => row.kind), ['fn', 'impl', 'trait', 'extern', 'other']);
});

test('malformed lexical input and excessive nested comments fail closed', () => {
  for (const source of ['/* unsafe {', 'r##"unterminated', '"unterminated', '/*'.repeat(129)]) {
    assert.match(invoke({ operation: 'scan', source }, 1), /Unterminated|exceeds 128/);
  }
});

test('all absent crate lanes are unsupported with no commands or qualification', t => {
  const directory = temporary(t);
  for (const crate of ['gc', 'runtime']) for (const lane of ['inventory', 'address', 'thread', 'miri', 'loom']) {
    const report = invoke({ operation: 'plan', root: directory, crate, lane });
    assert.equal(report.status, 'unsupported');
    assert.equal(report.qualified, false);
    assert.deepEqual(report.commands, []);
  }
});

test('source hashes cover all actual crate source including cfg-disabled unsafe blocks', t => {
  const directory = metadata(t, { source: '#[cfg(any())]\nfn disabled() { unsafe {} }' });
  const report = invoke({ operation: 'plan', root: directory, crate: 'gc', lane: 'miri' });
  assert.equal(report.status, 'failed');
  assert.equal(report.inventory.violations, 1);
  assert.match(report.inventory.files[0].sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(report.commands, []);
});

test('inventory rejects symlink traversal and source byte boundaries', t => {
  const directory = metadata(t);
  symlinkSync(join(directory, 'rust/gc/src/lib.rs'), join(directory, 'rust/gc/src/link.rs'));
  assert.match(invoke({ operation: 'inventory', root: directory, crate: 'gc' }, 1), /Symlink/);
  rmSync(join(directory, 'rust/gc/src/link.rs'));
  write(directory, 'rust/gc/src/lib.rs', ' '.repeat(5 * 1024 * 1024 + 1));
  assert.match(invoke({ operation: 'inventory', root: directory, crate: 'gc' }, 1), /byte limit/);
});

test('sanitizer and Miri plans reuse E03 pin and lock each real crate and target', t => {
  const directory = metadata(t);
  for (const lane of ['address', 'thread', 'miri']) {
    const report = invoke({ operation: 'plan', root: directory, crate: 'gc', lane });
    assert.equal(report.status, 'planned');
    assert.equal(report.qualified, false);
    assert.equal(report.toolchain, 'nightly-2025-08-01');
    const last = report.commands.at(-1);
    for (const expected of ['--locked', '--manifest-path', 'rust/gc/Cargo.toml', '--target', 'x86_64-unknown-linux-gnu']) {
      assert(last.argv.includes(expected), expected);
    }
    assert.equal(last.requiresTests, true);
    assert.equal(last.env.CARGO_BUILD_JOBS, '1');
    assert.equal(last.env.RUST_TEST_THREADS, '1');
    if (lane !== 'miri') {
      assert(last.argv.includes('-Zbuild-std'));
      assert.match(last.env.RUSTFLAGS, new RegExp(`-Zsanitizer=${lane}`));
    }
  }
});

test('existing workspace keeps E03 floating toolchain rejection', t => {
  const directory = metadata(t);
  write(directory, 'rust/rust-toolchain.toml', '[toolchain]\nchannel="nightly"\n');
  assert.match(invoke({ operation: 'plan', root: directory, crate: 'gc', lane: 'miri' }, 1), /pin an exact/);
});

test('loom is unsupported until a dedicated harness and locked dependency exist', t => {
  const directory = metadata(t);
  let report = invoke({ operation: 'plan', root: directory, crate: 'gc', lane: 'loom' });
  assert.equal(report.status, 'unsupported');
  assert.match(report.reason, /harness/);
  const withLoom = metadata(t, { loom: true });
  report = invoke({ operation: 'plan', root: withLoom, crate: 'gc', lane: 'loom' });
  assert.equal(report.status, 'planned');
  assert.equal(report.qualified, false);
  assert.equal(report.commands.at(-1).env.RUSTFLAGS, '--cfg loom');
  assert(report.commands.at(-1).argv.includes('loom'));
  write(withLoom, 'rust/Cargo.lock', '[[package]]\nname="loom"\nversion="0.7.2"\n');
  report = invoke({ operation: 'plan', root: withLoom, crate: 'gc', lane: 'loom' });
  assert.equal(report.status, 'unsupported');
  assert.match(report.reason, /checksum/);
});

test('other host platforms remain unsupported even when fixture manifests exist', t => {
  const directory = metadata(t);
  for (const host of [['darwin', 'arm64'], ['win32', 'AMD64'], ['linux', 'aarch64']]) {
    const report = invoke({ operation: 'plan', root: directory, crate: 'gc', lane: 'address', host });
    assert.equal(report.status, 'unsupported');
    assert.equal(report.qualified, false);
    assert.deepEqual(report.commands, []);
  }
});

const complete = 'test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.1s';
test('simulated execution only qualifies complete nonempty libtest evidence', () => {
  for (const [output, expected] of [[complete, true], ['', false], [complete.replace('2 passed', '0 passed'), false],
    [complete.replace('0 ignored', '1 ignored'), false], [complete.replace('0 filtered', '1 filtered'), false]]) {
    assert.equal(invoke({ operation: 'evidence', output }).complete, expected);
  }
  const report = { status: 'planned', qualified: false, commands: [{ argv: ['fixture'], env: {}, requiresTests: true }], results: [] };
  for (const [response, status] of [
    [{ exitCode: 0, output: complete }, 'passed'], [{ exitCode: 0, output: '' }, 'failed'],
    [{ exitCode: 1, output: complete }, 'failed'], [{ exitCode: -9, error: 'timeout', output: '' }, 'failed'],
    [{ exitCode: -9, error: 'cancelled', output: '' }, 'failed'], [{ raise: 'tool missing' }, 'failed'],
  ]) {
    const result = invoke({ operation: 'execute', root, report, responses: [response] });
    assert.equal(result.status, status);
    assert.equal(result.qualified, status === 'passed');
  }
});

test('ambient tool flags cannot silently weaken safety execution', () => {
  const result = invoke({ operation: 'environment', environment: {
    MIRIFLAGS: '-Zmiri-disable-validation', LOOM_MAX_PREEMPTIONS: '0', ASAN_OPTIONS: 'detect_leaks=0',
    CARGO_ENCODED_RUSTFLAGS: '--cfg\u001fskip', RUSTC_WRAPPER: 'wrapper', RUSTFLAGS: '--cfg skip',
  } });
  assert.deepEqual(result, { RUSTFLAGS: '-Zsanitizer=address' });
});
