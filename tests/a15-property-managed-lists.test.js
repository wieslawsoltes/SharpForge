import test from 'node:test';
import assert from 'node:assert/strict';
import {compilePropertyFixture, propertyEngines, rootedPropertySource} from './helpers/a15-property-managed-fixture.js';

const source = `using System; using System.Collections; using System.Collections.Generic;
using System.Collections.Specialized; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
class Source : Control, IList<int>, INotifyCollectionChanged {
  int[] values = new int[8]; int count;
  public event NotifyCollectionChangedEventHandler CollectionChanged;
  public int Count { get { return count; } } public bool IsReadOnly { get { return false; } }
  public int this[int index] { get { return values[index]; } set {
    int old = values[index]; values[index] = value;
    CollectionChanged?.Invoke(this, new NotifyCollectionChangedEventArgs(NotifyCollectionChangedAction.Replace, value, old, index));
  } }
  public void Add(int value) { Insert(count, value); }
  public void Insert(int index, int value) {
    for (int i = count; i > index; i--) values[i] = values[i - 1]; values[index] = value; count++;
    CollectionChanged?.Invoke(this, new NotifyCollectionChangedEventArgs(NotifyCollectionChangedAction.Add, value, index));
  }
  public void RemoveAt(int index) {
    int old = values[index]; for (int i = index; i < count - 1; i++) values[i] = values[i + 1]; count--;
    CollectionChanged?.Invoke(this, new NotifyCollectionChangedEventArgs(NotifyCollectionChangedAction.Remove, old, index));
  }
  public int IndexOf(int value) { for (int i = 0; i < count; i++) if (values[i] == value) return i; return -1; }
  public bool Contains(int value) { return IndexOf(value) >= 0; }
  public bool Remove(int value) { int i = IndexOf(value); if (i < 0) return false; RemoveAt(i); return true; }
  public void Clear() { count = 0; CollectionChanged?.Invoke(this, new NotifyCollectionChangedEventArgs(NotifyCollectionChangedAction.Reset)); }
  public void CopyTo(int[] array, int index) { for (int i = 0; i < count; i++) array[index + i] = values[i]; }
  public IEnumerator<int> GetEnumerator() { return null; }
  IEnumerator IEnumerable.GetEnumerator() { return null; }
}
class P { static void Main() {
  Source source = new Source { Name = "source" }; source.Add(10); source.Add(20); new Window { Content = source }.Activate();
} }`;

test('A15 arbitrary managed IList sources use real Count/indexer/mutators and precise INCC changes on every engine', () => {
  const built = compilePropertyFixture(source);
  for (const [name, vm] of propertyEngines(built)) {
    const receiver = rootedPropertySource(vm);
    const context = vm.platform.ui;
    const projection = context.bindingServices.collection(receiver);
    assert.equal(context.bindingServices.collection(receiver), projection, name);
    assert.deepEqual([...projection], [10, 20], name);
    const changes = [];
    const dispose = projection.subscribe(change => changes.push(change));
    projection.Insert(1, 15);
    projection.set_Item(0, 5);
    projection.RemoveAt(2);
    assert.deepEqual([...projection], [5, 15], name);
    assert.deepEqual(changes.map(change => [change.action, change.NewStartingIndex, change.OldStartingIndex]),
      [['Add', 1, -1], ['Replace', 0, 0], ['Remove', -1, 2]], name);
    assert.equal(context.bindingServices.read(receiver, {kind: 'index', key: 1}), 15, name);
    assert.throws(() => projection.set_Item(2, 100), {name: 'ArgumentOutOfRangeException'}, name);
    const iterator = projection[Symbol.iterator]();
    assert.equal(iterator.next().value, 5, name);
    projection.Add(30);
    assert.throws(() => iterator.next(), {name: 'InvalidOperationException'}, name);
    const before = projection.snapshot();
    const snapshot = vm.snapshot();
    projection.Clear();
    vm.restore(snapshot);
    assert.equal(projection.version, before.revision, name);
    assert.deepEqual([...projection], [5, 15, 30], name);
    assert([...projection.retainedValues()].some(value => value?.h === receiver.h && value?.g === receiver.g), name);
    dispose();
    assert.equal(projection.listeners.size, 0, name);
  }
});
