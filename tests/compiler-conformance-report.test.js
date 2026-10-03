import test from 'node:test';
import assert from 'node:assert/strict';
import { languageFeatures } from '@sharpforge/syntax';
import {
  conformanceReport,
  formatMarkdown,
  executionStatus,
  executionsByFeature,
  featuresUsedBy,
  STATUS,
  COLUMNS,
} from '../packages/compiler/test/conformance/report.js';
import { semanticFixtureFeatures } from '../packages/compiler/test/conformance/fixture-features.js';

// SF-A02-T12.2: the feature-level conformance report. The rule under test: a feature without an executed fixture is
// reported as unsupported, never as passed.

const statuses = new Set(Object.values(STATUS));
let cached = null;
const real = () => (cached ??= conformanceReport());

const usesNullConditionalAssignment = 'class C { public int P; } class Program { static void Main() { C c = new C(); c?.P = 1; } }\n';
const fixture = (id, kind = 'output') => ({ id, feature: id.split('/')[0], kind, source: usesNullConditionalAssignment });
const row = (id, axes) => ({ id, kind: 'output', diagnostics: true, warnings: true, bytecode: true, cil: true, passed: true, ...axes });

test('A02-T12.2 one row per catalog feature, every cell a known status', () => {
  const report = real();
  assert.deepEqual(report.rows.map(r => r.id), languageFeatures.map(f => f.id));
  assert.deepEqual(report.columns, [...COLUMNS]);
  for (const r of report.rows) for (const column of COLUMNS) assert(statuses.has(r[column]), `${r.id}.${column} = ${r[column]}`);
  for (const column of COLUMNS) assert.equal(Object.values(report.totals[column]).reduce((a, b) => a + b, 0), report.rows.length);
});

test('A02-T12.2 a feature with no executed fixture is unsupported on both back ends, never passed', () => {
  for (const r of real().rows) {
    if (r.executedFixtures === 0) {
      assert.equal(r.bytecode, STATUS.unsupported, r.id);
      assert.equal(r.cil, STATUS.unsupported, r.id);
    }
    if (r.bytecode === STATUS.pass) assert(r.bytecodeFixtures.passed > 0 && r.bytecodeFixtures.failed === 0, r.id);
    if (r.cil === STATUS.pass) assert(r.cilFixtures.passed > 0 && r.cilFixtures.failed === 0, r.id);
    if (r.bind === STATUS.pass) assert(r.bindFixtures.passed > 0 && r.bindFixtures.failed === 0, r.id);
  }
});

test('A02-T12.2 with an empty corpus nothing is reported as bound or executed', () => {
  const report = conformanceReport({ fixtures: [], differential: { fixtures: [], roslyn: null } });
  for (const r of report.rows) {
    assert.equal(r.bind, STATUS.unsupported, r.id);
    assert.equal(r.bytecode, STATUS.unsupported, r.id);
    assert.equal(r.cil, STATUS.unsupported, r.id);
  }
  // The columns that need no fixture are still computed.
  assert(report.totals.parse.pass > 250);
  assert(report.totals.gate.pass > 150);
});

test('A02-T12.2 execution status: pass needs a passing fixture and no failing one', () => {
  assert.equal(executionStatus(undefined), STATUS.unsupported);
  assert.equal(executionStatus({ passed: 0, failed: 0 }), STATUS.unsupported);
  assert.equal(executionStatus({ passed: 2, failed: 0 }), STATUS.pass);
  assert.equal(executionStatus({ passed: 2, failed: 1 }), STATUS.partial);
  assert.equal(executionStatus({ passed: 0, failed: 1 }), STATUS.fail);
});

test('A02-T12.2 a fixture counts for the features its source uses; a failing axis is never a pass', () => {
  assert(featuresUsedBy(usesNullConditionalAssignment).has('NullConditionalAssignment'));
  const features = languageFeatures.filter(f => f.id === 'NullConditionalAssignment' || f.id === 'Unions');
  const build = axes => conformanceReport({ features, fixtures: [fixture('x/a')], differential: { fixtures: [row('x/a', axes)], roslyn: null } }).rows;
  const [passing, unions] = build({});
  assert.deepEqual([passing.bind, passing.bytecode, passing.cil, passing.executedFixtures], ['pass', 'pass', 'pass', 1]);
  assert.deepEqual([unions.bind, unions.bytecode, unions.cil, unions.executedFixtures], ['unsupported', 'unsupported', 'unsupported', 0]);
  const [cilFails] = build({ cil: false, passed: false });
  assert.deepEqual([cilFails.bytecode, cilFails.cil], ['pass', 'fail']);
  const [unsupported] = build({ unsupported: true, diagnostics: false, bytecode: false, cil: false, passed: false });
  assert.deepEqual([unsupported.bind, unsupported.bytecode, unsupported.cil], ['fail', 'fail', 'fail']);
});

test('A02-T12.2 a diagnostics fixture counts for binding only: it executes nothing', () => {
  const executions = executionsByFeature([fixture('x/d', 'diagnostics')], [{ ...row('x/d'), kind: 'diagnostics', bytecode: null, cil: null }]);
  const entry = executions.get('NullConditionalAssignment');
  assert.deepEqual(entry.bind, { passed: 1, failed: 0 });
  assert.deepEqual([entry.bytecode, entry.cil, entry.fixtures], [{ passed: 0, failed: 0 }, { passed: 0, failed: 0 }, []]);
});

test('A02-T12.2 the semantic feature map names catalog rows', () => {
  const ids = new Set(languageFeatures.map(f => f.id));
  for (const [id, families] of Object.entries(semanticFixtureFeatures)) {
    assert(ids.has(id), `${id} is not a catalog row`);
    assert(Array.isArray(families) && families.length > 0);
  }
});

test('A02-T12.2 version gate column: C# 1 rows have none; preview rows are gated below preview', () => {
  const report = real();
  for (const r of report.rows.filter(x => x.version === '1')) assert.equal(r.gate, STATUS.notApplicable, r.id);
  for (const r of report.rows.filter(x => x.preview)) assert.equal(r.gate, STATUS.pass, r.id);
});

test('A02-T12.2 markdown and JSON carry every row', () => {
  const report = real(),
    markdown = formatMarkdown(report);
  for (const r of report.rows) assert(markdown.includes('`' + r.id + '`'), r.id);
  assert.equal(JSON.parse(JSON.stringify(report)).rows.length, languageFeatures.length);
  assert(!markdown.includes('\r'));
});
