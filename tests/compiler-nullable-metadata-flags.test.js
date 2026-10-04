import test from 'node:test';
import assert from 'node:assert/strict';
import { frameworkBridge } from '../packages/compiler/src/symbols/registry-bridge.js';
import {
  ArrayTypeSymbol, ConstructedNamedTypeSymbol, ErrorTypeSymbol, FunctionPointerTypeSymbol, NamedTypeSymbol,
  NullableAnnotation, PointerTypeSymbol, RefKind, SymbolKind, TypeKind, TypeParameterSymbol, TypeWithAnnotations,
} from '../packages/compiler/src/symbols/types.js';
import { encodeNullableFlags, applyNullableMetadataFlags, decodeNullableFlags } from '../packages/compiler/src/nullable/metadata-flags.js';
import { parseCompilerInput } from '../packages/compiler/src/parse-input.js';
import { SemanticAnalysis } from '../packages/compiler/src/semantic-analysis.js';

const bridge = frameworkBridge();
const string = bridge.typeFromName('string');
const int = bridge.typeFromName('int');
const nullable = bridge.coreType('System_Nullable_T');
const reference = (type, flag) => new TypeWithAnnotations(type,
  flag === 2 ? NullableAnnotation.Annotated : flag === 1 ? NullableAnnotation.NotAnnotated : NullableAnnotation.Oblivious);

test('A02-T05.3 nullable value wrappers contribute no transform slot of their own', () => {
  assert.deepEqual(encodeNullableFlags(nullable.construct(int)), []);
  const value = new NamedTypeSymbol({ name: 'Pair', arity: 2, typeKind: TypeKind.Struct });
  const nested = nullable.construct(value.construct([reference(string, 2), int]));
  assert.deepEqual(encodeNullableFlags(nested), [0, 2]);
  assert.deepEqual(encodeNullableFlags(applyNullableMetadataFlags(nested, [0, 1])), [0, 1]);
});

test('A02-T05.3 nested containing generic types preserve all arguments and custom modifiers', () => {
  const outer = new NamedTypeSymbol({ name: 'Outer', arity: 1 });
  const middle = new NamedTypeSymbol({ name: 'Middle', arity: 1, containingSymbol: outer });
  const inner = new NamedTypeSymbol({ name: 'Inner', arity: 1, containingSymbol: middle });
  const outerUse = outer.construct([reference(string, 2)]);
  const middleUse = new ConstructedNamedTypeSymbol(middle, [reference(string, 1)], outerUse);
  const innerUse = new ConstructedNamedTypeSymbol(inner, [reference(new ArrayTypeSymbol(reference(string, 2)), 1)], middleUse);
  const modifier = { isOptional: true, modifier: string };
  const input = new TypeWithAnnotations(innerUse, NullableAnnotation.Annotated, [modifier]);
  assert.deepEqual(encodeNullableFlags(input), [2, 2, 1, 1, 2]);
  const result = applyNullableMetadataFlags(input, [1, 1, 2, 2, 1]);
  assert.deepEqual(encodeNullableFlags(result), [1, 1, 2, 2, 1]);
  assert.equal(result.type.originalDefinition, inner);
  assert.equal(result.type.containingType.originalDefinition, middle);
  assert.equal(result.type.containingType.containingType.originalDefinition, outer);
  assert.deepEqual(result.customModifiers, [modifier]);
});

test('A02-T05.3 pointers and function pointers consume zero slots without changing the ABI', () => {
  const type = new FunctionPointerTypeSymbol({
    callingConvention: 'unmanaged', unmanagedConventions: ['Cdecl', 'SuppressGCTransition'],
    returnType: reference(string, 2), returnRefKind: RefKind.Ref,
    parameters: [{ type: reference(string, 1), refKind: RefKind.In }, { type: new PointerTypeSymbol(int), refKind: RefKind.None }],
  });
  assert.deepEqual(encodeNullableFlags(type), [0, 2, 1, 0]);
  const transformed = applyNullableMetadataFlags(type, [0, 1, 2, 0]).type;
  assert.deepEqual(encodeNullableFlags(transformed), [0, 1, 2, 0]);
  assert.equal(transformed.signature.callingConvention, type.signature.callingConvention);
  assert.deepEqual(transformed.signature.unmanagedConventions, ['Cdecl', 'SuppressGCTransition']);
  assert.equal(transformed.signature.returnRefKind, RefKind.Ref);
  assert.equal(transformed.signature.parameters[0].refKind, RefKind.In);
});

test('A02-T05.3 a scalar broadcasts but malformed metadata vectors do not partially change the type', () => {
  const array = reference(new ArrayTypeSymbol(reference(string, 2)), 1);
  assert.deepEqual(encodeNullableFlags(applyNullableMetadataFlags(array, 2)), [2, 2]);
  assert.equal(applyNullableMetadataFlags(array, [2]), array);
  assert.equal(applyNullableMetadataFlags(array, [1, 2, 0]), array);
  assert.deepEqual(encodeNullableFlags(applyNullableMetadataFlags(array, null, 1)), [1, 1]);
});

test('A02-T05.3 value-constrained type parameters retain their zero placeholder in composite transforms', () => {
  const parameter = new TypeParameterSymbol({ name: 'T', hasValueTypeConstraint: true });
  const pair = new NamedTypeSymbol({ name: 'Pair', arity: 2, typeKind: TypeKind.Struct });
  const type = pair.construct([reference(parameter, 1), reference(string, 2)]);
  assert.deepEqual(encodeNullableFlags(type), [0, 0, 2]);
});

test('A02-T05.3 unresolved generic arguments retain their annotations and original use-site diagnostic', () => {
  const reason = { code: 'CS0012', args: ['Missing', 'AbsentAssembly'] };
  const type = new ErrorTypeSymbol('Missing', 1, { reason, candidates: [string], typeArguments: [reference(string, 1)] });
  type.metadataFullName = 'Absent.Missing`1';
  const result = applyNullableMetadataFlags(type, [1, 2]);
  assert.deepEqual(encodeNullableFlags(result), [1, 2]);
  assert.equal(result.type.reason, reason);
  assert.equal(result.type.candidates, type.candidates);
  assert.equal(result.type.metadataFullName, type.metadataFullName);
  assert.deepEqual(encodeNullableFlags(type), [0, 1]);
});

test('A02-T05.3 the source decoder retains a registry delegate\'s closed Invoke signature and identity', () => {
  const definition = bridge.typeFromName('System.Func<string>').originalDefinition;
  const original = definition.construct([string]);
  const annotated = decodeNullableFlags(original, [1, 2]);
  assert.deepEqual(encodeNullableFlags(annotated), [1, 2]);
  assert.equal(annotated.type.unannotated, original);
  assert.ok(annotated.type.delegateInvokeMethod.returnType.equals(string));
  assert.equal(annotated.type.delegateInvokeMethod.parameters.length, 0);
});

test('A02-T05.3 unconstrained and interface-constrained type uses retain the source annotation context', () => {
  const source = `interface I { }
    class Uses<T, TInterface, TNew, TValue> where TInterface : I where TNew : new() where TValue : struct {
      public T Value; public T? Optional; public T[] Array; public TInterface Contract; public TNew Created; public TValue Number;
    }`;
  for (const nullableContext of ['enable', 'disable']) {
    const options = { nullableContext }, analysis = new SemanticAnalysis(parseCompilerInput(source, options), options);
    assert.deepEqual(analysis.run().diagnostics.filter(item => item.severity === 'error'), []);
    const type = analysis.assembly.globalNamespace.lookupType('Uses', 4), flag = nullableContext === 'enable' ? 1 : 0;
    const fields = Object.fromEntries(type.getMembers().filter(member => member.kind === SymbolKind.Field)
      .map(field => [field.name, encodeNullableFlags(field.typeWithAnnotations)]));
    assert.deepEqual(fields, { Value: [flag], Optional: [2], Array: [flag, flag], Contract: [flag], Created: [flag], Number: [0] });
  }
});
