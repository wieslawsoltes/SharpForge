import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const source = String.raw`
using System;
using System.Collections.Generic;
class Program {
    static void Print(params object[] values) {
        Console.WriteLine(values[0].GetType().FullName);
        Console.WriteLine(values[1].GetType().FullName);
    }
    static void Main() {
        object[] values = new object[] {'<', '\0', '\uD800', '\uFFFF', 60, 60.0, true, "<", null};
        for (int index = 0; index < 8; index++) Console.WriteLine(values[index].GetType().FullName);
        Console.WriteLine(values[8] == null);
        var dictionary = new Dictionary<int, object>();
        dictionary.Add(1, '<');
        Console.WriteLine(dictionary[1].GetType().FullName);
        var characters = new List<object>();
        characters.Add('<');
        Console.WriteLine(characters.Contains('<'));
        Console.WriteLine(characters.Contains(60));
        Print('<', '\0');
        char[] unboxed = new char[] {'<', '\0'};
        Console.WriteLine(unboxed.Length);
    }
}`;

const expected = [
  'System.Char', 'System.Char', 'System.Char', 'System.Char',
  'System.Int32', 'System.Double', 'System.Boolean', 'System.String', 'True',
  'System.Char', 'True', 'False', 'System.Char', 'System.Char', '2', ''
].join('\n');

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`SF-A09-B02 ${pipeline}/${engine} boxes Char at object arguments, arrays and params boundaries`, () => {
      const options = {pipeline, includeDebug: false};
      const compiled = engine === 'source' ? compile(source, options) : compileToIL(source, options);
      assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
      const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, expected);
        const boxes = vm.heap.records.filter(record => record?.kind === 'box' && record.methodTable.name === 'System.Char');
        const contents = new Set(boxes.map(record => vm.platform.native(record.data[0])));
        for (const codeUnit of [0, 60, 0xd800, 0xffff]) {
          assert(contents.has(codeUnit), `Char box must preserve UTF-16 code unit ${codeUnit}`);
        }
        const array = vm.heap.records.find(record => record?.kind === 'array' && record.methodTable.elementType?.name === 'System.Char');
        assert.deepEqual(Array.from(array.data), [60, 0]);
      } finally {
        vm.stop();
      }
    });
  }
}
