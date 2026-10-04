import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compile, Compilation } from '@sharpforge/compiler';
import { serializeImage } from '@sharpforge/bytecode';
import { types, contracts, findContracts, frameworkAssignable } from '@sharpforge/framework';
import { SourceText } from '@sharpforge/text';
import { parse } from '@sharpforge/syntax';
import { FrameworkMembers } from '../packages/compiler/src/binder/framework-members.js';
import { ErrorTypeSymbol } from '../packages/compiler/src/symbols/types.js';

const binderDirectory = fileURLToPath(new URL('../packages/compiler/src/binder/',import.meta.url));
const members = new FrameworkMembers();
const argumentOf = name => {
  if (name === 'null') return { literal: 'null', type: null };
  if (name === 'error') return { type: ErrorTypeSymbol.unknown };
  return { type: members.typeOf(name) };
};
const candidatesOf = contract =>
  contract.kind === 'constructor' ? members.constructors(contract.owner) : members.methods(contract.owner, contract.name, contract.isStatic);
const signature = contract => contract.parameters.join(',');

test('A02-T19 every registry contract is a symbol and is selected for a call with its own parameter types', () => {
  let selected = 0;
  for (const contract of contracts) {
    const candidates = candidatesOf(contract);
    assert(
      candidates.some(symbol => symbol.contract === contract),
      `${contract.owner}.${contract.name}(${signature(contract)}) is not reachable as a symbol`,
    );
    // A member redeclared by a derived type is found on the derived type first; overload resolution is asked with
    // the candidates of the declaring type, as a call on a receiver of exactly that type is.
    const result = members.resolve(candidates.filter(symbol => symbol.contract.owner === contract.owner), contract.parameters.map(argumentOf), {
      name: contract.name,
      isConstructor: contract.kind === 'constructor',
    });
    assert(result.succeeded, `${contract.owner}.${contract.name}(${signature(contract)}): ${result.error?.code}`);
    assert.equal(result.method.contract, contract, `${contract.owner}.${contract.name}(${signature(contract)})`);
    selected++;
  }
  assert.equal(selected, contracts.length);
  assert(selected > 1500);
});

test('A02-T19 symbol lookup yields the registry members of a type and its bases in the same order', () => {
  const names = new Set(contracts.map(contract => contract.name));
  let groups = 0;
  for (const owner of types.keys()) {
    for (const name of names) {
      for (const isStatic of [true, false]) {
        const expected = findContracts(owner, name, isStatic).filter(contract => contract.kind !== 'constructor' || contract.owner === owner);
        if (!expected.length) continue;
        const symbols = name === '.ctor' ? members.constructors(owner) : members.methods(owner, name, isStatic);
        assert.deepEqual(
          symbols.map(symbol => symbol.contract.id),
          expected.map(contract => contract.id),
          `${owner}.${name}`,
        );
        groups++;
      }
    }
  }
  assert(groups > 1500);
  assert.equal(members.type('string'), null, 'keywords are not registry receivers');
  assert.equal(members.methods('int[]', 'get_Item', false).length, 0);
});

/** The selection rule of the string-typed profile, kept here as the reference the resolver is compared with. */
function profileConversion(target, source) {
  if (target === source || (target === 'double' && source === 'int')) return true;
  if (source === 'null' && !['int', 'double', 'bool', 'void'].includes(target)) return true;
  // An array is a System.Array (Array.BinarySearch(Array, object, IComparer)): the string-typed rule compared names.
  if (target === 'System.Array' && source.endsWith('[]')) return true;
  return frameworkAssignable(target, source);
}
function profileChoice(candidates, argumentTypes, exactlyOne) {
  const applicable = candidates.filter(
    contract => contract.parameters.length === argumentTypes.length && contract.parameters.every((type, i) => profileConversion(type, argumentTypes[i])),
  );
  if (!applicable.length) return 'none';
  if (exactlyOne) return applicable.length === 1 ? applicable[0].id : 'ambiguous';
  const rank = contract => contract.parameters.reduce((count, type, i) => count + (type === argumentTypes[i] ? 0 : 1), 0);
  applicable.sort((a, b) => rank(a) - rank(b));
  return applicable.length > 1 && rank(applicable[0]) === rank(applicable[1]) ? 'ambiguous' : applicable[0].id;
}
function resolverChoice(symbols, argumentTypes, isConstructor) {
  const result = members.resolve(symbols, argumentTypes.map(argumentOf), { isConstructor });
  // The string-typed rule has no parameter arrays: a call only the expanded form accepts found nothing there.
  if (result.succeeded) return result.expanded ? 'none' : result.method.contract.id;
  return result.error.code === 'CS0121' ? 'ambiguous' : 'none';
}

test('A02-T19 the resolver agrees with the string-typed selection rule for every overload group', () => {
  const substitutes = ['int', 'double', 'bool', 'string', 'object', 'null', 'error', 'int[]', 'void'];
  const names = new Set(contracts.map(contract => contract.name));
  let compared = 0;
  for (const owner of types.keys()) {
    for (const name of names) {
      for (const isStatic of [true, false]) {
        const isConstructor = name === '.ctor';
        const group = findContracts(owner, name, isStatic).filter(contract => !isConstructor || contract.owner === owner);
        if (!group.length) continue;
        const symbols = isConstructor ? members.constructors(owner) : members.methods(owner, name, isStatic);
        const tuples = new Map();
        const add = tuple => tuples.set(tuple.join('|'), tuple);
        for (const contract of group) {
          add(contract.parameters);
          contract.parameters.forEach((parameter, i) => {
            for (const substitute of substitutes) add(contract.parameters.with(i, substitute));
            // 'System.String' is left out: the string-typed rule compared names, so it did not know it is `string`.
            for (const [derived, entry] of types) {
              if (entry.base === parameter && derived !== 'System.String') add(contract.parameters.with(i, derived));
            }
          });
          if (contract.parameters.length === 2) for (const first of substitutes) for (const second of substitutes) add([first, second]);
        }
        for (const tuple of tuples.values()) {
          assert.equal(
            String(resolverChoice(symbols, tuple, isConstructor)),
            String(profileChoice([...group], tuple, isConstructor)),
            `${owner}.${name}(${tuple.join(', ')})`,
          );
          compared++;
        }
      }
    }
  }
  assert(compared > 60000, `compared ${compared} calls`);
});

test('A02-T19 the binder has no import of the registry selection functions', () => {
  const sources = readdirSync(binderDirectory, { recursive: true }).filter(file => file.endsWith('.js'));
  assert(sources.length > 20);
  for (const file of sources) {
    const text = readFileSync(join(binderDirectory, file), 'utf8');
    assert(!/\bfindContracts\b|\bcontractForMember\b/.test(text), `${file} uses a registry selection function`);
  }
});

const program = `using System.Text;
using System.Collections.Generic;
var builder = new StringBuilder("a");
builder.Append(1);
builder.Append("b");
var list = new List<int>(4) { 1, 2 };
list.Add(3);
var grid = new Microsoft.UI.Xaml.Thickness(1);
Console.WriteLine(builder.ToString() + list.Count + list[0] + Math.Max(1, 2));
`;

test('A02-T19 the bound pipeline selects framework overloads through the resolver seam', () => {
  const compilation = new Compilation([parse(new SourceText(program, 'Program.cs'))], { pipeline: 'bound' });
  const events = [];
  compilation.semantic.framework.observer = event => events.push(event);
  const result = compilation.build();
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
  const chosen = events.filter(event => event.result.succeeded).map(event => {
    const contract = event.result.method.contract;
    return `${event.kind} ${contract.name}(${signature(contract)})`;
  });
  for (const expected of [
    'constructor .ctor(string)',
    'method Append(int)',
    'method Append(string)',
    'constructor .ctor(int)',
    'method Add(int)',
    'constructor .ctor(double)',
  ]) {
    assert(chosen.includes(expected), `${expected} was not resolved; saw ${[...new Set(chosen)].join('; ')}`);
  }
  for (const event of events) assert(event.candidates.every(symbol => symbol.kind === 'Method' && symbol.contract));
  // The legacy compiler does not go through the seam, and both produce the same image.
  const legacy = new Compilation([parse(new SourceText(program, 'Program.cs'))], { pipeline: 'legacy' });
  const legacyEvents = [];
  legacy.semantic.framework.observer = event => legacyEvents.push(event);
  const legacyResult = legacy.build();
  assert.equal(legacyEvents.length, 0);
  assert.equal(serializeImage(result.image), serializeImage(legacyResult.image));
});

const failing = [
  ['null argument between overloads', 'var b = new System.Text.StringBuilder(); b.Append(null);', 'CS0121'],
  ['no overload takes the argument', 'var b = new System.Text.StringBuilder(); b.Append(1, 2, 3);', 'CS1501'],
  ['argument type mismatch', 'var l = new System.Collections.Generic.List<int>(); l.Add("x");', 'CS1501'],
  ['no constructor', 'var b = new System.Text.StringBuilder(true);', 'CS1729'],
  ['collection initializer element', 'var l = new System.Collections.Generic.List<int> { "x" };', 'CS1921'],
  ['method group for a delegate', 'class P { static void M(string s) {} static void Main() { System.Action a = new System.Action(M); } }', 'CS0123'],
];

/** The diagnostics the binder of one pipeline reports, before the compilation reconciles them with other analyses. */
function binderDiagnostics(source, pipeline) {
  const compilation = new Compilation([parse(new SourceText(source, 'Program.cs'))], { pipeline });
  const reported = [];
  const report = compilation.report.bind(compilation);
  compilation.report = (node, code, args) => {
    reported.push([code, node?.start, JSON.stringify(args ?? [])].join('|'));
    return report(node, code, args);
  };
  compilation.build();
  return reported;
}

test('A02-T19 ambiguity and mismatch report the diagnostics of the string-typed profile', () => {
  for (const [name, source, code] of failing) {
    const bound = binderDiagnostics(source, 'bound'),
      legacy = binderDiagnostics(source, 'legacy');
    const withCode = list => list.filter(entry => entry.startsWith(code + '|'));
    assert(withCode(legacy).length > 0, `${name}: the legacy compiler reports ${code}`);
    assert.deepEqual(withCode(bound), withCode(legacy), name);
    assert.doesNotThrow(() => compile(source, { pipeline: 'verify' }), name);
  }
});
