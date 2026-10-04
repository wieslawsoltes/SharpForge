import { verifyCilMethodTypes } from '@sharpforge/cil';
import { coreAuthority } from '../a03-type-categories/input.js';
import { literalFixture, literalAuthority } from './input.js';
import { literalCases } from './cases.js';

/** Portable browser replay uses explicit synthetic authority; Node additionally replays captured CoreLib facts. */
export function run() {
  const core = coreAuthority();
  const checks = [];
  function check(fixture, expected, options = {}) {
    const input = literalFixture(fixture);
    const coreTypes = fixture.metadata ? literalAuthority(core, input) : undefined;
    const report = verifyCilMethodTypes(input.bytes, input.method, { coreTypes, ...options });
    if (report.status !== expected) throw new Error(JSON.stringify({ name: fixture.name, report }));
    checks.push(fixture.name);
  }
  for (const fixture of literalCases) check(fixture, fixture.status);
  check({ name: 'BadMarker', rawHeap: Uint8Array.of(0, 3, 65, 0, 1) }, 'rejected');
  check({ name: 'Truncated', rawHeap: Uint8Array.of(0, 0xc0, 0) }, 'rejected');
  check({ name: 'ByteBudget' }, 'unknown', { maxStringLiteralBytes: 0 });
  check({ name: 'CountBudget' }, 'unknown', { maxStringLiterals: 0 });
  check({ name: 'Cancelled' }, 'unknown', { signal: AbortSignal.abort() });
  return { passed: true, checks };
}
