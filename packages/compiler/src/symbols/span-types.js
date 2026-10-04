/**
 * `System.Span<T>` and `System.ReadOnlySpan<T>` for compilations bound against the closed framework registry.
 *
 * The registry does not list the span types, but the language knows them: `stackalloc` produces a `Span<T>`, C# 14
 * has built-in span conversions, and ref safety (flow/ref-safety.js) is about ref structs. The definitions are
 * declared in the bridge's core library as ref structs with the members programs use most (`Length`, the
 * by-reference indexer, `Slice`, `ToArray`); any other member is a framework gap like on every registry type.
 */
import { Accessibility, RefKind } from './types.js';
import { MethodSymbol, PropertySymbol, ParameterSymbol, MethodKind, DeclarationModifiers } from './members.js';

const publicMember = { declaredAccessibility: Accessibility.Public, isImplicitlyDeclared: true };

function addGetter(owner, name, type, options = {}) {
  const getMethod = new MethodSymbol({
    ...publicMember,
    name: 'get_' + (options.parameters ? 'Item' : name),
    methodKind: MethodKind.PropertyGet,
    returnType: type,
    refKind: options.refKind ?? RefKind.None,
    parameters: (options.parameters ?? []).map(([parameterName, parameterType]) => new ParameterSymbol({ name: parameterName, type: parameterType })),
    modifiers: DeclarationModifiers.ReadOnly,
  });
  owner.addMember(getMethod);
  owner.addMember(
    new PropertySymbol({
      ...publicMember,
      name,
      type,
      refKind: options.refKind ?? RefKind.None,
      parameters: (options.parameters ?? []).map(([parameterName, parameterType]) => new ParameterSymbol({ name: parameterName, type: parameterType })),
      getMethod,
    }),
  );
}

function addMethod(owner, name, returnType, parameters) {
  owner.addMember(
    new MethodSymbol({
      ...publicMember,
      name,
      returnType,
      parameters: parameters.map(([parameterName, parameterType]) => new ParameterSymbol({ name: parameterName, type: parameterType })),
      modifiers: DeclarationModifiers.ReadOnly,
    }),
  );
}

/** `public static implicit operator Target(Source value)` on `owner` (the conversions the BCL declares on the span types). */
function addImplicitConversion(owner, source, target) {
  owner.addMember(
    new MethodSymbol({
      ...publicMember,
      name: 'op_Implicit',
      methodKind: MethodKind.Conversion,
      returnType: target,
      parameters: [new ParameterSymbol({ name: 'value', type: source })],
      modifiers: DeclarationModifiers.Static,
    }),
  );
}

function declareSpan(core, id, elementRefKind) {
  const definition = core.bridge.coreType(id);
  // A definition that already has members comes from a referenced core library (or was declared before): leave it alone.
  if (definition.isErrorType() || definition.getMembers().length) return definition;
  definition.isRefLikeType = true;
  definition.isReadOnly = true;
  const element = definition.typeParameters[0];
  addGetter(definition, 'Length', core.int);
  addGetter(definition, 'IsEmpty', core.bool);
  addGetter(definition, 'this[]', element, { refKind: elementRefKind, parameters: [['index', core.int]] });
  addMethod(definition, 'Slice', definition, [['start', core.int]]);
  addMethod(definition, 'Slice', definition, [
    ['start', core.int],
    ['length', core.int],
  ]);
  addMethod(definition, 'ToArray', core.arrayOf(element), []);
  addImplicitConversion(definition, core.arrayOf(element), definition);
  return definition;
}

/** Declares both span definitions once per bridge and returns `{ span, readOnlySpan }`. */
export function declareSpanTypes(core) {
  const alreadyDeclared = core.bridge.coreType('System_Span_T').getMembers().length > 0;
  const span = declareSpan(core, 'System_Span_T', RefKind.Ref);
  const readOnlySpan = declareSpan(core, 'System_ReadOnlySpan_T', RefKind.RefReadOnly);
  if (!alreadyDeclared && !span.isErrorType() && !readOnlySpan.isErrorType()) {
    addImplicitConversion(span, span, readOnlySpan.construct(span.typeParameters[0]));
    // `string` declares `implicit operator ReadOnlySpan<char>(string)`: below C# 14 this operator is the conversion.
    if (core.string?.addMember && core.char) addImplicitConversion(core.string, core.string, readOnlySpan.construct(core.char));
  }
  return { span, readOnlySpan };
}
