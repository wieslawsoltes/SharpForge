import { Writer, utf8, codedIndex } from '@sharpforge/cil';
import { fail } from './contracts.js';

const fieldsByKind = Object.freeze({
  1: ['namespace'],
  2: ['assembly', 'namespace'],
  3: ['type'],
  4: ['alias', 'namespace'],
  5: ['alias'],
  6: ['alias', 'assembly'],
  7: ['alias', 'namespace'],
  8: ['alias', 'assembly', 'namespace'],
  9: ['alias', 'type'],
});

function writeReference(writer, field, value, counts) {
  if (field === 'assembly') {
    if (!Number.isInteger(value) || value < 1 || value > (counts[35] ?? 0)) fail('Invalid import assembly reference');
    writer.compressed(value);
    return;
  }
  const table = value >>> 24;
  const row = value & 0xffffff;
  if (!Number.isInteger(value) || ![1, 2, 27].includes(table) || row < 1 || row > (counts[table] ?? 0)) {
    fail('Invalid import type reference');
  }
  writer.compressed(codedIndex('TypeDefOrRef', value));
}

/** Write one-based import scopes in parent-before-child order; invalid references fail. */
export function writeImportScopes(builder, scopes, counts) {
  for (const [index, scope] of scopes.entries()) {
    const parent = scope.parent ?? 0;
    if (!Number.isInteger(parent) || parent < 0 || parent > index) fail('Import parent must precede its child');
    if (scope.id !== undefined && scope.id !== index + 1) fail('Import scope ids must match row order');
    const writer = new Writer();
    for (const definition of scope.definitions ?? []) {
      const fields = Object.hasOwn(fieldsByKind, definition.kind) ? fieldsByKind[definition.kind] : null;
      if (!fields) fail('Unknown import definition kind');
      writer.compressed(definition.kind);
      for (const field of fields) {
        const value = definition[field];
        if (field === 'assembly' || field === 'type') writeReference(writer, field, value, counts);
        else {
          if (typeof value !== 'string' || value.includes('\0')) fail('Invalid import ' + field);
          writer.compressed(builder.blob(utf8(value)));
        }
      }
    }
    builder.add(53, [parent, builder.blob(writer.finish())]);
  }
}
