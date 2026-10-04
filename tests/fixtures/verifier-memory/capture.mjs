import { captureVerifierCases } from '../../helpers/verifier-case-capture.mjs';
import { memoryCases, memoryFixture } from './input.js';

const capture = await captureVerifierCases({ output: process.argv[2], input: new URL('./input.js', import.meta.url),
  cases: memoryCases, createFixture: memoryFixture, describe: fixture => ({ policyStatus: fixture.status,
    expectedNative: fixture.nativeAccepted ?? fixture.status === 'verified', difference: fixture.difference ?? null }) });
console.log(JSON.stringify({ observations: capture.observations.length,
  differences: capture.observations.filter(value => value.difference).map(value => value.name) }));
