import {managedFixture} from '../../managed-fixtures.js';
import {builderType, builderContract} from './append-char.js';

export const equalsParameters = [builderType];
export const fromUnits = units => String.fromCharCode(...units);

/** Create only supported constructor profiles and keep each builder rooted during subsequent allocations. */
export function createEqualityBuilder(platform, plan) {
  if (plan === null) return null;
  if (plan.maxCapacity !== null) throw new Error('MaxCapacity constructor is native-only evidence');
  const result = platform.invoke(builderContract('.ctor', ['int']), [plan.capacity]);
  platform.heap.pins.push(result);
  const append = value => platform.invoke(builderContract('Append', ['string']), [result, platform.heap.string(value)]);
  if (plan.clearFirst) {
    append('discarded history\ud800\udc00');
    platform.invoke(builderContract('Clear'), [result]);
  }
  for (const segment of plan.segments) append(fromUnits(segment));
  if (plan.length !== null) platform.invoke(builderContract('set_Length', ['int']), [result, plan.length]);
  return result;
}

function sourceBuilder(name, plan) {
  if (plan === null) return `StringBuilder ${name} = null;`;
  const lines = [`var ${name} = new StringBuilder(${plan.capacity});`];
  if (plan.clearFirst) lines.push(`${name}.Append(${JSON.stringify('discarded history\ud800\udc00')}).Clear();`);
  for (const segment of plan.segments) lines.push(`${name}.Append(${JSON.stringify(fromUnits(segment))});`);
  if (plan.length !== null) lines.push(`${name}.Length = ${plan.length};`);
  return lines.join('\n');
}

/** Keep the argument statically typed as StringBuilder, including actual self references and null values. */
export function builderEqualsSource(row) {
  return '{' + sourceBuilder('first', row.first) + (row.self ? 'StringBuilder second = first;' : sourceBuilder('second', row.second)) +
    'Console.WriteLine(first.Equals(second));}';
}

function emitBuilder(writer, context, field, plan) {
  if (plan === null) writer.op('ldnull');
  else writer.op('ldc.i4', plan.capacity).op('newobj', context.member(builderType, '.ctor', 'void', ['int'], false));
  writer.op('stsfld', field);
  const append = value => writer.op('ldsfld', field).op('ldstr', 0x70000000 + context.md.userString(value))
    .op('callvirt', context.member(builderType, 'Append', builderType, ['string'], false)).op('pop');
  if (plan?.clearFirst) {
    append('discarded history\ud800\udc00');
    writer.op('ldsfld', field).op('callvirt', context.member(builderType, 'Clear', builderType, [], false)).op('pop');
  }
  for (const segment of plan?.segments ?? []) append(fromUnits(segment));
  if (plan?.length !== null && plan?.length !== undefined) writer.op('ldsfld', field).op('ldc.i4', plan.length)
    .op('callvirt', context.member(builderType, 'set_Length', 'void', ['int'], false));
}

/** Construct and compare builders through independent ordinary CIL, without source binding or lowering. */
export function builderEqualsAssembly(row) {
  return managedFixture({fields: [{name: 'First', type: builderType}, {name: 'Second', type: builderType}],
    methods: [{name: 'Main', result: 'bool', maxStack: 2, body(writer, context) {
      const first = 0x04000000 | context.fields.First;
      const second = 0x04000000 | context.fields.Second;
      emitBuilder(writer, context, first, row.first);
      if (row.self) writer.op('ldsfld', first).op('stsfld', second);
      else emitBuilder(writer, context, second, row.second);
      writer.op('ldsfld', first).op('ldsfld', second);
      writer.op('callvirt', context.member(builderType, 'Equals', 'bool', equalsParameters, false)).op('ret');
    }}]});
}
