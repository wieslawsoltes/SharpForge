import test from 'node:test';
import assert from 'node:assert/strict';
import {parseConfigurationJson, getCaseInsensitive, renameSolutionFolder} from '@sharpforge/project-system';

test('configuration JSON retains quoted text, accepts comments and controls trailing commas explicitly', () => {
  const source = '\ufeff{/* header */"url":"https://example.test/a//b", "items":[1,2,], // tail\n}';
  assert.deepEqual(parseConfigurationJson(source), {url: 'https://example.test/a//b', items: [1, 2]});
  assert.deepEqual(parseConfigurationJson('{/* sdk */"sdk":{"version":"10.0.201"}}', {allowTrailingCommas: false}),
    {sdk: {version: '10.0.201'}});
  assert.throws(() => parseConfigurationJson('{\n"sdk":1,\n}', {allowTrailingCommas: false}),
    {code: 'SFJSON001', start: 11, length: 1, line: 3, column: 1});
});

test('configuration JSON rejects malformed and excessive input with stable located diagnostics', () => {
  for (const source of ['{"x":', '{/*', '[1 2]', '"\\q"', '{"x":NaN}', 'true false']) {
    assert.throws(() => parseConfigurationJson(source), error => error.code === 'SFJSON001'
      && Number.isInteger(error.start) && error.line > 0 && error.column > 0);
  }
  assert.throws(() => parseConfigurationJson('true', {maxLength: 3}), {code: 'SFJSON001'});
  assert.throws(() => parseConfigurationJson('[[0]]', {maxDepth: 1}), {code: 'SFJSON001'});
  assert.throws(() => parseConfigurationJson('[1,2]', {maxNodes: 2}), {code: 'SFJSON001'});
});

test('configuration objects and metadata lookup preserve own-property boundaries and existing exports', () => {
  const value = parseConfigurationJson('{"__proto__":{"polluted":true},"Exact":1,"exact":2}');
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(Object.hasOwn(value, '__proto__'), true);
  assert.equal(value.polluted, undefined);
  assert.equal(getCaseInsensitive(value, 'exact'), 2);
  assert.equal(getCaseInsensitive(value, 'EXACT'), 1);
  assert.equal(getCaseInsensitive(Object.create({Inherited: 'hidden'}), 'inherited'), undefined);
  assert.equal(getCaseInsensitive(null, 'key'), undefined);
  assert.equal(typeof renameSolutionFolder, 'function');
});
