import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {BuiltinMap, FORMAT_VERSION, Op, decimalIntrinsicDefinitions, numericMode} from '@sharpforge/bytecode';
import {enumTypes} from '@sharpforge/framework';
import {emitAssemblyDetailed, loadAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {decodeDecimalBuiltin} from '../packages/cil/src/builtin-emission.js';

const enumType = 'System.MidpointRounding';
const modes = ['ToEven', 'AwayFromZero', 'ToZero', 'ToNegativeInfinity', 'ToPositiveInfinity'];
const modeNames = ['decimal.Round#2:MidpointRounding', 'decimal.Round#3:MidpointRounding'];

function artifact(body, members = '') {
  const compiled = compileToIL(`using System; using D = System.Decimal; using Mode = System.MidpointRounding;
    class P { static void Main() { ${body} } ${members} }`);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  return compiled;
}

function engines(compiled) {
  return [
    ['source', () => new VirtualMachine(compiled.image)],
    ['reload', () => new VirtualMachine(loadAssembly(compiled.assembly))],
    ['CIL', () => new CilVirtualMachine(compiled.assembly)]
  ];
}

function assertOutput(compiled, expected) {
  for (const [engine, create] of engines(compiled)) {
    const result = create().run();
    assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
    assert.equal(result.output, expected, engine);
  }
}

test('Round mode entries append exact descriptors after extrema without retyping released wire IDs', () => {
  const first = BuiltinMap.get('Math.Max#2:Decimal').id + 1;
  for (const [index, wireName] of modeNames.entries()) {
    const entry = BuiltinMap.get(wireName);
    assert.equal(entry.id, first + index);
    assert.equal(entry.decimal.owner, 'System.Decimal');
    assert.equal(entry.decimal.name, 'Round');
    assert(decimalIntrinsicDefinitions.includes(entry.decimal));
    assert.deepEqual(entry.params, index === 0 ? ['decimal', enumType] : ['decimal', 'int', enumType]);
    assert.deepEqual(entry.parameterNames, index === 0 ? ['d', 'mode'] : ['d', 'decimals', 'mode']);
    assert.equal(entry.result, 'decimal');
    assert(Object.isFrozen(entry));
  }
  assert.deepEqual(BuiltinMap.get('decimal.Round#2').params, ['decimal', 'int']);
  assert.equal(BuiltinMap.get('decimal.Round#2').id, BuiltinMap.get('decimal.Round#1').id + 1);
});

const integerResults = [
  [2, -2, 4, -4, 2, -2, 3, -3], [3, -3, 4, -4, 2, -2, 3, -3],
  [2, -2, 3, -3, 2, -2, 2, -2], [2, -3, 3, -4, 2, -3, 2, -3], [3, -2, 4, -3, 3, -2, 3, -2]
];
const fractionalResults = [
  ['1.24', '-1.24', '1.26', '-1.26'], ['1.25', '-1.25', '1.26', '-1.26'],
  ['1.24', '-1.24', '1.25', '-1.25'], ['1.24', '-1.25', '1.25', '-1.26'],
  ['1.25', '-1.24', '1.26', '-1.25']
];

for (const [index, mode] of modes.entries()) {
  test(`Round ${mode} preserves midpoint, non-midpoint and sign behavior in all engines`, () => {
    const integral = ['2.5', '-2.5', '3.5', '-3.5', '2.4', '-2.4', '2.6', '-2.6'];
    const fractional = ['1.245', '-1.245', '1.255', '-1.255'];
    const body = integral.map(value => `Console.WriteLine(D.Round(${value}m, Mode.${mode}));`).join('\n') +
      fractional.map(value => `Console.WriteLine(D.Round(${value}m, 2, Mode.${mode}));`).join('\n');
    assertOutput(artifact(body), [...integerResults[index], ...fractionalResults[index]].join('\n') + '\n');
  });
}

test('digit boundaries, full Decimal range and unchanged scale reuse existing Round storage', () => {
  assertOutput(artifact(`decimal[] values = new decimal[] {
    D.Round(decimal.MaxValue, 0, Mode.ToPositiveInfinity), D.Round(decimal.MinValue, 28, Mode.ToNegativeInfinity),
    D.Round(1.2300m, 28, Mode.ToZero), D.Round(0.0000000000000000000000000001m, 28, Mode.AwayFromZero),
    D.Round(0.0000000000000000000000000001m, 27, Mode.ToPositiveInfinity),
    D.Round(-0.0000000000000000000000000001m, 27, Mode.ToNegativeInfinity)
  }; foreach (decimal value in values) Console.WriteLine(value);
  object boxed = values[2]; Console.WriteLine(boxed.GetType().FullName); Console.WriteLine(boxed);`),
  '79228162514264337593543950335\n-79228162514264337593543950335\n1.2300\n' +
  '0.0000000000000000000000000001\n0.000000000000000000000000001\n' +
  '-0.000000000000000000000000001\nSystem.Decimal\n1.2300\n');
});

test('all modes preserve encoded negative zero while reducing its scale', () => {
  const body = modes.map(mode => `{
    decimal rounded = D.Round(decimal.Parse("-0.0000"), 2, Mode.${mode});
    int[] bits = D.GetBits(rounded); Console.WriteLine(bits[0]); Console.WriteLine(bits[3]);
  }`).join('\n');
  assertOutput(artifact(body), '0\n-2147352576\n'.repeat(modes.length));
});

test('real mode/d/decimals parameter names preserve textual argument evaluation order', () => {
  assertOutput(artifact(`Console.WriteLine(D.Round(mode: ReadMode(), d: Value(), decimals: Digits()));
    Console.WriteLine(System.Decimal.Round(mode: ReadMode(), d: Value()));`, `
    static Mode ReadMode() { Console.Write("M"); return Mode.AwayFromZero; }
    static decimal Value() { Console.Write("V"); return 1.245m; }
    static int Digits() { Console.Write("D"); return 2; }`), 'MVD1.25\nMV1\n');
});

for (const mode of [-2147483648, -1, 5, 2147483647]) {
  test(`invalid mode ${mode} faults even when no scale reduction is needed`, () => {
    for (const expression of [`D.Round(1m, (Mode)${mode})`, `D.Round(1m, 28, (Mode)${mode})`]) {
      for (const [engine, create] of engines(artifact(`Console.WriteLine(${expression});`))) {
        const result = create().run();
        assert.equal(result.state, 'faulted', engine);
        assert.equal(result.fault.name, 'ArgumentException', engine);
      }
    }
  });
}

for (const digits of [-1, 29]) {
  test(`digits ${digits} reject before an invalid mode, matching the existing Decimal contract`, () => {
    for (const [engine, create] of engines(artifact(`Console.WriteLine(D.Round(1m, ${digits}, (Mode)99));`))) {
      const result = create().run();
      assert.equal(result.state, 'faulted', engine);
      assert.equal(result.fault.name, 'ArgumentOutOfRangeException', engine);
    }
  });
}

function wireImage(entry) {
  const code = [Op.CONST, 0, numericMode('decimal')];
  for (const type of entry.params.slice(1)) {
    code.push(...(type === 'int' ? [Op.CONST, 1, 0] : [Op.ENUM, enumTypes.indexOf(enumType), 1]));
  }
  code.push(Op.BUILTIN, entry.id, entry.params.length, Op.BUILTIN, BuiltinMap.get('Console.WriteLine').id, 1, Op.RET, 0, 0);
  return {formatVersion: FORMAT_VERSION, entryPoint: 0, constants: [{scalar: 'decimal', value: [125, 0, 0, 131072]}, 1],
    sources: [], types: [], statics: [], sequencePoints: [], methods: [{id: 0, owner: null, name: 'Main', qualifiedName: 'P.Main',
      isStatic: true, parameters: [], returnType: 'void', locals: [], handlers: [], code: Int32Array.from(code)}]};
}

test('released and mode wire calls retain distinct IDs through canonical emission/reload', () => {
  const entries = ['decimal.Round#1', 'decimal.Round#2', ...modeNames].map(name => BuiltinMap.get(name));
  const expected = ['1\n', '1.2\n', '1\n', '1.3\n'];
  for (const [index, entry] of entries.entries()) {
    const image = wireImage(entry), assembly = emitAssemblyDetailed(image).bytes;
    const loaded = loadAssembly(assembly);
    assert.deepEqual([...loaded.methods[0].code], [...image.methods[0].code]);
    assertOutput({image, assembly}, expected[index]);
  }
  // The implicit enum conversion from integer constant zero is valid C#; nonzero requires a cast.
  assertOutput(artifact('Console.WriteLine(D.Round(1.25m, 1, 0)); Console.WriteLine(D.Round(1.25m, 0));'), '1.2\n1\n');
});

test('decoder requires the exact mode signature and source rejects incompatible or internal names', () => {
  for (const name of modeNames) {
    const entry = BuiltinMap.get(name), descriptor = entry.decimal;
    const target = {owner: descriptor.owner, name: descriptor.name, sig: {kind: 'method', isStatic: true,
      returnType: descriptor.returnType, parameters: descriptor.parameters}};
    assert.equal(decodeDecimalBuiltin(target), entry);
    for (const owner of ['System.Math', 'Other.Decimal']) assert.equal(decodeDecimalBuiltin({...target, owner}), null);
    for (const replacement of [{isStatic: false}, {returnType: 'double'}, {genericArity: 1}, {callingConvention: 5},
      {parameters: descriptor.parameters.map(type => type === enumType ? type + '&' : type)}]) {
      assert.equal(decodeDecimalBuiltin({...target, sig: {...target.sig, ...replacement}}), null);
    }
  }
  for (const expression of ['D.Round(1.25m, 1, 1)', 'D.Round(1.25, Mode.ToEven)',
    'D.Round(value: 1m, mode: Mode.ToEven)', 'D.Round(d: 1m, mode: Mode.ToEven, digits: 1)',
    'D.RoundMidpointRounding(1m, Mode.ToEven)', 'D.Round(1m, 1, Mode.ToEven, 1)']) {
    const compiled = compileToIL(`using System; using D = System.Decimal; using Mode = System.MidpointRounding;
      class P { static void Main() { Console.WriteLine(${expression}); } }`);
    assert.equal(compiled.success, false, expression);
  }
});
