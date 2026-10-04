import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

// SF-A02-T30: exception filters and `lock` emitted as CIL from bound trees. The fixture `exception-filters-and-lock`
// (packages/compiler/test/cil-emission) runs them end to end against the Roslyn build on real .NET (SDK 10.0.201);
// these tests pin the regions and the instructions.

function emit(source) {
  const result = compileToAssembly(source, { name: 'Sample' }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly);
  return (owner, name) => {
    const method = [...inspector.methods.values()].find(candidate => candidate.owner === owner && candidate.name === name);
    assert.ok(method, `no method ${owner}::${name}`);
    const body = inspector.getMethod(method.token),
      lines = body.instructions.map(instruction => {
        if (instruction.operandKind !== 'token' || instruction.operand >>> 24 === 0x70) return instruction.name;
        const token = instruction.operand,
          table = token >>> 24;
        if (table === 1 || table === 2 || table === 27) return `${instruction.name} ${inspector.metadata.typeName(token)}`;
        const target = inspector.resolveToken(token);
        return `${instruction.name} ${target.owner}::${target.name}`;
      });
    return { body, lines, offsets: body.instructions.map(instruction => instruction.offset) };
  };
}

test('A02-T30 a catch clause with a filter is a filter region that tests the type before the condition', () => {
  const method = emit(`using System;
    class C {
      static int M(Action action) {
        try { action(); return 0; }
        catch (ArgumentException e) when (e.Message == "x") { return 1; }
        catch (Exception) { return 2; }
      }
      static void Main() { }
    }`),
    { body, lines, offsets } = method('C', 'M'),
    [filter, typed] = body.handlers;
  assert.equal(filter.kind, 'filter');
  assert.equal(typed.kind, 'catch');
  assert.equal(filter.start, typed.start, 'both clauses protect the same try block');
  assert.equal(filter.end, typed.end);
  const at = offset => offsets.indexOf(offset),
    // The inspector reports the clause's ClassToken/FilterOffset union as `catchType`.
    filterBlock = lines.slice(at(filter.catchType), at(filter.target));
  assert.deepEqual(filterBlock.slice(0, 6), ['isinst System.ArgumentException', 'dup', 'brtrue.s', 'pop', 'ldc.i4.0', 'br.s']);
  assert.deepEqual(filterBlock.slice(-3), ['ldc.i4.0', 'cgt.un', 'endfilter']);
  assert.equal(filterBlock.filter(line => line === 'endfilter').length, 1);
  assert.equal(lines[at(filter.target)], 'pop', 'the handler drops the exception the filter has already stored');
  assert.equal(filter.handlerEnd, typed.target, 'the typed clause follows the filtered handler');
});

test('A02-T30 a general clause with a filter tests for System.Exception, the type the binder gives a general clause', () => {
  const { body, lines, offsets } = emit(`using System;
    class C {
      static bool flag;
      static void M(Action action) { try { action(); } catch when (flag) { } }
      static void Main() { }
    }`)('C', 'M'),
    [filter] = body.handlers,
    start = offsets.indexOf(filter.catchType);
  assert.equal(filter.kind, 'filter');
  assert.deepEqual(lines.slice(start, start + 2), ['isinst System.Exception', 'dup']);
  assert.ok(lines.includes('ldsfld C::flag'));
});

test('A02-T30 lock enters the monitor inside the protected region and exits in its finally block', () => {
  const { body, lines, offsets } = emit(`class C {
      static readonly object gate = new object();
      static int value;
      static int M() { lock (gate) { return ++value; } }
      static void Main() { }
    }`)('C', 'M'),
    [region] = body.handlers,
    at = offset => offsets.indexOf(offset);
  assert.equal(body.handlers.length, 1);
  assert.equal(region.kind, 'finally');
  assert.deepEqual(lines.slice(0, 4), ['ldsfld C::gate', 'stloc.0', 'ldc.i4.0', 'stloc.1'], 'the monitor object is evaluated once, the flag starts false');
  assert.deepEqual(lines.slice(at(region.start), at(region.start) + 3), ['ldloc.0', 'ldloca.s', 'call System.Threading.Monitor::Enter']);
  assert.deepEqual(lines.slice(at(region.target), at(region.handlerEnd)), [
    'ldloc.1',
    'brfalse.s',
    'ldloc.0',
    'call System.Threading.Monitor::Exit',
    'endfinally',
  ]);
  assert.equal(lines.filter(line => line === 'ret').length, 1, 'the return leaves the region to one return point');
});
