import { MetadataBuilder, CilWriter, Writer, methodSignature, localSignature, writeMethodBody, writePE } from '@sharpforge/cil';

export const boundaries = Object.freeze([
  { name: 'Tiny1', padding: 0, depth: 0, local: false, result: 'void', size: 1, headerSize: 1 },
  { name: 'Tiny63', padding: 62, depth: 0, local: false, result: 'void', size: 63, headerSize: 1 },
  { name: 'Fat64', padding: 63, depth: 0, local: false, result: 'void', size: 64, headerSize: 12 },
  { name: 'Stack8', padding: 0, depth: 8, local: false, result: 'int', size: 16, headerSize: 1 },
  { name: 'Stack9', padding: 0, depth: 9, local: false, result: 'int', size: 18, headerSize: 12 },
  { name: 'FatLocalZero', padding: 0, depth: 0, local: true, result: 'void', size: 1, headerSize: 12 },
]);

/** Native IL text is assembled by the pinned ILAsm, independently of the product body writer. */
export function nativeSource() {
  const methods = boundaries.map(item => {
    const operations = [...Array(item.padding).fill('nop'), ...Array(item.depth).fill('ldc.i4.0'),
      ...Array(Math.max(0, item.depth - 1)).fill('pop'), 'ret'];
    return `.method public static ${item.result === 'int' ? 'int32' : 'void'} ${item.name}() cil managed {
      .maxstack ${item.depth}
      ${item.local ? ".locals init (int32 'value')" : ''}
      ${operations.join('\n      ')}
    }`;
  });
  return `.assembly extern System.Runtime {}
.assembly Boundaries {}
.module Boundaries.dll
.class public abstract sealed Cases extends [System.Runtime]System.Object {
${methods.join('\n')}
  .method public static void InvalidUnderflow() cil managed { .maxstack 1 pop ret }
  .method public static void InvalidJoin() cil managed {
    .maxstack 2
    ldc.i4.0
    brtrue join
    ldc.i4.1
    join: ret
  }
}\n`;
}

/** Product images exercise the public body-writer policy, not compiler syntax lowering. */
export function productBoundaries() {
  const metadata = new MetadataBuilder('Boundaries');
  const object = metadata.typeRef('System.Object');
  metadata.definitions.typeDef({ Flags: 0, Name: '<Module>', Namespace: '', Extends: 0, FieldList: 1, MethodList: 1 });
  metadata.definitions.typeDef({ Flags: 0x181, Name: 'Cases', Namespace: '', Extends: object, FieldList: 1, MethodList: 1 });
  const section = new Writer().zero(72);
  for (const item of boundaries) {
    const writer = new CilWriter();
    for (let count = 0; count < item.padding; count++) writer.op('nop');
    for (let count = 0; count < item.depth; count++) writer.op('ldc.i4.0');
    for (let count = 1; count < item.depth; count++) writer.op('pop');
    const code = writer.op('ret').finish();
    const local = item.local ? metadata.add(17, [metadata.blob(localSignature(['int']))]) : 0;
    section.pad();
    const rva = 0x2000 + section.length;
    section.bytes(writeMethodBody(code, local, item.depth, [], { headerFormat: 'auto' }));
    metadata.definitions.method({ RVA: rva, ImplFlags: 0, Flags: 0x96, Name: item.name,
      Signature: methodSignature(item.result, [], true), ParamList: 1 });
  }
  section.pad();
  const offset = section.length;
  const bytes = metadata.finish();
  section.bytes(bytes);
  return writePE(section.finish(), offset, bytes.length, 0, { outputKind: 'library' });
}
