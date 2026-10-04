import test from 'node:test';
import assert from 'node:assert/strict';
import {UIConstructionRoots} from '@sharpforge/winui-properties';

test('A15 construction roots survive nested factories and release after caught and uncaught faults', () => {
  const scope = new UIConstructionRoots({key: value => value.id, maxRoots: 3, maxDepth: 2});
  const outer = {id: 1}, inner = {id: 2};
  assert.throws(() => scope.run(() => {
    scope.retain(outer);
    assert.throws(() => scope.run(() => {
      scope.retain(inner);
      assert.deepEqual([...scope.roots()], [outer, inner]);
      throw new Error('nested factory');
    }), /nested factory/);
    assert.equal(scope.size, 2, 'a caught inner fault cannot remove the outer construction roots');
    assert.throws(() => scope.run(() => scope.run(() => null)), /recursion budget/);
    scope.retain({id: 1});
    assert.equal(scope.size, 2, 'stable host identities are deduplicated');
    scope.retain({id: 3});
    scope.retain({id: 4});
  }), /root budget/);
  assert.equal(scope.size, 0);
  assert.equal(scope.depth, 0);
  assert.deepEqual([...scope.roots()], []);
  assert.throws(() => scope.run(() => Promise.resolve(null)), /asynchronous boundary/);
  assert.equal(scope.size, 0);
  assert.equal(scope.run(() => 7), 7, 'a failed factory does not poison the next operation');
});
