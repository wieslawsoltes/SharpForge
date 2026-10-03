import {MethodSymbol, ParameterSymbol, MethodKind, DeclarationModifiers} from './members.js';
import {scalarType} from '../scalar-queries.js';

/** A typed symbol for appended runtime profiles, whose names are deliberately absent from normal member lookup. */
export function executionBuiltinSymbol(symbols, builtin) {
  const descriptor = builtin?.numeric ?? builtin?.arrayRuntime ?? builtin?.synchronization;
  if (!descriptor) return null;
  const key = 'execution-builtin:' + builtin.id;
  if (symbols.records.has(key)) return symbols.records.get(key);
  const parameters = descriptor.parameters.map((name, ordinal) => {
    const byref = name.endsWith('&');
    return new ParameterSymbol({name: 'arg' + ordinal, ordinal,
      type: symbols.typeOf(scalarType(byref ? name.slice(0, -1) : name)), refKind: byref ? 'ref' : 'none'});
  });
  const method = new MethodSymbol({name: descriptor.name, parameters,
    methodKind: descriptor.name === '.ctor' ? MethodKind.Constructor : MethodKind.Ordinary,
    containingSymbol: symbols.typeOf(descriptor.owner), returnType: symbols.typeOf(scalarType(descriptor.returnType)),
    modifiers: descriptor.isStatic ? DeclarationModifiers.Static : 0});
  method.builtin = builtin;
  symbols.records.set(key, method);
  return method;
}
