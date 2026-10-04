import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, noErrors, identities } from './helpers/project-evaluation.js';

test('generic custom items preserve source order, default metadata, update and removal', () => {
  const result = evaluate(`<Project>
    <ItemDefinitionGroup><Widget><Mode>default</Mode></Widget></ItemDefinitionGroup>
    <ItemGroup><Widget Include="one;two;three"/><Widget Update="two"><Mode>changed</Mode></Widget>
      <Widget Remove="one"/><Clone Include="@(Widget)"/></ItemGroup></Project>`);
  noErrors(result);
  assert.deepEqual(identities(result, 'Widget'), ['two', 'three']);
  assert.deepEqual(result.project.evaluatedItems.Widget.map(item => item.metadata.Mode), ['changed', 'default']);
  assert.deepEqual(identities(result, 'Clone'), ['two', 'three']);
  assert.equal(result.project.items.filter(item => item.itemType === 'Clone').length, 2);
});

test('escaped separators remain literal item identities', () => {
  const result = evaluate('<Project><ItemGroup><X Include="one%3Btwo;three"/></ItemGroup></Project>');
  noErrors(result);
  assert.deepEqual(identities(result, 'X'), ['one;two', 'three']);
});

test('Include Exclude Update Remove obey declaration order for absent and future items', () => {
  const result = evaluate(`<Project><ItemGroup>
    <X Update="one"><Order>early</Order></X><X Remove="future"/>
    <X Include="one;two;future" Exclude="two"/><X Update="one"><Order>late</Order></X>
    <X Remove="future"/><X Include="future"/>
  </ItemGroup></Project>`);
  noErrors(result);
  assert.deepEqual(identities(result, 'X'), ['one', 'future']);
  assert.equal(result.project.evaluatedItems.X[0].metadata.Order, 'late');
  assert.equal(result.project.evaluatedItems.X[1].metadata.Order, undefined);
});

test('KeepDuplicates compares identity and custom metadata', () => {
  const result = evaluate(`<Project><ItemGroup>
    <X Include="same"><M>a</M></X><X Include="same" KeepDuplicates="false"><M>a</M></X>
    <X Include="same" KeepDuplicates="false"><M>b</M></X>
  </ItemGroup></Project>`);
  noErrors(result);
  assert.equal(result.project.evaluatedItems.X.length, 2);
});

test('KeepMetadata and RemoveMetadata filter copied custom metadata', () => {
  const result = evaluate(`<Project><ItemGroup>
    <X Include="source"><One>1</One><Two>2</Two></X>
    <Keep Include="@(X)" KeepMetadata="One"/><Remove Include="@(X)" RemoveMetadata="One"/>
  </ItemGroup></Project>`);
  noErrors(result);
  assert.deepEqual(result.project.evaluatedItems.Keep[0].metadata, { One: '1' });
  assert.deepEqual(result.project.evaluatedItems.Remove[0].metadata, { Two: '2' });
});

test('MatchOnMetadata removes matching copied items with explicit comparison modes', () => {
  const result = evaluate(`<Project><ItemGroup>
    <X Include="first"><Target>A</Target></X><X Include="second"><Target>B</Target></X>
    <Y Include="other"><Target>a</Target></Y>
    <X Remove="@(Y)" MatchOnMetadata="Target" MatchOnMetadataOptions="CaseInsensitive"/>
  </ItemGroup></Project>`);
  noErrors(result);
  assert.deepEqual(identities(result, 'X'), ['second']);
});

test('item metadata expansion observes previous metadata and the current item', () => {
  const result = evaluate(`<Project><ItemGroup><X Include="folder/one.cs">
    <A>%(Filename)</A><B>%(X.A).next</B><Empty>%(Other.A)</Empty>
    <Qualified>%(X.Extension)</Qualified><Identity>%(Identity)</Identity>
  </X></ItemGroup></Project>`);
  noErrors(result);
  const metadata = result.project.evaluatedItems.X[0].metadata;
  assert.equal(metadata.A, 'one');
  assert.equal(metadata.B, 'one.next');
  assert.equal(metadata.Empty, '');
  assert.equal(metadata.Qualified, '.cs');
  assert.equal(metadata.Identity, 'folder/one.cs');
});

test('well-known metadata describes imported definitions relative to the project', () => {
  const result = evaluate('<Project><Import Project="../shared/definitions.props"/></Project>', {
    'shared/definitions.props': `<Project><ItemGroup><X Include="sub/**/*.cs">
      <Full>%(FullPath)</Full><Root>%(RootDir)</Root><File>%(Filename)</File><Ext>%(Extension)</Ext>
      <Relative>%(RelativeDir)</Relative><Dir>%(Directory)</Dir><Recursive>%(RecursiveDir)</Recursive>
      <Origin>%(DefiningProjectFullPath)</Origin><OriginDir>%(DefiningProjectDirectory)</OriginDir>
      <OriginName>%(DefiningProjectName)</OriginName><OriginExt>%(DefiningProjectExtension)</OriginExt>
    </X></ItemGroup></Project>`, 'App/sub/deep/Name.cs': 'class Name {}',
  });
  noErrors(result);
  assert.deepEqual(result.project.evaluatedItems.X[0].metadata, {
    Full: '/App/sub/deep/Name.cs', Root: '/', File: 'Name', Ext: '.cs', Relative: 'sub/deep/', Dir: 'App/sub/deep/',
    Recursive: 'deep/', Origin: '/shared/definitions.props', OriginDir: '/shared/', OriginName: 'definitions', OriginExt: '.props',
  });
});

test('transforms generate new paths and preserve source metadata over nested transforms', () => {
  const result = evaluate(`<Project><ItemGroup><X Include="src/one.cs;src/two.cs"><M>retained</M></X>
    <Y Include="@(X->'%(RelativeDir)%(Filename).g.cs')"/>
    <Z Include="@(X->'%(Filename).x'->'%(Filename).final')"/>
  </ItemGroup></Project>`);
  noErrors(result);
  assert.deepEqual(identities(result, 'Y'), ['src/one.g.cs', 'src/two.g.cs']);
  assert.deepEqual(result.project.evaluatedItems.Y.map(item => item.path), ['App/src/one.g.cs', 'App/src/two.g.cs']);
  assert.deepEqual(identities(result, 'Z'), ['one.final', 'two.final']);
  assert.equal(result.project.evaluatedItems.Y[0].metadata.M, 'retained');
});

const functions = [
  ["@(X, '|')", 'a;A;a;b'.replaceAll(';', '|')], ["@(X->Count())", '4'],
  ["@(X->Distinct())", 'a;b'], ["@(X->DistinctWithCase())", 'a;A;b'], ["@(X->Reverse())", 'b;a;A;a'],
  ["@(X->AnyHaveMetadataValue('M','YES'))", 'True'], ["@(X->HasMetadata('M'))", 'a;A;a'],
  ["@(X->WithMetadataValue('M','yes'))", 'a;A;a'], ["@(X->WithoutMetadataValue('M','yes'))", 'b'],
  ["@(X->Metadata('M'))", 'yes;yes;yes'], ["@(X->ClearMetadata()->HasMetadata('M'))", ''],
  ["@(X->ToUpper())", 'A;A;A;B'],
];
for (const [expression, expected] of functions) test('item expression function ' + expression, () => {
  const result = evaluate(`<Project><ItemGroup><X Include="a;A;a"><M>yes</M></X><X Include="b"/>
    <Result Include="value"><Value>${expression.replaceAll('>', '&gt;')}</Value></Result></ItemGroup></Project>`);
  noErrors(result);
  assert.equal(result.project.evaluatedItems.Result[0].metadata.Value, expected);
});

test('Exists item function keeps only granted workspace files', () => {
  const result = evaluate(`<Project><ItemGroup><X Include="Program.cs;missing.cs"/>
    <Y Include="@(X->Exists())"/></ItemGroup></Project>`);
  noErrors(result);
  assert.deepEqual(identities(result, 'Y'), ['Program.cs']);
});

test('item conditions see final properties and per-item metadata', () => {
  const result = evaluate(`<Project><ItemGroup Condition="'$(Late)' == 'yes'">
    <X Include="one.cs;two.txt" Condition="'%(Extension)' == '.cs'"/>
  </ItemGroup><PropertyGroup><Late>yes</Late></PropertyGroup></Project>`);
  noErrors(result);
  assert.deepEqual(identities(result, 'X'), ['one.cs']);
});

for (const content of [
  '<X/>', '<X Include="a" Remove="b"/>', '<X Include="a" KeepMetadata="A" RemoveMetadata="B"/>',
  '<X Include="a" KeepDuplicates="perhaps"/>', '<X Remove="a" MatchOnMetadata="M"/>',
  '<X Include="a"/><X Remove="@(X)" MatchOnMetadata="M" MatchOnMetadataOptions="Random"/>',
  '<X Include="@(X->UnknownMethod())"/>', '<X Include="../../escape"/>',
]) test('invalid item operation is diagnosed: ' + content, () => {
  const result = evaluate('<Project><ItemGroup>' + content + '</ItemGroup></Project>');
  assert(result.diagnostics.some(diagnostic => diagnostic.severity === 'error'));
});

test('item expansion and cancellation budgets stop evaluation', () => {
  const result = evaluate('<Project><ItemGroup><X Include="a;b;c"/></ItemGroup></Project>', {}, { limits: { items: 2 } });
  assert(result.diagnostics.some(diagnostic => /limit/.test(diagnostic.message)));
  const controller = new AbortController();
  controller.abort();
  const cancelled = evaluate('<Project/>', {}, { signal: controller.signal });
  assert(cancelled.diagnostics.some(diagnostic => diagnostic.code === 'SFP1099'));
});
