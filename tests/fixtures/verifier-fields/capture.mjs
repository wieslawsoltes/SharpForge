import { captureVerifierCases } from '../../helpers/verifier-case-capture.mjs';
import { fieldFixture } from './input.js';
import { fieldCases } from './cases.js';

const input = new URL('./input.js', import.meta.url);
const capture = await captureVerifierCases({ output: process.argv[2], input,
  inputs: { 'input.js': input, 'cases.js': new URL('./cases.js', import.meta.url) },
  cases: fieldCases, createFixture: fixture => fieldFixture(fixture).bytes,
  describe: fixture => ({ policyStatus: fixture.status, expectedNative: fixture.nativeAccepted ?? (fixture.status === 'verified'),
    difference: fixture.difference ?? null }) });
console.log(JSON.stringify({ observations: capture.observations.length,
  unsupported: capture.observations.filter(value => value.policyStatus === 'unknown').map(value => value.name),
  differences: capture.observations.filter(value => value.difference).map(value => value.name) }));
