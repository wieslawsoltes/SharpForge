import {
  MetadataBuilder, Writer, CilWriter, fieldSignature, methodSignature,
  codedIndex, token, writePE, TEXT_RVA
} from '@sharpforge/cil';

/** Independent CLI field definitions and closed MemberRefs, without source lowering. */
export function tokenCacheFixture(otherType = 'int', {derived = false} = {}) {
  const metadata = new MetadataBuilder('FieldCache');
  const object = metadata.typeRef('System.Object');
  const generic = token(2, 2);
  const resolve = name => metadata.typeRef(name);
  metadata.add(2, [0, metadata.string('<Module>'), 0, 0, 1, 1]);
  metadata.add(2, [0x100001, metadata.string('Box`1'), 0, codedIndex('TypeDefOrRef', object), 1, 1]);
  metadata.add(2, [0x100001, metadata.string('Other'), 0, codedIndex('TypeDefOrRef', object), 3, 1]);
  metadata.add(2, [0x100001, metadata.string('Program'), 0, codedIndex('TypeDefOrRef', object), 4, 1]);
  metadata.add(42, [0, 0, codedIndex('TypeOrMethodDef', generic), metadata.string('T')]);
  const genericSignature = new Uint8Array([6, 0x13, 0]);
  const field = metadata.add(4, [6, metadata.string('Value'), metadata.blob(genericSignature)]);
  const staticField = metadata.add(4, [0x16, metadata.string('Shared'), metadata.blob(genericSignature)]);
  const otherField = metadata.add(4, [6, metadata.string('OtherValue'), metadata.blob(fieldSignature(otherType, resolve))]);
  const closedTypes = [];
  const members = [8, 14].map(element => {
    const signature = new Writer().u8(0x15).u8(0x12)
      .compressed(codedIndex('TypeDefOrRef', generic)).u8(1).u8(element).finish();
    const closed = metadata.add(27, [metadata.blob(signature)]);
    closedTypes.push(closed);
    return metadata.member(closed, 'Value', genericSignature);
  });
  const method = metadata.add(6, [
    0, 0, 0x96, metadata.string('Main'), metadata.blob(methodSignature('int', [], true, resolve)), 1
  ]);
  if (derived) metadata.add(2, [0x100001, metadata.string('DerivedBox'), 0,
    codedIndex('TypeDefOrRef', closedTypes[0]), 4, 2]);
  const section = new Writer().zero(72);
  const code = new CilWriter().op('ldc.i4.0').op('ret').finish();
  metadata.rows[6][0][0] = TEXT_RVA + section.length;
  section.u16(0x3013).u16(8).u32(code.length).u32(0).bytes(code).pad(4);
  const offset = section.length;
  const bytes = metadata.finish(undefined, new Uint8Array([3, 7, 0]));
  section.bytes(bytes);
  return {bytes: writePE(section.finish(), offset, bytes.length, method), field, staticField, otherField, members, method};
}
