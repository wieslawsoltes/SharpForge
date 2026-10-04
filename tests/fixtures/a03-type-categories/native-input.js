import { gunzipSync } from 'node:zlib';
import { AssemblyInspector, createMetadataVerificationTypeSystem } from '@sharpforge/cil';

export function nativeCategoryInput(capture) {
  const native = JSON.parse(capture.execution.stdout);
  const projection = JSON.parse(gunzipSync(Buffer.from(capture.coreMetadata, 'base64')));
  const coreInspector = { metadata: { rows: projection.rows,
    streams: new Map([['#Strings', Buffer.from(projection.strings, 'base64')]]) } };
  const context = createMetadataVerificationTypeSystem(coreInspector);
  const roots = { context, object: context.resolveType(native.roots.objectType).value,
    valueType: context.resolveType(native.roots.valueType).value, enum: context.resolveType(native.roots.enumType).value };
  const bindings = new Map(native.bindings.filter(binding => binding.definition !== null)
    .map(binding => [binding.token, context.resolveType(binding.definition)]));
  const coreTypes = { ...roots, resolveType: token => bindings.get(token) ?? { status: 'unknown', reason: 'outside-core' } };
  const inspector = new AssemblyInspector(Buffer.from(capture.assembly, 'base64'));
  return { native, inspector, coreInspector, coreTypes, coreAuthority: { ...roots, resolveType: context.resolveType } };
}
