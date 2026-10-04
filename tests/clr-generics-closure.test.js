import test from 'node:test';
import assert from 'node:assert/strict';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { arrayContext } from './clr-types-array-fixtures.js';
import { openClosure, remoteClosure } from './clr-generics-closure-fixtures.js';

const fails = code => error => error.code === code;

test('CLR simple self-reference has a finite closure for definitions, closed and arbitrarily nested caller arguments', async () => {
  const { types, module, definitions } = await openClosure('simple');
  const subject = await types.load(module, definitions.subject.metadataToken);
  assert.equal(subject.baseType.genericArguments[0], subject);
  const integer = types.intrinsic('System.Int32');
  const text = types.intrinsic('System.String');
  let instance = await types.instantiate(subject, [integer, text]);
  for (let index = 0; index < 3; index++) {
    assert.equal(instance.baseType.genericArguments[0], instance);
    const next = await types.instantiate(subject, [instance, text]);
    assert.equal(next.genericArguments[0], instance);
    instance = next;
  }
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR non-expanding mutual permutations retain distinct owner-scoped formals and partial identities', async () => {
  const { types, module, definitions } = await openClosure('permuted');
  const subject = await types.load(module, definitions.subject.metadataToken);
  const partner = await types.load(module, definitions.partner.metadataToken);
  assert.notEqual(subject.genericParameters[0], partner.genericParameters[0]);
  assert.deepEqual(subject.baseType.genericArguments[0].genericArguments, [...subject.genericParameters].reverse());
  assert.deepEqual(partner.baseType.genericArguments[0].genericArguments, partner.genericParameters);
  const arguments_ = [types.intrinsic('System.Int32'), partner.genericParameters[0]];
  const partial = await types.instantiate(subject, arguments_);
  assert.equal(partial.containsGenericParameters, true);
  assert.equal(await types.instantiate(subject, arguments_), partial);
  assert.deepEqual(partial.baseType.genericArguments[0].genericArguments, [...arguments_].reverse());
  assert.equal(definitions.node.isLoaded, false, 'An unrelated invalid TypeDef does not enter the requested closure');
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR acyclic expanding edges and a non-generic self interface remain valid', async () => {
  for (const pattern of ['acyclic-expansion', 'non-generic-self-interface']) {
    const { types, module, definitions } = await openClosure(pattern);
    const definition = definitions.plain ?? definitions.subject;
    const result = await types.load(module, definition.metadataToken);
    assert.equal(result.isLoaded, true);
    if (definitions.plain) assert.equal(result.interfaces[0].genericArguments[0], result);
    else {
      const closed = await types.instantiate(result, [types.intrinsic('System.Int32'), types.intrinsic('System.String')]);
      assert.equal(closed.baseType.genericArguments[0].genericArguments[0].genericDefinition, definitions.box);
    }
    assert.equal(module.methodBodyReadCount, 0);
  }
});

test('CLR indirect and array expansion cycles and erased constant-argument cycles reject without loaded publication', async () => {
  for (const pattern of ['indirect-expanding', 'array-expanding', 'erased-cycle']) {
    const { types, module, definitions } = await openClosure(pattern);
    const arguments_ = [types.intrinsic('System.Int32'), types.intrinsic('System.String')];
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(types.load(module, definitions.subject.metadataToken), fails(LoadErrorCode.TypeLoad));
      await assert.rejects(types.instantiate(definitions.subject, arguments_), fails(LoadErrorCode.TypeLoad));
      assert.equal(definitions.subject.isLoaded, false);
      assert.equal(definitions.partner.isLoaded, false);
      assert.equal(definitions.box.isLoaded, false);
    }
    assert.equal(module.methodBodyReadCount, 0);
  }
});

test('CLR invalid argument definitions cannot enter intrinsic tuples through element or function-pointer wrappers', async () => {
  const { types, definitions, module, specs } = await openClosure('simple');
  const box = types.defineIntrinsic('Host.Box`1', { genericArity: 1 });
  const invalid = definitions.node;
  const arguments_ = [invalid, invalid.genericParameters[0], types.szArray(invalid), types.array(invalid, 2),
    types.szArray(types.pointer(invalid)), types.szArray(types.functionPointer({ returnType: invalid }))];
  for (const argument of arguments_) {
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(types.instantiate(box, [argument]), fails(LoadErrorCode.TypeLoad));
      assert.equal(invalid.isLoaded, false);
    }
  }
  await assert.rejects(types.load(module, specs.scopeArray, { typeArguments: [invalid] }), fails(LoadErrorCode.TypeLoad));
  assert.equal((await types.instantiate(box, [types.intrinsic('System.Int32')])).isLoaded, true);
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR closure formals and inheritance references are canonical across assembly boundaries', async () => {
  for (const expanding of [false, true]) {
    const first = remoteClosure('ClosureA', 'ClosureB');
    const second = remoteClosure('ClosureB', 'ClosureA', { expanding });
    let calls = 0;
    const context = arrayContext({ load(request) {
      if (request.assemblyName.name !== 'ClosureB') return null;
      calls++;
      return second.image;
    } });
    const module = (await context.loadFromStream(first.image)).manifestModule;
    const definition = module.typeDefinition(first.tokens.subject);
    const pending = context.types.instantiate(definition, [context.types.intrinsic('System.Int32')]);
    if (expanding) {
      await assert.rejects(pending, fails(LoadErrorCode.TypeLoad));
      assert.equal(definition.isLoaded, false);
    } else {
      const instance = await pending;
      const partner = instance.baseType.genericArguments[0].genericDefinition;
      assert.notEqual(partner.genericParameters[0], definition.genericParameters[0]);
      assert.equal(partner.genericParameters[0].genericParameterOwner, partner);
      assert.equal(await context.types.instantiate(definition, instance.genericArguments), instance);
    }
    assert.equal(calls, 1);
    assert.equal(module.methodBodyReadCount, 0);
  }
});
