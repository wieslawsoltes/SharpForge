import { verifyCilMethodTypes } from '@sharpforge/cil';
import { coreAuthority } from '../a03-type-categories/input.js';
import { fieldFixture, fieldAuthority } from './input.js';
import { fieldCases } from './cases.js';

/** Browser contract uses portable canonical identity fixtures; the native Node replay uses actual CoreLib roots. */
export function run() {
  const checks = [];
  const core = coreAuthority();
  function check(input, options, expected, label) {
    const report = verifyCilMethodTypes(input.bytes, input.method, options);
    if (report.status !== expected) throw new Error(`${label}: ${JSON.stringify(report)}`);
    checks.push(label);
  }
  for (const fixture of fieldCases) {
    const input = fieldFixture(fixture);
    check(input, { coreTypes: fieldAuthority(core, input) }, fixture.status, fixture.name);
  }
  const input = fieldFixture(fieldCases.find(value => value.name === 'LoadWrongReceiver'));
  for (const sameModule of [undefined, true])
    check(input, { coreTypes: { ...fieldAuthority(core, input), sameModule } }, 'unknown', `Module:${sameModule}`);
  for (const limits of [{ maxMembers: 0 }, { maxTypedStackSlots: 0 }, { signal: AbortSignal.abort() }])
    check(input, { coreTypes: fieldAuthority(core, input), ...limits }, 'unknown', 'BudgetOrCancellation');
  check(input, {}, 'unknown', 'UnboundAuthority');
  return { passed: true, checks };
}
