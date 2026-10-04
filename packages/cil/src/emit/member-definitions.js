import {memberAccessFlags} from '../metadata/member-definitions.js';

/** Apply metadata-only visibility and initonly flags after definition tokens are allocated. */
export function applyMemberDefinitions(context, descriptors, profile) {
  if (!profile) return;
  const methods = new Map(profile.methods.map(record => [record.id, record]));
  const fields = new Map(profile.fields.map(record => [record.type + ':' + record.index, record]));
  const statics = new Map(profile.statics.map(record => [context.staticTokens[record.index], record]));
  for (const type of descriptors) {
    for (const method of type.methods) {
      const original = method.helper === 'constructor' ? method.ctor : method.original;
      if (!original || method.original?.name === '.ctor') continue;
      method.flags = (method.flags & ~7) | memberAccessFlags.get(methods.get(original.id).access);
    }
    if (!type.original) continue;
    for (const field of type.fields) {
      const record = field.isStatic ? statics.get(field.token) : fields.get(type.original.id + ':' + field.index);
      field.flags = (field.isStatic ? 0x10 : 0) | memberAccessFlags.get(record.access) | (record.isReadOnly ? 0x20 : 0);
    }
  }
}
