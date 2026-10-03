import { codedIndex } from './metadata/indices.js';

/** Emit PropertyMap/Property/MethodSemantics rows using the property signature grammar. */
export function emitPropertyMetadata(descriptors, context) {
  const { metadata, methodTokens, signatures } = context;
  for (const descriptor of descriptors) {
    const properties = descriptor.original?.properties ?? [];
    if (!properties.length) continue;
    metadata.add(21, [descriptor.token & 0xffffff, (metadata.rows[23]?.length ?? 0) + 1]);
    for (const property of properties) {
      const parameters = property.parameters?.map(parameter => parameter.type) ?? [];
      const signature = signatures.property(property.type, parameters, property.isStatic);
      const token = metadata.add(23, [0, metadata.string(property.name), metadata.blob(signature)]);
      const association = codedIndex('HasSemantics', token);
      if (property.get !== null) metadata.add(24, [2, methodTokens.get(property.get) & 0xffffff, association]);
      if (property.set !== null) metadata.add(24, [1, methodTokens.get(property.set) & 0xffffff, association]);
    }
  }
}
