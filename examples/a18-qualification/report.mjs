import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildIdentityReport} from '../../tests/fixtures/a18/report.js';
import {canonical} from '../../tests/fixtures/a18/corpus.js';

const argumentsSet = new Set(process.argv.slice(2));
for (const argument of argumentsSet) {
  if (!['--record-goldens', '--evidence'].includes(argument)) throw new Error('Unknown argument: ' + argument);
}
const report = buildIdentityReport();
for (const fixture of report.fixtures) {
  const url = new URL('../../tests/fixtures/a18/corpus/' + fixture.golden.fixture + '/golden.json', import.meta.url);
  if (argumentsSet.has('--record-goldens')) writeFileSync(url, JSON.stringify(canonical(fixture.golden), null, 2) + '\n');
  else assert.deepEqual(canonical(fixture.golden), canonical(JSON.parse(readFileSync(url, 'utf8'))),
    fixture.golden.fixture + ': golden analysis changed; review the source and diagnostic diff before re-recording.');
}
if (argumentsSet.has('--evidence')) {
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
  report.evidence = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim(),
    workingTree: execFileSync('git', ['status', '--porcelain'], {cwd, encoding: 'utf8'}).trim() ? 'modified' : 'clean',
    node: process.version, platform: process.platform, architecture: process.arch,
    command: ['node', 'examples/a18-qualification/report.mjs', '--evidence'],
  };
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
