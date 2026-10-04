import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverPortableTests} from '../packages/msbuild/src/testing/portable/discovery.js';

const source = `using System;
using Xunit;
namespace Samples {
public class XTests {
  [Fact, Trait("Category", "Fast")] public void Fact() { }
  [Theory, InlineData(2, "x"), InlineData(3, "y")] public void Inline(int value, string text) { }
  [Theory, MemberData(nameof(Rows))] public void Member(int value) { }
  public static object[][] Rows => new object[][] { new object[] { 7 }, new object[] { 8 } };
  [Fact(Skip = "later")] public void Skipped() { }
}
[NUnit.Framework.TestFixture(4), NUnit.Framework.Category("Arithmetic")]
public class NTests {
  public NTests(int value) { }
  [NUnit.Framework.OneTimeSetUp] public void BeforeAll() { }
  [NUnit.Framework.SetUp] public void Before() { }
  [NUnit.Framework.TearDown] public void After() { }
  [NUnit.Framework.TestCase(1), NUnit.Framework.TestCase(2, TestName = "Named case")]
  public void Cases(int value) { }
  [NUnit.Framework.Test, NUnit.Framework.Explicit] public void ExplicitCase() { }
}
[Microsoft.VisualStudio.TestTools.UnitTesting.TestClass]
public class MTests {
  [Microsoft.VisualStudio.TestTools.UnitTesting.TestInitialize] public void Before() { }
  [Microsoft.VisualStudio.TestTools.UnitTesting.TestCleanup] public void After() { }
  [Microsoft.VisualStudio.TestTools.UnitTesting.TestMethod]
  [Microsoft.VisualStudio.TestTools.UnitTesting.DataRow(1, DisplayName = "One")]
  [Microsoft.VisualStudio.TestTools.UnitTesting.DataRow(2)]
  [Microsoft.VisualStudio.TestTools.UnitTesting.Timeout(100)]
  public void Rows(int value) { }
}
}`;

test('A23 T36 source discovery expands xUnit rows with parameter names, traits, source lines and skip reasons', async () => {
  const result = await discoverPortableTests([{uri: 'Tests.cs', text: source}], {project: 'Tests.csproj'});
  const values = result.tests.filter(value => value.framework === 'xunit');
  assert.equal(values.length, 6);
  assert.equal(values.find(value => value.fqn.endsWith('.Inline')).displayName, 'Samples.XTests.Inline(value: 2, text: "x")');
  assert.deepEqual(values.filter(value => value.fqn.endsWith('.Member')).map(value => value.arguments), [[7], [8]]);
  assert.equal(values.find(value => value.fqn.endsWith('.Fact')).source.line, 5);
  assert.deepEqual(values.find(value => value.fqn.endsWith('.Fact')).traits.Category, ['Fast']);
  assert.equal(values.find(value => value.fqn.endsWith('.Skipped')).skipReason, 'later');
  assert.doesNotThrow(() => JSON.stringify(result.tests));
});

test('A23 T37 NUnit parameterized fixtures preserve names, lifecycle stages and explicit status', async () => {
  const {tests} = await discoverPortableTests(source, {project: 'Tests.csproj', frameworks: ['nunit']});
  assert.equal(tests.length, 3);
  assert.equal(tests[0].displayName, 'Cases(1)');
  assert.equal(tests[0].fixtureDisplayName, 'Samples.NTests(4)');
  assert.deepEqual(tests[0].fixtureArguments, [4]);
  assert.equal(tests[1].displayName, 'Named case');
  assert.equal(tests[0].lifecycle.setup[0].name, 'Before');
  assert.equal(tests[0].lifecycle.teardown[0].name, 'After');
  assert.equal(tests[0].lifecycle.classSetup[0].name, 'BeforeAll');
  assert.equal(tests[2].explicit, true);
});

test('A23 T38 MSTest expands display names, Timeout and initialize/cleanup metadata', async () => {
  const {tests} = await discoverPortableTests(source, {project: 'Tests.csproj', frameworks: ['mstest']});
  assert.deepEqual(tests.map(value => value.displayName), ['One', 'Rows (2)']);
  assert.equal(tests[0].timeoutMs, 100);
  assert.equal(tests[0].lifecycle.setup[0].name, 'Before');
  assert.equal(tests[0].lifecycle.teardown[0].name, 'After');
});

test('A23 T36–38 unresolved data is explicitly not-runnable and malformed/cancelled sources are rejected', async () => {
  const result = await discoverPortableTests('class Tests { [Xunit.Theory, Xunit.MemberData("Missing")] public void T(int value){} }',
    {project: 'Tests.csproj'});
  assert.match(result.tests[0].notRunnableReason, /Managed data-provider member was not found: Missing/);
  const invalid = await discoverPortableTests('class Tests { [Xunit.Fact] public void T( }', {project: 'Tests.csproj'});
  assert(invalid.diagnostics.length);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(discoverPortableTests(source, {project: 'Tests.csproj', signal: controller.signal}), {name: 'AbortError'});
  await assert.rejects(discoverPortableTests(source, {project: 'Tests.csproj', maxTests: 1}), /limit/);
});
