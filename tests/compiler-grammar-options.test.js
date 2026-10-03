import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, SemanticModel } from '@sharpforge/compiler';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';

const source = 'class record {} class P { record value; static void Main() {} }';

test('compiler language versions select grammar before contextual keywords are parsed', () => {
  const parsed = parse(new SourceText(source), undefined, { languageVersion: '8' });
  const text = compile(source, { langVersion: '8' });
  assert.equal(text.success, true, JSON.stringify(text.diagnostics));
  assert.deepEqual(text.diagnostics, compile([parsed], { langVersion: '8' }).diagnostics);
  const record = compile(source, { langVersion: '9' });
  assert.equal(record.success, true, JSON.stringify(record.diagnostics));
  assert.equal(record.semantic.generated, true, 'C# 9 parses a nested record and uses semantic generation');
});

test('per-file language versions and preprocessor symbols reach parsing together', () => {
  const files = [{ uri: 'Old.cs', text: `#if OLD\n${source}\n#else\n#error Wrong symbols\n#endif` }];
  const result = compile(files, { langVersion: '14', langVersionByUri: { 'Old.cs': '8' }, preprocessorSymbols: 'OLD;EXTRA' });
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.equal(compile(files, { langVersion: '8', preprocessorSymbols: [] }).success, false);
});

test('semantic model creation uses the same grammar and conditional compilation as compile', () => {
  const files = [{ uri: 'Old.cs', text: `#if OLD\n${source}\n#else\n#error Wrong symbols\n#endif` }];
  const options = { langVersion: '14', langVersionByUri: { 'Old.cs': '8' }, preprocessorSymbols: ['OLD'] };
  const result = SemanticModel.create(files, options).result;
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, compile(files, options).diagnostics);
});
