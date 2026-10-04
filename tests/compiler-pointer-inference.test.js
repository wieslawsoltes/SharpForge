import test from 'node:test';
import assert from 'node:assert/strict';
import { coreTypes } from '../packages/compiler/src/symbols/core-types.js';
import { Conversions } from '../packages/compiler/src/conversions/classify.js';
import {
  PointerTypeSymbol,
  FunctionPointerTypeSymbol,
  TypeParameterSymbol,
  RefKind,
} from '../packages/compiler/src/symbols/types.js';
import { containsTypeParameter } from '../packages/compiler/src/symbols/substitution.js';
import { TypeInferrer } from '../packages/compiler/src/overload/type-inference.js';

const core = coreTypes();
const conversions = new Conversions(core);
const pointer = type => new PointerTypeSymbol(type);
const functionPointer = (result, parameters = [], extra = {}) => new FunctionPointerTypeSymbol({
  returnType: result,
  parameters: parameters.map(type => ({ type })),
  ...extra,
});
const parameter = () => new TypeParameterSymbol({ name: 'T' });
const inferrer = typeParameter => new TypeInferrer([typeParameter], conversions, core);
const names = types => types?.map(type => type.toDisplayString()) ?? null;

test('pointer inference: exact pointee bounds infer T from T* and nested T**', () => {
  for (const wrap of [pointer, type => pointer(pointer(type))]) {
    const typeParameter = parameter();
    const result = inferrer(typeParameter).infer([wrap(typeParameter)], [{ type: wrap(core.int) }]);
    assert.deepEqual(names(result), ['int']);
  }
});

test('pointer inference: incompatible pointee types cannot be widened through numeric conversion', () => {
  const typeParameter = parameter();
  const result = inferrer(typeParameter).infer(
    [pointer(typeParameter), pointer(typeParameter)],
    [{ type: pointer(core.int) }, { type: pointer(core.long) }],
  );
  assert.equal(names(result), null);
});

test('pointer inference: raw pointers contribute exact input bounds but no lower or upper output bounds', () => {
  const typeParameter = parameter();
  const state = inferrer(typeParameter);
  state.lower(pointer(core.int), pointer(typeParameter));
  state.upper(pointer(core.int), pointer(typeParameter));
  assert.equal(state.boundCount(), 0);
  state.exact(pointer(core.int), pointer(typeParameter));
  assert.deepEqual(names(state.bounds.get(typeParameter).exact), ['int']);
});

test('pointer inference: function-pointer parameter and return slots contribute bounds', () => {
  const typeParameter = parameter();
  const open = functionPointer(typeParameter, [typeParameter, typeParameter]);
  const closed = functionPointer(core.string, [core.string, core.string]);
  assert.deepEqual(names(inferrer(typeParameter).infer([open], [{ type: closed }])), ['string']);
});

test('pointer inference: value slots are invariant, including otherwise widening numeric types', () => {
  const typeParameter = parameter();
  const open = functionPointer(typeParameter);
  const closed = functionPointer(core.int);
  assert.equal(names(inferrer(typeParameter).infer([open, typeParameter], [{ type: closed }, { type: core.long }])), null);
});

test('pointer inference: reference returns are covariant and parameters are contravariant', () => {
  const typeParameter = parameter();
  const output = inferrer(typeParameter);
  output.lower(functionPointer(core.string), functionPointer(typeParameter));
  assert.deepEqual(names(output.bounds.get(typeParameter).lower), ['string']);
  assert.deepEqual(output.bounds.get(typeParameter).exact, []);
  const input = inferrer(typeParameter);
  input.lower(functionPointer(core.void, [core.object]), functionPointer(core.void, [typeParameter]));
  assert.deepEqual(names(input.bounds.get(typeParameter).upper), ['object']);
  assert.deepEqual(input.bounds.get(typeParameter).exact, []);
});

test('pointer inference: upper-bound inference reverses function-pointer variance', () => {
  const typeParameter = parameter();
  const state = inferrer(typeParameter);
  state.upper(functionPointer(core.string, [core.object]), functionPointer(typeParameter, [typeParameter]));
  assert.deepEqual(names(state.bounds.get(typeParameter).upper), ['string']);
  assert.deepEqual(names(state.bounds.get(typeParameter).lower), ['object']);
});

test('pointer inference: exact function-pointer inference ignores by-value variance', () => {
  const typeParameter = parameter();
  const state = inferrer(typeParameter);
  state.exact(functionPointer(core.string, [core.object]), functionPointer(typeParameter, [typeParameter]));
  assert.deepEqual(names(state.bounds.get(typeParameter).exact), ['string', 'object']);
  assert.equal(state.fix(typeParameter), false);
});

test('pointer inference: by-reference slots are exact in every inference direction', () => {
  for (const mode of ['exact', 'lower', 'upper']) {
    const typeParameter = parameter();
    const source = functionPointer(core.string, [], {
      returnRefKind: RefKind.Ref,
      parameters: [{ type: core.object, refKind: RefKind.In }],
    });
    const target = functionPointer(typeParameter, [], {
      returnRefKind: RefKind.Ref,
      parameters: [{ type: typeParameter, refKind: RefKind.In }],
    });
    const state = inferrer(typeParameter);
    state[mode](source, target);
    assert.deepEqual(names(state.bounds.get(typeParameter).exact), ['string', 'object'], mode);
  }
});

test('pointer inference: calling convention, arity and ref-kind mismatches contribute no bounds', () => {
  const typeParameter = parameter();
  const open = functionPointer(typeParameter, [typeParameter]);
  const mismatches = [
    functionPointer(core.string),
    functionPointer(core.string, [core.string], { callingConvention: 'unmanaged' }),
    functionPointer(core.string, [core.string], { returnRefKind: RefKind.Ref }),
    functionPointer(core.string, [], { parameters: [{ type: core.string, refKind: RefKind.Ref }] }),
  ];
  for (const type of mismatches) assert.equal(names(inferrer(typeParameter).infer([open], [{ type }])), null);
});

test('pointer inference: reordered unmanaged markers identify the same calling convention', () => {
  const typeParameter = parameter();
  const source = functionPointer(core.int, [], {
    callingConvention: 'unmanaged', unmanagedConventions: ['Cdecl', 'SuppressGCTransition'],
  });
  const target = functionPointer(typeParameter, [], {
    callingConvention: 'unmanaged', unmanagedConventions: ['SuppressGCTransition', 'Cdecl'],
  });
  assert.deepEqual(names(inferrer(typeParameter).infer([target], [{ type: source }])), ['int']);
});

test('pointer inference dependencies traverse pointees and all function-pointer slots', () => {
  const typeParameter = parameter();
  const other = new TypeParameterSymbol({ name: 'Other' });
  for (const type of [pointer(typeParameter), functionPointer(typeParameter), functionPointer(core.void, [pointer(typeParameter)])]) {
    assert.equal(containsTypeParameter(type), true);
    assert.equal(containsTypeParameter(type, [typeParameter]), true);
    assert.equal(containsTypeParameter(type, [other]), false);
  }
  assert.equal(containsTypeParameter(functionPointer(core.int, [core.string])), false);
});
