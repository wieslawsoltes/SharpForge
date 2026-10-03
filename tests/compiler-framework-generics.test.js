import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { frameworkBridge } from '../packages/compiler/src/symbols/registry-bridge.js';
import { contractOfInstance } from '../packages/compiler/src/symbols/registry-open-members.js';
import { TypeKind, TypeWithAnnotations, typeOf } from '../packages/compiler/src/symbols/types.js';
import { linesOf, runOnBothBackEnds, notExecutable } from './support/semantic-codegen.js';
import { testPinnedFeature } from './support/pinned-feature.js';

// SF-A02-T02: framework generics over type parameters and user types. The pinned fixtures print on both back ends
// what the same programs print on .NET (Roslyn 5.3.0, .NET 10).
testPinnedFeature('SF-A02-T02', 'framework-generics', { outputs: 4, diagnostics: 2 });

const bridge = frameworkBridge();
const generic = 'System.Collections.Generic.';
const definitionOf = name => bridge.typeFromName(name).originalDefinition;
const signature = method => `${method.name}(${method.parameters.map(p => p.type.toDisplayString()).join(', ')}): ${method.returnType.toDisplayString()}`;
const methodsOf = (definition, name) => definition.getMembers(name).filter(member => member.kind === 'Method');

test('A02-T02 open members: the signatures of a registry generic are derived from its instantiations', () => {
  const list = definitionOf(generic + 'List`1<int>'),
    dictionary = definitionOf(generic + 'Dictionary`2<string, int>'),
    task = definitionOf('System.Threading.Tasks.Task`1<int>');
  assert.deepEqual(methodsOf(list, 'Insert').map(signature), ['Insert(int, T): void']);
  assert.deepEqual(methodsOf(list, 'ToArray').map(signature), ['ToArray(): T[]']);
  assert.deepEqual(methodsOf(list, 'IndexOf').map(signature), ['IndexOf(T): int']);
  assert.deepEqual(methodsOf(list, 'GetEnumerator').map(signature), ['GetEnumerator(): SharpForge.Runtime.Enumerator<T>']);
  assert.deepEqual(methodsOf(list, '.ctor').map(signature).sort(), ['.ctor(): void', '.ctor(T[]): void', '.ctor(int): void']);
  assert.deepEqual(methodsOf(dictionary, 'Add').map(signature), ['Add(T1, T2): void']);
  assert.equal(dictionary.getMembers('Keys')[0].type.toDisplayString(), 'T1[]');
  assert.equal(dictionary.getMembers('Values')[0].type.toDisplayString(), 'T2[]');
  assert.equal(task.getMembers('Result')[0].type, task.typeParameters[0]);
  assert.equal(task.getMembers('IsCompleted')[0].type.specialType, 'System_Boolean');
  const indexer = list.getMembers('this[]')[0];
  assert.equal(indexer.type, list.typeParameters[0]);
  assert.ok(indexer.getMethod && indexer.setMethod);
  // A construction outside the registry sees the members with its own arguments; none of them is a contract.
  const ofLong = list.construct(bridge.typeFromName('long'));
  assert.deepEqual(methodsOf(ofLong, 'Insert').map(signature), ['Insert(int, long): void']);
  assert.ok(ofLong.getMembers().every(member => !member.contract));
  // A registry instantiation keeps its own members: the contracts.
  assert.ok(methodsOf(bridge.typeFromName(generic + 'List`1<int>'), 'Insert')[0].contract);
});

test('A02-T02 open members: every open member stands for a contract with that signature in every instantiation', () => {
  let checked = 0;
  for (const definition of new Set(bridge.allTypes().map(type => type.originalDefinition))) {
    if (!definition.instances?.length) continue;
    const open = definition.getMembers().filter(member => member.kind === 'Method' && member.openContract);
    if (definition.typeKind === TypeKind.Delegate) assert.equal(open.length, 0, 'delegates keep the members of the core library');
    for (const instance of definition.instances) {
      for (const member of open) {
        const target = contractOfInstance(bridge, member, instance);
        if (!target) continue;
        const closed = member.asMemberOf(definition.construct(instance.typeArguments.map(argument => new TypeWithAnnotations(typeOf(argument)))));
        const label = `${instance.registryName}.${member.name}`;
        assert.equal(target.name, member.name, label);
        assert.equal(target.parameters.length, closed.parameters.length, label);
        closed.parameters.forEach((parameter, i) => assert.ok(parameter.type.equals(target.parameters[i].type), `${label} parameter ${i}`));
        if (member.name !== '.ctor') assert.ok(closed.returnType.equals(target.returnType), `${label} result`);
        checked++;
      }
    }
  }
  assert.ok(checked > 400, `expected the collection and task contracts to be covered, checked ${checked}`);
});

const program = (declarations, body) =>
  `using System;\nusing System.Collections.Generic;\n${declarations}\nclass Program { static void Main() { ${body} } }\n`;
const animal = 'class Animal { public string Name; public Animal(string name) { Name = name; } }';

test('A02-T02 a construction over a user class shares the registry instantiation over object', () => {
  const source = program(
    `${animal}
     class Bag<T> { public List<T> Items = new List<T>(); public T First() { return Items[0]; } }`,
    `var animals = new Bag<Animal>(); animals.Items.Add(new Animal("cat"));
     var numbers = new Bag<int>(); numbers.Items.Add(7);
     var words = new Bag<string>(); words.Items.Add("w");
     Console.WriteLine(animals.First().Name + numbers.First() + words.First());`,
  );
  const { image, output } = runOnBothBackEnds(source);
  assert.equal(output, 'cat7w\n');
  const fieldType = name => image.types.find(type => type.name === name).fields.find(field => field.name === 'Items').type;
  assert.equal(fieldType('Bag{Animal}'), generic + 'List`1<object>');
  assert.equal(fieldType('Bag{int}'), generic + 'List`1<int>');
  assert.equal(fieldType('Bag{string}'), generic + 'List`1<string>');
});

test('A02-T02 a captured framework generic lives in a cell whose class name has no type-name characters', () => {
  const source = program(
    '',
    'var kept = new List<string>(); Action<string> keep = text => { kept.Add(text); }; keep("a"); keep("b"); Console.WriteLine(kept.Count);',
  );
  const { image, output } = runOnBothBackEnds(source);
  assert.equal(output, '2\n');
  const cell = image.types.find(type => type.name.startsWith('<>Cell('));
  assert.equal(cell.name, '<>Cell(System.Collections.Generic.List{string})');
});

test('A02-T02 what the registry cannot run is refused with the missing contract named', () => {
  const cases = [
    [
      'var list = new List<long>(); Console.WriteLine(list.Count);',
      /List<long>' \(the framework registry has no 'System\.Collections\.Generic\.List<long>' contracts\)/,
    ],
    ['var list = new List<char>(); Console.WriteLine(list.Count);', /no 'System\.Collections\.Generic\.List<char>' contracts/],
    [
      'var map = new Dictionary<Animal, int>(); Console.WriteLine(map.Count);',
      /Dictionary<Animal, int>' \(the framework registry has no 'System\.Collections\.Generic\.Dictionary<object, int>' contracts\)/,
    ],
    ['var list = new List<Op>(); Console.WriteLine(list.Count);', /no 'System\.Collections\.Generic\.List<Op>' contracts/],
    [
      'var list = new List<Animal>(); Animal[] all = list.ToArray(); Console.WriteLine(all.Length);',
      /List<Animal>\.ToArray' \(the framework registry has no contract that returns an array/,
    ],
    [
      'var map = new Dictionary<string, Animal>(); Console.WriteLine(map.Values.Length);',
      /get_Values' \(the framework registry has no contract that returns an array/,
    ],
    ['var list = new List<Animal>(); list.Sort();', /List<Animal>\.Sort' \(the framework registry has no comparer contract/],
    ['var list = new List<Animal>(); Console.WriteLine(list.ToString());', /'object\.ToString\(\)' on a constructed generic type/],
    ['var list = new List<Animal>(); object o = list; Console.WriteLine(o != null);', /converting a constructed generic type to 'object'/],
  ];
  for (const [body, expected] of cases) {
    assert.match(notExecutable(program(`${animal}\ndelegate int Op(int x);`, body)).message, expected, body);
  }
  // Inside a generic body the refusal depends on the construction: the same class runs for T = int.
  const bag = 'class Bag<T> { public List<T> Items = new List<T>(); public T[] All() { return Items.ToArray(); } }';
  assert.deepEqual(linesOf(program(bag, 'var b = new Bag<int>(); b.Items.Add(1); Console.WriteLine(b.All().Length);')), ['1']);
  assert.match(
    notExecutable(program(`${animal}\n${bag}`, 'var b = new Bag<Animal>(); Console.WriteLine(b.All().Length);')).message,
    /List<Animal>\.ToArray'/,
  );
});

test('A02-T02 a class that defines its own equality is not shared with the construction over object', () => {
  const source = program(
    'class Key { public int Id; public bool Equals(Key other) { return other.Id == Id; } }',
    'var set = new HashSet<Key>(); Console.WriteLine(set.Count);',
  );
  assert.match(notExecutable(source).message, /no 'System\.Collections\.Generic\.HashSet<Key>' contracts/);
});

test('A02-T02 members of a construction are checked against the open signature', () => {
  const codes = body =>
    compile(program(animal, body))
      .diagnostics.filter(d => d.severity === 'error' && /^CS/.test(d.code))
      .map(d => d.code);
  assert.deepEqual(codes('var list = new List<Animal>(); string text = list[0];'), ['CS0029']);
  assert.deepEqual(codes('var list = new List<Animal>(); list.Count = 1;'), ['CS0200']);
  assert.deepEqual(codes('var map = new Dictionary<string, Animal>(); int n = map["k"].Name;'), ['CS0029']);
});
