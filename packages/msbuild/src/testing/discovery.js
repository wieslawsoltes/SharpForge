import {createTestCase} from './model.js';

/** Parse native list-tests output, enriching identities and traits from independently discovered source when available. */
export function parseNativeTestDiscovery(output, options = {}) {
  const {project, sourceTests = [], maxTests = 100_000, backend = 'native-vstest', signal} = options;
  if (typeof output !== 'string' || output.length > 32_000_000) throw new Error('Native test discovery output limit exceeded');
  if (!Array.isArray(sourceTests) || sourceTests.length > 100_000) throw new Error('Native source-test metadata limit exceeded');
  const byDisplay = new Map(sourceTests.map(test => [test.displayName, test]));
  const byFqn = new Map(sourceTests.map(test => [test.fqn, test]));
  const tests = [];
  const seen = new Set();
  let listing = false;
  for (const line of output.split(/\r?\n/)) {
    signal?.throwIfAborted();
    if (/The following Tests are available:|Discovered tests:/i.test(line)) { listing = true; continue; }
    let record = null;
    const trimmed = line.trim();
    if (trimmed.startsWith('{')) {
      try {
        const value = JSON.parse(trimmed);
        if (value.type === 'test' || value.type === 'test-discovered') record = value;
      } catch (error) {
        if (listing) throw new Error('Malformed structured native discovery event', {cause: error});
      }
    }
    if (!record && listing && /^\s{2,}\S/.test(line) && !/^(?:Total tests|Test Run|Attachments|Passed!|Failed!)/.test(trimmed)) {
      record = {displayName: trimmed};
    }
    if (!record) continue;
    const displayName = record.displayName ?? record.name ?? record.fqn;
    const known = byDisplay.get(displayName) ?? byFqn.get(record.fqn ?? displayName);
    const fqn = known?.fqn ?? record.fqn ?? displayName.replace(/\(.*$/, '');
    const test = createTestCase({...known, ...record, project, fqn, displayName: known?.displayName ?? displayName,
      traits: record.traits ?? known?.traits, backend, nativeId: record.id ?? null,
      metadataSource: known ? 'native-discovery-with-source-metadata' : 'native-discovery'});
    if (seen.has(test.id)) continue;
    if (tests.length >= maxTests) throw new Error('Native discovered test limit exceeded');
    seen.add(test.id);
    tests.push(test);
  }
  return {tests, diagnostics: listing || tests.length ? [] : [{code: 'SFT2303', severity: 'warning',
    message: 'The test host produced no recognized discovery records; its raw output is retained.'}]};
}

/** Construct documented native CLI discovery arguments; MTP bridge and .NET 10 runner modes are explicit. */
export function createTestDiscoveryArguments(request) {
  const runner = request.runner ?? 'vstest';
  if (!['vstest', 'mtp', 'mtp-bridge'].includes(runner)) throw new Error('Unknown native test runner');
  const args = ['test'];
  if (runner === 'mtp') args.push(/\.slnx?$/i.test(request.project) ? '--solution' : '--project');
  args.push(request.project, '--nologo');
  if (request.noBuild) args.push('--no-build');
  if (request.configuration) args.push('--configuration', request.configuration);
  if (request.framework) args.push('--framework', request.framework);
  if (request.runner === 'mtp-bridge') args.push('--');
  args.push('--list-tests');
  return args;
}
