import { AssemblyInspector, verifyCilAssembly } from '@sharpforge/cil';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { dataflowFixture, nativeCases } from './input.js';

function require(value, message) {
  if (!value) throw new Error(message);
}

/** Focused browser admission/execution qualification using the same independently authored PE fixtures. */
export function run() {
  const checks = [];
  for (const fixture of nativeCases) {
    const bytes = dataflowFixture(fixture);
    const report = verifyCilAssembly(bytes);
    require(report.success === !!fixture.accepted, fixture.name + ': ' + JSON.stringify(report.issues));
    if (fixture.diagnostic) require(report.issues.some(issue => issue.diagnostic === fixture.diagnostic), fixture.name);
    if (fixture.accepted) require(new CilVirtualMachine(bytes).run().state === 'terminated', fixture.name + ' execution');
    checks.push(fixture.name);
  }
  const inspector = new AssemblyInspector(dataflowFixture(nativeCases[0]));
  const denied = verifyCilAssembly(inspector, { maxDataflowSteps: 0 });
  require(!denied.success && denied.issues.some(issue => issue.code === 'IL_LIMIT'), 'zero work budget');
  checks.push('ZeroBudget');
  const cancelled = verifyCilAssembly(inspector, { signal: AbortSignal.abort() });
  require(!cancelled.success, 'cancelled admission');
  checks.push('Cancellation');
  return { passed: true, checks };
}
