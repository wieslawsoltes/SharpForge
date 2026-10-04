import {DiagnosticId} from '../diagnostics/codes.js';
import {registeredField, registeredFieldDescriptor, registeredFieldSourceValue, registeredFieldSymbolValue} from '../symbols/registry-fields.js';
import {n} from './semantic/node-factory.js';

/** The full semantic source pipeline consumes the same descriptor as the lightweight bound pipeline. */
export function registeredFieldLiteral(field) {
  const descriptor = registeredFieldDescriptor(field);
  return descriptor ? n.literal(registeredFieldSymbolValue(field), descriptor.type) : null;
}

/** The legacy receiver resolver already gives source types precedence over framework aliases. */
export function legacyRegisteredField(compiler, node) {
  if (node?.kind !== 'Member') return null;
  const receiver = compiler.frameworkReceiver(node);
  return receiver?.isStatic ? registeredField(receiver.type, node.name) : null;
}

/** The legacy emitter uses the same source constant shape as both bound lowering paths. */
export function emitLegacyRegisteredField(compiler, node) {
  const receiver = compiler.frameworkReceiver(node);
  const field = receiver?.isStatic ? registeredField(receiver.type, node.name) : null;
  if (!field) return undefined;
  compiler.emitConstant(registeredFieldSourceValue(field, receiver.type, node.name));
  return field.type;
}

/** Recover to a temporary after the diagnostic; a failed compilation cannot write external storage. */
export function prepareReadonlyField(compiler, node, field) {
  compiler.c.report(node, DiagnosticId.CS0198);
  return {kind: 'local', type: field.type, slot: compiler.temp(field.type)};
}
