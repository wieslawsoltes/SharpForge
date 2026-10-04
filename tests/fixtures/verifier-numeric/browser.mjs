import { AssemblyInspector, verifyCilMethodTypes } from '@sharpforge/cil';
import { numericFixture, numericCases } from './input.js';

function require(value, message) {
  if (!value) throw new Error(message);
}

/** Browser qualification of the typed verifier; these checks do not execute IL. */
export function run() {
  const checks = [];
  for (const fixture of numericCases) {
    const report = verifyCilMethodTypes(numericFixture(fixture), 0x06000001);
    require(report.status === (fixture.accepted ? 'verified' : 'rejected'), fixture.name + ': ' + JSON.stringify(report));
    checks.push(fixture.name);
  }
  const inspector = new AssemblyInspector(numericFixture(numericCases[0]));
  for (const options of [{ maxTypedStackSlots: 0 }, { maxDataflowSteps: 0 }, { signal: AbortSignal.abort() }]) {
    const report = verifyCilMethodTypes(inspector, 0x06000001, options);
    require(report.status === 'unknown', JSON.stringify(report));
    checks.push(report.diagnostics[0].code);
  }
  return { passed: true, checks };
}
