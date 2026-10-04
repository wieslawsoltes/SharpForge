/** Read-only metadata evidence from either compiler; never generates or substitutes an oracle assembly. */
import { AssemblyInspector, decodeCoded } from '@sharpforge/cil';
import { MetadataView } from '../../../packages/compiler/src/metadata-import/pe-metadata.js';
import { decodeWellKnownAttributes } from '../../../packages/compiler/src/metadata-import/attributes.js';

function attributeRows(bytes, select) {
  const inspector = new AssemblyInspector(bytes), md = inspector.metadata, view = new MetadataView(bytes);
  const labels = new Map();
  for (const type of inspector.types) {
    labels.set(type.token, type.name);
    for (const field of type.fields) labels.set(field.token, type.name + '::field:' + field.name);
    for (const property of type.properties) labels.set(property.token, type.name + '::property:' + property.name);
    for (const event of type.events) labels.set(event.token, type.name + '::event:' + event.name);
    for (const method of type.methods) {
      const signature = inspector.signature(method.token);
      const label = type.name + '::' + method.name + '(' + signature.parameters.join(',') + ')';
      labels.set(method.token, label);
      for (const parameter of md.list(method.token, 'ParamList')) {
        const row = md.row(parameter);
        labels.set(parameter, label + (row[1] === 0 ? ':return' : ':parameter:' + row[1]));
      }
    }
  }
  (md.rows[9] ?? []).forEach((row, index) => labels.set(0x09000000 | index + 1,
    labels.get(0x02000000 | row[0]) + ':interface:' + md.typeName(decodeCoded('TypeDefOrRef', row[1]))));
  (md.rows[42] ?? []).forEach((row, index) => labels.set(0x2a000000 | index + 1,
    labels.get(decodeCoded('TypeOrMethodDef', row[2])) + ':generic:' + row[0] + ':' + md.string(row[3])));
  (md.rows[44] ?? []).forEach((row, index) => labels.set(0x2c000000 | index + 1,
    labels.get(0x2a000000 | row[0]) + ':constraint:' + md.typeName(decodeCoded('TypeDefOrRef', row[1]))));
  const rows = [];
  for (const [token, label] of labels) {
    const data = decodeWellKnownAttributes(view.customAttributes(token));
    const selected = select(data);
    if (selected) rows.push({ target: label, ...selected });
  }
  return rows.sort((left, right) => left.target.localeCompare(right.target));
}

export function nullableAttributeRows(bytes) {
  return attributeRows(bytes, data => data.nullable !== null || data.nullableContext !== null
    ? { nullable: data.nullable, context: data.nullableContext } : null);
}

export function tupleAttributeRows(bytes) {
  return attributeRows(bytes, data => data.tupleElementNames ? { names: data.tupleElementNames } : null);
}
