import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { prepareVerificationCoreTypes } from '../src/index.js';
import { coreBindingFixture } from '../../../tests/helpers/clr-verification-core-types.js';

const fixture = await coreBindingFixture();
const authority = await prepareVerificationCoreTypes(fixture.module, fixture.bindingOptions);
const token = fixture.input.tokens.object;
const samples = { prepareMicroseconds: [], lookupNanoseconds: [] };
for (let sample = 0; sample < 23; sample++) {
  let start = performance.now();
  for (let index = 0; index < 100; index++) await prepareVerificationCoreTypes(fixture.module, fixture.bindingOptions);
  samples.prepareMicroseconds.push((performance.now() - start) * 1000 / 100);
  start = performance.now();
  for (let index = 0; index < 100000; index++) {
    if (authority.resolveType(token).value !== fixture.bindingOptions.object) throw new Error('Wrong core binding');
  }
  samples.lookupNanoseconds.push((performance.now() - start) * 1000000 / 100000);
}
const summary = Object.fromEntries(Object.entries(samples).map(([name, values]) => {
  const sorted = values.slice(3).sort((left, right) => left - right);
  return [name, { median: sorted[10], p95: sorted[18] }];
}));
const report = { node: process.version, platform: `${process.platform}-${process.arch}`, warmups: 3,
  selectedTokens: 3, preparedIterationsPerSample: 100, lookupIterationsPerSample: 100000,
  methodology: 'New API only; loaded CLR graph and CIL context prepared outside timing; shared host; no prior baseline.',
  unmeasured: ['allocation volume', 'peak memory', 'build output size', 'native/browser/VM execution'], samples, summary };
const output = JSON.stringify(report, null, 2) + '\n';
if (process.argv[2]) writeFileSync(process.argv[2], output);
else process.stdout.write(output);
