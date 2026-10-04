import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverPortableTests} from '@sharpforge/msbuild';
import {runPortableTests} from '@sharpforge/msbuild';
import {portableTestSources} from '../packages/msbuild/src/testing/portable/harness.js';

const provider = `using System.Collections; using System.Collections.Generic;
  public class Rows : IEnumerable<object[]> {
    public IEnumerator<object[]> GetEnumerator() { yield return new object[] { 5 }; }
    IEnumerator IEnumerable.GetEnumerator() { return GetEnumerator(); }
  }`;

for (const backend of ['source', 'cil']) {
  test(`A23 T36 ${backend} constant ClassData remains executable without compiling discovery-only iterator declarations`, async () => {
    const input = provider + `public class Tests {
      [Xunit.Theory, Xunit.ClassData(typeof(Rows))] public void Data(int value) { Xunit.Assert.Equal(5, value); }
      [Xunit.Fact] public void Neighbor() { Xunit.Assert.True(true); }
    }`;
    const discovery = await discoverPortableTests(input, {project: 'ClassData.csproj', backend});
    assert.deepEqual(discovery.tests.map(value => value.arguments), [[5], []]);
    const sources = portableTestSources(discovery.symbols, discovery.tests);
    assert.equal(sources[0].text.length, input.length);
    assert.equal(sources[0].text.split('\n').length, input.split('\n').length);
    assert.doesNotMatch(sources[0].text, /class Rows/);
    const result = await runPortableTests(discovery, {backend});
    assert.deepEqual(result.results.map(value => value.outcome), ['passed', 'passed'], JSON.stringify(result));
  });
}

test('A23 T36 providers used by executable code or declaring state remain in the managed source', async () => {
  for (const input of [provider + `public class Tests {
    [Xunit.Theory, Xunit.ClassData(typeof(Rows))] public void Data(int value) { var row = new Rows(); }
  }`, provider.replace('public class Rows :', 'public class Rows :').replace('public IEnumerator', 'static int state = 1; public IEnumerator') +
    `public class Tests { [Xunit.Theory, Xunit.ClassData(typeof(Rows))] public void Data(int value) { } }`]) {
    const discovery = await discoverPortableTests(input, {project: 'Retained.csproj', evaluateData: false});
    assert.match(portableTestSources(discovery.symbols, discovery.tests)[0].text, /class Rows/);
  }
});
