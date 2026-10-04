import {DiagnosticId} from '../diagnostics/codes.js';
import {registeredField, registeredFieldDescriptor} from '../symbols/registry-fields.js';
import {n} from './semantic/node-factory.js';

/** The full semantic source pipeline consumes the same descriptor as the lightweight bound pipeline. */
export function registeredFieldLiteral(field) {
  const descriptor = registeredFieldDescriptor(field);
  return descriptor ? n.literal(descriptor.value, descriptor.type) : null;
}

/** The legacy receiver resolver already gives source types precedence over framework aliases. */
export function legacyRegisteredField(compiler, node) {
  if (node?.kind !== 'Member') return null;
  const receiver = compiler.frameworkReceiver(node);
  return receiver?.isStatic ? registeredField(receiver.type, node.name) : null;
}

/** Recover to a temporary after the diagnostic; a failed compilation cannot write external storage. */
export function prepareReadonlyField(compiler, node, field) {
  compiler.c.report(node, DiagnosticId.CS0198);
  return {kind: 'local', type: field.type, slot: compiler.temp(field.type)};
}
