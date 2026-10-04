import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {DebugSession, CilDebugSession} from '@sharpforge/debugger';

const source = `int[] integers = new int[] { 1, 2, 3 };
long[] longs = new long[] { 4L, 9223372036854775807L };
double[] doubles = new double[] { 1.5, 2.25 };
string[] references = new string[] { "first", "second" };
var item = new Item() { Value = 9 };
Console.WriteLine(item.Value);
class Item { public int Value; }
`;

function pausedSession(route) {
  const compiled = compileToIL(source, {pipeline: 'bound'});
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const session = route === 'cil' ? new CilDebugSession(compiled.assembly)
    : new DebugSession(route === 'reload' ? loadAssembly(compiled.assembly) : compiled.image);
  const breakpoint = session.setBreakpoints('Program.cs', [{line: 6}]);
  assert.equal(breakpoint[0].verified, true);
  session.start(false);
  assert.equal(session.runUntilStop().state, 'paused');
  return session;
}

for (const route of ['source', 'reload', 'cil']) {
  test(`${route} debugger pages numeric backing as ordinary variable descriptors`, () => {
    const session = pausedSession(route);
    try {
      for (const [name, constructor, raw, display] of [
        ['integers', Int32Array, 2, '2'],
        ['longs', BigInt64Array, 9223372036854775807n, '9223372036854775807'],
        ['doubles', Float64Array, 2.25, '2.25']
      ]) {
        const reference = session.evaluate(name).reference ?? session.evaluate(name).value;
        const record = session.vm.heap.get(reference);
        assert.ok(record.data instanceof constructor, `${name} exercises actual typed backing`);
        const before = record.data.slice();
        const page = session.children(reference, 1, 1);
        assert.ok(Array.isArray(page));
        assert.equal(page.length, 1);
        assert.deepEqual(page[0], {name: '[1]', type: record.type.slice(0, -2), value: display, raw, reference: null});
        assert.deepEqual(record.data, before, 'inspection does not mutate backing storage');
        assert.deepEqual(session.children(reference, record.data.length, 1), []);
        assert.equal(session.children(reference, record.data.length - 1, 10).length, 1);
        assert.throws(() => session.children(reference, -1, 1), RangeError);
        assert.throws(() => session.children(reference, 0, 10001), RangeError);
      }
      const referenceArray = session.evaluate('references').reference ?? session.evaluate('references').value;
      const child = session.children(referenceArray, 1, 1)[0];
      assert.equal(child.value, '"second"');
      assert.equal(child.reference, child.raw);
      assert.equal(session.vm.heap.get(child.reference).data, 'second');
      const object = session.evaluate('item').reference ?? session.evaluate('item').value;
      assert.equal(session.children(object)[0].value, '9');
      assert.equal(session.children(object)[0].name, 'Value');
      session.stop();
      session.vm.heap.collect();
      assert.throws(() => session.children(referenceArray), {name: 'InvalidReferenceException'});
    } finally {
      session.stop();
    }
  });
}
