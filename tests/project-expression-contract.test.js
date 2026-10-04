import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCondition, expandExpression, matchesGlob, WorkspacePathIndex, normalizePath, directoryName,
} from '../packages/project-system/src/index.js';

test('condition syntax is fixed before quote, operator and empty property expansion', () => {
  for (const value of ["it's", '"quoted"', '(a) == (b)', 'x Or true', '']) {
    assert.equal(evaluateCondition("'$(A)' == '$(B)'", { properties: { A: value, B: value } }), true);
  }
  assert.equal(evaluateCondition("$(Empty) == ''", { properties: {} }), true);
  assert.equal(evaluateCondition("false And '$([Blocked]::Fail())' == ''"), false);
  assert.equal(evaluateCondition('true Or Exists($([Blocked]::Fail()))'), true);
  assert.equal(evaluateCondition("'2.10.0' > '2.9.9' And 0x10 == 16"), true);
  assert.throws(() => evaluateCondition("'$(A)' =="), error => error.code === 'MSB4092');
  assert.throws(() => evaluateCondition("'left' > 'right'"), error => error.code === 'MSB4086');
  assert.throws(() => evaluateCondition("'maybe'"), error => error.code === 'MSB4130');
});

test('expression scanning preserves adjacent, nested and encoded references without reparsing values', () => {
  const context = { properties: { A: "it's", B: 'ready', Source: ' x ', Injection: '$(B)' } };
  assert.equal(expandExpression('$(A)$(B)', context), "it'sready");
  assert.equal(expandExpression("$([System.String]::Copy('$(Source)').Trim().ToUpperInvariant())", context), 'X');
  assert.equal(expandExpression('%24(A)-%40(X)-%25(M)', context), '$(A)-@(X)-%(M)');
  assert.equal(expandExpression('$([System.String]::Copy(`a(b)c`))'), 'a(b)c');
  assert.equal(expandExpression('$(Injection)', context), '$(B)');
});

const stringMembers = [
  ['Length', '5'], ['Substring(1)', 'baba'], ['Substring(1,2)', 'ba'], ["Replace('a','X')", 'XbXbX'],
  ['ToUpper()', 'ABABA'], ['ToUpperInvariant()', 'ABABA'], ['ToLower()', 'ababa'], ['ToLowerInvariant()', 'ababa'],
  ["Contains('bab')", 'True'], ["StartsWith('AB','OrdinalIgnoreCase')", 'True'], ["EndsWith('BA','OrdinalIgnoreCase')", 'True'],
  ["IndexOf('ba')", '1'], ["LastIndexOf('ba')", '3'], ["Split('b')[1]", 'a'],
  ["PadLeft(7,'0')", '00ababa'], ["PadRight(7,'0')", 'ababa00'], ["Equals('ABABA','OrdinalIgnoreCase')", 'True'],
  ['[2]', 'a'], ["Trim('a')", 'bab'], ["TrimStart('a')", 'baba'], ["TrimEnd('a')", 'abab'],
];
for (const [member, expected] of stringMembers) {
  test('public expression string member ' + member, () => {
    const expression = '$(A' + (member.startsWith('[') ? '' : '.') + member + ')';
    assert.equal(expandExpression(expression, { properties: { A: 'ababa' } }), expected);
  });
}

const functions = [
  ["$([System.String]::Concat('a','b'))", 'ab'], ["$([System.String]::Format('{0}-{1}','a','b'))", 'a-b'],
  ["$([System.String]::IsNullOrWhiteSpace('  '))", 'True'], ['$([System.Math]::Round(2.5))', '2'],
  ['$([System.Math]::Round(3.5))', '4'], ['$([System.Math]::Max(2,8))', '8'],
  ["$([System.Version]::Parse('1.2.3').Major)", '1'], ["$([System.Convert]::ToInt32('FF',16))", '255'],
  ["$([System.Char]::IsDigit('4'))", 'True'], ['$([System.Guid]::Empty)', '00000000-0000-0000-0000-000000000000'],
  ["$([System.Text.RegularExpressions.Regex]::Replace('abc123','[0-9]+','x'))", 'abcx'],
  ['$([MSBuild]::Add(2,3))', '5'], ['$([MSBuild]::BitwiseOr(1,2))', '3'],
  ["$([MSBuild]::VersionGreaterThan('v2.0-preview','1.9.9'))", 'True'],
  ["$([MSBuild]::GetTargetFrameworkIdentifier('net8.0'))", '.NETCoreApp'],
  ["$([MSBuild]::IsTargetFrameworkCompatible('net8.0','netstandard2.1'))", 'True'],
];
for (const [expression, expected] of functions) {
  test('public allow-listed property function ' + expression, () => {
    assert.equal(expandExpression(expression), expected);
  });
}

test('unknown members, disallowed effects and invalid ranges remain located diagnostics', () => {
  for (const expression of [
    '$(A.BadMember)', "$(A.Replace('', 'x'))", '$(A.Substring(-1))', '$(A[100])',
    '$(Unterminated', "$([System.String]::Copy('missing))", '$([System.IO.File]::ReadAllText(x))',
    "$([System.Text.RegularExpressions.Regex]::IsMatch('aaaa!', '(a+)+$'))",
  ]) {
    assert.throws(() => expandExpression(expression, { properties: { A: 'abc' } }), error => /^MSB\d+$/.test(error.code));
  }
  assert.throws(() => expandExpression('$([System.DateTime]::UtcNow)'), /clock/);
  assert.throws(() => expandExpression('$([System.Guid]::NewGuid())'), /provider/);
});

test('virtual paths, environment and clock come only from the explicit context', () => {
  const context = {
    path: 'src/App.csproj', currentFile: 'src/App.csproj', environment: { SUPPLIED: 'visible' },
    clock: () => '2026-10-03T00:00:00Z', pathIndex: new WorkspacePathIndex(['Directory.Build.props']),
    // Directory resolution permits the workspace root; the file-path helper requires a leaf.
    resolvePath: (value, base = 'src') => directoryName(normalizePath(value + '/lookup-leaf', base)),
  };
  assert.equal(expandExpression("$([System.IO.Path]::GetFullPath('../shared/a.txt'))", context), '/shared/a.txt');
  assert.equal(expandExpression("$([System.Environment]::GetEnvironmentVariable('SUPPLIED'))", context), 'visible');
  assert.equal(expandExpression("$([System.Environment]::GetEnvironmentVariable('HOME'))", context), '');
  assert.equal(expandExpression("$([System.DateTime]::UtcNow.ToString('yyyy-MM-dd'))", context), '2026-10-03');
  assert.equal(expandExpression("$([MSBuild]::GetPathOfFileAbove('Directory.Build.props','../'))", context), '/Directory.Build.props');
});

test('item transforms preserve per-item metadata and reject absent contexts', () => {
  const first = { itemType: 'X', identity: 'a.txt', definingProject: 'src/App.csproj', metadata: { Group: 'one' } };
  const second = { ...first, identity: 'b.cs', metadata: { Group: 'two' } };
  const context = {
    path: 'src/App.csproj', items: { X: [first, second] }, currentItem: first,
    resolvePath: value => normalizePath(value, 'src'), exists: value => value === 'a.txt',
  };
  assert.equal(expandExpression("@(X->'%(Filename).out', ',')", context), 'a.out,b.out');
  assert.equal(expandExpression("@(X->WithMetadataValue('Group','one'))", context), 'a.txt');
  assert.equal(expandExpression('@(X->Count())', context), '2');
  assert.equal(expandExpression('@(X->Exists())', context), 'a.txt');
  assert.equal(expandExpression('%(X.FullPath)', context), '/src/a.txt');
  assert.equal(context.currentItem, first);
  assert.equal(evaluateCondition("'@(X)' != '' And '%(X.Group)' == 'one'", context), true);
  assert.throws(() => evaluateCondition("'@(X)' == ''"), error => error.code === 'MSB4191');
  assert.throws(() => evaluateCondition("'%(M)' == ''"), error => error.code === 'MSB4191');
});

test('indexed path membership, mutation and prefix globs remain bounded', () => {
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
  index.remove('project0/folder/File0.cs');
  assert.equal(index.exists('PROJECT0/FOLDER/FILE0.CS'), false);
  index.add('project0/folder/New.cs');
  assert.equal(index.canonical('PROJECT0/FOLDER/NEW.CS'), 'project0/folder/New.cs');
  assert(matchesGlob('a.cs', '**/*.cs'));
  assert(matchesGlob('src/A.cs', 'src/*.CS', { caseSensitive: false }));
  assert.throws(() => matchesGlob('a', 'x'.repeat(4097)), error => error.code === 'MSB0001');
  assert.throws(() => new WorkspacePathIndex(['a.cs', 'b.cs'], { maxMatches: 1 }).glob('*.cs'), /limit/);
});

test('expression and condition text, nesting and expanded output budgets are enforced', () => {
  assert.throws(() => expandExpression('x'.repeat(65537)), /limit/);
  assert.throws(() => expandExpression('$(A)', { properties: { A: 'x'.repeat(33) }, limits: { expressionLength: 32 } }), /limit/);
  assert.throws(() => evaluateCondition('('.repeat(65) + 'true' + ')'.repeat(65)), /limit/);
  assert.throws(() => evaluateCondition(' '.repeat(16385) + 'true'), /limit/);
});
