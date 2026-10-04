import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectSystem, evaluateCondition, expandExpression, WorkspacePathIndex, parseTargetFramework,
  isTargetFrameworkCompatible, nearestTargetFramework } from '../packages/project-system/src/index.js';
import { evaluate, propertyProject, noErrors } from './helpers/project-evaluation.js';

test('B01 tokenizes before expansion, preserving injected quotes, operators and empty values', () => {
  for (const value of ["it's", '"quoted"', '(a) == (b)', 'x Or true', '']) {
    assert.equal(evaluateCondition("'$(A)' == '$(B)'", { properties: { A: value, B: value } }), true);
  }
  assert.equal(evaluateCondition("$(Empty) == ''", { properties: {} }), true);
  assert.equal(evaluateCondition("false And '$([Blocked]::Fail())' == ''"), false);
  assert.equal(evaluateCondition("true Or Exists($([Blocked]::Fail()))"), true);
});

test('scanner handles adjacent references, nested static/string calls and encoded references', () => {
  const context = { properties: { A: "it's", B: 'ready', Source: ' x ' } };
  assert.equal(expandExpression('$(A)$(B)', context), "it'sready");
  assert.equal(expandExpression("$([System.String]::Copy('$(Source)').Trim().ToUpperInvariant())", context), 'X');
  assert.equal(expandExpression('%24(A)-%40(X)-%25(M)', context), '$(A)-@(X)-%(M)');
  assert.equal(expandExpression('$([System.String]::Copy(`a(b)c`))'), 'a(b)c');
});

const strings = [
  ['Length', '5'], ['Substring(1)', 'baba'], ['Substring(1,2)', 'ba'], ["Replace('a','X')", 'XbXbX'],
  ['ToUpper()', 'ABABA'], ['ToUpperInvariant()', 'ABABA'], ['ToLower()', 'ababa'], ['ToLowerInvariant()', 'ababa'],
  ["Contains('bab')", 'True'], ["StartsWith('AB', 'OrdinalIgnoreCase')", 'True'], ["EndsWith('BA', 'OrdinalIgnoreCase')", 'True'],
  ["IndexOf('ba')", '1'], ["LastIndexOf('ba')", '3'], ["Split('b')[1]", 'a'],
  ["PadLeft(7,'0')", '00ababa'], ["PadRight(7,'0')", 'ababa00'], ["Equals('ABABA', 'OrdinalIgnoreCase')", 'True'],
  ['[2]', 'a'], ["Trim('a')", 'bab'], ["TrimStart('a')", 'baba'], ["TrimEnd('a')", 'abab'],
];
for (const [member, expected] of strings) test('string property member ' + member, () => {
  const expression = '$(A' + (member.startsWith('[') ? '' : '.') + member + ')';
  assert.equal(expandExpression(expression, { properties: { A: 'ababa' } }), expected);
});

for (const expression of ['$(A.BadMember)', "$(A.Replace('', 'x'))", '$(A.Substring(-1))', '$(A[100])',
  '$(Unterminated', "$([System.String]::Copy('missing))", '$([System.IO.File]::ReadAllText(x))',
  "$([System.Text.RegularExpressions.Regex]::IsMatch('aaaa!', '(a+)+$'))"])
  test('B02 malformed or disallowed expression is diagnostic: ' + expression.slice(0, 45), () => {
    assert.throws(() => expandExpression(expression, { properties: { A: 'abc' } }));
    const result = evaluate(propertyProject({ A: 'abc', Result: expression }));
    assert(result.diagnostics.some(diagnostic => diagnostic.severity === 'error'));
    assert.equal(result.project.properties.result, undefined);
  });

test('B03 item and metadata conditions evaluate with context and fail explicitly without it', () => {
  const result = evaluate('<Project><ItemGroup><X Include="a;b"><M>yes</M></X>'
    + '<Y Include="@(X)" Condition="\'@(X)\' != \'\' And \'%(X.M)\' == \'yes\'"/></ItemGroup></Project>');
  noErrors(result);
  assert.equal(result.project.evaluatedItems.Y.length, 2);
  assert.throws(() => evaluateCondition("'@(X)' == ''"), /item context/i);
  assert.throws(() => evaluateCondition("'%(M)' == ''"), /metadata|context/i);
});

const staticFunctions = [
  ["$([System.String]::Concat('a','b'))", 'ab'], ["$([System.String]::Format('{0}-{1}','a','b'))", 'a-b'],
  ["$([System.String]::IsNullOrWhiteSpace('  '))", 'True'], ['$([System.Math]::Round(2.5))', '2'],
  ['$([System.Math]::Round(3.5))', '4'], ['$([System.Math]::Max(2,8))', '8'],
  ["$([System.Version]::Parse('1.2.3').Major)", '1'], ["$([System.Convert]::ToInt32('FF',16))", '255'],
  ["$([System.Char]::IsDigit('4'))", 'True'], ['$([System.Guid]::Empty)', '00000000-0000-0000-0000-000000000000'],
  ["$([System.Text.RegularExpressions.Regex]::Replace('abc123','[0-9]+','x'))", 'abcx'],
];
for (const [expression, expected] of staticFunctions) test('allow-listed static function ' + expression, () => {
  assert.equal(expandExpression(expression), expected);
});

test('static path/environment/time calls use only the explicit virtual context', () => {
  const result = evaluate(propertyProject({
    Full: "$([System.IO.Path]::GetFullPath('../shared/a.txt'))", File: "$([System.IO.Path]::GetFileName('x/y.txt'))",
    Extension: "$([System.IO.Path]::GetExtension('x/y.txt'))", Changed: "$([System.IO.Path]::ChangeExtension('a.txt','cs'))",
    Directory: "$([System.IO.Path]::GetDirectoryName('a/b.txt'))", Combined: "$([System.IO.Path]::Combine('a','b'))",
    Environment: "$([System.Environment]::GetEnvironmentVariable('MY_VALUE'))", Missing: "$([System.Environment]::GetEnvironmentVariable('HOME'))",
    Date: "$([System.DateTime]::UtcNow.ToString('yyyy-MM-dd'))",
  }), {}, { environment: { MY_VALUE: 'provided' }, clock: () => '2026-10-03T00:00:00Z' });
  noErrors(result);
  assert.equal(result.project.properties.full, '/shared/a.txt');
  assert.equal(result.project.properties.file, 'y.txt');
  assert.equal(result.project.properties.extension, '.txt');
  assert.equal(result.project.properties.changed, 'a.cs');
  assert.equal(result.project.properties.directory, 'a');
  assert.equal(result.project.properties.combined, 'a/b');
  assert.equal(result.project.properties.environment, 'provided');
  assert.equal(result.project.properties.missing, '');
  assert.equal(result.project.properties.date, '2026-10-03');
  assert.throws(() => expandExpression('$([System.DateTime]::UtcNow)'), /clock/);
  assert.throws(() => expandExpression('$([System.Guid]::NewGuid())'), /provider/);
});

const intrinsics = [
  ['Add(2,3)', '5'], ['Subtract(8,3)', '5'], ['Multiply(2,3)', '6'], ['Divide(8,2)', '4'], ['Modulo(8,3)', '2'],
  ['BitwiseOr(1,2)', '3'], ['BitwiseAnd(3,2)', '2'], ['BitwiseXor(3,2)', '1'], ['BitwiseNot(0)', '-1'],
  ["ValueOrDefault('', 'fallback')", 'fallback'], ["EnsureTrailingSlash('src')", 'src/'],
  ["VersionGreaterThan('v2.0-preview','1.9.9')", 'True'], ["VersionEquals('1.0','1.0.0.0')", 'True'],
  ["VersionLessThanOrEquals('1.0', '2.0')", 'True'], ["GetTargetFrameworkIdentifier('net8.0')", '.NETCoreApp'],
  ["GetTargetFrameworkVersion('net48')", '4.8'], ["GetTargetPlatformIdentifier('net8.0-windows10.0.19041')", 'windows'],
  ["IsTargetFrameworkCompatible('net8.0','netstandard2.1')", 'True'], ["AreFeaturesEnabled('17.0')", 'True'],
];
for (const [call, expected] of intrinsics) test('MSBuild intrinsic ' + call, () => {
  assert.equal(expandExpression('$([MSBuild]::' + call + ')'), expected);
});

test('indexed Exists performs bounded directory lookup across 20000 workspace files', () => {
  const paths = Array.from({ length: 20000 }, (_, index) => `project${index % 100}/folder/File${index}.cs`);
  const index = new WorkspacePathIndex(paths, { caseSensitive: false });
  for (let project = 0; project < 100; project++) {
    assert(index.exists(`PROJECT${project}/FOLDER`));
    assert.equal(index.exists(`project${project}/missing`), false);
  }
  assert.equal(index.counters.globCandidates, 0);
  assert.equal(index.counters.exists, 200);
  assert(index.counters.directorySteps <= 400);
  assert.equal(index.glob('project0/**/*.cs').length, 200);
  assert(index.counters.globCandidates <= 200);
  assert.deepEqual(index.glob('PROJECT0/**/*.cs', ['**/*100.cs']).filter(path => path.endsWith('100.cs')), []);
});

test('100 evaluated projects share a path trie over 20000 source files', () => {
  const files = [];
  const projects = [];
  for (let project = 0; project < 100; project++) {
    const path = `Project${project}/App.csproj`;
    projects.push(path);
    files.push({ path, text: '<Project><PropertyGroup Condition="Exists(\'folder\')"><Found>true</Found></PropertyGroup>'
      + '<ItemGroup><X Include="folder/**/*.cs"/></ItemGroup></Project>' });
    for (let file = 0; file < 200; file++) files.push({ path: `Project${project}/folder/File${file}.cs`, text: '' });
  }
  files.push({ path: 'Workspace.slnx', text: '<Solution>' + projects.map(path => `<Project Path="${path}"/>`).join('') + '</Solution>' });
  const system = new ProjectSystem(files, { maxFiles: 21000 });
  const snapshot = system.load('Workspace.slnx');
  noErrors(snapshot);
  assert.equal(snapshot.projects.length, 100);
  assert(snapshot.projects.every(project => project.properties.found === 'true'));
  assert.equal(system.pathIndex.counters.exists, 100);
  assert(system.pathIndex.counters.globCandidates <= 20000);
  assert(system.pathIndex.counters.directorySteps <= 500);
});

test('TFM parsing and nearest compatible framework selection is deterministic', () => {
  assert.equal(parseTargetFramework('net472').version, '4.7.2');
  assert.equal(parseTargetFramework('custom').supported, false);
  assert(isTargetFrameworkCompatible('net8.0', 'netstandard2.1'));
  assert(!isTargetFrameworkCompatible('net48', 'netstandard2.1'));
  assert(!isTargetFrameworkCompatible('net8.0', 'net8.0-windows'));
  assert.equal(nearestTargetFramework('net8.0', ['netstandard2.1', 'net6.0', 'net9.0']), 'net6.0');
});

test('expression and condition budgets reject excessive input and nesting', () => {
  assert.throws(() => expandExpression('x'.repeat(65537)), /limit/);
  assert.throws(() => evaluateCondition('('.repeat(65) + 'true' + ')'.repeat(65)), /limit/);
  assert.throws(() => expandExpression('$(A)', { properties: { A: 'x'.repeat(65537) } }), /limit/);
  let nested = 'x';
  for (let depth = 0; depth < 70; depth++) nested = "$([System.String]::Copy('" + nested + "'))";
  assert.throws(() => expandExpression(nested), /nesting limit/);
  assert.equal(expandExpression("$([System.String]::new('x',3))"), 'xxx');
  for (const count of [-1, 65537]) assert.throws(() => expandExpression(`$([System.String]::new('x',${count}))`), /allowed range/);
  assert.throws(() => expandExpression("$([System.String]::new('too long',2))"), /character/);
});
