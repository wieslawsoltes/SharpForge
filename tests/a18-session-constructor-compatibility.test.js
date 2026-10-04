import test from 'node:test';
import assert from 'node:assert/strict';
import {probeDesignSource} from '@sharpforge/designer';
import {component} from './browser_designer_gate_fixtures.mjs';

test('the actual browser component constructor has a syntax-only route with exact UTF-16 spans', () => {
  const text = '// 😀 constructor preview\r\n' + component;
  const probe = probeDesignSource(text, 'Card.cs');
  assert.equal(probe.compatible, true, probe.reason);
  assert.equal(probe.methodName, '.ctor');
  assert.equal(probe.method.ownerName, 'Card');
  assert.equal(text.slice(probe.method.nameSpan.start, probe.method.nameSpan.end), 'Card');
  assert.ok(text.slice(probe.span.start, probe.span.end).startsWith('public Card()'));
  assert.equal(text[probe.method.body.start], '{');
  assert.equal(text[probe.method.body.end - 1], '}');
});

test('a parameterless constructor can assign inline content, with or without an explicit access modifier', () => {
  for (const access of ['', 'public ']) {
    const text = `class Card : UserControl { ${access}Card() { this.Content = new Grid(); } }`;
    const probe = probeDesignSource(text, 'Card.cs');
    assert.equal(probe.compatible, true, probe.reason);
    assert.equal(probe.methodName, '.ctor');
  }
});

test('constructor calls, non-constructors and excluded constructor signatures do not open a design view', () => {
  const sources = [
    'class Card { void Run() { var instance = new Card(); var body = new Grid(); } }',
    'class Card { Card Card() { var body = new Grid(); return this; } }',
    'class Card { static Card() { var body = new Grid(); } }',
    'class Card { Card(int count) { var body = new Grid(); } }',
    'class Card { Card() : base() { var body = new Grid(); } }',
    'class Card { Card() : this(1) { var body = new Grid(); } Card(int count) {} }',
    'class Card { Card() { string text = "new Grid()"; } }',
    '// class Card { Card() { var body = new Grid(); } }\nclass Empty {}',
    '#if DISABLED\nclass Card { Card() { var body = new Grid(); } }\n#endif'
  ];
  for (const text of sources) assert.equal(probeDesignSource(text, 'Card.cs').compatible, false, text);
});

test('named construction priority and constructor ambiguity remain explicit', () => {
  const named = 'class Card { public Card() { InitializeComponent(); } void InitializeComponent() { var body = new Grid(); } }';
  assert.equal(probeDesignSource(named, 'Card.cs').methodName, 'InitializeComponent');
  const multiple = component + '\nclass Other { public Other() { var body = new Grid(); } }';
  assert.equal(probeDesignSource(multiple, 'Card.cs').code, 'SFDESIGN_AMBIGUOUS_CONSTRUCTION');
  assert.equal(probeDesignSource('class Card { Card() => new Grid(); }', 'Card.cs').code, 'SFDESIGN_BLOCK_BODY_REQUIRED');
});
