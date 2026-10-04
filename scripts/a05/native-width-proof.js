import assert from 'node:assert/strict';

/** Require observed CLR process width and matching execution routes, not the Node host architecture. */
export function verifyNativeWidthReport(report, {bits, sdk}) {
  assert([32, 64].includes(bits), 'Expected native width must be 32 or 64');
  assert.equal(report.status, 'passed', 'Native fixture must pass before width qualification');
  assert.equal(report.passed, true);
  assert.equal(report.fixture, 'native-width');
  assert.equal(report.dotnetSdk, sdk, 'The exact requested SDK must compile the fixture');
  assert.equal(report.nativeRuntime?.nativeIntBits, bits, 'Actual CLR process width differs from requested width');
  const architecture = report.nativeRuntime.processArchitecture;
  assert(bits === 32 ? architecture === 'X86' : ['X64', 'Arm64'].includes(architecture), 'Actual CLR process architecture differs');
  assert.equal(report.native.exitCode, 0);
  assert.equal(report.native.signal, null);
  assert.equal(report.nativeRuntime.exitCode, 0);
  assert.equal(report.nativeRuntime.signal, null);
  assert.deepEqual(report.native.output.split('\n').slice(0, 2), [String(bits / 8), String(bits / 8)], 'Guest pointer-size output');
  assert.equal(report.cil.state, 'terminated');
  assert.equal(report.cil.exitCode, 0);
  assert.equal(report.cil.output, report.native.output);
  assert.equal(report.sourceRoutes?.nativeIntBits, bits, 'Compiler routes must use the observed CLR width');
  assert.deepEqual(report.sourceRoutes.routes.map(route => route.engine), ['source', 'reloaded-source', 'compiled-cil']);
  for (const route of report.sourceRoutes.routes) {
    assert.equal(route.state, 'terminated', route.engine);
    assert.equal(route.exitCode, 0, route.engine);
    assert.equal(route.output, report.native.output, route.engine);
  }
  assert.match(report.assemblySha256, /^[a-f0-9]{64}$/);
  assert.match(report.nativeRuntime.probe.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(report.nativeRuntime.probe.assemblySha256, /^[a-f0-9]{64}$/);
  assert.match(report.nativeRuntime.runtimeConfig.sha256, /^[a-f0-9]{64}$/);
  return {bits, sdk, processArchitecture: architecture, assemblySha256: report.assemblySha256,
    sourceSha256: report.sourceRoutes.sourceSha256, nativeRuntime: report.nativeRuntime};
}
