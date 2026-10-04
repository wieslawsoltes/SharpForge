import test from 'node:test';
import assert from 'node:assert/strict';
import {frameworkFixtures} from './msbuild-differential/framework-fixtures.js';
import {discoverPortableTests} from '@sharpforge/msbuild';
import {runPortableTests} from '@sharpforge/msbuild';

for (const backend of ['source', 'cil']) {
  test(`A23 T35–39 ${backend} executes the exact shared native framework fixture sources`, async () => {
    for (const fixture of frameworkFixtures) {
      const discovery = await discoverPortableTests(fixture.source, {project: fixture.framework + '/Tests.csproj', backend});
      const count = fixture.framework === 'xunit' ? 8 : 6;
      assert.equal(discovery.tests.length, count, fixture.framework);
      assert.equal(new Set(discovery.tests.map(value => value.id)).size, count);
      const result = await runPortableTests(discovery, {backend});
      for (const item of result.results) {
        const expected = item.fqn.endsWith('.Fail') ? 'failed' : item.fqn.endsWith('.Skip') ? 'skipped' : 'passed';
        assert.equal(item.outcome, expected, JSON.stringify({framework: fixture.framework, item}));
      }
      assert.equal(result.results.length, count);
      const failure = result.results.find(value => value.fqn.endsWith('.Fail'));
      assert.match(failure.message, /Expected|Assert|equal/i);
      const assertion = fixture.source.indexOf('Assert.', fixture.source.indexOf('void Fail()'));
      assert.equal(failure.source.start, assertion);
      assert.equal(failure.source.line, fixture.source.slice(0, assertion).split('\n').length);
      const declaration = discovery.tests.find(value => value.fqn.endsWith('.Fail')).source;
      assert.equal(declaration.start, fixture.source.indexOf('Fail()'));
    }
  });
}
