import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverPortableTests} from '../packages/msbuild/src/testing/portable/discovery.js';
import {runPortableTests} from '../packages/msbuild/src/testing/portable/runner.js';

const source = `using System;
using Xunit;
namespace Fixtures {
public class Shared : IDisposable {
  public static int Created;
  public int Id;
  public Shared() { Created++; Id = Created; }
  public void Dispose() { Console.WriteLine("disposed fixture"); }
}
[CollectionDefinition("Shared")]
public class Definition : ICollectionFixture<Shared> { }
[Collection("Shared")]
public class First {
  Shared data;
  public First(Shared value) { data = value; }
  [Fact] public void Check() { Assert.Equal(1, data.Id); }
}
[Collection("Shared")]
public class Second {
  Shared data;
  public Second(Shared value) { data = value; }
  [Fact] public void Check() { Assert.Equal(1, data.Id); }
}
}`;

for (const backend of ['source', 'cil']) {
  test(`A23 T39 ${backend} collection fixtures are shared between classes and isolated between runs`, async () => {
    const discovery = await discoverPortableTests(source, {project: 'Fixtures.csproj'});
    for (let run = 0; run < 2; run++) {
      const result = await runPortableTests(discovery, {backend});
      assert.deepEqual(result.results.map(value => value.outcome), ['passed', 'passed'], JSON.stringify(result));
    }
  });

  test(`A23 T36 ${backend} computed member providers run in a bounded isolated managed session`, async () => {
    const input = `public class Tests {
      public static System.Collections.Generic.List<object[]> Rows() {
        int value = 3;
        var rows = new System.Collections.Generic.List<object[]>();
        rows.Add(new object[] { value + 2 });
        return rows;
      }
      [Xunit.Theory, Xunit.MemberData(nameof(Rows))]
      public void Data(int number) { Xunit.Assert.Equal(5, number); }
    }`;
    const discovery = await discoverPortableTests(input, {project: 'Data.csproj', backend});
    assert.equal(discovery.tests.length, 1);
    assert.equal(discovery.tests[0].notRunnableReason, null, discovery.tests[0].notRunnableReason);
    assert.deepEqual(discovery.tests[0].arguments, [5]);
    const result = await runPortableTests(discovery, {backend});
    assert.equal(result.results[0].outcome, 'passed', JSON.stringify(result));
  });

  test(`A23 T39 ${backend} fatal budgets stop the run without claiming remaining tests passed`, async () => {
    const discovery = await discoverPortableTests(`public class Tests {
      [Xunit.Fact] public void Infinite() { while (true) { } }
      [Xunit.Fact] public void Later() { Xunit.Assert.True(true); }
    }`, {project: 'Limits.csproj'});
    const result = await runPortableTests(discovery, {backend, maxInstructions: 500});
    assert.equal(result.results[0].outcome, 'timed-out', JSON.stringify(result));
    assert.equal(result.results[1].outcome, 'not-run');
    assert.equal(result.success, false);
  });

  test(`A23 T36 ${backend} computed jagged providers retain row values through managed execution`, async () => {
    const input = `public class Tests {
      public static object[][] Rows() { int value = 3; return new object[][] { new object[] { value + 2 } }; }
      [Xunit.Theory, Xunit.MemberData(nameof(Rows))]
      public void Data(int number) { Xunit.Assert.Equal(5, number); }
    }`;
    const discovery = await discoverPortableTests(input, {project: 'JaggedData.csproj', backend});
    assert.equal(discovery.tests.length, 1);
    assert.equal(discovery.tests[0].notRunnableReason, null);
    assert.deepEqual(discovery.tests[0].arguments, [5]);
    assert.equal((await runPortableTests(discovery, {backend})).results[0].outcome, 'passed');
  });
}
