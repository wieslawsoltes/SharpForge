import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {CancellationToken, OperationCanceledError} from '@sharpforge/syntax';
import {probeDesignSource, createDesign, generateDesignCode} from '@sharpforge/designer';
import {designerSamples} from '../apps/studio/samples-designer.js';

const source = name => `class View { public static Window ${name}() { var window = new Window(); return window; } }`;

for (const name of ['Create', 'InitializeComponent', 'Main']) {
  test(`probe finds ${name} with UTF-16 method and body spans`, () => {
    const text = '// 😀 preceding text\r\n' + source(name);
    const probe = probeDesignSource(text, 'View.cs');
    assert.equal(probe.compatible, true, probe.reason);
    assert.equal(probe.methodName, name);
    assert.match(text.slice(probe.span.start, probe.span.end), new RegExp(`static Window ${name}\\(`));
    assert.equal(text[probe.method.body.start], '{');
    assert.equal(text[probe.method.body.end - 1], '}');
    assert.equal(probe.blockingReason, null);
  });
}

test('shipped GUI samples are compatible and the console Edit and Continue sample is explicitly excluded', () => {
  for (const sample of designerSamples) {
    const compatible = sample.files.filter(file => probeDesignSource(file.text, file.uri).compatible);
    // The sample catalog also contains a non-UI field/Hot Reload example. It must not gain a false design surface.
    if (sample.id === 'edit-continue-structure') {
      assert.equal(compatible.length, 0);
      assert.equal(probeDesignSource(sample.files[0].text, sample.files[0].uri).code, 'SFDESIGN_NO_DECLARATIVE_CONTROLS');
    } else assert.ok(compatible.length > 0, sample.name);
  }
});

test('ParticleLab non-UI Program.cs reports why it has no designer', async () => {
  const text = await readFile(fileURLToPath(new URL('../examples/particles/Program.cs', import.meta.url)), 'utf8');
  const probe = probeDesignSource(text, 'Program.cs');
  assert.equal(probe.compatible, false);
  assert.ok(probe.reason.length > 0);
});

test('probe ignores method-like comments, strings, inactive directives, and invocation expressions', () => {
  const cases = [
    'class P { string text = "Window Create() { new Window(); }"; }',
    '// static Window Create() { return new Window(); }\nclass P {}',
    '#if UNDEFINED\nclass P { static Window Create() { return new Window(); } }\n#endif',
    'class P { void Run() { other.Create(); } }',
    'class P { static void Main() { Console.WriteLine("new Window()"); } }'
  ];
  for (const text of cases) assert.equal(probeDesignSource(text, 'P.cs').compatible, false, text);
});

test('incomplete, oversized, ambiguous, expression-bodied and unsupported documents are explicit', () => {
  assert.equal(probeDesignSource(source('Create'), 'View.txt').code, 'SFDESIGN_FILE_TYPE');
  assert.equal(probeDesignSource(source('Create'), 'View.cs', {maxCharacters: 2}).code, 'SFDESIGN_SOURCE_LIMIT');
  assert.equal(probeDesignSource(source('Create').slice(0, -2), 'View.cs').code, 'SFDESIGN_INCOMPLETE_SOURCE');
  assert.equal(probeDesignSource('class P { static Window Create() => new Window(); }', 'View.cs').code,
    'SFDESIGN_BLOCK_BODY_REQUIRED');
  assert.equal(probeDesignSource(source('Create') + source('Create').replace('class View', 'class Other'), 'View.cs').code,
    'SFDESIGN_AMBIGUOUS_CONSTRUCTION');
  assert.equal(probeDesignSource('class P { static void Main() {} }', 'View.cs').code, 'SFDESIGN_NO_DECLARATIVE_CONTROLS');
});

test('cancellation is honored before scanning and generated source stays compatible', () => {
  const token = new CancellationToken();
  token.cancel();
  assert.throws(() => probeDesignSource(source('Create'), 'View.cs', {cancellationToken: token}), OperationCanceledError);
  assert.equal(probeDesignSource(generateDesignCode(createDesign()), 'Generated.cs').compatible, true);
});
