import { captureVerifierCases } from '../../helpers/verifier-case-capture.mjs';
import { numericFixture, numericCases } from './input.js';

const capture = await captureVerifierCases({ output: process.argv[2], input: new URL('./input.js', import.meta.url),
  cases: numericCases, createFixture: numericFixture, describe: fixture => ({ normativeAccepted: fixture.accepted,
    expectedNative: fixture.nativeAccepted ?? fixture.accepted, difference: fixture.difference ?? null }) });
console.log(JSON.stringify({ observations: capture.observations.length,
  disagreements: capture.observations.filter(value => value.oracle.accepted !== value.normativeAccepted).map(value => value.name) }));
