import { verifyCilMethodTypes } from '@sharpforge/cil';
import { coreAuthority } from '../a03-type-categories/input.js';
import { objectFixture, objectAuthority, objectAnnotations } from './input.js';
import { objectCases } from './cases.js';

/** Portable API replay uses explicit synthetic identities; the native corpus independently verifies emitted CLI bytes. */
export function run() {
  const core = coreAuthority();
  const external = core.context.resolveType(core.tokens.Class).value;
  core.externalTypes = new Map([['System.Exception', external], ['System.MulticastDelegate', external]]);
  const checks = [];
  function check(fixture, expected, options = {}) {
    const input = objectFixture(fixture);
    const report = verifyCilMethodTypes(input.bytes, input.method, {
      coreTypes: objectAuthority(core, input),
      objectTypeAnnotations: fixture.annotationAuthority ? objectAnnotations(input) : undefined,
      ...options,
    });
    if (report.status !== expected) throw new Error(JSON.stringify({ name: fixture.name, report }));
    if (fixture.diagnostic && report.diagnostics[0]?.diagnostic !== fixture.diagnostic)
      throw new Error(JSON.stringify({ name: fixture.name, expectedDiagnostic: fixture.diagnostic, report }));
    checks.push(fixture.name);
  }
  for (const fixture of objectCases) check(fixture, fixture.status);
  const boxed = objectCases.find(fixture => fixture.name === 'HarmlessAnnotation');
  check({ ...boxed, name: 'AnnotationRows', diagnostic: undefined }, 'unknown', { maxObjectAnnotationRows: 0 });
  check({ ...boxed, name: 'AnnotationBytes', diagnostic: undefined }, 'unknown', { maxObjectAnnotationBytes: 0 });
  check({ ...boxed, name: 'Cancelled', diagnostic: undefined }, 'unknown', { signal: AbortSignal.abort() });
  check({ ...boxed, name: 'MalformedAuthority', diagnostic: 'ObjectAnnotationAuthorityUnavailable' }, 'unknown', {
    objectTypeAnnotations: { classifyConstructor: () => ({ status: 'known', value: { byRefLike: 'false' } }) },
  });
  return { passed: true, checks };
}
