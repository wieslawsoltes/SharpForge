import { MetadataBuilder } from '@sharpforge/cil';

/** One outer TypeDef plus independently named nested public children, without method bodies. */
export function nestedTypeMetadata(count) {
  const builder = new MetadataBuilder('NestedNames');
  const namespace = builder.string('Example');
  builder.add(2, [1, builder.string('Outer'), namespace, 0, 1, 1]);
  for (let index = 0; index < count; index++) {
    builder.add(2, [2, builder.string(`Inner${index}`), 0, 0, 1, 1]);
    builder.add(41, [index + 2, 1]);
  }
  return builder.finish();
}
