import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverPortableTests} from '../packages/msbuild/src/testing/portable/discovery.js';
import {runPortableTests, PortableTestAdapter} from '../packages/msbuild/src/testing/portable/runner.js';

const source = `using System;
namespace Samples {
public class XTests {
  int value;
  [Xunit.Fact] public void Pass() { value++; Xunit.Assert.Equal(1, value); Console.WriteLine("pass output"); }
  [Xunit.Fact] public void Another() { value++; Xunit.Assert.Equal(1, value); }
  [Xunit.Fact] public void Fail() { Xunit.Assert.Equal(1, 2); }
  [Xunit.Fact(Skip = "planned")] public void Skip() { throw new Exception("must not execute"); }
}
[NUnit.Framework.TestFixture]
public class NTests {
  int count;
  [NUnit.Framework.OneTimeSetUp] public void Once() { count = 10; }
  [NUnit.Framework.SetUp] public void Before() { count++; }
  [NUnit.Framework.Test] public void First() { NUnit.Framework.Assert.That(count, NUnit.Framework.Is.EqualTo(11)); }
  [NUnit.Framework.Test] public void Second() { NUnit.Framework.Assert.That(count, NUnit.Framework.Is.EqualTo(12)); }
}
[Microsoft.VisualStudio.TestTools.UnitTesting.TestClass]
public class MTests {
  int value;
  [Microsoft.VisualStudio.TestTools.UnitTesting.TestInitialize] public void Before() { value = 4; }
  [Microsoft.VisualStudio.TestTools.UnitTesting.TestCleanup] public void After() { Console.WriteLine("cleanup"); }
  [Microsoft.VisualStudio.TestTools.UnitTesting.TestMethod]
  [Microsoft.VisualStudio.TestTools.UnitTesting.DataRow(4)]
  public void Row(int expected) { Microsoft.VisualStudio.TestTools.UnitTesting.Assert.AreEqual(expected, value); }
}
}`;

for (const backend of ['source', 'cil']) {
  test(`A23 T39 ${backend} executes three frameworks with real assertions, per-test instances and one-time fixtures`, async () => {
    const discovery = await discoverPortableTests(source, {project: 'Tests.csproj'});
    const events = [];
    const run = await runPortableTests(discovery, {backend, onEvent: event => events.push(event)});
    assert.equal(run.results.length, 7);
    const outcome = suffix => run.results.find(result => result.fqn.endsWith(suffix));
    assert.equal(outcome('.Pass').outcome, 'passed', outcome('.Pass').message);
    assert.equal(outcome('.Another').outcome, 'passed', outcome('.Another').message);
    assert.equal(outcome('.Fail').outcome, 'failed');
    assert.equal(outcome('.Skip').outcome, 'skipped');
    assert.equal(outcome('.First').outcome, 'passed', outcome('.First').message);
    assert.equal(outcome('.Second').outcome, 'passed', outcome('.Second').message);
    assert.equal(outcome('.Row').outcome, 'passed', outcome('.Row').message);
    assert.match(outcome('.Pass').stdout, /pass output/);
    assert.match(outcome('.Row').stdout, /cleanup/);
    assert(events.some(event => event.kind === 'test-started'));
    assert.equal(run.success, false);
  });
}

test('A23 T39 unsupported APIs are not-runnable while supported neighboring tests execute', async () => {
  const discovery = await discoverPortableTests('public class Tests { [Xunit.Fact] public void Bad() { MissingApi.Do(); } ' +
    '[Xunit.Fact] public void Good() { Xunit.Assert.True(true); } }', {project: 'Tests.csproj'});
  const result = await runPortableTests(discovery);
  assert.equal(result.results.find(value => value.fqn.endsWith('.Bad')).outcome, 'not-runnable');
  assert.equal(result.results.find(value => value.fqn.endsWith('.Good')).outcome, 'passed');
});

test('A23 T39 disposed adapters reject work and cancellation reports remaining tests not-run', async () => {
  const adapter = new PortableTestAdapter();
  const controller = new AbortController();
  const discovery = await adapter.discover(source, {project: 'Tests.csproj'});
  controller.abort();
  await assert.rejects(adapter.run(discovery, {signal: controller.signal}), {name: 'AbortError'});
  adapter.close();
  await assert.rejects(adapter.discover(source), /disposed/);
});
