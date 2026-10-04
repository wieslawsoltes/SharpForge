export async function qualifySolutions(engine, { msbuildVersion = '' } = {}) {
  const results = [];
  for (const format of ['slnx', 'sln']) for (const graphBuild of [false, true]) {
    const started = await engine.start({ project: 'Fixture.' + format, action: 'build', restore: true, graphBuild, trusted: true });
    const result = await engine.wait(started.id);
    const expected = ['App.dll', 'Library.dll'];
    const passed = result.status === 'succeeded' && expected.every(name => result.artifacts.some(artifact => artifact.path.endsWith('/' + name)));
    const version = /^(\d+)\.(\d+)/.exec(msbuildVersion);
    const predatesSlnx = version && (Number(version[1]) < 17 || Number(version[1]) === 17 && Number(version[2]) < 12);
    const unsupported = !passed && format === 'slnx' && predatesSlnx &&
      result.diagnostics.some(diagnostic => ['MSB4068', 'MSB4041', 'MSB4078'].includes(diagnostic.code));
    results.push({ format, graphBuild, status: passed ? 'passed' : unsupported ? 'unsupported' : 'failed',
      reason: unsupported ? 'This installed MSBuild predates .slnx support; native rejection is retained below' : undefined,
      diagnostics: result.diagnostics, artifacts: result.artifacts, invocation: result.invocation, error: result.error });
  }
  return results;
}
