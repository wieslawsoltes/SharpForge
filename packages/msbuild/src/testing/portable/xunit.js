import {attributesOf, firstAttribute, displayArgument} from './attribute-values.js';
import {testRecord} from './discovery-shared.js';
import {resolveTestData} from './data-sources.js';

/** Discover xUnit Fact/Theory and constant or managed-resolved InlineData/MemberData/ClassData rows. */
export async function discoverXunitTests(symbols, options = {}) {
  const tests = [];
  for (const method of symbols.methods) {
    options.signal?.throwIfAborted();
    const fact = firstAttribute(method, 'Fact');
    const theory = firstAttribute(method, 'Theory');
    if (!fact && !theory) continue;
    const attribute = theory ?? fact;
    const baseName = attribute.named.DisplayName ?? method.fqn;
    const skipReason = attribute.named.Skip ?? null;
    const collection = firstAttribute(method.declaringType, 'Collection')?.arguments[0] ?? null;
    const fixtures = method.declaringType.baseTypes.filter(value => /(?:IClassFixture|ICollectionFixture)</.test(value));
    const common = {project: options.project, collection, fixtures, skipReason,
      timeoutMs: attribute.named.Timeout, executionClassName: method.className};
    if (fact) {
      tests.push(testRecord(method, 'xunit', null, {...common, displayName: baseName,
        notRunnableReason: method.parameters.length ? 'Fact methods cannot have parameters' : null}));
      continue;
    }
    const rows = attributesOf(method, 'InlineData').map(data => ({arguments: data.arguments, skipReason: data.named.Skip}));
    const unresolved = [];
    for (const data of attributesOf(method, 'MemberData')) {
      const descriptor = {kind: 'member', member: data.arguments[0], type: data.named.MemberType?.name, arguments: data.arguments.slice(1)};
      const resolved = await resolveTestData(symbols, method, descriptor, options);
      rows.push(...resolved.rows.map(argumentsValue => ({arguments: argumentsValue})));
      if (resolved.reason) unresolved.push(resolved.reason);
    }
    for (const data of attributesOf(method, 'ClassData')) {
      const descriptor = {kind: 'class', type: data.arguments[0]?.name};
      const resolved = await resolveTestData(symbols, method, descriptor, options);
      rows.push(...resolved.rows.map(argumentsValue => ({arguments: argumentsValue})));
      if (resolved.reason) unresolved.push(resolved.reason);
    }
    for (const row of rows) {
      const argumentsText = row.arguments.map((value, index) => `${method.parameters[index]?.name ?? '???'}: ${displayArgument(value)}`).join(', ');
      tests.push(testRecord(method, 'xunit', row.arguments, {...common, displayName: `${baseName}(${argumentsText})`,
        skipReason: row.skipReason ?? skipReason}));
    }
    if (!rows.length || unresolved.length) tests.push(testRecord(method, 'xunit', null, {...common, displayName: baseName,
      notRunnableReason: unresolved.join('; ') || 'Theory has no data rows'}));
  }
  return tests;
}
