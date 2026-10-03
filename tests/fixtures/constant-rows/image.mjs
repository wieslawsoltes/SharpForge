import { MetadataBuilder, Writer, fieldSignature, propertySignature, writePE } from '@sharpforge/cil';

/** Three Constant parents exercise every HasConstant tag with intentionally unsorted insertion. */
export function constantRowImage() {
  const builder = new MetadataBuilder('ConstantRows');
  const field = builder.definitions.field({ Flags: 0x56, Name: 'Answer', Signature: fieldSignature('int') });
  const parameter = builder.definitions.parameter({ Flags: 0x10, Sequence: 1, Name: 'value' });
  const property = builder.addRow('Property', { Flags: 0x200, Name: 'Default', Type: propertySignature('string', []) });
  builder.definitions.constantValue({ Parent: property, Type: 'string', Value: 'text' });
  builder.definitions.constantValue({ Parent: parameter, Type: 'int', Value: -7 });
  builder.definitions.constantValue({ Parent: field, Type: 'int', Value: 42 });
  const metadata = builder.finish();
  const section = new Writer().zero(72).bytes(metadata).finish();
  return writePE(section, 72, metadata.length, 0, { outputKind: 'library' });
}
