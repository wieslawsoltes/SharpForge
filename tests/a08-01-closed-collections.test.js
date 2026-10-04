import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {closedCollectionsModule} from '@sharpforge/bcl-collections';
import {createBclRegistry} from '@sharpforge/bcl-core';
import {contracts, types, createRegistry} from '@sharpforge/framework';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {loadAssembly, formatILDocument, assembleILDocument} from '@sharpforge/cil';

const engines = {
  source: compiled => new VirtualMachine(compiled.image),
  reload: compiled => new VirtualMachine(loadAssembly(compiled.assembly)),
  cil: compiled => new CilVirtualMachine(compiled.assembly),
  reassembled: compiled => new CilVirtualMachine(assembleILDocument(formatILDocument(compiled.assembly)).bytes)
};
const prefix = 'using System;using System.Collections.Generic;';

test('A08 collection extraction preserves every released contract identity and order', async () => {
  const registered = contracts.filter(member => member.id < 65536 && closedCollectionsModule.families.includes(types.get(member.owner)?.family));
  const locked = JSON.parse(await readFile(new URL('../planning/contracts/framework-ids.lock.json', import.meta.url), 'utf8'));
  const project = ({id, owner, name, parameters, kind}) => ({id, owner, name, parameters, kind});
  assert.equal(registered.length, 425);
  assert.deepEqual(registered.map(project), locked.filter(member => member.id >= 821 && member.id <= 1245));
  const isolated = createRegistry({reservations: [{name: 'collections', start: 821, size: 425}]});
  const modules = createBclRegistry([closedCollectionsModule]);
  isolated.register({name: 'collections', register: target => modules.register(target, {group: 'bcl-collections'})});
  assert.deepEqual(isolated.contracts, registered);
  assert.equal(isolated.types.size, 35);
});

test('A08 collections use independent family registration and decline unrelated owners', () => {
  const modules = createBclRegistry([closedCollectionsModule]);
  const platform = {bclHost: {frameworkType: () => ({kind: 'bcl', family: 'math'})}};
  assert.deepEqual(modules.invoke(platform, {owner: 'System.Math'}, []), {handled: false});
  assert.deepEqual(closedCollectionsModule.invoke(platform, {owner: 'System.Math'}, []), {handled: false});
  assert(Object.isFrozen(closedCollectionsModule.families));
  assert.throws(() => createBclRegistry([closedCollectionsModule, closedCollectionsModule]), /Duplicate BCL module/);
});

const fixtures = [
  {
    name: 'List range operations retain capacity and independent copies',
    source: `
      var values = new List<int>(new int[] {4, 1, 3});
      var copy = values.ToArray();
      values.AddRange(new int[] {2});
      values.Insert(values.Count, 9);
      values.Sort(); values.Reverse(); values.RemoveAt(0); values.RemoveRange(1, 2);
      values.RemoveRange(values.Count, 0);
      values.Capacity = 8;
      Console.WriteLine(string.Join(",", values.ToArray()));
      Console.WriteLine(copy[0]); Console.WriteLine(values.Capacity); Console.WriteLine(values.Remove(7));`,
    expected: '4,1\n4\n8\nFalse\n'
  },
  {
    name: 'List invalid mutations leave elements unchanged and empty Clear remains valid',
    source: `
      var values = new List<int>(new int[] {1, 2});
      try { values.Insert(3, 9); } catch (Exception error) { Console.WriteLine("insert"); }
      try { values.RemoveRange(1, 2); } catch (Exception error) { Console.WriteLine("range"); }
      try { values.Capacity = 1; } catch (Exception error) { Console.WriteLine("capacity"); }
      try { var invalid = new List<int>(-1); } catch (Exception error) { Console.WriteLine("constructor"); }
      Console.WriteLine(string.Join(",", values.ToArray()));
      var empty = new List<int>(); empty.Clear();
      Console.WriteLine(empty.Count); Console.WriteLine(empty.ToArray().Length);`,
    expected: 'insert\nrange\ncapacity\nconstructor\n1,2\n0\n0\n'
  },
  {
    name: 'HashSet preserves null, duplicate and array set-operation behavior',
    source: `
      var values = new HashSet<string>(new string[] {null, "a", "a"});
      Console.WriteLine(values.Count); Console.WriteLine(values.Add(null));
      values.UnionWith(new string[] {"b", "c"});
      values.ExceptWith(new string[] {"a"});
      values.IntersectWith(new string[] {null, "b"});
      Console.WriteLine(values.Count); Console.WriteLine(values.Remove(null));
      Console.WriteLine(values.Contains("b")); Console.WriteLine(values.Count);`,
    expected: '2\nFalse\n2\nTrue\nTrue\n1\n'
  },
  {
    name: 'Queue wraps and grows while Stack keeps reverse enumeration order',
    source: `
      var queue = new Queue<string>(4);
      queue.Enqueue("a"); queue.Enqueue("b"); queue.Enqueue("c"); queue.Enqueue("d");
      queue.Dequeue(); queue.Dequeue(); queue.Enqueue("e"); queue.Enqueue("f"); queue.Enqueue("g");
      Console.WriteLine(string.Join(",", queue.ToArray()));
      queue.Clear(); queue.Enqueue("z"); Console.WriteLine(queue.Dequeue());
      try { queue.Peek(); } catch (Exception error) { Console.WriteLine("queue empty"); }
      var stack = new Stack<int>(new int[] {1, 2}); stack.Push(3);
      Console.WriteLine(string.Join(",", stack.ToArray())); Console.WriteLine(stack.Pop());
      stack.Clear();
      try { stack.Pop(); } catch (Exception error) { Console.WriteLine("stack empty"); }`,
    expected: 'c,d,e,f,g\nz\nqueue empty\n3,2,1\n3\nstack empty\n'
  },
  {
    name: 'Dictionary preserves key snapshots, replacement, roots and rejected keys',
    source: `
      var values = new Dictionary<string,int>(); values.Add("first", 1); values.Add("second", 2);
      var keys = values.Keys;
      values.Remove("second"); values.Add("second", 3);
      Console.WriteLine(values.TryAdd("first", 7));
      try { values.Add("first", 9); } catch (Exception error) { Console.WriteLine("duplicate"); }
      try { values.Add(null, 0); } catch (Exception error) { Console.WriteLine("null"); }
      try { Console.WriteLine(values["missing"]); } catch (Exception error) { Console.WriteLine("missing"); }
      GC.Collect();
      Console.WriteLine(keys.Length); Console.WriteLine(keys[0]);
      Console.WriteLine(string.Join(",", values.Values)); Console.WriteLine(values.Count);`,
    expected: 'False\nduplicate\nnull\nmissing\n2\nfirst\n1,3\n2\n'
  },
  {
    name: 'Enumerator enforces current position, mutation versions and disposal',
    source: `
      var values = new List<int>(new int[] {1, 2});
      var iterator = values.GetEnumerator();
      try { Console.WriteLine(iterator.Current); } catch (Exception error) { Console.WriteLine("position"); }
      Console.WriteLine(iterator.MoveNext()); Console.WriteLine(iterator.Current);
      values.Add(3);
      try { iterator.MoveNext(); } catch (Exception error) { Console.WriteLine("modified"); }
      iterator.Dispose(); iterator.Dispose();
      try { iterator.MoveNext(); } catch (Exception error) { Console.WriteLine("disposed"); }`,
    expected: 'position\nTrue\n1\nmodified\ndisposed\n'
  }
];

for (const fixture of fixtures) {
  let compiled;
  for (const [engine, create] of Object.entries(engines)) {
    test(`A08 ${engine}: ${fixture.name}`, () => {
      compiled ??= compileToIL(prefix + fixture.source);
      assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
      const result = create(compiled).run();
      assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
      assert.equal(result.output, fixture.expected);
    });
  }
}

for (const engine of ['source', 'cil']) {
  test(`A08 ${engine}: collection heap state and indexes replay after snapshot restore`, () => {
    const compiled = compileToIL(prefix + `
      var values = new Dictionary<string,int>(); values.Add("key", 1);
      var queue = new Queue<int>(); queue.Enqueue(7);
      Console.WriteLine("ready");
      values.Remove("key"); values.Add("key", 2); queue.Enqueue(8);
      GC.Collect();
      Console.WriteLine(values["key"]); Console.WriteLine(string.Join(",", queue.ToArray()));`);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const vm = engines[engine](compiled);
    for (let step = 0; step < 10000 && !vm.output.join('').includes('ready'); step++) {
      vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    }
    assert.equal(vm.output.join(''), 'ready\n');
    const saved = vm.snapshot();
    assert.equal(vm.run().output, 'ready\n2\n7,8\n');
    vm.restore(saved);
    assert.equal(vm.run().output, 'ready\n2\n7,8\n');
  });
}
