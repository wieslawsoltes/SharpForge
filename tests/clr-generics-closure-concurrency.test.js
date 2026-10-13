import test from 'node:test';
import assert from 'node:assert/strict';
import { codedIndex } from '@sharpforge/cil';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { arrayContext } from './clr-types-array-fixtures.js';
import { openGenerics, deferred } from './clr-generics-instantiation-fixtures.js';

async function concurrentBindings(mode) {
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = deferred();
  const second = deferred();
  const firstStarted = deferred();
  const secondStarted = deferred();
  let types;
  let left;
  let right;
  let firstTail;
  let secondTail;
  let wait;
  const state = await openGenerics({ typeOptions: {
    resolveExternalType({ assemblyName, namespace, name, signal }) {
      if (assemblyName.name === 'System.Runtime') return types.intrinsic(`${namespace}.${name}`);
      assert.equal(assemblyName.name, 'Host.Bindings');
      if (name === 'Link') {
        if (signal === firstController.signal) {
          firstStarted.resolve();
          return first.promise;
        }
        if (mode === 'same') {
          secondStarted.resolve();
          return second.promise;
        }
        return right;
      }
      if (name === 'Tail') {
        if (signal === firstController.signal || mode === 'same') return firstTail;
        if (mode === 'post-read') {
          secondStarted.resolve();
          return second.promise;
        }
        return secondTail;
      }
      assert.equal(name, 'Wait');
      secondStarted.resolve();
      return second.promise;
    },
  } }, { decorate({ md, type, tokens }) {
    for (const [key, name, parent] of [['c', 'C', 'Link'], ['d', 'D', 'Tail'], ['waiting', 'Waiting', 'Wait']]) {
      tokens[key] = type(name);
      md.rows[2][(tokens[key] & 0xffffff) - 1][3] = codedIndex('TypeDefOrRef', md.typeRef(`Host.${parent}`, 'Host.Bindings'));
    }
  } });
  types = state.types;
  const firstHost = arrayContext().types;
  const secondHost = arrayContext().types;
  left = firstHost.defineIntrinsic('Host.Link', { baseType: firstHost.intrinsic('System.Object') });
  firstTail = firstHost.defineIntrinsic('Host.Tail', { baseType: state.definitions.c });
  right = secondHost.defineIntrinsic('Host.Link', { baseType: state.definitions.d });
  secondTail = secondHost.defineIntrinsic('Host.Tail', {
    baseType: mode === 'notification' ? state.definitions.waiting : secondHost.intrinsic('System.Object'),
  });
  wait = secondHost.defineIntrinsic('Host.Wait', { baseType: secondHost.intrinsic('System.Object') });
  return { ...state, firstController, secondController, firstStarted: firstStarted.promise, secondStarted: secondStarted.promise,
    releaseFirst: () => first.resolve(left),
    releaseSecond: () => second.resolve(mode === 'same' ? left : mode === 'notification' ? wait : secondTail), firstTail };
}

test('CLR a late template read adopts the canonical graph another root already published', async () => {
  const state = await concurrentBindings('post-read');
  const first = state.types.load(state.module, state.tokens.d, { typeArguments: [], signal: state.firstController.signal });
  await state.firstStarted;
  const second = state.types.load(state.module, state.tokens.c, { typeArguments: [], signal: state.secondController.signal });
  const rejected = assert.rejects(second, error => error.code === LoadErrorCode.TypeLoad);
  await state.secondStarted;
  state.releaseFirst();
  assert.equal(await first, state.definitions.d);
  assert.equal(state.definitions.d.baseType, state.firstTail);
  assert.equal(state.definitions.c.isLoaded, false);
  state.releaseSecond();
  await rejected;
  assert.equal(state.definitions.c.isLoaded, false, 'The incompatible C graph cannot complete the combined erased cycle');
  assert.equal(state.module.methodBodyReadCount, 0);
});

test('CLR changed canonical publication invalidates an earlier complete proof record while another bind is pending', async () => {
  const state = await concurrentBindings('notification');
  const first = state.types.load(state.module, state.tokens.d, { typeArguments: [], signal: state.firstController.signal });
  await state.firstStarted;
  const second = state.types.load(state.module, state.tokens.c, { typeArguments: [], signal: state.secondController.signal });
  const rejected = assert.rejects(second, error => error.code === LoadErrorCode.TypeLoad);
  await state.secondStarted;
  state.releaseFirst();
  await first;
  state.releaseSecond();
  await rejected;
  assert.equal(state.definitions.c.isLoaded, false);
  assert.equal(state.definitions.waiting.isLoaded, false);
  assert.equal(state.definitions.d.baseType, state.firstTail);
});

test('CLR concurrent equal direct bindings retain canonical identity without false conflict or pending self-promise', async () => {
  const state = await concurrentBindings('same');
  const first = state.types.load(state.module, state.tokens.d, { typeArguments: [], signal: state.firstController.signal });
  await state.firstStarted;
  const second = state.types.load(state.module, state.tokens.d, { typeArguments: [], signal: state.secondController.signal });
  await state.secondStarted;
  state.releaseFirst();
  const expected = await first;
  state.releaseSecond();
  assert.equal(await second, expected);
  assert.equal(expected.baseType, state.firstTail);
  assert.equal(state.definitions.c.isLoaded, false, 'Closure validation does not eagerly complete an intrinsic base argument graph');
});
