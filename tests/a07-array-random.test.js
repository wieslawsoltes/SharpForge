import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {loadAssembly, formatILDocument, assembleILDocument} from '@sharpforge/cil';

const engines = {
  source: compiled => new VirtualMachine(compiled.image),
  reload: compiled => new VirtualMachine(loadAssembly(compiled.assembly)),
  cil: compiled => new CilVirtualMachine(compiled.assembly),
  reassembled: compiled => new CilVirtualMachine(assembleILDocument(formatILDocument(compiled.assembly)).bytes)
};

const cases = [
  {
    name: 'Array zero-length operations accept the endpoint without changing elements',
    source: `
      int[] values = new int[] {1, 2};
      Array.Copy(values, 2, values, 2, 0);
      Array.Fill(values, 9, 2, 0);
      Array.Clear(values, 2, 0);
      Console.WriteLine(string.Join(",", values));
      int[] empty = new int[0];
      Array.Copy(empty, empty, 0);
      Array.Fill(empty, 1);
      Array.Clear(empty, 0, 0);
      Console.WriteLine(Array.IndexOf(empty, 1));
      Console.WriteLine(Array.LastIndexOf(empty, 1));
      Console.WriteLine(Array.BinarySearch(empty, 1));`,
    expected: '1,2\n-1\n-1\n-1\n'
  },
  {
    name: 'Array rejected writes retain source and destination',
    source: `
      int[] source = new int[] {1, 2};
      int[] destination = new int[] {7, 8};
      try { Array.Copy(source, 1, destination, 0, 2); }
      catch (Exception error) { Console.WriteLine("copy"); }
      try { Array.Fill(destination, 9, 1, 2); }
      catch (Exception error) { Console.WriteLine("fill"); }
      try { Array.Clear(destination, -1, 1); }
      catch (Exception error) { Console.WriteLine("clear"); }
      Console.WriteLine(string.Join(",", source));
      Console.WriteLine(string.Join(",", destination));`,
    expected: 'copy\nfill\nclear\n1,2\n7,8\n'
  },
  {
    name: 'Array null and reference searches retain released semantics',
    source: `
      string[] values = new string[] {null, "a", "b", "a"};
      Console.WriteLine(Array.IndexOf(values, null));
      Console.WriteLine(Array.LastIndexOf(values, "a"));
      Console.WriteLine(Array.BinarySearch(new string[] {null, "a", "b"}, null));
      Console.WriteLine(Array.BinarySearch(new string[] {null, "a", "b"}, "c"));
      Array.Copy(values, 0, values, 1, 3);
      GC.Collect();
      Console.WriteLine(values[3]);
      Array.Clear(values, 0, values.Length);
      Console.WriteLine(values[3] == null);`,
    expected: '0\n3\n0\n-4\nb\nTrue\n'
  },
  {
    name: 'Random positive and negative seeds share the released sequence',
    source: `
      var positive = new Random(1);
      var negative = new Random(-1);
      for (int index = 0; index < 3; index++) {
        int value = positive.Next();
        Console.WriteLine(value);
        Console.WriteLine(value == negative.Next());
      }
      var minimum = new Random(-2147483648);
      var maximum = new Random(2147483647);
      Console.WriteLine(minimum.Next() == maximum.Next());`,
    expected: '534011718\nTrue\n237820880\nTrue\n1002897798\nTrue\nTrue\n'
  },
  {
    name: 'Random rejected bounds do not advance generator state',
    source: `
      var generator = new Random(42);
      var reference = new Random(42);
      try { generator.Next(-1); }
      catch (Exception error) { Console.WriteLine("maximum"); }
      try { generator.Next(2, 1); }
      catch (Exception error) { Console.WriteLine("range"); }
      Console.WriteLine(generator.Next() == reference.Next());
      Console.WriteLine(generator.Next(0));
      Console.WriteLine(generator.Next(-3, -3));
      Console.WriteLine(Random.Shared == Random.Shared);`,
    expected: 'maximum\nrange\nTrue\n0\n-3\nTrue\n'
  },
  {
    name: 'Random wide ranges and doubles remain bounded after heap collection',
    source: `
      var generator = new Random(42);
      var reference = new Random(42);
      bool valid = true;
      for (int index = 0; index < 128; index++) {
        int value = generator.Next(-2147483648, 2147483647);
        if (value != reference.Next(-2147483648, 2147483647)) valid = false;
        if (value < -2147483648 || value >= 2147483647) valid = false;
        double fraction = generator.NextDouble();
        if (fraction != reference.NextDouble()) valid = false;
        if (fraction < 0.0 || fraction >= 1.0) valid = false;
      }
      GC.Collect();
      Console.WriteLine(generator.Next() == reference.Next());
      Console.WriteLine(valid);`,
    expected: 'True\nTrue\n'
  }
];

for (const fixture of cases) {
  let compiled;
  for (const [engine, create] of Object.entries(engines)) {
    test(`A07 ${engine}: ${fixture.name}`, () => {
      compiled ??= compileToIL('using System;' + fixture.source);
      assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
      const result = create(compiled).run();
      assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
      assert.equal(result.output, fixture.expected);
    });
  }
}
