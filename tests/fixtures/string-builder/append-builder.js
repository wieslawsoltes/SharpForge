import {managedFixture} from '../../managed-fixtures.js';
import {builderPlatform, builderType, builderContract} from './append-char.js';

export const builderParameters = [builderType];
export const segmentText = values => values.map(units => String.fromCharCode(...units));

/** Construct both builders in one heap, keeping the destination rooted during source allocation. */
export function builderPair(engine, destination = ['seed|'], source = ['ab', '\0', '\ud800', 'cd\udc00']) {
  const builder = builderPlatform(engine, '');
  const {platform, reference, call} = builder;
  const input = platform.heap.withRoots([reference], () => {
    for (const segment of destination) call('Append', ['string'], [platform.heap.string(segment)]);
    if (source === null) return null;
    const result = platform.invoke(builderContract('.ctor'), []);
    return platform.heap.withRoots([result], () => {
      for (const segment of source) {
        platform.invoke(builderContract('Append', ['string']), [result, platform.heap.string(segment)]);
      }
      return result;
    });
  });
  return {...builder, input};
}

export function emitBuilder(writer, context, field, segments) {
  if (segments === null) writer.op('ldnull');
  else writer.op('newobj', context.member(builderType, '.ctor', 'void', [], false));
  writer.op('stsfld', field);
  for (const segment of segments ?? []) {
    writer.op('ldsfld', field).op('ldstr', 0x70000000 + context.md.userString(String.fromCharCode(...segment)));
    writer.op('callvirt', context.member(builderType, 'Append', builderType, ['string'], false)).op('pop');
  }
}

/** Call the exact builder overload through independent ordinary CIL, including true self references. */
export function builderAppendAssembly(row) {
  return managedFixture({fields: [{name: 'Destination', type: builderType}, {name: 'Source', type: builderType},
    {name: 'Same', type: 'bool'}], methods: [{name: 'Main', result: 'void', maxStack: 2, body(writer, context) {
      const destination = 0x04000000 | context.fields.Destination;
      const source = 0x04000000 | context.fields.Source;
      emitBuilder(writer, context, destination, row.nullReceiver ? null : row.destination);
      if (row.self) writer.op('ldsfld', destination).op('stsfld', source);
      else emitBuilder(writer, context, source, row.source);
      writer.op('ldsfld', destination).op('ldsfld', source);
      writer.op('callvirt', context.member(builderType, 'Append', builderType, builderParameters, false));
      writer.op('ldsfld', destination).op('ceq').op('stsfld', 0x04000000 | context.fields.Same).op('ret');
    }}]});
}
