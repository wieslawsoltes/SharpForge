import { captureVerifierCases } from '../../helpers/verifier-case-capture.mjs';
import { literalFixture } from './input.js';
import { literalCases } from './cases.js';

const input = new URL('./input.js', import.meta.url);
const capture = await captureVerifierCases({
  output: process.argv[2],
  input,
  inputs: {
    'input.js': input,
    'cases.js': new URL('./cases.js', import.meta.url),
    '../../managed-fixtures.js': new URL('../../managed-fixtures.js', import.meta.url),
    '../verifier-fields/input.js': new URL('../verifier-fields/input.js', import.meta.url),
  },
  cases: literalCases,
  createFixture: fixture => literalFixture(fixture).bytes,
  describe: fixture => ({
    policyStatus: fixture.status,
    expectedNative: fixture.nativeAccepted ?? fixture.status === 'verified',
    difference: fixture.difference ?? null,
  }),
});
console.log(JSON.stringify({ observations: capture.observations.length,
  unsupported: capture.observations.filter(value => value.policyStatus === 'unknown').map(value => value.name) }));
