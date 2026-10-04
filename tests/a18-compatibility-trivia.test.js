import test from 'node:test';
import assert from 'node:assert/strict';
import {probeDesignSource} from '@sharpforge/designer';
import {CancellationToken, OperationCanceledError, Scanner} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';

const method = 'public static Window Create() { return new Window(); }';
const view = body => 'class View { ' + body + ' }';

function largeSource() {
  const members = Array.from({length: 1992}, (_, index) => `    static int value${index} = ${index};`).join('\n');
  return `class View\n{\n${members}\n    static Window Create()\n    {\n        var window = new Window();\n        return window;\n    }\n}`;
}

test('A18 compatibility keeps exact spans on the measured 2000-line fixture without a source session', () => {
  const text = largeSource();
  assert.equal(text.split('\n').length, 2000);
  assert.equal(text.length, 63627);
  const probe = probeDesignSource(text, 'View.cs');
  const start = text.indexOf('static Window Create');
  const end = text.lastIndexOf('    }') + 5;
  assert.equal(probe.compatible, true, probe.reason);
  assert.deepEqual(probe.span, {start, end});
  assert.deepEqual(probe.method.body, {start: text.indexOf('{', start), end});
  assert.equal(probe.methodName, 'Create');
});

test('A18 compatibility preserves directive position and inactive-region semantics across whitespace forms', () => {
  for (const newline of ['\n', '\r', '\r\n', '\u0085', '\u2028', '\u2029']) {
    const text = ' \t#define ENABLED' + newline + ' \t#if ENABLED' + newline + view(method) + newline +
      ' \t#else' + newline + 'broken } " source in disabled code' + newline + ' \t#endif' + newline;
    assert.equal(probeDesignSource(text, 'View.cs').compatible, true, JSON.stringify(newline));
    const misplaced = view(method) + ' \t#define TOO_LATE' + newline;
    assert.equal(probeDesignSource(misplaced, 'View.cs').code, 'SFDESIGN_INCOMPLETE_SOURCE');
  }
  const disabled = '#if DISABLED\n' + view(method) + '\n#endif\nclass Empty {}';
  assert.equal(probeDesignSource(disabled, 'View.cs').code, 'SFDESIGN_NO_CONSTRUCTION_METHOD');
  const mapped = '#nullable enable\r\n#line 200 "Mapped.cs"\r\n' + view(method) + '\r\n#line default\r\n#nullable restore\r\n';
  const probe = probeDesignSource(mapped, 'View.cs');
  assert.equal(probe.compatible, true, probe.reason);
  assert.equal(probe.method.start, mapped.indexOf('public static'));
  assert.equal(probeDesignSource(view(method) + ' #nullable enable\n', 'View.cs').code, 'SFDESIGN_INCOMPLETE_SOURCE');
});

test('A18 compatibility retains comments, Unicode trivia and escaped identifiers without matching literal contents', () => {
  const prefix = '\ufeff// 😀 Create() { new Window(); }\r\n\t/** documentation */\u00a0';
  const escaped = 'public static Window @Create() { return new global::Microsoft.UI.Xaml.Window(); }';
  const text = prefix + view(escaped);
  const probe = probeDesignSource(text, 'View.cs');
  assert.equal(probe.compatible, true, probe.reason);
  assert.equal(text.slice(probe.method.nameSpan.start, probe.method.nameSpan.end), '@Create');
  const literals = [
    '"Create() { new Window(); }"', '@"Create() { new Window(); }"',
    '"""Create() { new Window(); }"""', '$"Create() {{ new Window(); }} {1 + 2}"'
  ];
  for (const literal of literals) {
    assert.equal(probeDesignSource(view('string text = ' + literal + ';'), 'View.cs').compatible, false, literal);
  }
  const ordinary = view(method).replaceAll(' ', '\v\f\u001a\u00a0\u2003');
  assert.equal(probeDesignSource(ordinary, 'View.cs').compatible, true);
});

test('A18 compatibility scans lexical errors after a valid construction method and preserves shared scanner diagnostics', () => {
  const suffixes = ['/* unclosed', '"unclosed', '\u0000', 'int value = 0x;', '#invalid directive\n'];
  for (const suffix of suffixes) {
    const text = view(method) + '\n' + suffix;
    const scanner = new Scanner(new SourceText(text, 'View.cs'));
    scanner.sequence();
    assert(scanner.diagnostics.some(diagnostic => diagnostic.severity === 'error'), suffix);
    assert.equal(probeDesignSource(text, 'View.cs').code, 'SFDESIGN_INCOMPLETE_SOURCE', suffix);
  }
  assert.equal(probeDesignSource(view(method) + ']', 'View.cs').code, 'SFDESIGN_INCOMPLETE_SOURCE');
  assert.equal(probeDesignSource(view(method) + '\n' + view(method), 'View.cs').code, 'SFDESIGN_AMBIGUOUS_CONSTRUCTION');
});

test('A18 streaming compatibility keeps size bounds and cooperative cancellation during a large scan', () => {
  const text = largeSource();
  let polls = 0;
  const token = new CancellationToken({poll: () => ++polls === 3});
  assert.throws(() => probeDesignSource(text, 'View.cs', {cancellationToken: token}), OperationCanceledError);
  assert.equal(polls, 3);
  assert.equal(probeDesignSource(text, 'View.cs', {maxCharacters: text.length - 1}).code, 'SFDESIGN_SOURCE_LIMIT');
  assert.equal(probeDesignSource(text, 'View.cs', {maxCharacters: text.length}).compatible, true);
  assert.equal(probeDesignSource(text + '/*', 'View.cs').code, 'SFDESIGN_INCOMPLETE_SOURCE');
  assert.equal(probeDesignSource(text, 'View.cs').compatible, true, 'A previous failure must not contaminate another invocation');
});

test('A18 raw token discard mode matches captured lexical values and state across all complex trivia', () => {
  const cases = [
    largeSource(),
    '#nullable enable\r\n#line 40 "Mapped.cs"\r\n' + view(method),
    '#if DISABLED\nCreate() { "bad disabled text\n#else\n' + view(method) + '\n#endif',
    ' \t/* multiline\r\n comment */\r\n' + view('public /* signature */ static Window Create(/* parameters */) { return new Window(); }'),
    '\ufeff\u00a0\u2003' + view('string text = """Create() { new Window(); }"""; ' + method),
    view('string text = $"{1 + 2} Create() {{ new Window(); }}"; ' + method),
    view(method) + '\r\n/* unterminated',
    view(method) + ' #nullable enable\n'
  ];
  const records = raws => raws.map(({leading, trailing, ...record}) => record);
  for (const text of cases) {
    const source = new SourceText(text, 'View.cs');
    const captured = new Scanner(source);
    const compact = new Scanner(source);
    const expected = captured.sequence();
    const actual = compact.sequence(null, {captureTrivia: false});
    assert.deepEqual(records(actual.raws), records(expected.raws));
    assert(actual.raws.every(record => record.leading === undefined && record.trailing === undefined));
    assert.deepEqual(actual.head, []);
    assert.deepEqual(actual.tail, []);
    assert.deepEqual(compact.diagnostics, captured.diagnostics);
    assert.deepEqual(compact.profile, captured.profile);
    assert.deepEqual(compact.directives, captured.directives);
    assert.deepEqual(compact.checkpoints, captured.checkpoints);
    assert.deepEqual(compact.features, captured.features);
    assert.deepEqual(compact.state, captured.state);
  }
});

test('A18 trivia discard mode polls cancellation within a near-limit whitespace run', () => {
  const text = ' '.repeat(1_999_900) + view(method);
  let polls = 0;
  const token = new CancellationToken({poll: () => ++polls === 2});
  assert.throws(() => probeDesignSource(text, 'View.cs', {cancellationToken: token}), OperationCanceledError);
  assert.equal(polls, 2);
});
