import { rowWriterGroup } from './row-writer.js';

/** Interop, declarative security and event row writers use the ECMA named columns. */
export function interopRowWriters(builder) {
  return rowWriterGroup(builder, {
    implMap: 'ImplMap', fieldMarshal: 'FieldMarshal', declSecurity: 'DeclSecurity',
    event: 'Event', eventMap: 'EventMap', methodSemantics: 'MethodSemantics',
  });
}
