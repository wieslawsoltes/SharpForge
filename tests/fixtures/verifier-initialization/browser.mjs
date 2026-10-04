import { verifyCilMethodTypes } from '@sharpforge/cil';
import { initializationFixture, initializationCases } from './input.js';
import { run as numericChecks } from '../verifier-numeric/browser.mjs';

export function run() {
  const checks = numericChecks().checks;
  for (const fixture of initializationCases) {
    const report = verifyCilMethodTypes(initializationFixture(fixture), 0x06000001,
      { localInitialization: 'definite-assignment' });
    if (report.status !== (fixture.accepted ? 'verified' : 'rejected')) throw new Error(JSON.stringify({ name: fixture.name, report }));
    checks.push(fixture.name);
  }
  const fixture = initializationCases.find(value => value.name === 'StoredLoad');
  for (const options of [{ maxInitializationWords: 0 }, { signal: AbortSignal.abort() }]) {
    const report = verifyCilMethodTypes(initializationFixture(fixture), 0x06000001,
      { localInitialization: 'definite-assignment', ...options });
    if (report.status !== 'unknown') throw new Error(JSON.stringify(report));
    checks.push(report.diagnostics[0].code);
  }
  return { passed: true, checks };
}
