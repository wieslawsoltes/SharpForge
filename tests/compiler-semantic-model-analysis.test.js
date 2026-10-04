import test from 'node:test';
import assert from 'node:assert/strict';
import { walk } from '@sharpforge/syntax';
import { SemanticModel } from '@sharpforge/compiler';
import { SymbolKind } from '../packages/compiler/src/symbols/types.js';
import { programs } from '../packages/compiler/test/semantic-model/programs.js';
import { loadPinned, programHash } from '../packages/compiler/test/semantic-model/store.js';
import { compareProgram } from '../packages/compiler/test/semantic-model/compare.js';

const pinned = loadPinned();
const textOf = (program, row) => program.source.slice(row.start, row.end);
const summary = (program, rows) => rows.map(row => `${row.question} ${row.syntaxKind} ${JSON.stringify(textOf(program, row))}`).sort();

/**
 * What the model does not say as Roslyn does, per pinned program: the whole list, so a regression and an improvement
 * both show. `different` are answers that are not Roslyn's (none today); `none` are questions without an answer.
 */
const known = {
  'classes-and-statements': { different: [], none: [] },
  'structs-interfaces-enums': {
    different: [],
    none: [
      // Roslyn gives the `nameof` identifier and an omitted array size an error type; the model gives them none.
      'convertedType IdentifierName "nameof"',
      'type IdentifierName "nameof"',
      'convertedType OmittedArraySizeExpression ""',
      'type OmittedArraySizeExpression ""',
    ],
  },
  'generics-lambdas-patterns': { different: [], none: [] },
  'inheritance-and-statics': {
    different: [],
    none: [
      // The framework registry has no System.Array.Length property symbol; the access is bound without one.
      'symbol IdentifierName "Length"',
      'symbol SimpleMemberAccessExpression "animals.Length"',
      // The assignment inside an object initializer is bound as an initializer entry, not as an expression.
      'convertedType SimpleAssignmentExpression "Id = 7"',
      'type SimpleAssignmentExpression "Id = 7"',
    ],
  },
};

test('SF-A02-T38 pins: every program has a current Roslyn pin', () => {
  assert.match(String(pinned.roslyn.version), /^\d+\.\d+/);
  assert.ok(programs.length >= 4);
  for (const program of programs) {
    const pin = pinned.programs[program.id];
    assert.ok(pin, `${program.id}: not pinned; run node packages/compiler/test/semantic-model/tools/pin.mjs`);
    assert.equal(pin.hash, programHash(program), `${program.id}: program changed since it was pinned`);
    assert.ok(pin.expressions.length > 100 && pin.declarations.length > 10, program.id);
  }
});

for (const program of programs) {
  test(`SF-A02-T38 Roslyn agreement: symbols, types, converted types, constants and declarations of ${program.id}`, () => {
    const result = compareProgram(program, pinned.programs[program.id]),
      expected = known[program.id];
    assert.deepEqual([...new Set(summary(program, result.different))], [...expected.different].sort(), 'answers that differ from Roslyn');
    assert.deepEqual([...new Set(summary(program, result.none))], [...expected.none].sort(), 'questions without an answer');
    assert.equal(result.same + result.none.length + result.different.length, result.asked);
    assert.ok(result.same / result.asked > 0.97, `${result.same} of ${result.asked} answers are Roslyn's`);
  });
}

test('SF-A02-T38 Roslyn agreement in total: more than 1400 answers, none differs, 8 are unanswered', () => {
  const total = { asked: 0, same: 0, none: 0, different: 0 };
  for (const program of programs) {
    const result = compareProgram(program, pinned.programs[program.id]);
    total.asked += result.asked;
    total.same += result.same;
    total.none += result.none.length;
    total.different += result.different.length;
  }
  assert.ok(total.same > 1400, JSON.stringify(total));
  assert.equal(total.different, 0);
  assert.equal(total.none, 8);
  assert.ok(total.none / total.asked < 0.01, JSON.stringify(total));
});

const structProgram = `using System;
struct S
{
    public int X;
    public S(int x) { X = x; }
    public int Twice() { return X * 2; }
}
interface IValue { int Value { get; } }
class Holder : IValue
{
    public int Value { get { return 7; } }
}
class Program
{
    static int Sum(int a, int b)
    {
        int total = a;
        total += b;
        if (total > 100) return 100;
        long wide = total;
        return (int)wide;
    }
    static void Main()
    {
        S s = new S(3);
        int doubled = s.Twice() + s.X;
        IValue value = new Holder();
        object boxed = doubled;
        Console.WriteLine(boxed);
        Console.WriteLine(value.Value + Sum(1, 2));
    }
}
`;

function modelOf(source, options) {
  const created = SemanticModel.create([{ uri: 'Program.cs', text: source }], options),
    nodes = [];
  walk(created.compilation.inputFiles[0].root, node => nodes.push(node));
  const find = (kind, snippet, index = 0) => {
    const hits = nodes.filter(node => node.kind === kind && source.slice(node.start, node.end) === snippet);
    assert.ok(hits.length > index, `no ${kind} node '${snippet}'`);
    return hits[index];
  };
  /** The span of `text` inside the first occurrence of `context`. */
  const span = (context, text = context) => {
    const start = source.indexOf(context) + context.indexOf(text);
    assert.ok(source.includes(context) && context.includes(text), context);
    return { start, end: start + text.length };
  };
  return { ...created, nodes, find, span, at: snippet => source.indexOf(snippet) };
}

test('SF-A02-T38 a program outside the execution profile is answered from the semantic analysis', () => {
  const { model, result, find, span } = modelOf(structProgram);
  // Valid C# that the runtime cannot execute (structs): no C# diagnostic, and the model still answers.
  assert.deepEqual(result.diagnostics.filter(d => /^CS/.test(d.code)), []);
  assert.equal(model.isSemantic, true);
  // The two queries the issue names: a struct creation and a struct field were a null symbol and an error type.
  const creation = find('New', 'new S(3)'),
    field = find('Member', 's.X');
  assert.equal(model.getSymbolInfo(creation).symbol.toDisplayString(), 'S.S(int)');
  assert.equal(model.getTypeInfo(creation).type.toDisplayString(), 'S');
  assert.equal(model.getSymbolInfo(field).symbol.toDisplayString(), 'S.X');
  assert.equal(model.getSymbolInfo(field).candidateReason, 'none');
  assert.equal(model.getTypeInfo(field).type.toDisplayString(), 'int');
  assert.equal(model.getSymbolInfo(find('Call', 's.Twice()')).symbol.toDisplayString(), 'S.Twice()');
  assert.equal(model.getSymbolInfo(find('Member', 'value.Value')).symbol.toDisplayString(), 'IValue.Value');
  assert.equal(model.getTypeInfo(span('value.Value + Sum', 'value')).type.toDisplayString(), 'IValue');
  // Declarations of the kinds the execution binder does not have.
  const declaration = (from, to) => ({ start: structProgram.indexOf(from), end: structProgram.indexOf(to) });
  const struct = model.getDeclaredSymbol(declaration('struct S', '\ninterface'));
  assert.equal(struct.kind, SymbolKind.NamedType);
  assert.equal(struct.typeKind, 'struct');
  assert.equal(model.getDeclaredSymbol(declaration('interface IValue', '\nclass Holder')).toDisplayString(), 'IValue');
  assert.equal(model.getDeclaredSymbol(span('S s = new S(3)', 's = new S(3)')).name, 's');
  assert.equal(model.getDeclaredSymbol(span('int a, int b', 'int b')).kind, SymbolKind.Parameter);
  assert.equal(model.getDeclaredSymbol(span('s.Twice()')), null, 'an expression declares nothing');
  assert.equal(model.getDeclaredSymbol(null), null);
  assert.equal(model.getFlowAnalysis(0, 'Program.cs'), null, 'the flow graph of the execution binder does not exist for this program');
});

test('SF-A02-T38 conversions, constants and diagnostics', () => {
  const { model, find, span } = modelOf(structProgram);
  const total = span('long wide = total', 'total');
  assert.equal(model.getTypeInfo(total).type.toDisplayString(), 'int');
  assert.equal(model.getTypeInfo(total).convertedType.toDisplayString(), 'long', '`long wide = total` converts the int');
  assert.equal(model.getConversion(total).kind, 'ImplicitNumeric');
  assert.equal(model.getConversion(span('object boxed = doubled', 'doubled')).kind, 'Boxing');
  assert.equal(model.getConversion(span('return 100', '100')).kind, 'Identity');
  assert.deepEqual(model.getConstantValue(find('Literal', '100')), { hasValue: true, value: 100 });
  assert.deepEqual(model.getConstantValue(span('total > 100', 'total')), { hasValue: false, value: undefined });
  assert.deepEqual(model.getDiagnostics(), []);
  // Negative: a program with errors is still answered, and its diagnostics are found by span.
  const broken = modelOf(structProgram.replace('int doubled = s.Twice() + s.X;', 'int doubled = s.Twice() + s.Missing;'));
  assert.equal(broken.result.success, false);
  assert.equal(broken.model.isSemantic, true);
  const at = broken.at('s.Missing');
  assert.deepEqual(broken.model.getDiagnostics({ start: at, end: at + 9 }).map(d => d.code), ['CS1061']);
  assert.deepEqual(broken.model.getDiagnostics({ start: 0, end: 10 }), []);
  assert.equal(broken.model.getSymbolInfo(broken.find('Call', 's.Twice()')).symbol.toDisplayString(), 'S.Twice()');
  assert.equal(broken.model.getSymbolInfo({ start: at, end: at + 9 }).candidateReason, 'notFound');
});

test('SF-A02-T38 lookupSymbols and speculative binding over the semantic analysis', () => {
  const { model, at } = modelOf(structProgram),
    inSum = at('long wide'),
    names = (position, options) => model.lookupSymbols(position, options).map(symbol => symbol.name);
  const visible = names(inSum);
  for (const name of ['total', 'a', 'b', 'Sum', 'Main', 'S', 'IValue', 'Holder', 'Program', 'System']) assert.ok(visible.includes(name), name);
  assert.ok(!visible.includes('wide'), 'a local is not visible before its declaration');
  assert.ok(!visible.includes('doubled'), 'a local of another method is not visible');
  assert.deepEqual(names(inSum, { name: 'total' }), ['total']);
  assert.deepEqual(names(inSum, { name: 'this' }), [], 'no this in a static method');
  assert.deepEqual(model.lookupSymbols(at('return X * 2'), { name: 'this' }).map(symbol => symbol.toDisplayString()), ['S']);
  assert.ok(names(inSum, { namespacesAndTypesOnly: true }).every(name => !['total', 'a', 'Sum'].includes(name)));
  const before = model.getDiagnostics().length,
    sum = model.bindSpeculativeExpression(inSum, 'total + a * 2');
  assert.equal(sum.type.toDisplayString(), 'int');
  assert.deepEqual(sum.diagnostics, []);
  assert.equal(model.bindSpeculativeExpression(at('IValue value'), 's.Twice()').symbol.toDisplayString(), 'S.Twice()');
  assert.deepEqual(model.bindSpeculativeExpression(inSum, '2 * 21').constantValue, { hasValue: true, value: 42 });
  assert.equal(model.getSpeculativeTypeInfo(inSum, 'total > 1').type.toDisplayString(), 'bool');
  assert.deepEqual(model.bindSpeculativeExpression(inSum, 'wide + missing').diagnostics.map(d => d.code), ['CS0103', 'CS0103']);
  assert.equal(model.bindSpeculativeExpression(at('struct S'), '1').bound, null, 'no body at that position');
  assert.equal(model.getDiagnostics().length, before, 'speculative binding reports nothing into the model');
});

test('SF-A02-T38 data flow and control flow of a region', () => {
  const { model, at } = modelOf(structProgram),
    start = at('total += b'),
    end = at('return (int)wide');
  const names = symbols => symbols.map(symbol => symbol.name).sort(),
    flow = model.analyzeDataFlow(start, end);
  assert.deepEqual(names(flow.variablesDeclared), ['wide']);
  assert.deepEqual(names(flow.readInside), ['b', 'total']);
  assert.deepEqual(names(flow.writtenInside), ['total', 'wide']);
  assert.deepEqual(names(flow.dataFlowsIn), ['b', 'total']);
  assert.deepEqual(names(flow.dataFlowsOut), ['wide']);
  assert.deepEqual(names(flow.writtenOutside), ['a', 'b', 'total']);
  const control = model.analyzeControlFlow(start, end);
  assert.equal(control.statements.length, 3);
  assert.equal(control.returnStatements.length, 1);
  assert.equal(control.endPointIsReachable, true);
  assert.equal(model.analyzeControlFlow(at('return (int)wide'), at('return (int)wide') + 17).endPointIsReachable, false);
  assert.equal(model.analyzeDataFlow(at('struct S'), at('struct S') + 5), null, 'outside a body');
});

test('SF-A02-T38 the same queries on a program of the execution profile: both models answer alike', () => {
  const source = `using System;
class Cart
{
    public int Count;
    public string Owner { get; set; }
    public Cart(string owner) { Owner = owner; }
    public int Add(int amount)
    {
        const int Limit = 10;
        int next = Count + amount;
        if (next > Limit) { return Count; }
        Count = next;
        return Count;
    }
}
class Program
{
    static void Main()
    {
        var cart = new Cart("ann");
        int total = cart.Add(3) + cart.Count;
        Console.WriteLine(total);
    }
}
`;
  const execution = modelOf(source),
    semantic = modelOf(source, { semantic: true });
  assert.equal(execution.result.success, true);
  assert.equal(execution.model.isSemantic, false, 'the execution binder answers a program it compiled');
  assert.equal(semantic.model.isSemantic, true);
  const answers = (model, node) => {
    const symbol = model.getSymbolInfo(node).symbol,
      constant = model.getConstantValue(node);
    return [symbol?.toDisplayString() ?? null, model.getTypeInfo(node).type?.toDisplayString() ?? null, constant.hasValue ? constant.value : null];
  };
  let compared = 0;
  for (const kind of ['Name', 'Member', 'Call', 'New', 'Binary', 'Literal']) {
    execution.nodes.forEach((node, index) => {
      if (node.kind !== kind) return;
      assert.deepEqual(answers(semantic.model, semantic.nodes[index]), answers(execution.model, node), `${kind} '${source.slice(node.start, node.end)}'`);
      compared++;
    });
  }
  assert.ok(compared > 25, String(compared));
  for (const kind of ['Class', 'Method', 'Field', 'Property', 'Parameter', 'Variable']) {
    execution.nodes.forEach((node, index) => {
      if (node.kind !== kind) return;
      const expected = execution.model.getDeclaredSymbol(node),
        actual = semantic.model.getDeclaredSymbol(semantic.nodes[index]);
      assert.equal(actual?.kind, expected?.kind, `${kind} '${source.slice(node.start, node.end).slice(0, 30)}'`);
      assert.equal(actual?.name, expected?.name);
    });
  }
});
