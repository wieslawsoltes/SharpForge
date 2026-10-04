import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {getHeapStatistics} from 'node:v8';
import {resourceEnvironment, resourceControlNames} from '../bench/vm/resource-environment.js';
import {hash, stable} from '../bench/vm/evidence.js';
import {qualifyBaseline} from '../bench/vm/gate.js';
import {validateReport} from '../bench/vm/report-validation.js';
import {reportFixture, syntheticOptions} from './a05-12-fixtures.js';

test('T12 provenance records actual V8 heap capacity and every inherited resource control', () => {
  const observed = resourceEnvironment();
  assert.equal(observed.heapSizeLimit, getHeapStatistics().heap_size_limit);
  assert.equal(observed.nodeOptions, process.env.NODE_OPTIONS ?? null);
  for (const name of resourceControlNames) assert.equal(observed.resourceControls[name], process.env[name] ?? null);
});

test('T12 inherited heap caps remain visible when Node execArgv is identical', () => {
  const url = new URL('../bench/vm/resource-environment.js', import.meta.url).href;
  const script = `import {resourceEnvironment} from ${JSON.stringify(url)};
    process.stdout.write(JSON.stringify({execArgv:process.execArgv, environment:resourceEnvironment()}));`;
  const measure = cap => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', env: {...process.env, NODE_OPTIONS: `--max-old-space-size=${cap}`}, timeout: 10000
  }));
  const first = measure(64), second = measure(96);
  assert.deepEqual(first.execArgv, second.execArgv);
  assert.equal(first.environment.nodeOptions, '--max-old-space-size=64');
  assert.equal(second.environment.nodeOptions, '--max-old-space-size=96');
  assert(first.environment.heapSizeLimit < second.environment.heapSizeLimit);
  assert.notEqual(hash(stable(first.environment)), hash(stable(second.environment)));
});

for (const [name, mutate] of [
  ['NODE_OPTIONS', environment => { environment.nodeOptions = '--max-old-space-size=96'; }],
  ['effective V8 limit', environment => { environment.heapSizeLimit += 1024; }],
  ...resourceControlNames.map(name => [name, environment => { environment.resourceControls[name] = '2'; }])
]) test(`T12 rejects repeat qualification after changing ${name}`, () => {
  const first = reportFixture(), second = reportFixture({day: 2});
  mutate(second.environment);
  second.environmentFingerprint = hash(stable(second.environment));
  assert.throws(() => qualifyBaseline(first, second, syntheticOptions), /Incompatible environmentFingerprint/);
});

for (const [name, mutate] of [
  ['missing inherited options', environment => { delete environment.nodeOptions; }],
  ['missing effective heap limit', environment => { delete environment.heapSizeLimit; }],
  ['invalid effective heap limit', environment => { environment.heapSizeLimit = -1; }],
  ['omitted resource control', environment => { delete environment.resourceControls.SHARPFORGE_MAX_PARALLEL_RUNS; }]
]) test(`T12 rejects ${name}`, () => {
  const report = reportFixture();
  mutate(report.environment);
  report.environmentFingerprint = hash(stable(report.environment));
  assert.throws(() => validateReport(report, syntheticOptions), /resource limits/);
});
