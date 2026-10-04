import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTemplateConfig, evaluateTemplateSymbols, applyValueForm } from '@sharpforge/templates';

function configuration(description) {
  return { identity: 'Budget.Template', shortName: 'budget', description };
}

test('template config budgets count actual UTF-8 bytes for strings, byte inputs and object inputs', () => {
  for (const description of ['ASCII', 'λ', '漢字', '😀', '\uD800']) {
    const value = configuration(description);
    const source = JSON.stringify(value);
    const bytes = new TextEncoder().encode(source);
    for (const input of [source, bytes, value]) {
      assert.equal(parseTemplateConfig(input, { maxBytes: bytes.length }).description, description);
      assert.throws(() => parseTemplateConfig(input, { maxBytes: bytes.length - 1 }), { code: 'SFTPL012' });
    }
    assert.deepEqual(value, configuration(description), 'object input remains unchanged');
  }
});

test('template byte limits include a UTF-8 BOM and reject oversized malformed bytes before decoding', () => {
  const source = new TextEncoder().encode(JSON.stringify(configuration('λ')));
  const bytes = new Uint8Array(source.length + 3);
  bytes.set([0xef, 0xbb, 0xbf]);
  bytes.set(source, 3);
  assert.equal(parseTemplateConfig(bytes, { maxBytes: bytes.length }).description, 'λ');
  assert.throws(() => parseTemplateConfig(bytes, { maxBytes: bytes.length - 1 }), { code: 'SFTPL012' });
  const malformed = Uint8Array.of(0xff, 0xfe);
  assert.throws(() => parseTemplateConfig(malformed, { maxBytes: 1 }), {
    code: 'SFTPL012', message: 'Template config size limit exceeded'
  });
  assert.throws(() => parseTemplateConfig(malformed, { maxBytes: 2 }), error =>
    error.code === 'SFTPL012' && /Invalid template.json/.test(error.message));
});

test('template config byte budgets reject invalid limits before parsing input', () => {
  for (const maxBytes of [0, -1, 1.5, NaN, Infinity, '100']) {
    assert.throws(() => parseTemplateConfig(configuration('small'), { maxBytes }), {
      code: 'SFTPL012', message: 'Invalid template config byte limit'
    });
  }
});

test('inherited object names cannot act as builtin forms or configured builtin identifiers', () => {
  for (const name of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
    assert.throws(() => applyValueForm('Source', name), {
      code: 'SFTPL011', message: 'Unknown template value form: ' + name
    });
    assert.throws(() => applyValueForm('Source', 'alias', { alias: { identifier: name } }), {
      code: 'SFTPL011', message: 'Unsupported template value form: ' + name
    });
    const config = parseTemplateConfig({ ...configuration(''), symbols: {
      Derived: { type: 'derived', valueSource: 'name', valueTransform: name }
    } });
    assert.throws(() => evaluateTemplateSymbols(config, {}, { name: 'Source' }), { code: 'SFTPL011' });
  }
});

test('declared forms and builtin transformations retain their behavior while inherited declarations are ignored', () => {
  assert.equal(applyValueForm('Source.Name', 'lowerCase'), 'source.name');
  assert.equal(applyValueForm('Source.Name', 'upper', { upper: { identifier: 'upperCase' } }), 'SOURCE.NAME');
  const forms = JSON.parse('{"constructor":{"identifier":"upperCase"},"__proto__":{"identifier":"lowerCase"}}');
  assert.equal(applyValueForm('Source', 'constructor', forms), 'SOURCE');
  assert.equal(applyValueForm('Source', '__proto__', forms), 'source');
  const inherited = Object.create({ alias: { identifier: 'upperCase' } });
  assert.throws(() => applyValueForm('Source', 'alias', inherited), {
    code: 'SFTPL011', message: 'Unknown template value form: alias'
  });
});
