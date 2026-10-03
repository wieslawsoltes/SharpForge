import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { exportDag, writeDagExports } from '../scripts/planning/dag-export.js';

const cli = fileURLToPath(new URL('../scripts/planning/dag-export.js', import.meta.url));
const task = (id, dependencies = []) => ({ id, area: id.slice(3, 6), dependencies, parent: null });
const snapshot = () => ({ issues: [
  task('SF-A00-T01'),
  task('SF-A01-T01', ['SF-A00-T01']),
  task('SF-A02-T01', ['SF-A00-T01']),
  task('SF-A02-T02', ['SF-A02-T01', 'SF-A01-T01']),
  task('SF-A00-T99'),
] });
const expectedPath = ['SF-A00-T01', 'SF-A01-T01', 'SF-A02-T02'];

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'sf-dag-export-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function invoke(directory, input, args = []) {
  const source = join(directory, 'snapshot.json');
  const output = join(directory, 'diagrams');
  writeFileSync(source, JSON.stringify(input));
  const result = spawnSync(process.execPath, [cli, '--snapshot', source, '--output', output, ...args], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 10000,
  });
  return { ...result, output };
}

test('critical-path diagrams contain only the longest chain and report its task count', () => {
  const result = exportDag(snapshot());
  assert.deepEqual(result.criticalPath, expectedPath);
  assert.equal(result.length, 3);
  assert.match(result.criticalMermaid, /SF_A00_T01 --> SF_A01_T01/);
  assert.match(result.criticalMermaid, /SF_A01_T01 --> SF_A02_T02/);
  assert.doesNotMatch(result.criticalMermaid, /SF_A00_T99|SF_A02_T01/);
  assert.match(result.criticalDot, /"SF-A01-T01" -> "SF-A02-T02";/);
  assert.equal(result.criticalDot.match(/ -> /g).length, 2);
  assert.match(result.mermaid, /SF_A02_T01 --> SF_A02_T02/);
});

test('input ordering and equal-length branches produce byte-identical diagrams', () => {
  const first = snapshot();
  const reordered = { issues: first.issues.toReversed().map(item => ({
    ...item,
    dependencies: item.dependencies.toReversed(),
  })) };
  assert.deepEqual(exportDag(first), exportDag(reordered));
  assert.deepEqual(exportDag(first, 'A02'), exportDag(reordered, 'A02'));
});

test('CLI writes all, per-area and critical-path Mermaid/DOT files and prints length', t => {
  const result = invoke(temporary(t), snapshot());
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.deepEqual(summary.criticalPath, expectedPath);
  assert.equal(summary.length, 3);
  assert.deepEqual(readdirSync(result.output).sort(), [
    'A00.dot', 'A00.mmd', 'A01.dot', 'A01.mmd', 'A02.dot', 'A02.mmd',
    'all.dot', 'all.mmd', 'critical-path.dot', 'critical-path.mmd',
  ]);
  assert.equal(readFileSync(join(result.output, 'critical-path.mmd'), 'utf8'), exportDag(snapshot()).criticalMermaid);
  assert.equal(readFileSync(join(result.output, 'critical-path.dot'), 'utf8'), exportDag(snapshot()).criticalDot);
});

test('area-only export keeps its external prerequisites and the global critical path', t => {
  const result = invoke(temporary(t), snapshot(), ['--area', 'A02']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(result.output).sort(), ['A02.dot', 'A02.mmd', 'critical-path.dot', 'critical-path.mmd']);
  assert.deepEqual(JSON.parse(result.stdout).criticalPath, expectedPath);
  const diagram = readFileSync(join(result.output, 'A02.mmd'), 'utf8');
  assert.match(diagram, /SF_A01_T01 --> SF_A02_T02/);
  assert.doesNotMatch(diagram, /SF_A00_T99/);
});

test('empty, isolated and inherited-dependency graphs retain explicit boundaries', () => {
  const empty = exportDag({ issues: [] });
  assert.equal(empty.length, 0);
  assert.deepEqual(empty.criticalPath, []);
  assert.equal(empty.criticalMermaid, 'flowchart TD\n');
  assert.equal(empty.criticalDot, 'digraph dependencies {\n}\n');
  const isolated = exportDag({ issues: [task('SF-A00-T02'), task('SF-A00-T01')] });
  assert.deepEqual(isolated.criticalPath, ['SF-A00-T01']);
  assert.doesNotMatch(isolated.criticalDot, / -> /);
  const input = snapshot();
  input.issues.push({ ...task('SF-A02-T02.1'), parent: 'SF-A02-T02' });
  assert.match(exportDag(input).mermaid, /SF_A01_T01 --> SF_A02_T02_1/);
});

test('duplicate IDs, cycles and unresolved dependencies still fail before any output is written', t => {
  const cases = [
    { issues: [task('SF-A00-T01'), task('SF-A00-T01')] },
    { issues: [task('SF-A00-T01', ['SF-A00-T02']), task('SF-A00-T02', ['SF-A00-T01'])] },
    { issues: [task('SF-A00-T01', ['SF-A00-T99'])] },
  ];
  const errors = [/Duplicate work ID/, /Cycle/, /unresolved dependency/];
  for (const [index, input] of cases.entries()) {
    const result = invoke(temporary(t), input);
    assert.equal(result.status, 1);
    assert.match(result.stderr, errors[index]);
    assert.equal(existsSync(result.output), false);
  }
});

test('unknown or unsafe areas do not create output files', t => {
  const directory = temporary(t);
  const output = join(directory, 'diagrams');
  for (const area of ['A99', '../escape']) {
    assert.throws(() => writeDagExports(snapshot(), { area, output }), /Unknown area/);
    assert.equal(existsSync(output), false);
  }
});

test('release-overlay areas retain their own diagram pair', t => {
  const input = { issues: [{ ...task('SF-R015-T01'), area: 'R015' }] };
  const result = invoke(temporary(t), input, ['--area', 'R015']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(result.output).sort(), ['R015.dot', 'R015.mmd', 'critical-path.dot', 'critical-path.mmd']);
});
