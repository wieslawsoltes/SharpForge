/** VSTest filters escape its expression language and are passed as one process argument, without shell evaluation. */
export function testSelectionFilter(tests) {
  if (!Array.isArray(tests) || !tests.length || tests.length > 10_000) throw new Error('Select 1–10000 tests');
  const names = [...new Set(tests.map(test => typeof test === 'string' ? test : test.fqn))];
  return names.map(name => {
    if (typeof name !== 'string' || !name || name.length > 4096 || /[\x00-\x1f]/.test(name)) throw new Error('Invalid test filter name');
    const escaped = name.replaceAll('\\', '\\\\').replace(/[()&|=!~]/g, value => '\\' + value).replaceAll(',', '%2C');
    return 'FullyQualifiedName=' + escaped;
  }).join('|');
}

/** TRX output is requested from the actual test host; result parsing remains a separate phase. */
export function createTestRunArguments(request, directory) {
  const runner = request.runner ?? 'vstest';
  if (!['vstest', 'mtp', 'mtp-bridge'].includes(runner)) throw new Error('Unknown native test runner');
  const args = ['test'];
  if (runner === 'mtp') args.push(/\.slnx?$/i.test(request.project) ? '--solution' : '--project');
  args.push(request.project, '--nologo');
  if (request.noBuild) args.push('--no-build');
  if (request.configuration) args.push('--configuration', request.configuration);
  if (request.framework) args.push('--framework', request.framework);
  if (request.settings && runner !== 'vstest') throw new Error('MTP settings are provided by its registered test framework');
  if (request.settings) args.push('--settings', request.settings);
  if (runner === 'mtp-bridge') args.push('--');
  if (runner === 'vstest') {
    args.push('--results-directory', directory, '--logger', 'trx;LogFileName=results.trx');
    if (request.tests?.length) args.push('--filter', testSelectionFilter(request.tests));
    if (request.coverage) args.push('--collect', 'XPlat Code Coverage');
  } else {
    args.push('--results-directory', directory, '--report-trx', '--report-trx-filename', 'results.trx');
    if (request.tests?.length) {
      const identifiers = request.tests.map(test => test.nativeId).filter(Boolean);
      if (identifiers.length !== request.tests.length) throw new Error('MTP selection requires native test UIDs from discovery');
      if (identifiers.some(id => typeof id !== 'string' || !id || /[\x00-\x1f]/.test(id))) throw new Error('Invalid MTP test UID');
      args.push('--filter-uid', ...identifiers);
    }
    if (request.coverage) args.push('--coverage', '--coverage-output-format', 'cobertura');
  }
  return args;
}
