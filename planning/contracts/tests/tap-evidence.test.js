import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactDigest, digest, proofObligations, tapSummary } from '../../../scripts/planning/lib/evidence.js';
import { verifyArtifact } from '../../../scripts/planning/rollup-invalidation.js';
import { detect } from '../../../scripts/conformance/flaky/detect.js';

const target = {
  capabilityId: 'fixture.tap-structure', platform: 'fixture', engine: 'node-fixture', specRevision: 'fixture-v1',
  status: 'pass', testName: 'real test',
};
const passingSummary = { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0, exitCode: 0, complete: true };

function stats(overrides = {}) {
  const counts = { tests: 1, suites: 0, pass: 1, fail: 0, cancelled: 0, skipped: 0, todo: 0, ...overrides };
  return Object.entries(counts).map(([name, value]) => `# ${name} ${value}\n`).join('');
}

function proofComment(proof = target) {
  // Node's reporter escapes the text of stdout comments before retaining it as TAP.
  return '# sharpforge-evidence: ' + JSON.stringify(proof).replaceAll('\\', '\\\\').replaceAll('#', '\\#') + '\n';
}

function flatReport(body = 'ok 1 - real test\n1..1\n', counts = {}, proof = target) {
  return 'TAP version 13\n' + proofComment(proof) + body + stats(counts);
}

function retainedArtifact(t, tap, summary = passingSummary, proof = target) {
  const directory = mkdtempSync(join(tmpdir(), 'sf-tap-structure-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const files = { 'tests.tap': tap, 'stderr.log': '', 'environment.json': '{}\n' };
  const metadata = {
    schemaVersion: 2, task: 'SF-A00-T11.3', headCommit: 'a'.repeat(40), command: ['node', 'fixture.js'], summary, obligations: [proof],
  };
  metadata.evidenceDigest = artifactDigest(metadata, files);
  metadata.files = Object.fromEntries(Object.entries(files).map(([name, content]) => [name, digest(content)]));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content);
  writeFileSync(join(directory, 'evidence.json'), JSON.stringify(metadata));
  const { testName, ...obligation } = proof;
  const record = {
    schemaVersion: 1, leafId: metadata.task, commit: metadata.headCommit, evidenceDigest: metadata.evidenceDigest, ...obligation,
  };
  return { directory, record };
}

test('a complete Node TAP report remains qualifying evidence with the unchanged summary shape', t => {
  const tap = flatReport();
  assert.deepEqual(tapSummary(tap, 0), passingSummary);
  assert.deepEqual(proofObligations(tap, passingSummary), [target]);
  const { directory, record } = retainedArtifact(t, tap);
  assert.equal(verifyArtifact(record, directory), true);
});

const malformedReports = [
  ['root plan exceeds results', tap => tap.replace('1..1', '1..2')],
  ['root plan precedes too few results', tap => tap.replace('ok 1 - real test\n1..1', '1..2\nok 1 - real test')],
  ['duplicate root plans', tap => tap.replace('1..1', '1..1\n1..1')],
  ['a middle plan is not a second valid stream', tap => tap.replace('1..1', '1..1\nok 2 - extra')],
  ['result numbering starts at zero', tap => tap.replace('ok 1 -', 'ok 0 -')],
  ['result numbering exceeds the plan', tap => tap.replace('ok 1 -', 'ok 2 -')],
  ['unsafe result number', tap => tap.replace('ok 1 -', 'ok 9007199254740993 -')],
  ['unsafe plan number', tap => tap.replace('1..1', '1..9007199254740993')],
  ['duplicate TAP headers', tap => tap.replace('1..1', 'TAP version 13\n1..1')],
  ['misplaced TAP header', tap => '# prefix\n' + tap],
  ['root bailout after counters', tap => tap + 'Bail out! process interrupted\n'],
  ['case insensitive bailout', tap => tap + 'bail out! process interrupted\n'],
  ['duplicate root suite counter', tap => tap + '# suites 0\n'],
  ['duplicate root test counter', tap => tap + '# tests 1\n'],
  ['negative root counter', tap => tap.replace('# todo 0', '# todo -1')],
  ['extra passed counter contradicts observed points', tap => tap.replace('# tests 1', '# tests 2').replace('# pass 1', '# pass 2')],
  ['summary counters precede the results', tap => tap.replace(stats(), '').replace('ok 1 -', stats() + 'ok 1 -')],
  ['unterminated diagnostic', tap => tap.replace('1..1', '  ---\n  duration_ms: 1\n1..1')],
];

for (const [name, corrupt] of malformedReports) {
  test(`malformed evidence cannot qualify a pass: ${name}`, () => {
    const tap = corrupt(flatReport());
    assert.equal(tapSummary(tap, 0).complete, false);
    assert.throws(() => proofObligations(tap, passingSummary), /not a passing test/);
  });
}

test('a correctly hashed retained artifact cannot bypass malformed TAP refusal', t => {
  const tap = flatReport().replace('1..1', '1..2');
  // Retain the old parser's accepted summary, then recompute every digest for those exact malformed bytes.
  const { directory, record } = retainedArtifact(t, tap);
  assert.equal(verifyArtifact(record, directory), false);
});

test('each scope permits a leading plan and checks unique in-range result numbers', () => {
  const reordered = flatReport('1..2\nok 2 - real test\nok 1 - another\n', { tests: 2, pass: 2 });
  assert.equal(tapSummary(reordered, 0).complete, true);
  assert.deepEqual(proofObligations(reordered, tapSummary(reordered, 0)), [target]);
  const duplicate = reordered.replace('ok 1 - another', 'ok 2 - another');
  assert.equal(tapSummary(duplicate, 0).complete, false);
  assert.throws(() => proofObligations(duplicate, tapSummary(duplicate, 0)), /not a passing test/);
});

function nestedReport() {
  return 'TAP version 13\n' + proofComment() + [
    '# Subtest: outer',
    '    # Subtest: inner',
    '        # Subtest: real test',
    '        ok 1 - real test',
    '          ---',
    '          duration_ms: 1',
    "          type: 'test'",
    '          ...',
    '        1..1',
    '# stdout emitted while a nested test is running',
    '    ok 1 - inner',
    '      ---',
    '      duration_ms: 2',
    "      type: 'suite'",
    '      ...',
    '    1..1',
    'ok 1 - outer',
    '  ---',
    '  duration_ms: 3',
    "  type: 'suite'",
    '  ...',
    '1..1',
    '',
  ].join('\n') + stats({ suites: 2 });
}

test('Node nested suites retain their own plans and exclude suite wrappers from test counters', t => {
  const tap = nestedReport().replaceAll('\n', '\r\n');
  assert.deepEqual(tapSummary(tap, 0), passingSummary);
  assert.deepEqual(proofObligations(tap, passingSummary), [target]);
  const { directory, record } = retainedArtifact(t, tap);
  assert.equal(verifyArtifact(record, directory), true);
});

test('Node nested test wrappers are counted as tests instead of suites', () => {
  const tap = nestedReport().replaceAll("type: 'suite'", "type: 'test'")
    .replace(stats({ suites: 2 }), stats({ tests: 3, pass: 3 }));
  assert.deepEqual(tapSummary(tap, 0), { ...passingSummary, tests: 3, passed: 3 });
  assert.deepEqual(proofObligations(tap, tapSummary(tap, 0)), [target]);
});

test('missing, duplicate, mismatched, or abandoned nested plans refuse qualification', () => {
  for (const tap of [
    nestedReport().replace('        1..1\n', ''),
    nestedReport().replace('        1..1', '        1..2'),
    nestedReport().replace('        1..1', '        1..1\n        1..1'),
    nestedReport().replace('        ok 1 -', '        ok 2 -'),
    nestedReport().replace('    ok 1 - inner\n', ''),
    nestedReport().replace('        1..1', '        Bail out! interrupted\n        1..1'),
    nestedReport().replace('# suites 2', '# suites 1'),
  ]) {
    assert.equal(tapSummary(tap, 0).complete, false);
    assert.throws(() => proofObligations(tap, passingSummary), /not a passing test/);
  }
});

test('diagnostic YAML cannot impersonate test points, proofs, plans, or bailouts', () => {
  const diagnostic = [
    '  ---', '  duration_ms: 1', "  type: 'test'", '  error: |-',
    '    ok 2 - invented target', '    1..2', '    Bail out! diagnostic text',
    '    ' + proofComment({ ...target, capabilityId: 'invented', testName: 'invented target' }).trimEnd(), '  ...', '',
  ].join('\n');
  const tap = flatReport('ok 1 - real test\n' + diagnostic + '1..1\n');
  assert.deepEqual(tapSummary(tap, 0), passingSummary);
  assert.deepEqual(proofObligations(tap, passingSummary), [target]);
});

test('failure and cancellation counters retain honest outcomes without becoming passes', t => {
  const failure = { ...target, status: 'fail' };
  const failed = flatReport('not ok 1 - real test\n1..1\n', { pass: 0, fail: 1 }, failure);
  const summary = { ...passingSummary, passed: 0, failed: 1, exitCode: 1 };
  assert.deepEqual(tapSummary(failed, 1), summary);
  assert.deepEqual(proofObligations(failed, summary), [failure]);
  const { directory, record } = retainedArtifact(t, failed, summary, failure);
  assert.equal(verifyArtifact(record, directory), true);
  assert.equal(verifyArtifact({ ...record, status: 'pass' }, directory), false);
  const cancelled = flatReport('not ok 1 - real test\n1..1\n', { pass: 0, cancelled: 1 });
  assert.deepEqual(tapSummary(cancelled, 1), { ...passingSummary, passed: 0, cancelled: 1, exitCode: 1 });
  assert.throws(() => proofObligations(cancelled, tapSummary(cancelled, 1)), /not a passing test/);
});

test('unknown and unsupported skipped probes remain explicit and cannot be relabeled as passes', t => {
  for (const status of ['unknown', 'unsupported']) {
    const proof = { ...target, status, reason: 'actual provider unavailable' };
    const tap = flatReport('ok 1 - real test # skip unavailable\n1..1\n', { pass: 0, skipped: 1 }, proof);
    const summary = { ...passingSummary, passed: 0, skipped: 1 };
    assert.deepEqual(tapSummary(tap, 0), summary);
    assert.deepEqual(proofObligations(tap, summary), [proof]);
    const { directory, record } = retainedArtifact(t, tap, summary, proof);
    assert.equal(verifyArtifact(record, directory), true);
    assert.equal(verifyArtifact({ ...record, status: 'pass' }, directory), false);
    const relabeled = tap.replace(`"status":"${status}"`, '"status":"pass"');
    assert.throws(() => proofObligations(relabeled, summary), /not a passing test/);
  }
});

test('TODO directives and suite skips cannot qualify a nested passing target', () => {
  const todo = flatReport('not ok 1 - real test # tOdO pending\n1..1\n', { pass: 0, todo: 1 });
  assert.deepEqual(tapSummary(todo, 0), { ...passingSummary, passed: 0, todo: 1 });
  assert.throws(() => proofObligations(todo, tapSummary(todo, 0)), /not a passing test/);
  const skippedSuite = nestedReport().replace('ok 1 - outer', 'ok 1 - outer # SKIP unavailable');
  assert.equal(tapSummary(skippedSuite, 0).complete, true);
  assert.throws(() => proofObligations(skippedSuite, passingSummary), /not a passing test/);
});

test('a failed suite cannot be hidden behind passing test counters and a forged zero exit code', t => {
  const tap = nestedReport().replace('ok 1 - outer', 'not ok 1 - outer');
  assert.deepEqual(tapSummary(tap, 0), { ...passingSummary, complete: false });
  assert.deepEqual(tapSummary(tap, 1), { ...passingSummary, exitCode: 1 });
  assert.throws(() => proofObligations(tap, passingSummary), /not a passing test/);
  const { directory, record } = retainedArtifact(t, tap);
  assert.equal(verifyArtifact(record, directory), false);
  const report = detect({
    files: ['tests/fixture.test.js'], quarantine: { schemaVersion: 1, entries: [] }, retries: 0,
    execute: () => ({ status: 0, stdout: tap, stderr: '' }),
  });
  assert.equal(report.passed, false);
  assert.equal(report.results[0].status, 'failed');
  assert.equal(report.results[0].attempts[0].summary.complete, false);
});

test('a named suite with an executed passing descendant retains its target proof', t => {
  for (const testName of ['outer', 'inner']) {
    const proof = { ...target, testName };
    const tap = nestedReport().replace(proofComment(), proofComment(proof));
    assert.deepEqual(proofObligations(tap, passingSummary), [proof]);
    const { directory, record } = retainedArtifact(t, tap, passingSummary, proof);
    assert.equal(verifyArtifact(record, directory), true);
  }
});

function suiteBesidePassingTest(children = '', counts = {}) {
  const proof = { ...target, testName: 'target suite' };
  const body = '# Subtest: target suite\n' + children + [
    'ok 1 - target suite', '  ---', "  type: 'suite'", '  ...',
    '# Subtest: unrelated test', 'ok 2 - unrelated test', '1..2', '',
  ].join('\n');
  return { tap: flatReport(body, { suites: 1, ...counts }, proof), proof };
}

test('an empty named suite cannot borrow passing evidence from an unrelated test', t => {
  const { tap, proof } = suiteBesidePassingTest();
  assert.deepEqual(tapSummary(tap, 0), passingSummary);
  assert.throws(() => proofObligations(tap, passingSummary), /not a passing test/);
  const { directory, record } = retainedArtifact(t, tap, passingSummary, proof);
  assert.equal(verifyArtifact(record, directory), false);
});

test('an all-skipped named suite cannot borrow passing evidence from an unrelated test', t => {
  const children = '    # Subtest: unavailable target\n    ok 1 - unavailable target # SKIP no provider\n    1..1\n';
  const { tap, proof } = suiteBesidePassingTest(children, { tests: 2, skipped: 1 });
  const summary = { ...passingSummary, tests: 2, skipped: 1 };
  assert.deepEqual(tapSummary(tap, 0), summary);
  assert.throws(() => proofObligations(tap, summary), /not a passing test/);
  const { directory, record } = retainedArtifact(t, tap, summary, proof);
  assert.equal(verifyArtifact(record, directory), false);
});

test('a nested suite cannot count passing descendants under an inherited skip or TODO directive', () => {
  const proof = { ...target, testName: 'outer' };
  for (const directive of ['SKIP', 'TODO']) {
    const tap = nestedReport().replace(proofComment(), proofComment(proof))
      .replace('ok 1 - inner', `ok 1 - inner # ${directive} unavailable`);
    assert.deepEqual(tapSummary(tap, 0), passingSummary);
    assert.throws(() => proofObligations(tap, passingSummary), /not a passing test/);
  }
});

test('escaped TAP hashes in names are literal text rather than skip directives', () => {
  const proof = { ...target, testName: 'real # SKIP test' };
  const tap = flatReport('ok 1 - real \\# SKIP test\n1..1\n', {}, proof);
  assert.deepEqual(proofObligations(tap, passingSummary), [proof]);
});

test('an empty Node run is complete but supplies no passing target', () => {
  const tap = 'TAP version 13\n1..0 # SKIP no tests selected\n' + stats({ tests: 0, pass: 0 });
  assert.deepEqual(tapSummary(tap, 0), { ...passingSummary, tests: 0, passed: 0 });
  assert.deepEqual(proofObligations(tap, tapSummary(tap, 0)), []);
});

function deeplyNestedReport(depth) {
  const lines = ['TAP version 13', proofComment().trimEnd()];
  for (let level = 0; level < depth; level++) lines.push('    '.repeat(level) + `# Subtest: suite ${level}`);
  lines.push('    '.repeat(depth) + 'ok 1 - real test', '    '.repeat(depth) + '1..1');
  for (let level = depth - 1; level >= 0; level--) {
    const indent = '    '.repeat(level);
    lines.push(indent + `ok 1 - suite ${level}`, indent + '  ---', indent + "  type: 'suite'", indent + '  ...', indent + '1..1');
  }
  return lines.join('\n') + '\n' + stats({ suites: depth });
}

test('nested evidence accepts the depth limit and refuses deeper streams without qualification', () => {
  const valid = deeplyNestedReport(128);
  assert.deepEqual(tapSummary(valid, 0), passingSummary);
  assert.deepEqual(proofObligations(valid, passingSummary), [target]);
  const excessive = deeplyNestedReport(129);
  assert.equal(tapSummary(excessive, 0).complete, false);
  assert.throws(() => proofObligations(excessive, passingSummary), /not a passing test|unambiguous TAP/);
});
