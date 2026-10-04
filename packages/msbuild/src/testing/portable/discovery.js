import {discoverTestSymbols} from './source-symbols.js';
import {discoverXunitTests} from './xunit.js';
import {discoverNunitTests} from './nunit.js';
import {discoverMstestTests} from './mstest.js';

/** An explicit adapter registry keeps third-party frameworks out of central discovery branches. */
export function createPortableTestDiscoverers() {
  return new Map([['xunit', discoverXunitTests], ['nunit', discoverNunitTests], ['mstest', discoverMstestTests]]);
}

/** Discover the three framework profiles from compiler-owned declarations, retaining diagnostics and execution preparation data. */
export async function discoverPortableTests(input, options = {}) {
  const symbols = await discoverTestSymbols(input, options);
  const tests = [];
  const discoverers = options.discoverers ?? createPortableTestDiscoverers();
  for (const [framework, discover] of discoverers) {
    if (options.frameworks && !options.frameworks.includes(framework)) continue;
    tests.push(...await discover(symbols, options));
  }
  if (tests.length > (options.maxTests ?? 100_000)) throw new Error('Portable discovered test limit exceeded');
  return {tests, diagnostics: symbols.diagnostics, symbols, backend: 'portable-source'};
}
