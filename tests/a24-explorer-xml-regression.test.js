import test from 'node:test';
import assert from 'node:assert/strict';
import {rewriteProjectPath, parseXml} from '@sharpforge/project-system';

for (const entity of ['a&amp;b', 'a&#38;b', 'a&#x26;b']) {
  test('B02 rename compares entity-decoded paths: ' + entity, () => {
    const text = '\uFEFF<Project><!-- preserve ' + entity + ' --><ItemGroup><Compile Include="' + entity + '/x.cs" /></ItemGroup></Project>';
    const next = rewriteProjectPath(text, {documentPath: 'App.csproj', oldPath: 'a&b', newPath: 'c&d'});
    assert(next.startsWith('\uFEFF'));
    assert(next.includes('Include="c&amp;d/x.cs"'));
    assert(next.includes('<!-- preserve ' + entity + ' -->'));
    parseXml(next);
  });
}

test('B02 path rewrite preserves single quote attributes and escapes apostrophes', () => {
  const next = rewriteProjectPath("<Project><ItemGroup><Compile Include='old/A.cs'/></ItemGroup></Project>",
    {documentPath: 'App.csproj', oldPath: 'old', newPath: "a'b"});
  assert(next.includes("Include='a&apos;b/A.cs'"));
  assert.equal(parseXml(next).children[0].children[0].attributes.Include, "a'b/A.cs");
});

test('B02 path rewrite leaves expressions and package identities unchanged and rejects malformed entities', () => {
  const text = '<Project><ItemGroup><Compile Include="$(Root)/old.cs"/><PackageReference Include="Old"/></ItemGroup></Project>';
  assert.equal(rewriteProjectPath(text, {documentPath: 'App.csproj', oldPath: 'Old', newPath: 'New'}), text);
  assert.throws(() => rewriteProjectPath('<Project><Compile Include="a&unknown;b/A.cs"/></Project>',
    {documentPath: 'App.csproj', oldPath: 'a&b', newPath: 'new'}), /entity/);
});

test('project relocation rewrites references against the new document directory', () => {
  const next = rewriteProjectPath('<Project><ItemGroup><Compile Include="../Shared/A.cs"/></ItemGroup></Project>',
    {documentPath: 'App/App.csproj', newDocumentPath: 'Nested/App/App.csproj', oldPath: 'App', newPath: 'Nested/App'});
  assert(next.includes('../../Shared/A.cs'));
});
