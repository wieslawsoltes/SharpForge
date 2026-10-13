import test from 'node:test';
import assert from 'node:assert/strict';
import { codedIndex } from '@sharpforge/cil';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { arrayContext } from './clr-types-array-fixtures.js';
import { managedFixture } from './managed-fixtures.js';
import { decorateClosure, openClosure } from './clr-generics-closure-fixtures.js';
import { generic, openGenerics } from './clr-generics-instantiation-fixtures.js';

test('CLR public external TypeRefs validate generic intrinsic definitions and born-loaded tuple closures', async () => {
  let types;
  const bindings = new Map();
  const state = await openClosure('simple', { typeOptions: {
    resolveExternalType({ assemblyName, namespace, name }) {
      const fullName = `${namespace}.${name}`;
      if (assemblyName.name === 'HostTypes') return bindings.get(fullName) ?? null;
      return assemblyName.name === 'System.Runtime' ? types.intrinsic(fullName) : null;
    },
  } });
  types = state.types;
  const invalid = state.definitions.node;
  const definition = types.defineIntrinsic('Host.Bad`1', { genericArity: 1, baseType: invalid });
  const vector = types.szArray(invalid);
  const tuple = vector.interfaces.find(type => type.genericDefinition === types.intrinsic('System.Collections.Generic.IEnumerable`1'));
  assert.ok(tuple && tuple.isLoaded, 'Existing synchronous vector interfaces supply a canonical born-loaded tuple');
  const good = types.defineIntrinsic('Host.Good`1', { genericArity: 1, baseType: types.intrinsic('System.Object') });
  for (const type of [definition, tuple, good]) bindings.set(type.fullName, type);
  const tokens = [];
  const image = managedFixture({ name: 'HostClosureReferences', methods: [], entry: null, decorate({ md }) {
    for (const type of [definition, tuple, good]) tokens.push(md.typeRef(type.fullName, 'HostTypes'));
  } });
  const module = (await state.context.loadFromStream(image)).manifestModule;
  for (const token of tokens.slice(0, 2)) {
    await assert.rejects(types.load(module, token), error => error.code === LoadErrorCode.TypeLoad);
  }
  assert.equal(await types.load(module, tokens[2]), good);
  assert.equal(invalid.isLoaded, false);
  assert.equal(module.methodBodyReadCount + state.module.methodBodyReadCount, 0);
});

test('CLR identity-only external templates do not recursively complete a legal self-reference', async () => {
  let types;
  let calls = 0;
  const state = await openClosure('simple', { typeOptions: {
    resolveExternalType({ assemblyName, namespace, name }) {
      assert.equal(assemblyName.name, 'System.Runtime');
      calls++;
      return types.intrinsic(`${namespace}.${name}`);
    },
  } });
  types = state.types;
  const definition = await types.load(state.module, state.definitions.subject.metadataToken);
  assert.equal(definition.baseType.genericArguments[0], definition);
  const instance = await types.instantiate(definition, [types.intrinsic('System.Int32'), types.intrinsic('System.String')]);
  assert.equal(instance.baseType.genericArguments[0], instance);
  assert.ok(calls > 0 && calls < 100, 'Identity-only metadata binding stays finite without recursive graph completion');
});

test('CLR finite proof and completion consume the same binding when a host offers changing same-name descriptors', async () => {
  let types;
  let good;
  let alternate;
  let calls = 0;
  const state = await openGenerics({ typeOptions: {
    resolveExternalType({ assemblyName, namespace, name }) {
      if (assemblyName.name === 'Remote') return ++calls === 1 ? good : alternate;
      return assemblyName.name === 'System.Runtime' ? types.intrinsic(`${namespace}.${name}`) : null;
    },
  } }, { decorate(input) {
    decorateClosure('simple')(input);
    const { md, tokens } = input;
    md.rows[2][(tokens.subject & 0xffffff) - 1][3] = codedIndex('TypeDefOrRef', md.typeRef('Remote.Base', 'Remote'));
  } });
  types = state.types;
  good = types.defineIntrinsic('Remote.Base', { baseType: types.intrinsic('System.Object') });
  alternate = arrayContext().types.defineIntrinsic('Remote.Base', { baseType: state.definitions.subject });
  const result = await types.load(state.module, state.definitions.subject.metadataToken);
  assert.equal(result.baseType, good);
  assert.equal(calls, 1, 'Completion consumes the proof template instead of requesting another host identity');
  const closed = await types.instantiate(result, [types.intrinsic('System.Int32'), types.intrinsic('System.String')]);
  assert.equal(closed.baseType, good);
  assert.equal(calls, 1, 'Later proof reads use the already completed canonical definition graph');
  assert.equal(alternate.baseType, result, 'The unused alternate would create an erased cycle if rebound');
  assert.equal(state.module.methodBodyReadCount, 0);
});

test('CLR unloaded argument templates are rechecked across roots without a strong permanent binding cache', async () => {
  for (const construction of ['intrinsic', 'metadata']) {
    let types;
    let good;
    let alternate;
    let calls = 0;
    const state = await openGenerics({ typeOptions: {
      resolveExternalType({ assemblyName, namespace, name }) {
        if (assemblyName.name === 'Remote') return ++calls === 2 ? alternate : good;
        return assemblyName.name === 'System.Runtime' ? types.intrinsic(`${namespace}.${name}`) : null;
      },
    } }, { decorate({ md, tokens }) {
      md.rows[2][(tokens.box & 0xffffff) - 1][3] = codedIndex('TypeDefOrRef', md.typeRef('Remote.Base', 'Remote'));
    } });
    types = state.types;
    good = types.defineIntrinsic('Remote.Base');
    alternate = arrayContext().types.defineIntrinsic('Remote.Base', { baseType: state.definitions.box });
    const host = construction === 'metadata' ? state.definitions.other : types.defineIntrinsic('Host.Container`1', { genericArity: 1 });
    const retained = await types.instantiate(host, [state.definitions.box]);
    assert.equal(state.definitions.box.isLoaded, false, 'Argument metadata is proved without completing its inherited graph');
    await assert.rejects(types.instantiate(host, [state.definitions.box]), error => error.code === LoadErrorCode.TypeLoad);
    assert.equal(calls, 2, 'A prior proof involving an unloaded definition is not a cross-operation success admission');
    assert.equal(await types.instantiate(host, [state.definitions.box]), retained);
    assert.equal(calls, 3, 'Failed proof does not poison a later valid callback result');
    assert.equal(state.definitions.box.isLoaded, false);
  }
});


test('CLR loaded metadata definitions reprove unloaded argument graphs before the token fast path returns', async () => {
  let types;
  let host;
  let good;
  let alternate;
  let calls = 0;
  let invalid = false;
  const state = await openGenerics({ typeOptions: {
    resolveExternalType({ assemblyName, namespace, name }) {
      if (assemblyName.name === 'Host') return host;
      if (assemblyName.name === 'Remote') {
        calls++;
        return invalid ? alternate : good;
      }
      return assemblyName.name === 'System.Runtime' ? types.intrinsic(`${namespace}.${name}`) : null;
    },
  } }, { decorate({ md, type, base, tokens }) {
    tokens.subject = type('Subject`1', 1);
    md.rows[2][(tokens.box & 0xffffff) - 1][3] = codedIndex('TypeDefOrRef', md.typeRef('Remote.Base', 'Remote'));
    base(tokens.subject, generic(md.typeRef('Host.Container`1', 'Host'), [{ kind: 'class', token: tokens.box }]), 'subjectBase');
  } });
  types = state.types;
  host = types.defineIntrinsic('Host.Container`1', { genericArity: 1 });
  good = types.defineIntrinsic('Remote.Base');
  alternate = arrayContext().types.defineIntrinsic('Remote.Base', { baseType: state.definitions.box });
  const retained = await types.load(state.module, state.tokens.subject);
  assert.equal(retained.isLoaded, true);
  assert.equal(retained.baseType.genericArguments[0], state.definitions.box);
  assert.equal(state.definitions.box.isLoaded, false);
  const firstCalls = calls;
  invalid = true;
  await assert.rejects(types.load(state.module, state.tokens.subject), error => error.code === LoadErrorCode.TypeLoad);
  assert.ok(calls > firstCalls, 'Loaded nominal metadata cannot bypass a withheld finite-closure admission');
  invalid = false;
  assert.equal(await types.load(state.module, state.tokens.subject), retained);
  assert.ok(calls > firstCalls + 1, 'A failed reproof does not poison a later valid root');
  assert.equal(state.module.methodBodyReadCount, 0);
});

test('CLR a late generic entry cannot publish a nominal graph different from its own completed proof template', async () => {
  let types;
  let first;
  let second;
  let calls = 0;
  const state = await openGenerics({ typeOptions: {
    resolveExternalType({ assemblyName, namespace, name }) {
      if (assemblyName.name === 'Host') return ++calls === 1 ? first : second;
      return assemblyName.name === 'System.Runtime' ? types.intrinsic(`${namespace}.${name}`) : null;
    },
  } }, { decorate({ md, type, tokens }) {
    tokens.subject = type('PlainSubject');
    md.rows[2][(tokens.subject & 0xffffff) - 1][3] = codedIndex('TypeDefOrRef', md.typeRef('Host.G`1', 'Host'));
    // A direct external TypeRef activates generic closure without inheriting an active TypeSpec cycle marker.
  } });
  types = state.types;
  first = types.defineIntrinsic('Host.G`1', { genericArity: 1, baseType: state.definitions.subject });
  const foreign = arrayContext().types;
  second = foreign.defineIntrinsic('Host.G`1', { genericArity: 1, baseType: foreign.intrinsic('System.Object') });
  await assert.rejects(types.load(state.module, state.tokens.subject), error => error.code === LoadErrorCode.TypeLoad);
  assert.equal(calls, 2, 'The first raw base and later generic proof received distinct same-name bindings');
  assert.equal(state.definitions.subject.isLoaded, false, 'The root rejects before publishing its cyclic requested graph');
  assert.equal(state.module.methodBodyReadCount, 0);
});
