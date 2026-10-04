import {attributesOf, firstAttribute, displayArgument} from './attribute-values.js';
import {testRecord, lifecycle, inheritedIgnore} from './discovery-shared.js';
import {resolveTestData} from './data-sources.js';

const lifecycleNames = Object.freeze({setup: 'SetUp', teardown: 'TearDown', classSetup: 'OneTimeSetUp', classTeardown: 'OneTimeTearDown'});

/** Discover NUnit method/data/fixture combinations with lifecycle metadata, explicit selection and ignored cases. */
export async function discoverNunitTests(symbols, options = {}) {
  const tests = [];
  for (const method of symbols.methods) {
    options.signal?.throwIfAborted();
    const test = firstAttribute(method, 'Test');
    const cases = attributesOf(method, 'TestCase');
    const sources = attributesOf(method, 'TestCaseSource');
    if (!test && !cases.length && !sources.length) continue;
    const fixtures = attributesOf(method.declaringType, 'TestFixture');
    const fixtureRows = fixtures.length ? fixtures : [{arguments: [], named: {}}];
    const rows = cases.map(attribute => ({arguments: attribute.arguments, displayName: attribute.named.TestName,
      expectedResult: attribute.named.ExpectedResult, hasExpectedResult: Object.hasOwn(attribute.named, 'ExpectedResult'),
      skipReason: attribute.named.Ignore, explicit: attribute.named.Explicit === true}));
    const reasons = [];
    for (const attribute of sources) {
      const typed = attribute.arguments[0]?.kind === 'type';
      const descriptor = {kind: 'member', member: attribute.arguments[typed ? 1 : 0],
        type: typed ? attribute.arguments[0].name : undefined, arguments: attribute.arguments.slice(typed ? 2 : 1)};
      const resolved = await resolveTestData(symbols, method, descriptor, options);
      rows.push(...resolved.rows.map(argumentsValue => ({arguments: argumentsValue})));
      if (resolved.reason) reasons.push(resolved.reason);
    }
    if (!rows.length && test) rows.push({arguments: null});
    if (!rows.length || reasons.length) rows.push({arguments: null, reason: reasons.join('; ') || 'TestCaseSource has no data rows'});
    for (const fixture of fixtureRows) {
      const fixtureName = method.className + (fixture.arguments.length ? '(' + fixture.arguments.map(displayArgument).join(',') + ')' : '');
      for (const row of rows) {
        const argumentsText = row.arguments ? '(' + row.arguments.map(displayArgument).join(',') + ')' : '';
        const displayName = row.displayName ?? method.name + argumentsText;
        const explicit = row.explicit || !!firstAttribute(method, 'Explicit') || !!firstAttribute(method.declaringType, 'Explicit');
        tests.push(testRecord(method, 'nunit', row.arguments, {project: options.project, displayName,
          rowKey: fixtureName + '.' + displayName, fixtureDisplayName: fixtureName, executionClassName: method.className,
          fixtureArguments: fixture.arguments, lifecycle: lifecycle(method.declaringType, lifecycleNames), explicit,
          expectedResult: row.expectedResult, hasExpectedResult: row.hasExpectedResult === true,
          skipReason: row.skipReason ?? inheritedIgnore(method), notRunnableReason: row.reason ?? null}));
      }
    }
  }
  return tests;
}
