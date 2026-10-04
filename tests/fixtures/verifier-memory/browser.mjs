import { verifyCilMethodTypes } from '@sharpforge/cil';
import { memoryFixture, memoryCases } from './input.js';

/** Browser verification only: no IL execution or native-acceptance inference. */
export function run() {
  const checks = [];
  for (const fixture of memoryCases) {
    const report = verifyCilMethodTypes(memoryFixture(fixture), 0x06000001);
    if (report.status !== fixture.status) throw new Error(JSON.stringify({ name: fixture.name, report }));
    checks.push(fixture.name);
  }
  const bytes = memoryFixture(memoryCases[0]);
  for (const options of [{ maxTypedStackSlots: 0 }, { maxDataflowSteps: 0 }, { signal: AbortSignal.abort() }]) {
    const report = verifyCilMethodTypes(bytes, 0x06000001, options);
    if (report.status !== 'unknown') throw new Error(JSON.stringify(report));
    checks.push(report.diagnostics[0].code);
  }
  return { passed: true, checks };
}
