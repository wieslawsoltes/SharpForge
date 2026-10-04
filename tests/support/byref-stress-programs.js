import {genericCallFixture} from './generic-call-fixture.js';

export const byrefStressSeed = 0x53464237;
export const byrefStressKinds = Object.freeze(['field', 'array', 'box']);

/** Each specimen changes executable constants, nesting, layouts and array boundaries. */
export function byrefStressPrograms(count = 1000, seed = byrefStressSeed) {
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new RangeError('Stress count must be 1..1000');
  if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff) throw new RangeError('Stress seed must be a nonzero UInt32');
  let state = seed;
  const random = bound => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % bound;
  };
  return Array.from({length: count}, (_, ordinal) => {
    const length = 1 + random(8);
    const levels = Array.from({length: 1 + random(5)}, () => ({delta: random(101) - 50, value: random(20001) - 10000}));
    const initial = random(2001) - 1000;
    const after = random(101) - 50;
    return Object.freeze({ordinal, kind: byrefStressKinds[ordinal % 3], initial, after, length,
      index: ordinal % 2 ? length - 1 : 0, padding: random(4), levels,
      expected: initial + after + levels.reduce((sum, level) => sum + level.delta, 0) + levels.at(-1).value});
  });
}

function padded(field, count) {
  return [...Array.from({length: count}, (_, index) => ({name: `Padding${index}`, type: 'int'})), field];
}

function interior(writer, context, field) {
  writer.op('ldflda', context.fields.get('Cell.Inner')).op('ldflda', context.fields.get('Inner.' + field));
}

function makeOwner(writer, context, specimen) {
  const cell = context.resolve('Cell');
  if (specimen.kind === 'field') {
    writer.op('newobj', context.methods.get('Holder..ctor')).op('ldflda', context.fields.get('Holder.Cell'));
  } else if (specimen.kind === 'array') {
    writer.integer(specimen.length).op('newarr', cell).integer(specimen.index).op('ldelema', cell);
  } else {
    writer.op('ldloc.0').op('box', cell).op('unbox', cell);
  }
  writer.op('ret');
}

function nestedMethod(specimen, level, index) {
  return {name: 'Level' + index, parameters: ['int&', 'Node&'], body(writer, context) {
    writer.op('ldarg.0').op('ldarg.0').op('ldind.i4').integer(level.delta).op('add').op('stind.i4');
    writer.op('ldarg.1').op('newobj', context.methods.get('Node..ctor')).op('dup').integer(level.value);
    writer.op('stfld', context.fields.get('Node.Value')).op('stind.ref');
    const count = specimen.initial + specimen.levels.slice(0, index + 1).reduce((sum, item) => sum + item.delta, 0);
    const fail = 'lostWrite' + index;
    writer.op('ldarg.0').op('ldind.i4').integer(count).op('bne.un', fail);
    writer.op('ldarg.1').op('ldind.ref').op('ldfld', context.fields.get('Node.Value')).integer(level.value).op('bne.un', fail);
    if (index + 1 < specimen.levels.length) {
      writer.op('ldarg.0').op('ldarg.1').op('call', context.methods.get('Program.Level' + (index + 1)));
    }
    // A read after the nested call catches both lost reference writes and premature Node reclamation.
    writer.op('ldarg.1').op('ldind.ref').op('ldfld', context.fields.get('Node.Value'));
    writer.integer(specimen.levels.at(-1).value).op('bne.un', fail).op('ret');
    writer.mark(fail).op('newobj', context.member('System.InvalidOperationException', '.ctor', 'void', [], false)).op('throw');
  }};
}

/** Ordinary CLI metadata with no source-image side channel or host-injected guest addresses. */
export function byrefStressAssembly(specimen) {
  const constructor = {name: '.ctor', static: false, body: writer => writer.op('ret')};
  const methods = [
    {name: 'Make', result: 'valuetype Cell&', locals: ['valuetype Cell'],
      body: (writer, context) => makeOwner(writer, context, specimen)},
    {name: 'Outer', result: 'valuetype Cell&', parameters: ['valuetype Cell&'], body(writer, context) {
      writer.op('ldarg.0');
      interior(writer, context, 'Count');
      writer.integer(specimen.initial).op('stind.i4').op('ldarg.0');
      interior(writer, context, 'Count');
      writer.op('ldarg.0');
      interior(writer, context, 'Reference');
      writer.op('call', context.methods.get('Program.Level0')).op('ldarg.0').op('ret');
    }},
    ...specimen.levels.map((level, index) => nestedMethod(specimen, level, index)),
    {name: 'Main', result: 'int', locals: ['valuetype Cell&'], body(writer, context) {
      writer.op('call', context.methods.get('Program.Make')).op('call', context.methods.get('Program.Outer')).op('stloc.0');
      writer.op('ldloc.0');
      interior(writer, context, 'Count');
      writer.op('dup').op('ldind.i4').integer(specimen.after).op('add').op('stind.i4');
      writer.op('ldloc.0');
      interior(writer, context, 'Count');
      writer.op('ldind.i4').op('ldloc.0');
      interior(writer, context, 'Reference');
      writer.op('ldind.ref').op('ldfld', context.fields.get('Node.Value')).op('add').op('dup');
      writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['int'])).op('ret');
    }}
  ];
  return genericCallFixture([
    {name: 'Node', fields: padded({name: 'Value', type: 'int'}, specimen.padding), methods: [constructor]},
    {name: 'Inner', base: 'System.ValueType', flags: 0x100109,
      fields: [{name: 'Count', type: 'int'}, {name: 'Reference', type: 'Node'}], methods: []},
    {name: 'Cell', base: 'System.ValueType', flags: 0x100109,
      fields: padded({name: 'Inner', type: 'valuetype Inner'}, specimen.padding), methods: []},
    {name: 'Holder', fields: padded({name: 'Cell', type: 'valuetype Cell'}, specimen.padding), methods: [constructor]},
    {name: 'Program', methods}
  ]);
}

/** C# exposes field/array ref returns; source bytecode has no unbox-address instruction. */
export function byrefStressSource(specimen) {
  if (specimen.kind === 'box') throw new RangeError('Box interior creation requires the direct CIL unbox instruction');
  const padding = Array.from({length: specimen.padding}, (_, index) => `public int Padding${index};`).join('\n');
  const make = specimen.kind === 'field'
    ? 'Holder owner = new Holder(); return ref owner.Cell;'
    : `Cell[] owner = new Cell[${specimen.length}]; return ref owner[${specimen.index}];`;
  const levels = specimen.levels.map((level, index) => `
    static void Level${index}(ref int count, ref Node reference) {
      count += ${level.delta};
      reference = new Node(); reference.Value = ${level.value};
      if (count != ${specimen.initial + specimen.levels.slice(0, index + 1).reduce((sum, item) => sum + item.delta, 0)} ||
          reference.Value != ${level.value}) throw new InvalidOperationException();
      ${index + 1 < specimen.levels.length ? `Level${index + 1}(ref count, ref reference);` : ''}
      if (reference.Value != ${specimen.levels.at(-1).value}) throw new InvalidOperationException();
    }`).join('\n');
  return `using System;
    class Node { ${padding} public int Value; }
    struct Inner { public int Count; public Node Reference; }
    struct Cell { ${padding} public Inner Inner; }
    class Holder { ${padding} public Cell Cell; }
    class Program {
      static ref Cell Make() { ${make} }
      static ref Cell Outer(ref Cell cell) {
        cell.Inner.Count = ${specimen.initial};
        Level0(ref cell.Inner.Count, ref cell.Inner.Reference);
        return ref cell;
      }
      ${levels}
      static void Main() {
        ref Cell cell = ref Outer(ref Make());
        cell.Inner.Count += ${specimen.after};
        Console.WriteLine(cell.Inner.Count + cell.Inner.Reference.Value);
      }
    }`;
}
