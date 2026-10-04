import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLinkUrl, SymbolError } from '@sharpforge/symbols';

const symbols = (documents) => ({ sourceLink: { documents } });
const mappings = symbols({
  'C:\\src\\*': 'https://default.example/src/*',
  'C:\\src\\foo\\*': 'https://foo.example/src/*',
  'C:\\src\\foo\\specific.txt': 'https://specific.example/src/specific.txt',
  'C:\\src\\bar\\*': 'https://bar.example/src/*',
});

// Source Link specification's precedence table, with this package's HTTPS-only transport policy.
for (const [path, expected] of [
  ['C:\\src\\foo\\specific.txt', 'https://specific.example/src/specific.txt'],
  ['C:\\src\\foo\\nested\\item.cs', 'https://foo.example/src/nested/item.cs'],
  ['C:/src/bar/item.cs', 'https://bar.example/src/item.cs'],
  ['C:/src/other/item.cs', 'https://default.example/src/other/item.cs'],
  ['C:/outside/item.cs', null],
])
  test('Source Link specification mapping: ' + path, () => {
    assert.equal(sourceLinkUrl(mappings, path), expected);
  });

test('case-insensitive mode normalizes separators and keeps the captured path casing', () => {
  assert.equal(sourceLinkUrl(mappings, 'c:/SRC/Foo/Folder/File.cs'), null);
  assert.equal(
    sourceLinkUrl(mappings, 'c:/SRC/Foo/Folder/File.cs', { ignoreCase: true }),
    'https://foo.example/src/Folder/File.cs',
  );
  const unicode = symbols({ '/É/*': 'https://source.example/*' });
  assert.equal(sourceLinkUrl(unicode, '/é/File.cs', { ignoreCase: true }), 'https://source.example/File.cs');
  assert.equal(sourceLinkUrl(symbols({ '/ß/*': 'https://source.example/*' }), '/ss/file', { ignoreCase: true }), null);
});

test('wildcard capture uses URI path-segment escaping including reserved punctuation and literal percent', () => {
  const value = symbols({ '/src/*': 'https://source.example/items?path=/*&version=commit' });
  assert.equal(
    sourceLinkUrl(value, "/src/a b/!'()%20#?.cs"),
    'https://source.example/items?path=/a%20b/%21%27%28%29%2520%23%3F.cs&version=commit',
  );
  assert.equal(sourceLinkUrl(value, '/src/𝄞.cs'), 'https://source.example/items?path=/%F0%9D%84%9E.cs&version=commit');
});

test('most-specific mapping wins regardless of object order', () => {
  const reversed = symbols(Object.fromEntries(Object.entries(mappings.sourceLink.documents).reverse()));
  assert.equal(sourceLinkUrl(reversed, 'C:/src/foo/specific.txt'), 'https://specific.example/src/specific.txt');
});

test('malformed wildcards, normalized duplicates and ambiguous case mappings are explicit errors', () => {
  for (const documents of [
    { '/src/*.cs': 'https://source.example/*' },
    { '/src/**': 'https://source.example/*' },
    { '/src/*': 'https://source.example/file' },
    { '/src/file': 'https://source.example/*' },
    { '/src/*': 'https://source.example/*/*' },
    { '/src/*': null },
    { 'C:\\src\\*': 'https://source.example/*', 'C:/src/*': 'https://source.example/*' },
  ])
    assert.throws(() => sourceLinkUrl(symbols(documents), '/src/file'), SymbolError);
  assert.throws(
    () =>
      sourceLinkUrl(symbols({ '/a/*': 'https://one.example/*', '/A/*': 'https://two.example/*' }), '/a/file', {
        ignoreCase: true,
      }),
    /Ambiguous/,
  );
});

test('unsafe or invalid selected URLs and invalid path text fail before network access', () => {
  for (const url of ['http://source.example/a', 'https://name:secret@source.example/a', 'not-a-url']) {
    assert.throws(() => sourceLinkUrl(symbols({ file: url }), 'file'), SymbolError);
  }
  const value = symbols({ '/src/*': 'https://source.example/*' });
  assert.throws(() => sourceLinkUrl(value, '/src/../secret'), /dot segments/);
  assert.throws(() => sourceLinkUrl(value, '/src/\ud800'), /Unicode/);
  assert.equal(sourceLinkUrl(value, '/src/*.cs'), null);
});

test('mapping count and document-size budgets have exact boundaries', () => {
  const value = symbols({ '/src/*': 'https://source.example/*' });
  assert.equal(sourceLinkUrl(value, '/src/a', { maxMappings: 1 }), 'https://source.example/a');
  assert.throws(() => sourceLinkUrl(value, '/src/a', { maxMappings: 0 }), /limit/);
  assert.equal(sourceLinkUrl(symbols({}), 'a'.repeat(32768)), null);
  assert.throws(() => sourceLinkUrl(value, 'a'.repeat(32769)), /document path/);
  assert.throws(() => sourceLinkUrl(value, '/src/a', { ignoreCase: 'yes' }), /options/);
});
