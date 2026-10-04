import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { isWriteAUse } from '../packages/compiler/src/flow/write-is-a-use.js';
import { TypeKind } from '../packages/compiler/src/symbols/types.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';

test('SF-A02-T34 corpus: the write-is-a-use fixtures match Roslyn', () => {
  const pinned = loadPinned(),
    ids = ['unused-local-writes/cs0219-constants-behind-conversions', 'language-version/gate-native-int-at-8', 'nullable/cs0037-cs0266-nullable-values'];
  for (const id of ids) {
    const fixture = loadFixtures().find(f => f.id === id);
    assert(fixture, id);
    const row = runFixture(fixture, pinned.results.get(id));
    assert.equal(row.passed, true, `${id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T34 the rule: what a write must store to count as a use of the local', () => {
  const int = { isReferenceType: false, specialType: 'System_Int32' },
    string = { isReferenceType: true, specialType: 'System_String' },
    object = { isReferenceType: true, specialType: 'System_Object' },
    pointer = { typeKind: TypeKind.Pointer },
    constant = { kind: 'Literal', constantValue: { value: 5 } },
    nullLiteral = { kind: 'Literal', literal: 'null' },
    call = { kind: 'Call' },
    conversion = (operand, extra = {}) => ({ kind: 'Conversion', operand, conversion: extra });
  assert.equal(isWriteAUse(int, null), true, 'nothing known about the value');
  assert.equal(isWriteAUse(int, { kind: 'Call', hasErrors: true }), true);
  const outOfRange = { kind: 'Conversion', hasErrors: true, conversion: { kind: 'ExplicitNumeric' }, operand: constant };
  assert.equal(isWriteAUse(int, outOfRange), false, '(byte)300 is CS0221 and still a constant');
  assert.equal(isWriteAUse(int, { ...outOfRange, conversion: { kind: 'InterpolatedStringHandler' } }), true, 'any other conversion in error');
  assert.equal(isWriteAUse(int, { ...outOfRange, operand: call }), true);
  assert.equal(isWriteAUse(int, constant), false);
  assert.equal(isWriteAUse(int, call), true);
  assert.equal(isWriteAUse(int, { kind: 'Default' }), false);
  assert.equal(isWriteAUse(int, conversion(constant)), false, 'a constant behind an implicit conversion');
  assert.equal(isWriteAUse(int, conversion(nullLiteral)), false, 'int? none = null');
  assert.equal(isWriteAUse(int, conversion(constant, { isUserDefined: true })), true, 'a user-defined conversion runs code');
  assert.equal(isWriteAUse(int, conversion(call)), true);
  assert.equal(isWriteAUse(string, constant), false, 'a string constant');
  assert.equal(isWriteAUse(object, conversion(constant)), true, 'a reference keeps its object alive');
  assert.equal(isWriteAUse(object, nullLiteral), false, 'unless it is null');
  assert.equal(isWriteAUse(pointer, constant), true);
  assert.equal(isWriteAUse(int, { kind: 'ObjectCreation', constructor: { isImplicitlyDeclared: true } }), false, 'new S() of a plain struct');
  assert.equal(isWriteAUse(int, { kind: 'ObjectCreation', constructor: { isImplicitlyDeclared: true }, initializers: [{}] }), true);
  assert.equal(isWriteAUse(int, { kind: 'ObjectCreation', constructor: { isImplicitlyDeclared: false } }), true);
});

test('SF-A02-T34 CS0219 for a local that is only written', () => {
  const unused = body => {
    const source = `struct Plain { public int X; }\nstatic class P {\n  static int F() => 1;\n  static void Main() {\n${body}\n  }\n}\n`;
    return compile(source)
      .diagnostics.filter(d => d.code === 'CS0219')
      .map(d => source.slice(d.start, d.start + d.length));
  };
  assert.deepEqual(unused('int? none = null;'), ['none']);
  assert.deepEqual(unused('long wide = 1;'), ['wide']);
  assert.deepEqual(unused('Plain p = new Plain();'), ['p']);
  assert.deepEqual(unused('int called = F();'), []);
  assert.deepEqual(unused('object boxed = 1;'), []);
  assert.deepEqual(unused('object nothing = null;'), ['nothing']);
  assert.deepEqual(unused('int a; a = 1; int b; b = F();'), ['a']);
});
