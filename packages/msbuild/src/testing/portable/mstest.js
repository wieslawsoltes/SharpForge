import {attributesOf, firstAttribute, displayArgument} from './attribute-values.js';
import {testRecord, lifecycle, inheritedIgnore} from './discovery-shared.js';
import {resolveTestData} from './data-sources.js';

const lifecycleNames = Object.freeze({setup: 'TestInitialize', teardown: 'TestCleanup', classSetup: 'ClassInitialize', classTeardown: 'ClassCleanup'});

/** Discover MSTest classes, data rows and DynamicData while preserving display names, categories and timeout metadata. */
export async function discoverMstestTests(symbols, options = {}) {
  const tests = [];
  for (const method of symbols.methods) {
    options.signal?.throwIfAborted();
    if (!firstAttribute(method.declaringType, 'TestClass')) continue;
    const test = firstAttribute(method, 'TestMethod') ?? firstAttribute(method, 'DataTestMethod');
    if (!test) continue;
    const baseName = test.named.DisplayName ?? test.arguments[0] ?? method.name;
    const rows = attributesOf(method, 'DataRow').map(attribute => ({arguments: attribute.arguments,
      displayName: attribute.named.DisplayName, skipReason: attribute.named.IgnoreMessage}));
    const reasons = [];
    for (const attribute of attributesOf(method, 'DynamicData')) {
      const descriptor = {kind: 'member', member: attribute.arguments[0],
        type: attribute.arguments.find(value => value?.kind === 'type')?.name};
      const resolved = await resolveTestData(symbols, method, descriptor, options);
      rows.push(...resolved.rows.map(argumentsValue => ({arguments: argumentsValue})));
      if (resolved.reason) reasons.push(resolved.reason);
    }
    if (!rows.length) rows.push({arguments: null});
    for (const row of rows) {
      const displayName = row.displayName ?? (row.arguments ? `${baseName} (${row.arguments.map(displayArgument).join(',')})` : baseName);
      tests.push(testRecord(method, 'mstest', row.arguments, {project: options.project, displayName,
        skipReason: row.skipReason ?? inheritedIgnore(method), lifecycle: lifecycle(method.declaringType, lifecycleNames),
        timeoutMs: firstAttribute(method, 'Timeout')?.arguments[0], executionClassName: method.className,
        notRunnableReason: reasons.join('; ') || (row.arguments === null && method.parameters.length ? 'Data test has no resolved rows' : null)}));
    }
  }
  return tests;
}
