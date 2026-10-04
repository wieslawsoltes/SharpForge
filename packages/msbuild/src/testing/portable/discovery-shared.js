import {createTestCase} from '../model.js';
import {attributesOf, firstAttribute, testTraits, hasUnresolved} from './attribute-values.js';

export function lifecycle(type, names) {
  const result = {};
  for (const [stage, attribute] of Object.entries(names)) {
    result[stage] = type.methods.filter(method => firstAttribute(method, attribute)).map(method => ({name: method.name,
      fqn: method.fqn, isStatic: method.modifiers.includes('static'), parameters: method.parameters, returnType: method.returnType}));
  }
  return result;
}

export function testRecord(method, framework, row, options) {
  const {project, displayName, skipReason, notRunnableReason, fixtureArguments = [], lifecycle: stages = {}, ...rest} = options;
  const invalidArguments = (row ?? []).length !== method.parameters.length ? 'Data row argument count does not match the test method' : null;
  const inaccessible = !method.modifiers.includes('public') && framework !== 'xunit' ? 'Test method must be public' : null;
  const reason = notRunnableReason ?? (hasUnresolved(row) ? 'Attribute data contains unresolved values' : null) ?? invalidArguments ?? inaccessible;
  return createTestCase({project, fqn: method.fqn, displayName, framework, source: method.source,
    traits: testTraits(method.declaringType, method), arguments: row ?? [], fixtureArguments,
    dataRows: row ? [{arguments: row}] : [], lifecycle: stages,
    method: {name: method.name, fqn: method.fqn, modifiers: method.modifiers, parameters: method.parameters,
      returnType: method.returnType, declarationSpan: method.declarationSpan, source: method.source}, className: method.className,
    skipReason: skipReason ?? null, notRunnableReason: reason, ...rest});
}

export function inheritedIgnore(method) {
  const attribute = firstAttribute(method, 'Ignore') ?? firstAttribute(method.declaringType, 'Ignore');
  return attribute ? String(attribute.arguments[0] ?? 'Ignored') : null;
}

export function allAttributes(method, name) { return [...attributesOf(method.declaringType, name), ...attributesOf(method, name)]; }
