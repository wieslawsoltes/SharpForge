import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';

// C# boxes each primitive at the object[] boundary. Formatting and GetType make
// the stored runtime type observable; integral-valued doubles must stay Double.
const cases = [
  {
    name: 'object array initializers preserve primitive types for formatting',
    source: `using System;
      using System.Text;
      class Program {
        static void Main() {
          object[] values = new object[] {42, 42.0, true, "text", null};
          var builder = new StringBuilder();
          builder.AppendFormat("{0:D3}", values[0]);
          builder.AppendFormat("/{0:F1}", values[1]);
          builder.AppendFormat("/{0}/{1}/{2}", values[2], values[3], values[4]);
          Console.WriteLine(builder.ToString());
          Console.WriteLine(values[0].GetType().FullName);
          Console.WriteLine(values[1].GetType().FullName);
          Console.WriteLine(values[2].GetType().FullName);
        }
      }`,
    expected: '042/42.0/True/text/\nSystem.Int32\nSystem.Double\nSystem.Boolean\n',
  },
  {
    name: 'expanded params preserve primitive types and argument evaluation order',
    source: `using System;
      using System.Text;
      class Program {
        static int Next(int value) { Console.WriteLine(value); return value; }
        static void Print(params object[] values) {
          var builder = new StringBuilder();
          builder.AppendFormat("{0:D3}/{1:D3}/{2:F1}", values[0], values[1], values[2]);
          Console.WriteLine(builder.ToString());
        }
        static void Main() { Print(Next(1), Next(2), 3.0); }
      }`,
    expected: '1\n2\n001/002/3.0\n',
  },
  {
    name: 'explicit params arrays and empty expansion preserve reference and null identity',
    source: `using System;
      class Item {}
      class Program {
        static void Print(params object[] values) {
          Console.WriteLine(values.Length);
          if (values.Length > 0) {
            Console.WriteLine(object.ReferenceEquals(values[0], values[1]));
            Console.WriteLine(values[2] == null);
            Console.WriteLine(values[3].GetType().FullName);
          }
        }
        static void Main() {
          var item = new Item();
          Print(new object[] {item, item, null, 42});
          Print(item, item, null, 42);
          Print();
        }
      }`,
    expected: '4\nTrue\nTrue\nSystem.Int32\n4\nTrue\nTrue\nSystem.Int32\n0\n',
  },
  {
    name: 'initializers evaluate once and leave primitive arrays unboxed',
    source: `using System;
      class Program {
        static int Next(int value) { Console.WriteLine(value); return value; }
        static void Main() {
          object[] values = new object[] {Next(4), Next(5)};
          int[] numbers = new int[] {Next(6), Next(7)};
          Console.WriteLine(values[0].GetType().FullName);
          Console.WriteLine(values[1].GetType().FullName);
          Console.WriteLine(numbers[0] + numbers[1]);
        }
      }`,
    expected: '4\n5\n6\n7\nSystem.Int32\nSystem.Int32\n13\n',
  },
];

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    for (const fixture of cases) {
      test(`SF-A07-B06 ${pipeline}/${engine}: ${fixture.name}`, () => {
        const options = {pipeline, includeDebug: false};
        const result = engine === 'source' ? compile(fixture.source, options) : compileToIL(fixture.source, options);
        assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
        const machine = engine === 'source'
          ? new VirtualMachine(result.image)
          : new CilVirtualMachine(result.assembly);
        const execution = machine.run();
        assert.equal(execution.fault, null, execution.fault?.message);
        assert.equal(execution.output, fixture.expected);
      });
    }
  }
}
