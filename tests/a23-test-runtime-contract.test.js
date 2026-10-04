import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagedTestRuntime, discoverTestSymbols, portableAssertionCapabilities} from '@sharpforge/msbuild';

async function prepared(source) {
  const symbols = await discoverTestSymbols([{uri: 'Tests.cs', text: source}]);
  const tests = symbols.methods.filter(method => method.attributes.some(value => value.type.endsWith('Fact'))).map(method => ({
    id: method.fqn, fqn: method.fqn, framework: 'xunit', className: method.className, executionClassName: method.className,
    method, source: method.source, arguments: [], lifecycle: {}
  }));
  return {symbols, tests};
}

for (const backend of ['source', 'cil']) {
  test(`prepared ${backend} test runtimes execute real managed assertions and isolate static state between factory calls`, async () => {
    const discovery = await prepared(`public class Tests {
      static int runs;
      [Xunit.Fact] public void Pass() { runs++; Xunit.Assert.Equal(1, runs); System.Console.WriteLine("managed"); }
    }`);
    for (let attempt = 0; attempt < 2; attempt++) {
      const runtime = await createManagedTestRuntime(discovery, {backend});
      try {
        assert.equal(runtime.hasRunnableTests, true);
        assert.equal(runtime.unavailable.size, 0);
        assert.equal(runtime.groups.length, 1);
        assert.equal((await runtime.initialize()).fault, null);
        assert.equal((await runtime.initializeGroup(runtime.groups[0])).fault, null);
        const result = await runtime.execute(discovery.tests[0]);
        assert.equal(result.fault, null);
        assert.match(result.stdout, /managed/);
        assert.equal((await runtime.cleanupGroup(runtime.groups[0])).fault, null);
        assert.equal((await runtime.cleanup()).fault, null);
      } finally { runtime.dispose(); }
      await assert.rejects(runtime.execute(discovery.tests[0]), /disposed/);
    }
  });

  test(`prepared ${backend} runtimes retain missing-API diagnostics while compiling a supported neighbor`, async () => {
    const discovery = await prepared(`public class Tests {
      [Xunit.Fact] public void Bad() { MissingApi.Do(); }
      [Xunit.Fact] public void Good() { Xunit.Assert.True(true); }
    }`);
    const runtime = await createManagedTestRuntime(discovery, {backend});
    try {
      assert.equal(runtime.hasRunnableTests, true);
      const bad = discovery.tests.find(value => value.fqn.endsWith('.Bad'));
      const good = discovery.tests.find(value => value.fqn.endsWith('.Good'));
      assert.ok(runtime.unavailable.get(bad.id).some(value => value.severity === 'error'));
      assert.equal(runtime.unavailable.has(good.id), false);
      await runtime.initialize();
      await runtime.initializeGroup(runtime.groups[0]);
      assert.equal((await runtime.execute(good)).fault, null);
      await runtime.cleanupGroup(runtime.groups[0]);
      await runtime.cleanup();
    } finally { runtime.dispose(); }
  });
}

test('managed test preparation rejects unsupported backends and observes cancellation before compilation', async () => {
  const discovery = await prepared('public class Tests { [Xunit.Fact] public void Pass() { } }');
  await assert.rejects(createManagedTestRuntime(discovery, {backend: 'native'}), /source and CIL/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createManagedTestRuntime(discovery, {signal: controller.signal}), {name: 'AbortError'});
  const skipped = {...discovery, tests: discovery.tests.map(value => ({...value, skipReason: 'planned'}))};
  const runtime = await createManagedTestRuntime(skipped);
  assert.equal(runtime.hasRunnableTests, false);
  runtime.dispose();
  assert.ok(portableAssertionCapabilities.xunit.includes('True'));
});
