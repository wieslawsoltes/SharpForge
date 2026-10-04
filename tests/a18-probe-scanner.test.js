import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {
  CancellationToken, OperationCanceledError, Scanner, keywords, legacyContextual,
  lex, reservedKeywordKinds, scanNumber
} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';
import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {probeDesignSource} from '@sharpforge/designer';
import {compareTokenValue} from './support/syntax-reference.js';

const tokens = text => lex(new SourceText(text, 'Numbers.cs'), undefined, {profile: false}).tokens;

test('plain decimal integers retain exact public records, offsets, leading zeroes and independent mutable results', () => {
  for (const spelling of ['0', '7', '42', '1991', '1000000000', '2147483647', '0000000007', '0'.repeat(10000) + '7']) {
    const value = Number(spelling);
    const result = scanNumber('/*prefix*/' + spelling + ';', 10);
    assert.deepEqual(result, {
      end: 10 + spelling.length, kind: 'integer', value, literal: {type: 'int', value},
      suffix: '', errors: [], features: [], profile: []
    }, spelling.slice(0, 20));
    assert.equal(scanNumber(spelling, 0).end, spelling.length, 'EOF retains the complete integer');
    const token = tokens(spelling)[0];
    assert.equal(token.text, spelling);
    assert.deepEqual(token.literal, {type: 'int', value, number: value});
    assert.equal(Object.isFrozen(token.literal), true);
  }
  const first = scanNumber('42;', 0);
  first.literal.value = -1;
  first.errors.push({code: 'caller'});
  first.features.push('caller');
  first.profile.push({code: 'caller'});
  const next = scanNumber('42;', 0);
  assert.deepEqual([next.literal, next.errors, next.features, next.profile], [{type: 'int', value: 42}, [], [], []]);
});

test('extended numeric forms retain their exact token ends, types, profile distinctions and diagnostics', () => {
  const cases = [
    ['2147483648', 'uint', 2147483648, [], []],
    ['2147483649', 'uint', 2147483649, [], ['SF1004']],
    ['4294967295', 'uint', 4294967295, [], ['SF1004']],
    ['4294967296', 'long', 4294967296n, [], ['SF1004']],
    ['18446744073709551615', 'ulong', 18446744073709551615n, [], ['SF1004']],
    ['18446744073709551616', 'ulong', 18446744073709551616n, ['CS1021'], ['SF1004']],
    ['0x7FFFFFFF', 'int', 2147483647, [], []],
    ['0X_FF', 'int', 255, [], []],
    ['0b_1', 'int', 1, [], []],
    ['1_024', 'int', 1024, [], []],
    ['1_', 'int', 1, ['CS1013'], []],
    ['1U', 'uint', 1, [], ['SF1003']],
    ['1L', 'long', 1n, [], ['SF1003']],
    ['1uL', 'ulong', 1n, [], ['SF1003']],
    ['1Lu', 'ulong', 1n, [], ['SF1003']],
    ['1.25', 'double', 1.25, [], []],
    ['1e+3', 'double', 1000, [], []],
    ['1E-2', 'double', 0.01, [], []],
    ['1f', 'float', 1, [], ['SF1005']],
    ['1D', 'double', 1, [], []],
    ['1.10m', 'decimal', {mantissa: 110n, scale: 2}, [], ['SF1003']],
    ['1e309', 'double', Infinity, ['CS0594'], []]
  ];
  for (const [text, type, value, errors, profile] of cases) {
    const result = scanNumber(text + ';', 0);
    assert.equal(result.end, text.length, text);
    assert.equal(result.literal.type, type, text);
    assert.deepEqual(result.literal.value, value, text);
    assert.deepEqual(result.errors.map(item => item.code), errors, text);
    assert.deepEqual(result.profile.map(item => item.code), profile, text);
  }
  for (const text of ['0x', '0b']) {
    const result = scanNumber(text + ';', 0);
    assert.equal(result.end, 2);
    assert.equal(Number.isNaN(result.value), true);
    assert.deepEqual(result.errors.map(item => item.code), ['CS1013']);
  }
});

test('integer punctuation, Unicode and incomplete exponents retain recovery boundaries', () => {
  for (const [text, expected] of [
    ['1.ToString()', ['1', '.', 'ToString', '(', ')']],
    ['1..2', ['1', '..', '2']], ['1e', ['1', 'e']], ['1e+', ['1', 'e', '+']],
    ['123abc', ['123', 'abc']], ['42\u00a0;', ['42', ';']], ['42变量', ['42', '变量']],
    [String.raw`42\u0061`, ['42', String.raw`\u0061`]], ['1.5.ToString()', ['1.5', '.', 'ToString', '(', ')']]
  ]) assert.deepEqual(tokens(text).slice(0, -1).map(token => token.text), expected, text);
});

function referenceNumbers(node, result = []) {
  if (node[0] === 'NumericLiteralToken') result.push(node);
  else if (Array.isArray(node[3])) for (const child of node[3]) referenceNumbers(child, result);
  return result;
}

test('all numeric tokens still match the checked-in Roslyn 5.3 lexical reference', async () => {
  const file = new URL('../packages/syntax/test/lexer-corpus/numbers.cs', import.meta.url);
  const text = (await readFile(fileURLToPath(file), 'utf8')).replaceAll('\r\n', '\n');
  const reference = JSON.parse(await readFile(fileURLToPath(new URL(file.href + '.json')), 'utf8'));
  assert.equal(text.length, reference.length);
  const actual = lex(new SourceText(text), undefined, {profile: false});
  assert.deepEqual(actual.diagnostics, []);
  const expected = referenceNumbers(reference.tree);
  const numeric = actual.tokens.filter(token => token.literal);
  assert.equal(numeric.length, expected.length);
  for (let index = 0; index < expected.length; index++) {
    const [, start, end, spelling] = expected[index];
    const token = numeric[index];
    assert.deepEqual([token.start, token.end, token.text, token.syntaxKind], [start, end, spelling, 'NumericLiteralToken']);
    assert.equal(compareTokenValue({text: token.text, value: token.literal}, expected[index]), null, spelling);
  }
});

test('keyword classification preserves every reserved and legacy kind plus escaped and Unicode identifiers', () => {
  for (const [word, syntaxKind] of Object.entries(reservedKeywordKinds)) {
    assert.deepEqual([tokens(word)[0].kind, tokens(word)[0].syntaxKind], [word, syntaxKind], word);
    const escaped = tokens('@' + word)[0];
    assert.deepEqual([escaped.kind, escaped.syntaxKind, escaped.value], ['identifier', 'IdentifierToken', word]);
  }
  for (const word of legacyContextual) assert.deepEqual([tokens(word)[0].kind, tokens(word)[0].syntaxKind], [word, 'IdentifierToken']);
  for (const [text, value] of [
    ['ordinary', 'ordinary'], ['变量', '变量'], ['e\u0301', 'e\u0301'], ['a\u200db', 'ab'],
    [String.raw`st\u0061tic`, 'static'], ['@static', 'static'], ['constructor', 'constructor'], ['toString', 'toString']
  ]) {
    const token = tokens(text)[0];
    assert.deepEqual([token.kind, token.syntaxKind, token.value], ['identifier', 'IdentifierToken', value], text);
  }
});

test('public keyword membership stays live without inheriting unrelated Object prototype properties', () => {
  const added = ['customKeyword', 'constructor', 'toString'].filter(word => !keywords.has(word));
  const hadStatic = keywords.has('static');
  try {
    for (const word of added) keywords.add(word);
    keywords.delete('static');
    assert.deepEqual([tokens('static')[0].kind, tokens('static')[0].syntaxKind], ['identifier', 'IdentifierToken']);
    for (const word of added) assert.deepEqual([tokens(word)[0].kind, tokens(word)[0].syntaxKind], [word, 'IdentifierToken']);
  } finally {
    for (const word of added) keywords.delete(word);
    if (hadStatic) keywords.add('static');
  }
  assert.equal(tokens('static')[0].syntaxKind, hadStatic ? 'StaticKeyword' : 'IdentifierToken');
});

test('probe constructor ownership, trivia, diagnostics and cancellation use the same shared scanner paths', () => {
  const body = 'public Card() { this.Content = new Button { Width = 2147483647 }; }';
  const text = '#if DISABLED\r\n"broken 0x}\r\n#else\r\n' +
    '// Create() { return new Window(); }\r\nclass Card : UserControl {\r\n' + body + '\r\n}\r\n#endif';
  const result = probeDesignSource(text, 'Card.cs');
  assert.equal(result.compatible, true, result.reason);
  assert.equal(result.methodName, '.ctor');
  assert.equal(result.method.ownerName, 'Card');
  assert.deepEqual(result.span, {start: text.indexOf(body), end: text.indexOf(body) + body.length});
  const records = raws => raws.map(({leading, trailing, ...record}) => record);
  const captured = new Scanner(new SourceText(text, 'Card.cs'));
  const discarded = new Scanner(new SourceText(text, 'Card.cs'));
  assert.deepEqual(records(discarded.sequence(null, {captureTrivia: false}).raws), records(captured.sequence().raws));
  for (const field of ['diagnostics', 'features', 'directives', 'checkpoints', 'state']) assert.deepEqual(discarded[field], captured[field]);
  assert.equal(probeDesignSource(text + '\n/* unfinished', 'Card.cs').code, 'SFDESIGN_INCOMPLETE_SOURCE');
  const many = 'class Values { ' + Array.from({length: 800}, (_, index) => `int value${index} = ${index};`).join('\n') + ' }\n' + text;
  let polls = 0;
  const cancellationToken = new CancellationToken({poll: () => ++polls === 3});
  assert.throws(() => probeDesignSource(many, 'Card.cs', {cancellationToken}), OperationCanceledError);
  assert.equal(polls, 3);
});

test('plain and boundary integer operands still execute through the source and CIL engines', () => {
  const compiled = compileToIL(`class NumericProbe {
    static void Main() {
      int ordinary = 1991;
      int maximum = 2147483647;
      int minimum = -2147483648;
      Console.WriteLine(ordinary + 1);
      Console.WriteLine(maximum);
      Console.WriteLine(minimum);
      Console.WriteLine(0000000007);
      Console.WriteLine(0x7FFFFFFF);
      Console.WriteLine(0b111);
      Console.WriteLine(1_024);
    }
  }`);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  for (const Machine of [VirtualMachine, CilVirtualMachine]) {
    const result = new Machine(Machine === VirtualMachine ? compiled.image : compiled.assembly).run();
    assert.equal(result.state, 'terminated', Machine.name + ': ' + JSON.stringify(result.fault));
    assert.equal(result.output.replace(/\r/g, ''), '1992\n2147483647\n-2147483648\n7\n2147483647\n7\n1024\n', Machine.name);
  }
});
