import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {packageCoverage, checkFloors, floorProposal} from '../../../scripts/conformance/coverage/report.js';
import {measureCoverage} from '../../../scripts/conformance/coverage.js';
const sha = 'a'.repeat(40);
const file = (path, lines = 10, covered = 5, branches = 2, hit = 1) => ({path, totalLineCount: lines, coveredLineCount: covered, totalBranchCount: branches, coveredBranchCount: hit});
const floor = {area: 'A05', package: 'runtime', commit: sha, review: 'reviewed fixture baseline', files: ['packages/runtime/src/a.js'], lines: 50, branches: 50};
const rows = () => [{area: 'A05', status: 'passed', packages: packageCoverage({files: [file('/repo/packages/runtime/src/a.js')]}, '/repo')}];
test('coverage aggregates package counts, excludes external and test code, and preserves zero-branch unknown', () => {
  const result = packageCoverage({files: [file('/repo/packages/runtime/src/a.js'), file('/repo/packages/runtime/src/b.js', 90, 90, 0, 0), file('/outside/a.js'), file('/repo/packages/runtime/test/a.test.js')]}, '/repo');
  assert.equal(result[0].lines.percent, 95); assert.equal(result[0].branches.percent, 50);
  assert.equal(packageCoverage({files: [file('/repo/packages/empty/src/a.js', 0, 0, 0, 0)]}, '/repo')[0].branches.percent, null);
});
test('coverage rejects malformed and duplicate evidence', () => {
  assert.throws(() => packageCoverage({files: [file('/repo/packages/a/src/a.js', 1, 2)]}, '/repo'), /Invalid coverage/);
  assert.throws(() => packageCoverage({files: [file('/repo/packages/a/src/a.js'), file('/repo/packages/a/src/a.js')]}, '/repo'), /Duplicate/);
  assert.throws(() => packageCoverage(null, '/repo'), /Missing/);
});
test('reviewed floors fail actual regressions, vanished files, and failed package runs; equality passes', () => {
  const policy = {schemaVersion: 1, floors: [floor]}; assert.deepEqual(checkFloors(rows(), policy), []);
  assert.match(checkFloors(rows(), {schemaVersion: 1, floors: [{...floor, lines: 51}]}).join(), /below/);
  const missing = rows(); missing[0].packages[0].files = []; assert.match(checkFloors(missing, policy).join(), /missing/);
  const failed = rows(); failed[0].status = 'failed'; assert.match(checkFloors(failed, policy).join(), /successful/);
  assert.throws(() => checkFloors(rows(), {schemaVersion: 1, floors: [{...floor, review: null}]}), /unreviewed/);
  assert.throws(() => checkFloors(rows(), {schemaVersion: 1, floors: [floor, floor]}), /unreviewed/);
  assert.throws(() => checkFloors(rows(), {schemaVersion: 1, floors: [{...floor, lines: null, branches: null}]}), /unreviewed/);
});
test('floor proposals retain measurements and require human review before becoming policy', () => {
  const proposal = floorProposal({commit: sha, areas: rows()}); assert.equal(proposal.floors[0].lines, 50);
  assert.equal(proposal.floors[0].review, null); assert.throws(() => checkFloors(rows(), proposal), /unreviewed/);
  assert.throws(() => floorProposal({commit: sha, areas: [{status: 'failed'}]}), /incomplete/);
});
test('coverage records a real bounded Node measurement and retains a failure report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sf-coverage-'));
  try {
    await mkdir(join(root, 'packages/tiny/src'), {recursive: true}); await mkdir(join(root, 'tests'), {recursive: true});
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await writeFile(join(root, 'packages/tiny/src/index.js'), 'export function f(x) { if (x) return 1; return 2; }\n');
    await writeFile(join(root, 'tests/tiny.test.js'), 'import test from "node:test";import assert from "node:assert/strict";import {f} from "../packages/tiny/src/index.js";test("tiny",()=>assert.equal(f(true),1));');
    await writeFile(join(root, 'floors.json'), '{"schemaVersion":1,"floors":[]}');
    execFileSync('git', ['init', '-q', root]); execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', ['-C', root, '-c', 'user.name=CoverageFixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
    const options = {root, floors: 'floors.json', output: 'report.json', manifests: [{area: 'A05', nodeFiles: ['tests/tiny.test.js'], timeout: 30000}]};
    const report = await measureCoverage(options); assert.equal(report.status, 'completed', JSON.stringify(report.errors));
    assert.equal(report.areas[0].packages[0].package, 'tiny'); assert(report.areas[0].packages[0].lines.covered > 0);
    assert.equal(report.floorStatus, 'unknown-no-reviewed-measurements');
    await writeFile(join(root, 'tests/tiny.test.js'), 'throw new Error("intentional fixture failure");');
    const failure = await measureCoverage(options); assert.equal(failure.status, 'failed');
    assert.equal(JSON.parse(await readFile(join(root, 'report.json'), 'utf8')).status, 'failed');
    assert((await readFile(join(root, 'artifacts/coverage/A05.ndjson'), 'utf8')).includes('test:fail'));
  } finally { await rm(root, {recursive: true, force: true}); }
});
