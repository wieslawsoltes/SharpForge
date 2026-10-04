import {join} from 'node:path';

const fixtureCases = [
  ['value-storage', 'a05/value-storage'],
  ['value-layout-sizeof', 'a05/value-layout-sizeof', '--unsafe'],
  ['value-boxing', 'a05/value-boxing'],
  ['value-instance-calls', 'a05/value-instance-calls'],
  ['virtual-slots', 'a05/virtual-slots'],
  ['default-interfaces', 'a05/default-interfaces'],
  ['generic-calls', 'a05/generic-calls'],
  ['source-generic-values', 'a05/source-generic-values'],
  ['enum-unboxing', 'a05/enum-unboxing'],
  ['nullable', 'a05/nullable'],
  ['enums-strings', 'a05/enums-strings'],
  ['tokens', 'a05/tokens'],
  ['statics', 'a05-statics'],
  ['calli', 'a05-calli', '--unsafe'],
  ['varargs', 'a05-source-varargs'],
  ['control-exceptions', 'a05-control-exceptions'],
  ['runtime-faults', 'a05/runtime-faults'],
  ['decimal', 'a05/decimal'],
  ['unsigned-widening', 'a05/numeric-conversions'],
  ['memory', 'a05-memory', '--unsafe'],
  ['async-replay', 'a05-async', '--async'],
  ['synchronization', 'a05/synchronization', '--scheduled'],
  ['exception-event-identity', 'a05/exception-event-identity'],
  ['first-chance-policy', 'a05/first-chance-policy', '--failfast'],
  ['unhandled-policy', 'a05/unhandled-policy', '--fault', 'Exception']
];

/** Explicit native scope: every case has an independent process and evidence directory. */
export function nativeQualificationPlan({output, framework}) {
  const fixtureScript = 'scripts/validate-a05-type-system.js';
  const evidence = id => join(output, id, 'evidence');
  const cases = fixtureCases.map(([id, fixture, ...flags]) => ({
    id,
    args: [fixtureScript, '--fixture', 'tests/fixtures/' + fixture, ...flags,
      '--framework', framework, '--output', evidence(id)],
    evidence: evidence(id)
  }));
  cases.push({id: 'assignability', evidence: evidence('assignability'), args: [fixtureScript, '--casts',
    '--framework', framework, '--output', evidence('assignability')]});
  for (const id of ['dispatch', 'static-init']) {
    cases.push({id, evidence: evidence(id), args: ['scripts/validate-a05-' + id + '.js', '--output', evidence(id)]});
  }
  const numericReason = 'The numeric conversion policy and generated oracle explicitly pin the .NET 10 JIT; .NET 8 is not qualified.';
  cases.push({id: 'numeric-conversions', args: ['scripts/validate-a05-numeric-dotnet.js'], sdkMajor: 10,
    unsupportedReason: numericReason});
  cases.push({id: 'numeric-capture', args: ['scripts/numeric/generate-oracle.js', evidence('numeric-capture')],
    evidence: evidence('numeric-capture'), sdkMajor: 10, unsupportedReason: numericReason, timeoutMs: 900000});
  cases.push({id: 'numeric-replay', args: ['--test', '--test-concurrency=1', 'tests/numeric-differential.test.js'],
    dependsOn: 'numeric-capture', sdkMajor: 10, unsupportedReason: numericReason, timeoutMs: 900000,
    env: {SHARPFORGE_NUMERIC_ORACLE_DIR: evidence('numeric-capture')}});
  return cases.map(item => ({timeoutMs: 300000, ...item}));
}
